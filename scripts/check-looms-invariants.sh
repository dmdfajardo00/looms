#!/usr/bin/env bash
# check-looms-invariants.sh
#
# Verify that all Looms-specific patches, branding, and unlocked-features are
# still in place after pulling from upstream Cap. Run before AND after every
# `git merge upstream/main` cycle.
#
# Exit code: 0 = all clear; non-zero = number of failed invariants.
#
# Usage:
#   bash scripts/check-looms-invariants.sh
#   bash scripts/check-looms-invariants.sh --quiet   # only print failures
#
# This script never modifies anything. Pure read-only diagnostic.

set -u
cd "$(dirname "$0")/.."

QUIET=${1:-}
PASS=0
FAIL=0
FAILED_LIST=()

ok() {
	if [ "$QUIET" != "--quiet" ]; then printf "  \033[32m✓\033[0m %s\n" "$1"; fi
	PASS=$((PASS+1))
}
fail() {
	printf "  \033[31m✗\033[0m %s\n     → %s\n" "$1" "$2"
	FAIL=$((FAIL+1))
	FAILED_LIST+=("$1")
}
section() { if [ "$QUIET" != "--quiet" ]; then printf "\n\033[1m%s\033[0m\n" "$1"; fi; }

# ---- Helpers ----------------------------------------------------------------

assert_file_exists() {
	# $1 = label, $2 = path
	[ -f "$2" ] && ok "$1" || fail "$1" "missing file: $2"
}
assert_file_contains() {
	# $1 = label, $2 = path, $3 = needle (literal string)
	if [ ! -f "$2" ]; then fail "$1" "missing file: $2"; return; fi
	grep -qF "$3" "$2" && ok "$1" || fail "$1" "$2 no longer contains '$3'"
}
assert_file_not_contains() {
	# $1 = label, $2 = path, $3 = needle (literal string)
	if [ ! -f "$2" ]; then fail "$1" "missing file: $2"; return; fi
	! grep -qF "$3" "$2" && ok "$1" || fail "$1" "$2 still contains banned '$3'"
}
assert_path_exists() {
	[ -e "$2" ] && ok "$1" || fail "$1" "missing path: $2"
}
assert_path_missing() {
	[ ! -e "$2" ] && ok "$1" || fail "$1" "unexpected path exists: $2"
}
assert_grep_repo() {
	# $1 = label, $2 = regex, $3 = expected match count, $4 = include-glob
	local count
	count=$(grep -rE "$2" $4 2>/dev/null | grep -v -E "node_modules|\.next|\.git" | wc -l | tr -d ' ')
	if [ "$count" -ge "$3" ]; then ok "$1 ($count refs)"
	else fail "$1" "expected ≥$3 matches of /$2/, found $count"
	fi
}
assert_no_grep_repo() {
	# $1 = label, $2 = regex, $3 = include-glob
	local count
	count=$(grep -rE "$2" $3 2>/dev/null | grep -v -E "node_modules|\.next|\.git" | wc -l | tr -d ' ')
	if [ "$count" -eq 0 ]; then ok "$1"
	else fail "$1" "/$2/ found in $count places, should be 0"
	fi
}

# ---- Section: Patch A — R2 custom-domain at root ---------------------------

section "Patch A — R2 custom-domain URL handling"
A_FILE="packages/web-backend/src/S3Buckets/S3BucketAccess.ts"
assert_file_contains "S3BucketAccess: publicBucketUrl short-circuit"       "$A_FILE" "provider.publicBucketUrl"
assert_file_contains "S3BucketAccess: getInternal for presigned PUT"       "$A_FILE" "provider.publicBucketUrl"
assert_file_contains "S3BucketClientProvider: publicBucketUrl field"       "packages/web-backend/src/S3Buckets/S3BucketClientProvider.ts" "publicBucketUrl"
assert_file_contains "S3Buckets index: S3_PUBLIC_BUCKET_URL env read"      "packages/web-backend/src/S3Buckets/index.ts" "S3_PUBLIC_BUCKET_URL"

# ---- Section: Patch B — uniform multipart chunks for R2 --------------------

