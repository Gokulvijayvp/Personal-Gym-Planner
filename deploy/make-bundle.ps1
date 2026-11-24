# Run on your Windows PC (PowerShell) from anywhere:
#     powershell -ExecutionPolicy Bypass -File deploy\make-bundle.ps1
#     powershell -ExecutionPolicy Bypass -File deploy\make-bundle.ps1 -WithDatabase     (also takes your current data to the server)
#
# Builds the website here (so the server needs no Node) and packs everything the server needs into deploy\upload\.
param([switch]$WithDatabase)
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $PSScriptRoot "upload"
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory $out | Out-Null

Write-Host "==> Building the website"
Push-Location (Join-Path $root "frontend")
npm run build
if ($LASTEXITCODE -ne 0) { throw "The website build failed." }
Pop-Location
Copy-Item (Join-Path $root "frontend\dist") (Join-Path $out "dist") -Recurse

Write-Host "==> Packing the backend (without your local data, virtual environment or tests)"
tar -czf (Join-Path $out "backend.tar.gz") `
  --exclude=.venv --exclude=venv --exclude=data --exclude=__pycache__ --exclude=.pytest_cache --exclude=tests `
  --exclude=.env --exclude=*.db --exclude=*.pyc `
  -C (Join-Path $root "backend") .
if ($LASTEXITCODE -ne 0) { throw "Packing the backend failed." }

foreach ($f in "setup-server.sh", "gym-planner.service", "nginx-gym-planner.conf", "env.server.example") {
  Copy-Item (Join-Path $PSScriptRoot $f) $out
}

if ($WithDatabase) {
  $data = Join-Path $root "backend\data"
  New-Item -ItemType Directory (Join-Path $out "data") | Out-Null
  if (Test-Path (Join-Path $data "gym_planner.db")) {
    # a consistent copy made with SQLite's own backup, never a raw file copy of a database that may be open
    Push-Location (Join-Path $root "backend")
    python scripts/backup_db.py data/gym_planner.db (Join-Path $out "data") | Out-Host
    Pop-Location
    $copy = Get-ChildItem (Join-Path $out "data") -Filter "gym_planner_*.db" | Sort-Object Name | Select-Object -Last 1
    Rename-Item $copy.FullName "gym_planner.db"
  }
  if (Test-Path (Join-Path $data "media")) { Copy-Item (Join-Path $data "media") (Join-Path $out "data\media") -Recurse }
  Write-Host "    Included your current database and pictures."
}

$mb = [math]::Round(((Get-ChildItem $out -Recurse | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host ""
Write-Host "Ready: $out  ($mb MB). Upload that whole folder to the server (see deploy\DEPLOY.md, step 3)."
