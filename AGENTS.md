# AGENTS.md — Looms (forked Cap)

You are working inside the **Looms** repo. This is a private fork of [CapSoftware/Cap](https://github.com/CapSoftware/Cap), deployed to https://looms.dmdfajardo.pro as a self-hosted screen-recording app for a single user (Dave). Upstream remote is `upstream` — pull future Cap merges from there.

Read this whole file before making changes. Then read the **load-bearing patches** section below before touching storage, transcription, or workflow code.

---

## Live URLs

| | |
|-|-|
| App | https://looms.dmdfajardo.pro |
| Fallback (dual-host) | https://screen.dmdfajardo.pro |
| R2 public reads | https://dmdfajardo.pro/&lt;key&gt; |
| Dokploy | https://deploy.dmdfajardo.pro → project "Screen" → compose `stack-w1yuvu` |
| GHA build | https://github.com/dmdfajardo00/looms/actions |
| GHCR image | `ghcr.io/dmdfajardo00/looms-web:latest` |
| Tinybird | workspace `dave_fajardo` at `https://cloud.tinybird.co/gcp/europe-west2/dave_fajardo` |
| Gladia | API `https://api.gladia.io` |
| Resend | sender `looms-manager@dmdfajardo.pro` |

VPS access (via skill `vps-management`): `ssh -i ~/.ssh/id_ed25519 root@31.97.190.82`.

---

## Stack at a glance

```
Browser ──HTTPS──► looms.dmdfajardo.pro ──► Traefik ──► screen-web (Next.js)
                                                         │
                                                         ├──► mysql              (auth, video metadata)
                                                         ├──► media-server       (ffmpeg jobs, thumbs, audio extraction)
                                                         ├──► Gladia API         (transcription, REST)
                                                         ├──► Tinybird API       (per-video analytics)
                                                         └──► Resend API         (magic-link emails)

Browser ──HTTPS──► dmdfajardo.pro/<key> ──► Cloudflare R2 ──► screen-recordings bucket
                          ▲
                          │ unsigned public reads
Browser ──signed PUT──────┘
              (uploads go via <account>.r2.cloudflarestorage.com, path-style)
```

Three containers in `stack-w1yuvu`: `screen-web`, `screen-media-server`, `screen-mysql`. Container names kept as `screen-*` for stability; Docker image is `looms-web`.

---

## Load-bearing patches — DON'T regress these

Four patches make this fork actually work on this stack. Upstream Cap doesn't need them — they exist only because of our R2 + self-hosted + no-workflow-runner setup. Touching the underlying systems without preserving these = transcription/uploads break.

### Patch A — R2 custom-domain at root
**Files**: `packages/web-backend/src/S3Buckets/S3BucketAccess.ts` + `S3Buckets/index.ts` + `S3BucketClientProvider.ts`
**Env**: `S3_PUBLIC_BUCKET_URL` (set to `https://dmdfajardo.pro`)
**What**: When env set, `getSignedObjectUrl()` returns unsigned `${publicBucketUrl}/${key}` (R2 custom domain serves bucket at root — no bucket prefix). All PUT/PUT-part URLs route to `provider.getInternal` (R2 S3 API endpoint, path-style native) instead of public.
**Why**: Cap's stock SDK generates path-style URLs with bucket prefix; R2 apex custom domain rejects them. See `mempalace:looms_problem_3923496a`.

### Patch B — Uniform multipart chunks for R2
**File**: `apps/web/app/(org)/dashboard/caps/components/web-recorder-dialog/instant-mp4-uploader.ts`
**What**: `flushBuffer()` and `handleChunk()` use uniform 16MB chunks via `FINAL_BLOB_PART_SIZE_BYTES`. Only the final flush sends partial.
**Why**: R2 requires every non-trailing multipart part to be exactly the same size; S3 doesn't enforce this. See `mempalace:looms_problem_cacc7384`.

### Patch C — Static-asset proxy bypass
**File**: `apps/web/proxy.ts`
**What**: Self-hosted-mode allowlist expanded to include `/`, `/_next/`, `/fonts/`, `/rive/`, `/site.webmanifest`, `/favicon.ico`, plus regex for static extensions.
**Why**: Cap's self-hosted proxy default redirects every unknown path to `/login`, breaking the webmanifest and font/JS loading. See `mempalace:looms_problem_862897d3`.

### Patch D — Inline transcription runner (replaces Vercel workflow engine)
**Files**: `apps/web/workflows/transcribe.ts` (adds `runTranscribeInline()`), `apps/web/lib/transcribe.ts` (calls `void runTranscribeInline(...)` instead of `await start(transcribeVideoWorkflow, ...)`)
**What**: Bypasses Cap's required `apps/web-cluster` runner service (Effect cluster + RPC) by executing step functions directly inline. Each Gladia fetch wrapped in `fetchWithTimeout()` (AbortController) — without timeouts, fire-and-forget fetches silently hang.
**Why**: Cap's `start()` is a CLIENT for an external workflow runner we never deployed; without it, every `start()` call resolves but no step ever runs. AbortController timeouts prevent Node from garbage-collecting in-flight sockets when the parent request returns. See `mempalace:looms_problem_4a667c2d`.

---

## File map (where to look when X breaks)

| Symptom | First file to read |
|-|-|
| Broken `<img>`/`<video>` src returning 404 from `dmdfajardo.pro/...` | `packages/web-backend/src/S3Buckets/S3BucketAccess.ts` (patch A) |
| `InvalidPart: All non-trailing parts...` on multipart upload | `instant-mp4-uploader.ts` (patch B) |
| `/_next/...` or `/site.webmanifest` redirecting to `/login` | `apps/web/proxy.ts` (patch C) |
| Transcription never starts / status stuck NULL or PROCESSING | `apps/web/lib/transcribe.ts` + `apps/web/workflows/transcribe.ts` (patch D) |
| Gladia call hangs silently | `transcribeWithGladia()` in `apps/web/workflows/transcribe.ts` — verify `fetchWithTimeout` is used |
| Email not delivering | `packages/database/emails/config.ts` (from-address) + Resend dashboard |
| Org icon broken on dashboard | See patch A; also check `apps/web/app/(org)/dashboard/settings/organization/components/OrganizationIcon.tsx` |
| Cap logo / "Cap" text still showing somewhere | `packages/ui/src/components/icons/Logo.tsx` + run `python3 scripts/rebrand.py --scan-only` |
| Build fails with `Module not found: ./<X>Looms<Y>` | Identifier was incorrectly renamed by `scripts/rebrand.py`. See `mempalace:looms_problem_c384cdf8` for revert pattern. |
| Workflow manifest mismatch (after renaming a `"use step"` function) | `apps/web/public/.well-known/workflow/v1/manifest.json` (must match every "use step" function in `apps/web/workflows/*.ts`) |

---

## Build & deploy

Three steps. Skipping any of them = stale state.

```bash
# 1. Push code → GHA builds image ~10-15 min
git push

# 2. Verify build success
gh run list --repo dmdfajardo00/looms --workflow=looms-build.yml --limit 1

# 3. CRITICAL — manually pull + recreate (Dokploy's Deploy doesn't auto-pull)
ssh -i ~/.ssh/id_ed25519 root@31.97.190.82 "\
  docker pull ghcr.io/dmdfajardo00/looms-web:latest && \
  cd /etc/dokploy/compose/stack-w1yuvu/code && \
  docker compose -p stack-w1yuvu up -d --force-recreate cap-web"
```

For env/compose changes (not code): use Dokploy UI → Reload. Reload syncs DB to disk and restarts.

See `mempalace:looms_problem_3a8b9bff` for the full deploy gotchas list.

---

## Code conventions (inherited from Cap upstream — apply unchanged)

These are enforced by CI (`cargo clippy -D warnings`, Biome). Emit the correct shape the FIRST time.

- **Tabs, not spaces.** Double quotes in JS/TS. Biome enforces.
- **Default to NO comments.** Add one only after solving a non-obvious issue, capturing context a future investigator needs. Bad cases banned: narrating what code does, restating types, JSDoc paraphrasing param names, "TODO" notes, comments describing the current change.
- **Never edit generated files**: `**/tauri.ts`, `**/queries.ts`, `apps/desktop/src-tauri/gen/**`, `packages/ui-solid/src/auto-imports.d.ts`, Drizzle migrations under `packages/database/migrations/`.
- **Never start additional dev servers** (`pnpm dev`, `pnpm dev:web`, `pnpm dev:desktop`, Docker services). Assume they're running.
- **Rust**: write clippy-clean form the FIRST time (workspace `[lints]` denies many patterns). `cargo fmt --all` + `cargo clippy -p <crate> --all-targets -- -D warnings`.
- **TS/JS/JSON/CSS/MD**: `pnpm format` + `pnpm lint`. For type changes: `pnpm typecheck`.
- **NEVER add `Co-Authored-By`, `Signed-off-by`, or any Claude/Anthropic attribution in commit messages.** All commits are Dave's work.
- **NEVER commit without explicit permission.** Ask first.

For the full upstream convention list (Biome details, denied clippy lints, Effect patterns, etc.) read the **upstream Cap CLAUDE.md** at https://github.com/CapSoftware/Cap/blob/main/CLAUDE.md — we inherited its rules.

---

## Don't-touch zones

- `apps/web/public/.well-known/workflow/v1/manifest.json` — only edit if you renamed/added a `"use step"` function in `apps/web/workflows/*.ts`. Keys must match function names exactly.
- Compose `services:` keys (`cap-web`, `media-server`, `mysql`) — used for inter-container Docker DNS (`MEDIA_SERVER_WEBHOOK_URL: http://cap-web:3000`). Renaming breaks routing.
- Compose `container_name:` values (`screen-web`, etc.) — referenced in many ops commands. Don't rename without updating the vps-management skill.
- `scripts/rebrand.py` — gitignored. Don't commit, don't run blindly. If you need to do another rebrand pass, read the script carefully and the failure-mode notes in `mempalace:looms_problem_c384cdf8`.
- `apps/desktop/**` — we don't rebuild the desktop binary; it's upstream Cap's binary configured via `Settings → Cap Server URL → https://looms.dmdfajardo.pro`. Changes here are wasted unless you commit to a fork-and-rebuild project.

---

## Mempalace navigation

Wing: **`looms`**. Start here for any operational question:

- **Index drawer**: `looms_reference_90cd008f` — full session artifact map + credentials + URLs + pointers to every other drawer
- **Decisions** (wing=looms, room=decision):
  - `fbe6fa79` — naming Looms (Loom vs Looms vs Screen)
  - `dfd99862` — Deepgram → Gladia swap
  - `bba53df1` — REST vs SMTP for Resend
  - `1a1828e0` — dual-host Traefik
  - `05b95617` — render-null pattern for Pro UI
  - `39c2e52e` — R2 public bucket + CORS
  - `59d5c311` — Tinybird Forward edition + deploy
  - `71b259fc` — full domain rename playbook
  - `19feb6ab` — brand identity (color #2D6FF7)
  - `e42ba6ac` — GHCR image rename
  - `24ccabfa` — n8n SMTP via inline compose
- **Problems** (wing=looms, room=problem):
  - `3923496a` — R2 custom-domain URL handling (patch A)
  - `cacc7384` — R2 uniform multipart chunks (patch B)
  - `3a8b9bff` — Dokploy Deploy doesn't pull / Save-vs-Reload
  - `862897d3` — proxy.ts allowlist (patch C)
  - `da4f5315` — workflow manifest stale (Gladia step ID)
  - `c384cdf8` — rebrand.py over-eager Caps → Looms identifier breakage
  - `4a667c2d` — workflow runner gap + AbortController fix (patch D)

To search: `mempalace_search` with `wing="looms"` + your topic.

Related skills (in `~/.claude/skills/`): `dave-looms-vps` (full operational playbook), `vps-management` (the underlying VPS).

---

## AGPL credit

Cap is licensed under AGPLv3 (with parts under MIT). This fork inherits those terms. The hard engineering work belongs to the [CapSoftware](https://github.com/CapSoftware) team. This repo is Dave's plumbing + customizations on top.