section "Patch B — Uniform multipart chunks for R2"
B_FILE="apps/web/app/(org)/dashboard/videos/components/web-recorder-dialog/instant-mp4-uploader.ts"
if [ ! -f "$B_FILE" ]; then B_FILE="apps/web/app/(org)/dashboard/caps/components/web-recorder-dialog/instant-mp4-uploader.ts"; fi
assert_file_contains "flushBuffer uses FINAL_BLOB_PART_SIZE_BYTES"        "$B_FILE" "FINAL_BLOB_PART_SIZE_BYTES"
assert_file_contains "handleChunk trigger at uniform threshold"            "$B_FILE" "this.bufferedBytes >= FINAL_BLOB_PART_SIZE_BYTES"
assert_file_contains "flushBuffer uses takeBufferedPart loop"              "$B_FILE" "this.takeBufferedPart(partSize)"

# ---- Section: Patch C — static-asset proxy bypass --------------------------

section "Patch C — proxy.ts static asset allowlist"
C_FILE="apps/web/proxy.ts"
assert_file_contains "proxy allows /site.webmanifest"                      "$C_FILE" "/site.webmanifest"
assert_file_contains "proxy allows /_next/"                                "$C_FILE" 'path.startsWith("/_next/")'
assert_file_contains "proxy allows /fonts/"                                "$C_FILE" 'path.startsWith("/fonts/")'
assert_file_contains "proxy has static-extension regex bypass"             "$C_FILE" "png|jpe?g|svg|gif|webp|ico|woff"

# ---- Section: Patch D — inline transcription runner -----------------------

section "Patch D — inline transcription (bypass workflow runner)"
D_WORKFLOW="apps/web/workflows/transcribe.ts"
D_LIB="apps/web/lib/transcribe.ts"
assert_file_contains "runTranscribeInline exported"                        "$D_WORKFLOW" "export async function runTranscribeInline"
assert_file_contains "fetchWithTimeout helper defined"                     "$D_WORKFLOW" "async function fetchWithTimeout"
assert_file_contains "lib/transcribe.ts calls runTranscribeInline"         "$D_LIB" "runTranscribeInline"
assert_file_not_contains "lib/transcribe.ts no longer uses workflow start" "$D_LIB" 'from "workflow/api"'
assert_file_contains "Gladia upload wrapped in fetchWithTimeout"           "$D_WORKFLOW" "fetchWithTimeout"

# ---- Section: Gladia integration (not Deepgram) ---------------------------

section "Gladia integration (Deepgram swap)"
assert_file_contains "env: GLADIA_API_KEY in server schema"                "packages/env/server.ts" "GLADIA_API_KEY"
assert_file_not_contains "env: DEEPGRAM_API_KEY removed"                   "packages/env/server.ts" "DEEPGRAM_API_KEY"
assert_file_contains "transcribeWithGladia function"                       "$D_WORKFLOW" "async function transcribeWithGladia"
assert_file_not_contains "transcribeWithDeepgram function gone"            "$D_WORKFLOW" "transcribeWithDeepgram"
assert_no_grep_repo  "no @deepgram/sdk imports"                            "from .@deepgram/sdk." "apps/web --include=*.ts --include=*.tsx"
assert_path_missing  "transcribe-utils.ts deleted"                         "apps/web/lib/transcribe-utils.ts"

# ---- Section: Workflow manifest -------------------------------------------

section "Workflow manifest registrations"
MANIFEST="apps/web/public/.well-known/workflow/v1/manifest.json"
assert_file_contains "manifest registers transcribeWithGladia"             "$MANIFEST" "transcribeWithGladia"
assert_file_contains "manifest registers markError"                        "$MANIFEST" "markError"
assert_file_not_contains "manifest no longer references transcribeWithDeepgram" "$MANIFEST" "transcribeWithDeepgram"

# ---- Section: Resend sender ------------------------------------------------

section "Resend / email"
assert_file_contains "auth emails send from looms-manager"                 "packages/database/emails/config.ts" "looms-manager"

# ---- Section: Brand assets ------------------------------------------------

section "Brand assets"
assert_file_exists "looms-mark.svg"                                        "apps/web/public/looms-mark.svg"
assert_file_exists "looms-wordmark.svg"                                    "apps/web/public/looms-wordmark.svg"
assert_file_exists "favicon.svg"                                           "apps/web/public/favicon.svg"
assert_file_contains "Logo.tsx uses <text>Looms</text>"                    "packages/ui/src/components/icons/Logo.tsx" ">Looms<"
assert_file_contains "Logo viewBox 280x100 for wordmark"                   "packages/ui/src/components/icons/Logo.tsx" '"0 0 280 100"'
assert_file_contains "layout title is Looms"                               "apps/web/app/layout.tsx" 'title: "Looms"'
assert_file_contains "site.webmanifest name=Looms"                         "apps/web/public/site.webmanifest" '"name": "Looms"'

