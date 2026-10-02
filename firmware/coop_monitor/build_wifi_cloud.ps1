param([string]$ArduinoCli, [string]$BuildDirectory)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (!$ArduinoCli) {
    $candidate = Get-Command arduino-cli -ErrorAction SilentlyContinue
    $ArduinoCli = if ($candidate) { $candidate.Source } else {
        Join-Path $env:LOCALAPPDATA 'Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe'
    }
}
if (!(Test-Path -LiteralPath $ArduinoCli)) { throw 'Arduino CLI not found. Supply -ArduinoCli with its full path.' }
if (!$BuildDirectory) { $BuildDirectory = Join-Path $root 'outputs\wifi-cloud\build' }
$null = [IO.Directory]::CreateDirectory($BuildDirectory)
& $ArduinoCli compile --fqbn 'esp32:esp32:nologo_esp32c3_super_mini:CDCOnBoot=cdc,PartitionScheme=no_ota,EraseFlash=none' `
    --build-property 'upload.maximum_size=2097152' --build-path $BuildDirectory $PSScriptRoot
if ($LASTEXITCODE -ne 0) { throw 'ESP32-C3 firmware compilation failed.' }
Write-Host "Build saved to $BuildDirectory. No device was uploaded."
