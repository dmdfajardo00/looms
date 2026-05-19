<p align="center">
	<img width="120" height="120" src="apps/web/public/looms-mark.svg" alt="Looms">
</p>

<h1 align="center">Looms</h1>

<p align="center">
	A self-hosted screen-recording app at <a href="https://looms.dmdfajardo.pro">looms.dmdfajardo.pro</a>.
	<br/>
	Personal fork of <a href="https://github.com/CapSoftware/Cap">CapSoftware/Cap</a>. Built for sending recordings to clients without paying a SaaS.
</p>

<p align="center">
	<a href="https://looms.dmdfajardo.pro">looms.dmdfajardo.pro</a>
</p>

---

## What this is

Looms is my private screen-recording tool. It runs on my own VPS, stores recordings on my own Cloudflare R2 bucket, transcribes them through Gladia, and emails magic-link logins through Resend — all under my own domain. When I send a client a `looms.dmdfajardo.pro/s/<id>` link, they get the Loom-style experience without me paying $20/seat/month for it.

It started as a fork of the excellent open-source [Cap](https://github.com/CapSoftware/Cap) project. I rebranded it, swapped Deepgram for Gladia, patched the R2 storage layer, fixed multipart upload chunking for R2's stricter spec, white-labelled all user-visible Cap branding, and stripped out the upsell UI that doesn't apply to a self-hosted single-user deploy.

**This repo is not affiliated with CapSoftware Pty Ltd.** It's a private fork for personal use. All upstream rights belong to the original authors. If you want the real Cap product, go to [cap.so](https://cap.so).

## Why fork instead of use Loom or Cap Cloud

- **Cost.** $20/user/month for Loom Business adds up. The VPS is already paid for.
- **Data ownership.** Every video lives in my R2 bucket. No vendor.
- **Custom domain.** `looms.dmdfajardo.pro/s/<id>` is the share URL. Clients see my brand, not someone else's.
- **Zero egress.** Cloudflare R2 has no egress fees — important for a video product.
- **The story.** When a client sees a `looms.dmdfajardo.pro` link, they ask "wait, did you build your own?" That's the impression I want.

## Stack

| Layer | Choice | Why |
|-|-|-|
| Hosting | Hostinger VPS, Dokploy | I already run other services here |
| Web app | Forked Cap (Next.js + Tauri) | Open source, polished, complete |
| Object storage | Cloudflare R2 | Zero egress + custom domain at apex |
| Transcription | [Gladia](https://gladia.io) | Better multilingual accuracy than Deepgram |
| Email | [Resend](https://resend.com) | Domain already verified |
| Reverse proxy | Traefik (via Dokploy) | Let's Encrypt + auto-routing |
| Brand | "Looms" (plural) | Loom-adjacent without trademark exposure |

## Architecture

```
Browser ──HTTPS──► looms.dmdfajardo.pro ──► Traefik ──► looms-web (Next.js)
                                                         │
                                                         ├──► mysql              (auth, video metadata)
                                                         ├──► media-server       (ffmpeg jobs, thumbs)
                                                         ├──► Gladia API         (transcription)
                                                         └──► Resend API         (magic-link emails)

Browser ──HTTPS──► dmdfajardo.pro/<key> ──► Cloudflare R2 ──► screen-recordings bucket
                          ▲
                          │ unsigned public reads
                          │
Browser ──signed PUT──────┘
              (uploads go via <account>.r2.cloudflarestorage.com, path-style)
```

## Three load-bearing changes from upstream Cap

These three patches are what make this fork actually work on my setup:

1. **R2 custom-domain at root.** Cap's S3 SDK generates path-style URLs (`https://<endpoint>/<bucket>/<key>`). Cloudflare R2 with a custom domain bound to the apex serves the bucket at root (no bucket prefix). Patched `S3BucketAccess.getSignedObjectUrl()` to return unsigned `${publicBucketUrl}/${key}` when `S3_PUBLIC_BUCKET_URL` env is set. Upload presign URLs route through the internal R2 S3 API endpoint where path-style still works.
2. **Uniform multipart chunk sizes.** R2 requires every non-trailing multipart part to be exactly the same size. S3 only enforces a 5MB minimum. Cap's `instant-mp4-uploader.ts` flushed variable-size parts; R2 rejected them with `InvalidPart`. Rewrote `flushBuffer()` to take exactly 16MB chunks.
3. **Static-asset proxy bypass.** Cap's self-hosted-mode proxy redirects every unrecognized path to `/login`. That broke `/site.webmanifest`, `/_next/*`, fonts, OG images. Expanded the allowlist + added a regex for common static extensions.

Other changes: Deepgram → Gladia, Resend `RESEND_API_KEY` for outbound mail, white-label all visible "Cap" text → "Looms", new SVG mark/wordmark/favicon, hide Pro upsell UI on self-hosted, force-hide the Cap logo on share pages.

## Repository map

| Path | What lives there |
|-|-|
| `apps/desktop` | Tauri v2 desktop app with SolidStart UI and Rust backend (upstream Cap, untouched) |
| `apps/web` | Next.js web app — share pages, dashboard, API routes, auth (where most Looms changes live) |
| `apps/cli` | Rust CLI |
| `apps/media-server` | ffmpeg jobs, thumbnails, audio extraction for transcription |
| `apps/discord-bot` | Discord integration (unused in this fork) |
| `packages/database` | Drizzle schema, auth, email config |
| `packages/ui` | Shared React UI (Logo + favicon swapped here) |
| `packages/ui-solid` | Shared Solid UI (desktop app) |
| `packages/web-backend` | Backend service layer — S3Buckets, ImageUploads (R2 patches live here) |
| `packages/web-domain` | Web domain models and types |
| `packages/env` | Environment validation (Gladia/Resend env vars added here) |
| `packages/sdk-embed` | Embed SDK |
| `packages/sdk-recorder` | Recorder SDK |
| `crates/*` | Recording, capture, camera, audio, encoding, rendering, muxing crates |
| `scripts/*` | Build + maintenance tooling. `scripts/rebrand.py` (gitignored) is the Cap→Looms text sweep |
| `infra/*` | Infrastructure configuration |
| `deploy/*` | This fork's Dokploy compose + deployment runbook |

The web API uses Effect and `@effect/platform` HTTP APIs. Desktop capture and export paths are backed by Rust crates for fast recording, rendering, and platform-specific media access.

## Local development

Same as upstream Cap (this is a fork). See the original [CapSoftware/Cap README](https://github.com/CapSoftware/Cap) for the full dev setup. Short version:

```bash
pnpm install
pnpm env-setup
pnpm cap-setup
pnpm dev:web
```

## Deploy to my VPS

Documented in `deploy/SCREEN-DEPLOY.md` and the private `/dave-looms-vps` agent skill in my Claude config. Short version:

```bash
# 1. Push to main
git push

# 2. GHA builds the image (~10 min)
gh run watch --repo dmdfajardo00/looms

# 3. Manual pull + recreate (Dokploy doesn't auto-pull)
ssh root@31.97.190.82 "\
  docker pull ghcr.io/dmdfajardo00/looms-web:latest && \
  cd /etc/dokploy/compose/stack-w1yuvu/code && \
  docker compose -p stack-w1yuvu up -d --force-recreate cap-web"
```

## License

Cap is licensed under AGPLv3 (with parts under MIT). This fork inherits those terms. See [LICENSE](LICENSE) and [licenses/LICENSE-MIT](licenses/LICENSE-MIT).

## Credit

The hard work in this repo belongs to the [CapSoftware](https://github.com/CapSoftware) team. They built an exceptional open-source product. This fork is just my plumbing on top.