# ---- Section: White-label user-visible strings ----------------------------

section "White-label user-visible strings"
LOGIN_FORM="apps/web/app/(org)/login/form.tsx"
SIGNUP_FORM="apps/web/app/(org)/signup/form.tsx"
EMPTY_STATE_OLD="apps/web/app/(org)/dashboard/caps/components/EmptyCapState.tsx"
EMPTY_STATE_NEW="apps/web/app/(org)/dashboard/videos/components/EmptyCapState.tsx"
EMPTY_STATE="$EMPTY_STATE_NEW"; [ ! -f "$EMPTY_STATE" ] && EMPTY_STATE="$EMPTY_STATE_OLD"
assert_file_contains "login heading is 'Sign in to Looms'"                 "$LOGIN_FORM" "Sign in to Looms"
assert_file_contains "signup heading is 'Sign up to Looms'"                "$SIGNUP_FORM" "Sign up to Looms"
assert_file_contains "empty state says 'Record your first Loom'"           "$EMPTY_STATE" "Record your first Loom"
assert_file_contains "Items.tsx footer 'Looms ·'"                          "apps/web/app/(org)/dashboard/_components/Navbar/Items.tsx" "Looms · "
assert_file_contains "site Footer says 'Looms ·'"                          "apps/web/app/(site)/Footer.tsx" "© Looms"
assert_file_not_contains "site Footer not 'Cap Software'"                  "apps/web/app/(site)/Footer.tsx" "Cap Software, Inc."
assert_file_not_contains "Items.tsx footer not 'Cap Software'"             "apps/web/app/(org)/dashboard/_components/Navbar/Items.tsx" "Cap Software, Inc."

# ---- Section: Pro-gated features unlocked / hidden upsell -----------------

section "Pro-feature unlocks (upsells hidden on self-hosted)"
SHARE_PAGE="apps/web/app/s/[videoId]/page.tsx"
assert_file_contains "getShareableLinkIcon force-returns null"             "$SHARE_PAGE" "return null;
}"
assert_file_not_contains "share page no longer returns {type: 'cap'}"      "$SHARE_PAGE" 'type: "cap"'
USAGE_BTN="apps/web/components/UsageButton.tsx"
assert_file_contains "UsageButton has NEXT_PUBLIC_IS_CAP guard"            "$USAGE_BTN" 'buildEnv.NEXT_PUBLIC_IS_CAP !== "true"'
BILLING="apps/web/app/(org)/dashboard/settings/organization/components/BillingSummaryCard.tsx"
assert_file_contains "BillingSummaryCard has NEXT_PUBLIC_IS_CAP guard"     "$BILLING" 'buildEnv.NEXT_PUBLIC_IS_CAP !== "true"'

# ---- Section: Route rename /caps → /videos -------------------------------

section "Route rename /caps → /videos"
assert_path_exists  "videos route dir exists"                              "apps/web/app/(org)/dashboard/videos"
assert_path_missing "caps route dir gone"                                  "apps/web/app/(org)/dashboard/caps"
assert_grep_repo    "nav has /dashboard/videos refs"                       "/dashboard/videos" 1 "apps/web --include=*.tsx --include=*.ts"
assert_no_grep_repo "no stale /dashboard/caps refs"                        "/dashboard/caps\\b" "apps/web --include=*.tsx --include=*.ts"

# ---- Summary --------------------------------------------------------------

printf "\n\033[1m================ SUMMARY ================\033[0m\n"
printf "  passed: \033[32m%d\033[0m\n  failed: \033[31m%d\033[0m\n" "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
	printf "\n\033[31mFAILED INVARIANTS:\033[0m\n"
	for f in "${FAILED_LIST[@]}"; do printf "  • %s\n" "$f"; done
	printf "\nFix each one before considering a merge complete. See AGENTS.md → 'Load-bearing patches' for the canonical implementations.\n"
fi
exit "$FAIL"
