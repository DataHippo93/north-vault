# Wrapper to run the batch face scan on Windows. Adds nodejs to PATH and
# invokes the CJS scan script. Designed to be called via BWS run_with_secrets
# (which injects supabase creds as env vars).
param(
  [int]$BatchSize = 5
)

$nodeDir = 'C:\Program Files\nodejs'
$env:Path = $nodeDir + ';' + $env:Path
Set-Location -Path 'C:\git\Clark\north-vault'

# 8.3 short paths sidestep PowerShell's argument-splitting issues with
# 'Program Files'.
$shortNode = (New-Object -ComObject Scripting.FileSystemObject).GetFile("$nodeDir\node.exe").ShortPath
$shortNpm = (New-Object -ComObject Scripting.FileSystemObject).GetFile("$nodeDir\node_modules\npm\bin\npm-cli.js").ShortPath

# One-shot install: native sharp + tfjs-backend-wasm (which the face-api
# node-wasm bundle needs at runtime). Pass package names individually so
# npm doesn't try to reconcile the whole tree.
$sharpWin = 'node_modules\@img\sharp-win32-x64'
$wasm = 'node_modules\@tensorflow\tfjs-backend-wasm'
if (-not (Test-Path $wasm)) {
  # Bypass npm: there's a broken version pin somewhere in the tree
  # (`@huggingface/transformers` deps) that blocks any `npm install`.
  # Pull the tarball directly and extract into node_modules.
  Write-Host '[wrap] Installing tfjs-backend-wasm via tarball...'
  $tarball = 'https://registry.npmjs.org/@tensorflow/tfjs-backend-wasm/-/tfjs-backend-wasm-4.22.0.tgz'
  $tmp = Join-Path $env:TEMP 'tfjs-wasm.tgz'
  Invoke-WebRequest -Uri $tarball -OutFile $tmp -UseBasicParsing
  $dest = 'node_modules\@tensorflow\tfjs-backend-wasm'
  New-Item -ItemType Directory -Force -Path 'node_modules\@tensorflow' | Out-Null
  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  $extractTmp = Join-Path $env:TEMP 'tfjs-wasm-extract'
  if (Test-Path $extractTmp) { Remove-Item -Recurse -Force $extractTmp }
  New-Item -ItemType Directory -Force -Path $extractTmp | Out-Null
  $tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
  Start-Process -FilePath $tarExe -ArgumentList @('-xzf', $tmp, '-C', $extractTmp) -Wait -NoNewWindow
  Move-Item (Join-Path $extractTmp 'package') $dest
  Remove-Item -Recurse -Force $extractTmp
  Remove-Item $tmp
  Write-Host '[wrap] tfjs-wasm extracted'
}
if (-not (Test-Path $sharpWin)) {
  Write-Host '[wrap] Installing @img/sharp-win32-x64 via tarball...'
  $shrpUrl = 'https://registry.npmjs.org/@img/sharp-win32-x64/-/sharp-win32-x64-0.34.5.tgz'
  $libUrl = 'https://registry.npmjs.org/@img/sharp-libvips-win32-x64/-/sharp-libvips-win32-x64-1.2.4.tgz'
  foreach ($pair in @(@{u=$shrpUrl;d='node_modules\@img\sharp-win32-x64'},@{u=$libUrl;d='node_modules\@img\sharp-libvips-win32-x64'})) {
    $tmp = Join-Path $env:TEMP ([System.Guid]::NewGuid().ToString() + '.tgz')
    Invoke-WebRequest -Uri $pair.u -OutFile $tmp -UseBasicParsing
    New-Item -ItemType Directory -Force -Path 'node_modules\@img' | Out-Null
    if (Test-Path $pair.d) { Remove-Item -Recurse -Force $pair.d }
    $ex = Join-Path $env:TEMP ([System.Guid]::NewGuid().ToString())
    New-Item -ItemType Directory -Force -Path $ex | Out-Null
    $tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
    Start-Process -FilePath $tarExe -ArgumentList @('-xzf', $tmp, '-C', $ex) -Wait -NoNewWindow
    Move-Item (Join-Path $ex 'package') $pair.d
    Remove-Item -Recurse -Force $ex
    Remove-Item $tmp
  }
  Write-Host '[wrap] sharp-win32 extracted'
}

# canvas: marker file lies (the .node is from Linux). Use a sentinel
# so we re-run pre-gyp install once for win32-x64.
$canvasMarker = 'node_modules\canvas\.win32-installed'
if (-not (Test-Path $canvasMarker)) {
  Write-Host '[wrap] Installing canvas prebuild via node-pre-gyp...'
  $pregyp = 'node_modules\canvas\node_modules\.bin\node-pre-gyp.cmd'
  if (-not (Test-Path $pregyp)) { $pregyp = 'node_modules\.bin\node-pre-gyp.cmd' }
  if (Test-Path $pregyp) {
    $p = Start-Process -FilePath $pregyp -ArgumentList @('install', '--fallback-to-build=false') -WorkingDirectory 'node_modules\canvas' -Wait -NoNewWindow -PassThru
    Write-Host "[wrap] canvas pre-gyp install exit=$($p.ExitCode)"
  } else {
    Write-Host '[wrap] no node-pre-gyp.cmd found, falling back to npm rebuild canvas'
    $instArgs = @($shortNpm, 'rebuild', 'canvas', '--no-audit', '--no-fund')
    $p = Start-Process -FilePath $shortNode -ArgumentList $instArgs -Wait -NoNewWindow -PassThru
    Write-Host "[wrap] canvas rebuild exit=$($p.ExitCode)"
  }
  New-Item -ItemType File -Force -Path $canvasMarker | Out-Null
}

Write-Host "[wrap] Running scan with batch=$BatchSize"
$scanArgs = @('scripts\scan-faces-batch.cjs', "$BatchSize")
$p = Start-Process -FilePath $shortNode -ArgumentList $scanArgs -Wait -NoNewWindow -PassThru
exit $p.ExitCode
