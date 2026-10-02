param([Parameter(Mandatory)][string]$Port, [string]$ArduinoCli, [string]$Esptool,
      [string]$BuildDirectory)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (!$ArduinoCli) { $ArduinoCli = Join-Path $env:LOCALAPPDATA 'Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe' }
if (!$Esptool) {
    $toolsPath = Join-Path $env:LOCALAPPDATA 'Arduino15\packages\esp32\tools\esptool_py'
    $candidate = Get-ChildItem -LiteralPath $toolsPath -Filter esptool.exe -Recurse |
        Sort-Object FullName -Descending | Select-Object -First 1
    if ($candidate) { $Esptool = $candidate.FullName }
}
if (!(Test-Path -LiteralPath $ArduinoCli) -or !$Esptool -or !(Test-Path -LiteralPath $Esptool)) {
    throw 'Arduino CLI or esptool not found. Supply the executable paths explicitly.'
}
if (!$BuildDirectory) { $BuildDirectory = Join-Path $root 'outputs\wifi-cloud\build' }
& (Join-Path $PSScriptRoot 'build_wifi_cloud.ps1') -ArduinoCli $ArduinoCli -BuildDirectory $BuildDirectory
# Read-only chip identification; --chip prevents an upload to a different MCU.
$flashInfo = @(& $Esptool --chip esp32c3 --port $Port flash-id 2>&1)
if ($LASTEXITCODE -ne 0 -or ($flashInfo -join "`n") -notmatch 'Detected flash size:\s*4\s*MB') {
    throw 'A 4 MB ESP32-C3 was not verified. Upload stopped without writing firmware.'
}
$serial = [IO.Ports.SerialPort]::new($Port,115200,[IO.Ports.Parity]::None,8,[IO.Ports.StopBits]::One)
$serial.ReadTimeout = 250
$serial.WriteTimeout = 2000
$serial.NewLine = "`n"
$calibration = $null
try {
    $serial.Open()
    Start-Sleep -Milliseconds 1800
    $serial.DiscardInBuffer()
    $serial.WriteLine('CAL EXPORT')
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while ([DateTime]::UtcNow -lt $deadline) {
        try { $line = $serial.ReadLine().Trim() } catch [TimeoutException] { continue }
        if ($line -match '^@CAL,(DATA,1,mq135-01,3,2\.000,RISING,|MISSING,mq135-01$)') { $calibration = $line; break }
    }
} finally { $serial.Dispose() }
if (!$calibration) { throw 'CAL EXPORT could not be backed up. Upload stopped; restore the current monitor firmware/Serial connection first.' }
$backup = Join-Path $root 'outputs\wifi-cloud\backups'
$null = [IO.Directory]::CreateDirectory($backup)
$path = Join-Path $backup ('calibration_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.txt')
[IO.File]::WriteAllText($path, $calibration + "`n")
Write-Host "Verified 4 MB ESP32-C3; calibration export saved to $path."
# This does not erase NVS or format LittleFS. Its offsets match the SD version.
& $ArduinoCli upload --fqbn 'esp32:esp32:nologo_esp32c3_super_mini:CDCOnBoot=cdc,PartitionScheme=no_ota,EraseFlash=none' `
    --port $Port --input-dir $BuildDirectory
if ($LASTEXITCODE -ne 0) { throw 'Upload failed. Preserve the calibration backup.' }
Write-Host 'Firmware uploaded. Check CAL SHOW and QUEUE STATUS in Serial Monitor.'
Write-Host 'If provisioning a new empty filesystem, explicitly send QUEUE INIT EMPTY once.'
