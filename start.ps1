$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

Write-Host "Starting Bubble Wrap on http://127.0.0.1:3000"

if (Get-Command py -ErrorAction SilentlyContinue) {
  py -3 -m http.server 3000 --bind 127.0.0.1
  exit $LASTEXITCODE
}

if (Get-Command python -ErrorAction SilentlyContinue) {
  python -m http.server 3000 --bind 127.0.0.1
  exit $LASTEXITCODE
}

Write-Error "Python was not found in PATH. Install Python 3 or run Bubble Wrap from another local web server."
