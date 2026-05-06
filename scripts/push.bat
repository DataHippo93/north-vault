@echo off
setlocal
set "GITEXE=C:\Program Files\Git\bin\git.exe"
set "REPO=C:\git\Clark\north-vault"
cd /d %REPO%

echo === status ===
"%GITEXE%" status --short

echo === branch ===
"%GITEXE%" rev-parse --abbrev-ref HEAD

echo === remote ===
"%GITEXE%" remote -v

echo === add -A ===
"%GITEXE%" add -A

echo === commit ===
"%GITEXE%" -c user.email=clarkstate3991@gmail.com -c "user.name=Clark Maine" commit --no-verify -m "Replace Azure Face API with face-api.js, add Gemini tagger, FTS+trigram search, Playwright config, batch scan tooling"

echo === push ===
if "%GITHUB_PAT%"=="" (echo GITHUB_PAT missing & exit /b 1)
set "PUSH_URL=https://x-access-token:%GITHUB_PAT%@github.com/DataHippo93/north-vault"
echo === pull --rebase ===
"%GITEXE%" pull --rebase "%PUSH_URL%" main
echo === push ===
"%GITEXE%" push "%PUSH_URL%" HEAD:main
exit /b %ERRORLEVEL%
