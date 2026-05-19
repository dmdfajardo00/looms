# screen.dmdfajardo.pro — Deploy Checklist

Self-hosted Cap fork, white-labelled as "Screen", on the Hostinger VPS (`31.97.190.82`) with Cloudflare R2 storage and Gladia transcription.

## 1. Cloudflare R2 setup

Cloudflare Dashboard → R2 (left sidebar).

1. **Create bucket**
   - Name: `screen-recordings`
   - Location: Automatic (or pick closest to KL: APAC)
   - Note the **Account ID** shown at the top of the R2 page

2. **Create API token**
   - R2 → Manage R2 API Tokens → Create API Token
   - Permission: **Object Read & Write**
   - Specify bucket: `screen-recordings`
   - TTL: forever
   - Copy `Access Key ID` and `Secret Access Key` — shown once

3. **Public access via custom domain** (so playback works without signed URLs)
   - Bucket → Settings → Public Access → Connect Domain
   - Domain: `media.screen.dmdfajardo.pro`
   - Cloudflare auto-adds the CNAME (this one IS proxied — orange cloud, that's correct)

4. **CORS rules** (bucket → Settings → CORS Policy)

   ```json
   [
     {
       "AllowedOrigins": ["https://screen.dmdfajardo.pro"],
       "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

5. **Capture for env file:**
   - `R2_BUCKET=screen-recordings`
   - `R2_ACCESS_KEY_ID=<from step 2>`
   - `R2_SECRET_ACCESS_KEY=<from step 2>`
   - `R2_S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
   - `R2_PUBLIC_URL=https://media.screen.dmdfajardo.pro`

## 2. Cloudflare DNS

Zone: `dmdfajardo.pro` → DNS

| Type | Name | Target | Proxy |
|-|-|-|-|
| A | `screen` | `31.97.190.82` | DNS only (gray) |

`media.screen` was auto-added by the R2 custom-domain step in §1.

## 3. GitHub: trigger first image build

```bash
cd ~/Documents/GitHub/Cap
git add -A
git commit -m "screen-fork: gladia, white-label, screen deploy"
git push -u origin screen-fork
```

The workflow at `.github/workflows/screen-build.yml` will run on push and publish:

- `ghcr.io/dmdfajardo00/cap-web:screen`
- `ghcr.io/dmdfajardo00/cap-web:screen-<sha>`

Build is ~10-15 min on free GitHub runners. Watch it: `gh run watch`.

The package will be **private** by default. After first publish:

- github.com/dmdfajardo00?tab=packages → `cap-web` → Package settings → Change visibility → **Public**

(Or: keep it private and add a GHCR pull secret to Dokploy — public is simpler for a personal fork.)

## 4. Secrets (already generated — paste into Dokploy env)

```env
DATABASE_ENCRYPTION_KEY=5a2333fe00d003b7cdfed54415f38c9fd2185b9b607a41b3a215bd70b9ef46af
NEXTAUTH_SECRET=6dbe5a700323a2563d00ee3e31297051fda6e84ac84c7e4d449ab508e181a717
MEDIA_SERVER_WEBHOOK_SECRET=399dd182358fb12207031fa12bd1da0a67f72c92188a95b1f86f56a9794c6447
```

Also generate fresh MySQL passwords (don't reuse n8n's):

```bash
openssl rand -hex 16   # MYSQL_PASSWORD
openssl rand -hex 16   # MYSQL_ROOT_PASSWORD
```

## 5. Dokploy project

`https://deploy.dmdfajardo.pro` → Create Project → "Screen" → New Compose service.

- **Source:** raw — paste contents of `deploy/screen-dokploy.yml`
- **Environment tab** (all keys from the file, plus the secrets above):

  ```env
  MYSQL_PASSWORD=<from step 4>
  MYSQL_ROOT_PASSWORD=<from step 4>
  DATABASE_ENCRYPTION_KEY=5a2333fe00d003b7cdfed54415f38c9fd2185b9b607a41b3a215bd70b9ef46af
  NEXTAUTH_SECRET=6dbe5a700323a2563d00ee3e31297051fda6e84ac84c7e4d449ab508e181a717
  MEDIA_SERVER_WEBHOOK_SECRET=399dd182358fb12207031fa12bd1da0a67f72c92188a95b1f86f56a9794c6447
  R2_BUCKET=screen-recordings
  R2_ACCESS_KEY_ID=<from step 1.2>
  R2_SECRET_ACCESS_KEY=<from step 1.2>
  R2_S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
  R2_PUBLIC_URL=https://media.screen.dmdfajardo.pro
  GLADIA_API_KEY=<from gladia.io dashboard>
  RESEND_API_KEY=
  RESEND_FROM_DOMAIN=
  ```

- **Deploy.** First run takes ~2 min for image pull + DB init.

## 6. First login

Resend is left blank → login emails appear in container logs:

```bash
ssh root@31.97.190.82
docker logs screen-web 2>&1 | grep -i 'magic\|login\|sign'
```

Visit `https://screen.dmdfajardo.pro`, enter your email, copy the magic link from logs, paste in browser.

You're now the first user = org owner.

## 7. Test pass

1. Open Cap desktop → Settings → Cap Server URL → set to `https://screen.dmdfajardo.pro`
2. Sign in
3. Record a 30-second clip in Instant Mode
4. Verify share link `https://screen.dmdfajardo.pro/s/<id>` opens, plays, shows no "Cap" branding
5. Wait ~30s, refresh — transcript tab should populate (Gladia)
6. Check R2 bucket — `<user-id>/<video-id>/result.mp4` + `transcription.vtt` present

## 8. Resource sanity check

```bash
ssh root@31.97.190.82 "free -h && docker stats --no-stream | grep screen"
```

Expected baseline: ~1.5 GB across screen-web + media-server + mysql. If swap usage on the VPS climbs past 1.8 GB sustained, drop `mem_limit` on screen-web from 1g to 768m.

## Deferred polish (v1.1)

- **Favicon swap.** Currently still ships Cap's favicon (`apps/web/public/favicon*`). Drop in your own 16/32/180px PNGs + .ico to fully kill the Cap mark in browser tabs.
- **Apple touch icon, manifest, OG image** — same folder.
- **Email branding** when Resend is wired (currently uses Cap default templates).
- **Uptime monitor.** Add `screen.dmdfajardo.pro` to UptimeRobot free tier so you know before clients do.
- **Nightly mysql dump** to R2 (n8n cron, ~5 min to wire).

## Rollback

If anything explodes:

```bash
# Stop without losing data:
docker compose -p screen down
# Full nuke (keeps R2 data, loses local mysql):
docker compose -p screen down -v
```

Recordings live in R2 independently of the compose stack. Tear-down and rebuild is safe.
