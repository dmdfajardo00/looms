import { promises as fs } from "node:fs";
import { db } from "@cap/database";
import {
	organizations,
	users,
	videos,
	videoUploads,
} from "@cap/database/schema";
import type { VideoMetadata } from "@cap/database/types";
import { serverEnv } from "@cap/env";
import { userIsPro } from "@cap/utils";
import { Storage } from "@cap/web-backend";
import {
	AI_GENERATION_LANGUAGE_AUTO,
	type AiGenerationLanguage,
	parseAiGenerationLanguage,
	type Video,
} from "@cap/web-domain";
import { eq } from "drizzle-orm";
import { FatalError } from "workflow";
import {
	ENHANCED_AUDIO_CONTENT_TYPE,
	ENHANCED_AUDIO_EXTENSION,
	enhanceAudioFromUrl,
} from "@/lib/audio-enhance";
import { checkHasAudioTrack, extractAudioFromUrl } from "@/lib/audio-extract";
import { startAiGeneration } from "@/lib/generate-ai";
import {
	checkHasAudioTrackViaMediaServer,
	extractAudioViaMediaServer,
	isMediaServerConfigured,
	probeVideoViaMediaServer,
} from "@/lib/media-client";
import { runPromise } from "@/lib/server";
import { decodeStorageVideo } from "@/lib/video-storage";

interface TranscribeWorkflowPayload {
	videoId: string;
	userId: string;
	aiGenerationEnabled: boolean;
}

interface VideoData {
	video: typeof videos.$inferSelect;
	transcriptionDisabled: boolean;
	isOwnerPro: boolean;
	aiGenerationLanguage: AiGenerationLanguage;
}

export async function transcribeVideoWorkflow(
	payload: TranscribeWorkflowPayload,
) {
	"use workflow";

	return runTranscribeBody(payload);
}

