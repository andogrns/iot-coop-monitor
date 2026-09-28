param(
    [ValidateRange(1, 60)]
    [int]$PollSeconds = 5,

    [ValidateRange(1, 86400)]
    [int]$LogIntervalSeconds = 30
)

$ErrorActionPreference = 'Stop'
$captureScript = Join-Path $PSScriptRoot 'capture_on_computer.ps1'
$directory = [System.IO.Directory]::CreateDirectory(
    (Join-Path $PSScriptRoot '..\..\outputs\sensor_logs')
).FullName
$statusPath = Join-Path $directory 'capture_status.log'
$stopPath = Join-Path $directory 'stop_logging.signal'
$mutex = [System.Threading.Mutex]::new($false, 'Local\CoopMonitorManualCapture')

if (!$mutex.WaitOne(0)) {
    Write-Output 'Coop monitor logging is already running.'
    $mutex.Dispose()
    exit 1
}

function Write-CaptureStatus {
    param([string]$Message)
    $stamp = [DateTimeOffset]::Now.ToString('yyyy-MM-ddTHH:mm:sszzz')
    $entry = "$stamp $Message"
    Add-Content -LiteralPath $statusPath -Value $entry -Encoding utf8
    Write-Host $entry
}

function Get-UsbSerialPorts {
    # Windows maps active serial devices here. Ignore virtual Bluetooth ports.
    $key = Get-Item -LiteralPath 'HKLM:\HARDWARE\DEVICEMAP\SERIALCOMM'
    foreach ($deviceName in $key.GetValueNames()) {
        if ($deviceName -match 'Bth|Bluetooth') { continue }
        $port = [string]$key.GetValue($deviceName)
        if ($port -match '^COM[1-9][0-9]*$') { $port }
    }
}

try {
    if (Test-Path -LiteralPath $stopPath) { Remove-Item -LiteralPath $stopPath }
    $retryAfter = @{}
    $lastPorts = ''
    Write-CaptureStatus 'Manual logging started. Waiting for the ESP32-C3 serial port.'

    while (!(Test-Path -LiteralPath $stopPath)) {
        try {
            $ports = @(Get-UsbSerialPorts | Sort-Object -Unique)
            $portList = $ports -join ','
            if ($portList -ne $lastPorts) {
                Write-CaptureStatus "Available non-Bluetooth ports: $portList"
                $lastPorts = $portList
            }

            foreach ($candidate in $ports) {
                if (Test-Path -LiteralPath $stopPath) { break }
                if ($retryAfter.ContainsKey($candidate) -and
                    [DateTimeOffset]::Now -lt $retryAfter[$candidate]) { continue }

                Write-CaptureStatus "Opening $candidate; checking for the coop monitor."
                $result = & $captureScript -Port $candidate `
                    -LogIntervalSeconds $LogIntervalSeconds `
                    -OutputDirectory $directory -StopFile $stopPath `
                    -ReturnInsteadOfExit
                $resultCode = [int]$result
                Write-CaptureStatus "Capture on $candidate stopped with code $resultCode."
                $cooldown = if ($resultCode -eq 2) { 60 } else { $PollSeconds }
                $retryAfter[$candidate] = [DateTimeOffset]::Now.AddSeconds($cooldown)
            }
        } catch {
            Write-CaptureStatus "Capture error: $($_.Exception.Message)"
        }
        if (!(Test-Path -LiteralPath $stopPath)) { Start-Sleep -Seconds $PollSeconds }
    }
    Write-CaptureStatus 'Manual logging stopped.'
} finally {
    if (Test-Path -LiteralPath $stopPath) { Remove-Item -LiteralPath $stopPath }
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
