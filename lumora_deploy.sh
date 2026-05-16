#!/usr/bin/env bash
# ============================================================
# LUMORA DEPLOY — macOS/Linux
# Runs sanity audit, then commits + pushes to GitHub.
# DigitalOcean App Platform auto-deploys on push to main.
# ============================================================
set -euo pipefail

echo
echo "=== LUMORA DEPLOY ==="
echo

echo "[1/4] Running pre-deploy audit..."
node scripts/lumora_audit.js

echo
echo "[2/4] Git status:"
git status --short

echo
read -rp "Commit message (or blank to skip commit): " MSG

if [[ -n "${MSG// /}" ]]; then
  echo "[3/4] Committing..."
  git add -A
  git commit -m "$MSG"
else
  echo "[3/4] Skipping commit."
fi

echo
echo "[4/4] Pushing to origin/main..."
git push origin main

echo
echo "=== Push complete. DigitalOcean App Platform will build and deploy. ==="
echo "=== Check status: https://cloud.digitalocean.com/apps ==="
echo "=== Live API:    https://api.lumoradating.com/api/health ==="
echo