export async function runTranscribeInline(
	payload: TranscribeWorkflowPayload,
): Promise<{ success: boolean; message: string }> {
	try {
		return await runTranscribeBody(payload);
	} catch (error) {
		console.error(
			`[transcribeInline] Workflow failed for video ${payload.videoId}:`,
			error,
		);
		return {
			success: false,
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

async function runTranscribeBody(payload: TranscribeWorkflowPayload) {
	const { videoId, userId, aiGenerationEnabled } = payload;

	const videoData = await validateVideo(videoId);

	if (videoData.transcriptionDisabled) {
		await markSkipped(videoId);
		return { success: true, message: "Transcription disabled - skipped" };
	}

	try {
		const audioUrl = await extractAudio(videoId, userId, videoData.video);

		if (!audioUrl) {
			await markNoAudio(videoId);
			return {
				success: true,
				message: "Video has no audio track - skipped transcription",
			};
		}

		const [transcription] = await Promise.all([
			transcribeWithGladia(audioUrl, videoData.aiGenerationLanguage),
		]);

		await saveTranscription(videoId, userId, videoData.video, transcription);
	} catch (error) {
		await markError(videoId);
		await cleanupTempAudio(videoId, userId, videoData.video);
		throw error;
	}

	await cleanupTempAudio(videoId, userId, videoData.video);

	if (aiGenerationEnabled) {
		await queueAiGeneration(videoId, userId);
	}

	return { success: true, message: "Transcription completed successfully" };
}

async function validateVideo(videoId: string): Promise<VideoData> {
	"use step";

	if (!serverEnv().GLADIA_API_KEY) {
		throw new FatalError("Missing GLADIA_API_KEY");
	}

	const query = await db()
		.select({
			video: videos,
			settings: videos.settings,
			orgSettings: organizations.settings,
			owner: users,
		})
		.from(videos)
		.leftJoin(organizations, eq(videos.orgId, organizations.id))
		.innerJoin(users, eq(videos.ownerId, users.id))
		.where(eq(videos.id, videoId as Video.VideoId));

	if (query.length === 0) {
		throw new FatalError("Video does not exist");
	}

	const result = query[0];
	if (!result?.video) {
		throw new FatalError("Video information is missing");
	}

	const transcriptionDisabled =
		result.video.settings?.disableTranscript ??
		result.orgSettings?.disableTranscript ??
		false;

	const isOwnerPro = userIsPro(result.owner);

	console.log(
		`[transcribe] Owner check: stripeSubscriptionStatus=${result.owner.stripeSubscriptionStatus}, thirdPartyStripeSubscriptionId=${result.owner.thirdPartyStripeSubscriptionId}, isOwnerPro=${isOwnerPro}`,
	);

	await db()
		.update(videos)
		.set({ transcriptionStatus: "PROCESSING" })
		.where(eq(videos.id, videoId as Video.VideoId));

	return {
		video: result.video,
		transcriptionDisabled,
		isOwnerPro,
		aiGenerationLanguage: parseAiGenerationLanguage(
			result.orgSettings?.aiGenerationLanguage,
		),
	};
}

async function markSkipped(videoId: string): Promise<void> {
	"use step";

	await db()
		.update(videos)
		.set({ transcriptionStatus: "SKIPPED" })
		.where(eq(videos.id, videoId as Video.VideoId));
}

async function markNoAudio(videoId: string): Promise<void> {
	"use step";

	await db()
		.update(videos)
		.set({ transcriptionStatus: "NO_AUDIO" })
		.where(eq(videos.id, videoId as Video.VideoId));
}

async function markError(videoId: string): Promise<void> {
	"use step";

	await db()
		.update(videos)
		.set({ transcriptionStatus: "ERROR" })
		.where(eq(videos.id, videoId as Video.VideoId));
}

async function extractAudio(
	videoId: string,
	userId: string,
	video: typeof videos.$inferSelect,
): Promise<string | null> {
	"use step";

	const [bucket] = await Storage.getAccessForVideo(
		decodeStorageVideo(video),
	).pipe(runPromise);

	const videoUrl = await resolveVideoSourceUrl(videoId, userId, video);

	const useMediaServer = isMediaServerConfigured();
	console.log(
		`[transcribe] Audio detection: useMediaServer=${useMediaServer}, videoId=${videoId}`,
	);

	let hasAudio: boolean;
	let audioBuffer: Buffer;

	if (useMediaServer) {
		try {
			const probe = await probeVideoViaMediaServer(videoUrl);
			console.log(
				`[transcribe] Probe result for ${videoId}: audioCodec=${probe.audioCodec}, videoCodec=${probe.videoCodec}, duration=${probe.duration}, audioChannels=${probe.audioChannels}, sampleRate=${probe.sampleRate}`,
			);
			hasAudio = probe.audioCodec !== null;
		} catch (probeError) {
			console.error(
				`[transcribe] Probe failed for ${videoId}, falling back to audio check:`,
				probeError,
			);
			hasAudio = await checkHasAudioTrackViaMediaServer(videoUrl);
			console.log(
				`[transcribe] Fallback audio check result for ${videoId}: hasAudio=${hasAudio}`,
			);
		}

		if (!hasAudio) {
			console.log(
				`[transcribe] No audio track detected for ${videoId} via media server`,
			);
			return null;
		}

		audioBuffer = await extractAudioViaMediaServer(videoUrl);
	} else {
		hasAudio = await checkHasAudioTrack(videoUrl);
		console.log(
			`[transcribe] Local ffmpeg audio check for ${videoId}: hasAudio=${hasAudio}`,
		);
		if (!hasAudio) {
			return null;
		}

		const result = await extractAudioFromUrl(videoUrl);

		try {
			audioBuffer = await fs.readFile(result.filePath);
		} finally {
			await result.cleanup();
		}
	}

	console.log(
		`[transcribe] Extracted audio for ${videoId}: ${audioBuffer.length} bytes`,
	);

	const audioKey = `${userId}/${videoId}/audio-temp.mp3`;

	await bucket
		.putObject(audioKey, audioBuffer, {
			contentType: "audio/mpeg",
		})
		.pipe(runPromise);

	const audioSignedUrl = await bucket
		.getInternalSignedObjectUrl(audioKey)
		.pipe(runPromise);

	return audioSignedUrl;
}

async function resolveVideoSourceUrl(
	videoId: string,
	userId: string,
	video: typeof videos.$inferSelect,
): Promise<string> {
	const [resolvedBucket] = await Storage.getAccessForVideo(
		decodeStorageVideo(video),
	).pipe(runPromise);

	const upload = await db()
		.select({ rawFileKey: videoUploads.rawFileKey })
		.from(videoUploads)
		.where(eq(videoUploads.videoId, videoId as Video.VideoId))
		.limit(1);

	const candidateKeys = [
		`${userId}/${videoId}/result.mp4`,
		upload[0]?.rawFileKey,
	].filter(
		(value, index, values): value is string =>
			Boolean(value) && values.indexOf(value) === index,
	);

	for (const key of candidateKeys) {
		const url = await resolvedBucket
			.getInternalSignedObjectUrl(key)
			.pipe(runPromise);
		const response = await fetch(url, {
			method: "GET",
			headers: { range: "bytes=0-0" },
		});

		if (response.ok) {
			console.log(`[transcribe] Using video source ${key}`);
			return url;
		}
	}

	throw new Error("Video file not accessible");
}

async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	timeoutMs: number,
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

const GLADIA_API_BASE = "https://api.gladia.io";
const GLADIA_POLL_TIMEOUT_MS = 10 * 60 * 1000;
const GLADIA_POLL_INITIAL_DELAY_MS = 2_000;
const GLADIA_POLL_MAX_DELAY_MS = 10_000;

type GladiaUploadResponse = {
	audio_url: string;
};

type GladiaInitResponse = {
	id: string;
	result_url: string;
};

type GladiaSubtitle = {
	format: "srt" | "vtt";
	subtitles: string;
};

type GladiaResultResponse = {
	status: "queued" | "processing" | "done" | "error";
	error_code?: number | null;
	result?: {
		transcription?: {
			subtitles?: GladiaSubtitle[];
		};
	};
};

async function transcribeWithGladia(
	audioUrl: string,
	language: AiGenerationLanguage,
): Promise<string> {
	"use step";

	const apiKey = serverEnv().GLADIA_API_KEY as string;
	console.log("[gladia] downloading audio from signed URL");

	const audioResponse = await fetchWithTimeout(audioUrl, {}, 30_000);
	if (!audioResponse.ok) {
		throw new Error(
			`Audio URL not accessible: ${audioResponse.status} ${audioResponse.statusText}`,
		);
	}
	const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
	console.log(`[gladia] audio downloaded: ${audioBuffer.length} bytes`);

	const form = new FormData();
	form.append(
		"audio",
		new Blob([audioBuffer], { type: "audio/mpeg" }),
		"audio.mp3",
	);

	console.log("[gladia] POST /v2/upload");
	const uploadResp = await fetchWithTimeout(
		`${GLADIA_API_BASE}/v2/upload`,
		{
			method: "POST",
			headers: { "x-gladia-key": apiKey },
			body: form,
		},
		60_000,
	);
	if (!uploadResp.ok) {
		throw new Error(
			`Gladia upload failed: ${uploadResp.status} ${await uploadResp.text()}`,
		);
	}
	const { audio_url: gladiaAudioUrl } =
		(await uploadResp.json()) as GladiaUploadResponse;
	console.log(`[gladia] upload OK, audio_url=${gladiaAudioUrl}`);

	const initBody: Record<string, unknown> = {
		audio_url: gladiaAudioUrl,
		subtitles: true,
		subtitles_config: { formats: ["vtt"] },
		punctuation_enhanced: true,
	};
	if (language !== AI_GENERATION_LANGUAGE_AUTO) {
		initBody.language_config = { languages: [language] };
	}

	console.log("[gladia] POST /v2/pre-recorded");
	const initResp = await fetchWithTimeout(
		`${GLADIA_API_BASE}/v2/pre-recorded`,
		{
			method: "POST",
			headers: {
				"x-gladia-key": apiKey,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(initBody),
		},
		30_000,
	);
	if (!initResp.ok) {
		throw new Error(
			`Gladia init failed (language=${language}): ${initResp.status} ${await initResp.text()}`,
		);
	}
	const { result_url: resultUrl } =
		(await initResp.json()) as GladiaInitResponse;
	console.log(`[gladia] init OK, polling ${resultUrl}`);

	const startedAt = Date.now();
	let delayMs = GLADIA_POLL_INITIAL_DELAY_MS;
	while (Date.now() - startedAt < GLADIA_POLL_TIMEOUT_MS) {
		await new Promise((resolve) => setTimeout(resolve, delayMs));
		const poll = await fetchWithTimeout(
			resultUrl,
			{ headers: { "x-gladia-key": apiKey } },
			15_000,
		);
		if (!poll.ok) {
			throw new Error(
				`Gladia poll failed: ${poll.status} ${await poll.text()}`,
			);
		}
		const data = (await poll.json()) as GladiaResultResponse;
		if (data.status === "done") {
			const vtt = data.result?.transcription?.subtitles?.find(
				(subtitle) => subtitle.format === "vtt",
			)?.subtitles;
			if (!vtt) {
				throw new Error("Gladia transcription completed without VTT output");
			}
			return vtt;
		}
		if (data.status === "error") {
			throw new Error(
				`Gladia transcription error (code=${data.error_code ?? "unknown"})`,
			);
		}
		delayMs = Math.min(delayMs * 1.5, GLADIA_POLL_MAX_DELAY_MS);
	}
	throw new Error("Gladia transcription timed out after 10 minutes");
}

async function saveTranscription(
	videoId: string,
	userId: string,
	video: typeof videos.$inferSelect,
	transcription: string,
): Promise<void> {
	"use step";

	const [bucket] = await Storage.getAccessForVideo(
		decodeStorageVideo(video),
	).pipe(runPromise);

	await bucket
		.putObject(`${userId}/${videoId}/transcription.vtt`, transcription, {
			contentType: "text/vtt",
		})
		.pipe(runPromise);

	await db()
		.update(videos)
		.set({ transcriptionStatus: "COMPLETE" })
		.where(eq(videos.id, videoId as Video.VideoId));
}

async function cleanupTempAudio(
	videoId: string,
	userId: string,
	video: typeof videos.$inferSelect,
): Promise<void> {
	"use step";

	const audioKey = `${userId}/${videoId}/audio-temp.mp3`;

	try {
		const [bucket] = await Storage.getAccessForVideo(
			decodeStorageVideo(video),
		).pipe(runPromise);

		await bucket.deleteObject(audioKey).pipe(runPromise);
	} catch (error) {
		console.error(
			`[transcribe] Failed to cleanup temp audio file: ${audioKey}`,
			error,
		);
	}
}

async function queueAiGeneration(
	videoId: string,
	userId: string,
): Promise<void> {
	"use step";

	await startAiGeneration(videoId as Video.VideoId, userId);
}

async function _markEnhancedAudioProcessing(videoId: string): Promise<void> {
	"use step";

	const [video] = await db()
		.select({ metadata: videos.metadata })
		.from(videos)
		.where(eq(videos.id, videoId as Video.VideoId));

	const currentMetadata = (video?.metadata as VideoMetadata) || {};

	await db()
		.update(videos)
		.set({
			metadata: {
				...currentMetadata,
				enhancedAudioStatus: "PROCESSING",
			},
		})
		.where(eq(videos.id, videoId as Video.VideoId));
}

async function _enhanceAndSaveAudio(
	videoId: string,
	userId: string,
	audioUrl: string,
	video: typeof videos.$inferSelect,
): Promise<void> {
	"use step";

	console.log(`[transcribe] Starting audio enhancement for video ${videoId}`);

	try {
		const enhancedBuffer = await enhanceAudioFromUrl(audioUrl);
		console.log(
			`[transcribe] Audio enhanced, saving to S3 (${enhancedBuffer.length} bytes)`,
		);

		const [bucket] = await Storage.getAccessForVideo(
			decodeStorageVideo(video),
		).pipe(runPromise);

		const enhancedAudioKey = `${userId}/${videoId}/enhanced-audio.${ENHANCED_AUDIO_EXTENSION}`;

		await bucket
			.putObject(enhancedAudioKey, enhancedBuffer, {
				contentType: ENHANCED_AUDIO_CONTENT_TYPE,
			})
			.pipe(runPromise);

		const [videoRecord] = await db()
			.select({ metadata: videos.metadata })
			.from(videos)
			.where(eq(videos.id, videoId as Video.VideoId));

		const currentMetadata = (videoRecord?.metadata as VideoMetadata) || {};

		await db()
			.update(videos)
			.set({
				metadata: {
					...currentMetadata,
					enhancedAudioStatus: "COMPLETE",
				},
			})
			.where(eq(videos.id, videoId as Video.VideoId));
	} catch (error) {
		console.error(
			`[transcribe] Audio enhancement failed for video ${videoId}:`,
			error,
		);

		const [video] = await db()
			.select({ metadata: videos.metadata })
			.from(videos)
			.where(eq(videos.id, videoId as Video.VideoId));

		const currentMetadata = (video?.metadata as VideoMetadata) || {};

		await db()
			.update(videos)
			.set({
				metadata: {
					...currentMetadata,
					enhancedAudioStatus: "ERROR",
				},
			})
			.where(eq(videos.id, videoId as Video.VideoId));
	}
}
