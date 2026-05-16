@echo off
REM ============================================================
REM LUMORA DEPLOY — Windows
REM Runs sanity audit, then commits + pushes to GitHub.
REM DigitalOcean App Platform auto-deploys on push to main.
REM ============================================================

setlocal enabledelayedexpansion

echo.
echo === LUMORA DEPLOY ===
echo.

REM 1. Audit
echo [1/4] Running pre-deploy audit...
call node scripts/lumora_audit.js
if errorlevel 1 (
  echo.
  echo === AUDIT FAILED. Aborting deploy. ===
  exit /b 1
)

REM 2. Show status
echo.
echo [2/4] Git status:
git status --short

REM 3. Commit
echo.
set /p MSG=Commit message (or blank to skip commit): 
if not "%MSG%"=="" (
  echo [3/4] Committing...
  git add -A
  git commit -m "%MSG%"
  if errorlevel 1 (
    echo Commit failed. Aborting.
    exit /b 1
  )
) else (
  echo [3/4] Skipping commit.
)

REM 4. Push
echo.
echo [4/4] Pushing to origin/main...
git push origin main
if errorlevel 1 (
  echo Push failed. Aborting.
  exit /b 1
)

echo.
echo === Push complete. DigitalOcean App Platform will build and deploy. ===
echo === Check status: https://cloud.digitalocean.com/apps ===
echo === Live API:    https://api.lumoradating.com/api/health ===
echo.

endlocal
