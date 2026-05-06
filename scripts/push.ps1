# Commit + push, using New-Alias to dodge PowerShell's `& 'path-with-space'`
# pipeline rejection.
$ErrorActionPreference = 'Continue'
$repo = 'C:\git\Clark\north-vault'
Set-Alias git 'C:\Program Files\Git\bin\git.exe' -Scope Script
Set-Location $repo

Write-Host '=== status ==='
git -C $repo status --short
Write-Host '=== branch ==='
git -C $repo rev-parse --abbrev-ref HEAD
Write-Host '=== remote ==='
git -C $repo remote -v
Write-Host '=== add ==='
git -C $repo add -A
Write-Host '=== commit ==='
$msg = 'Replace Azure Face API with face-api.js, add Gemini tagger, FTS+trigram search, Playwright config, batch scan tooling'
git -C $repo -c user.email=clarkstate3991@gmail.com -c user.name='Clark Maine' commit -m $msg
Write-Host '=== push ==='
$pat = $env:GITHUB_PAT
if (-not $pat) { Write-Error 'GITHUB_PAT missing'; exit 1 }
$remoteUrl = (git -C $repo remote get-url origin) -as [string]
$remoteUrl = $remoteUrl.Trim()
Write-Host "remote: $remoteUrl"
$pushUrl = $remoteUrl -replace '^https://github.com/', "https://x-access-token:$pat@github.com/"
git -C $repo push $pushUrl HEAD
exit $LASTEXITCODE
