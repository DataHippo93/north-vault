# Commit + push the face-api.js + search + Gemini + Playwright work.
# Uses GITHUB_PAT from BWS env for HTTPS push auth.
$gitExe = 'C:\Program Files\Git\bin\git.exe'
Set-Location -Path 'C:\git\Clark\north-vault'

function GitRun {
  param([string[]]$cmdArgs)
  & $gitExe @cmdArgs
}

Write-Host '--- git status ---'
GitRun @('status', '--short')

Write-Host '--- staging changes ---'
GitRun @('add', '-A')

Write-Host '--- commit ---'
$msg = 'Replace Azure Face API with face-api.js, add Gemini tagger, FTS+trigram search, Playwright config'
GitRun @('-c', 'user.email=clarkstate3991@gmail.com', '-c', 'user.name=Clark Maine', 'commit', '-m', $msg)

Write-Host '--- push ---'
$pat = $env:GITHUB_PAT
if (-not $pat) { Write-Error 'GITHUB_PAT not in env'; exit 1 }
$remote = (& $gitExe 'remote' 'get-url' 'origin').Trim()
Write-Host "[wrap] Original remote: $remote"
$pushUrl = $remote -replace '^https://github.com/', "https://x-access-token:$pat@github.com/"
& $gitExe 'push' $pushUrl 'HEAD'
exit $LASTEXITCODE
