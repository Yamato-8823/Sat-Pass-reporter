#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   cd /path/to/satpass-ops-console
#   bash /path/to/satpass_online_patch_18jst_formatted/apply.sh

PATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p .github/workflows config data scripts/lib docs
cp "$PATCH_DIR/.github/workflows/update-tle.yml" .github/workflows/update-tle.yml
cp "$PATCH_DIR/.github/workflows/pass-slack-report.yml" .github/workflows/pass-slack-report.yml
cp "$PATCH_DIR/config/slack-pass-report.json" config/slack-pass-report.json
cp "$PATCH_DIR/data/tle-sources.json" data/tle-sources.json
cp "$PATCH_DIR/scripts/update-tle.mjs" scripts/update-tle.mjs
cp "$PATCH_DIR/scripts/send-pass-report.mjs" scripts/send-pass-report.mjs
cp "$PATCH_DIR/scripts/lib/satpass-core.mjs" scripts/lib/satpass-core.mjs
cp "$PATCH_DIR/scripts/lib/radar-png.mjs" scripts/lib/radar-png.mjs
cp "$PATCH_DIR/scripts/lib/slack-client.mjs" scripts/lib/slack-client.mjs
cp "$PATCH_DIR/docs/ONLINE_SLACK_PASS_REPORT.md" docs/ONLINE_SLACK_PASS_REPORT.md

echo "Applied 18 JST online Slack PASS report files with Teikyo GS config."
echo "Next: git diff && npm ci && node scripts/update-tle.mjs"
