# Rebuilds the Android app and copies it to mobile\GymPlanner.apk
#     powershell -ExecutionPolicy Bypass -File mobile\build-apk.ps1
# Needs: Node, the Android SDK (ANDROID_HOME) and Android Studio (its bundled Java 21 is used for this build only).
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot

$jbr = "C:\Program Files\Android\Android Studio\jbr"
if (-not (Test-Path "$jbr\bin\java.exe")) { throw "Android Studio's Java was not found at $jbr. Install Android Studio, or set JAVA_HOME to a Java 21 folder and edit this script." }
$sdk = $env:ANDROID_HOME
if (-not $sdk) { $sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk" }
if (-not (Test-Path $sdk)) { throw "The Android SDK was not found. Set ANDROID_HOME." }
$env:JAVA_HOME = $jbr
$env:ANDROID_HOME = $sdk

Push-Location $here
if (-not (Test-Path "node_modules")) { npm install --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw "npm install failed" } }
npx cap sync android
if ($LASTEXITCODE -ne 0) { throw "cap sync failed" }

Push-Location android
# tell Gradle where the SDK is (this file is not committed)
"sdk.dir=" + ($sdk -replace "\\", "\\\\" -replace ":", "\:") | Set-Content -Encoding ascii local.properties
.\gradlew.bat assembleDebug --console=plain
if ($LASTEXITCODE -ne 0) { throw "The Android build failed." }
Pop-Location

Copy-Item "android\app\build\outputs\apk\debug\app-debug.apk" "GymPlanner.apk" -Force
Pop-Location
$mb = [math]::Round((Get-Item (Join-Path $here "GymPlanner.apk")).Length / 1MB, 1)
Write-Host ""
Write-Host "Built: $(Join-Path $here 'GymPlanner.apk')  ($mb MB)"
