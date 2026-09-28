param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^COM[1-9][0-9]*$')]
    [string]$Port,

    [ValidateRange(1, 86400)]
    [int]$LogIntervalSeconds = 30,

    [ValidateSet('None', 'Start', 'Cancel', 'Show')]
    [string]$CalibrationAction = 'None',

    [string]$OutputDirectory,

    [string]$StopFile,

    [switch]$ReturnInsteadOfExit
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'reading_format.ps1')
$culture = [System.Globalization.CultureInfo]::InvariantCulture
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $PSScriptRoot '..\..\outputs\sensor_logs'
}
$directory = [System.IO.Directory]::CreateDirectory($OutputDirectory).FullName

function Get-ReferencePath {
    param([string]$SensorId)
    if ($SensorId -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Invalid sensor identifier.' }
    return Join-Path $directory "calibration_$SensorId.json"
}

function Convert-OptionalFloat {
    param([string]$Value)
    if ($Value -eq 'NA') { return $null }
    return [double]::Parse($Value, $culture)
}

function Format-OptionalFloat {
    param($Value)
    if ($null -eq $Value) { return 'NA' }
    return ([double]$Value).ToString('0.###', $culture)
}

function Save-Reference {
    param([string[]]$Fields)

    if ($Fields.Count -ne 13 -or $Fields[2] -ne '1' -or
        $Fields[3] -notmatch '^[a-zA-Z0-9_-]+$' -or $Fields[4] -ne '3' -or
        $Fields[6] -ne 'RISING') {
        throw 'Unexpected calibration record from the ESP32.'
    }

    $reference = [ordered]@{
        schema_version = 1
        sensor_id = $Fields[3]
        adc_pin = 3
        divider_scale = [double]::Parse($Fields[5], $culture)
        direction = 'RISING'
        baseline_adc_mv = [double]::Parse($Fields[7], $culture)
        threshold_adc_mv = [double]::Parse($Fields[8], $culture)
        sd_adc_mv = [double]::Parse($Fields[9], $culture)
        sample_count = [uint32]::Parse($Fields[10], $culture)
        temperature_c = Convert-OptionalFloat $Fields[11]
        humidity_percent = Convert-OptionalFloat $Fields[12]
        saved_at_local = [DateTimeOffset]::Now.ToString('o', $culture)
    }
    if ($reference.divider_scale -ne 2.0 -or
        $reference.baseline_adc_mv -lt 10 -or
        $reference.threshold_adc_mv -le $reference.baseline_adc_mv -or
        $reference.threshold_adc_mv -ge 2400 -or
        $reference.sample_count -lt 60) {
        throw 'Calibration values from the ESP32 failed validation.'
    }

    $path = Get-ReferencePath $reference.sensor_id
    if (Test-Path -LiteralPath $path) {
        $previous = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        if ($previous.schema_version -eq $reference.schema_version -and
            $previous.sensor_id -eq $reference.sensor_id -and
            $previous.adc_pin -eq $reference.adc_pin -and
            $previous.divider_scale -eq $reference.divider_scale -and
            $previous.direction -eq $reference.direction -and
            $previous.baseline_adc_mv -eq $reference.baseline_adc_mv -and
            $previous.threshold_adc_mv -eq $reference.threshold_adc_mv -and
            $previous.sd_adc_mv -eq $reference.sd_adc_mv -and
            $previous.sample_count -eq $reference.sample_count -and
            $previous.temperature_c -eq $reference.temperature_c -and
            $previous.humidity_percent -eq $reference.humidity_percent) {
            return $path
        }
    }

    $json = $reference | ConvertTo-Json -Depth 3
    $temporaryPath = "$path.tmp"
    [System.IO.File]::WriteAllText($temporaryPath, $json + [Environment]::NewLine,
                                  [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::Move($temporaryPath, $path, $true)
    return $path
}

function Send-Reference {
    param([System.IO.Ports.SerialPort]$SerialPort, [string]$SensorId)

    $path = Get-ReferencePath $SensorId
    if (!(Test-Path -LiteralPath $path)) {
        Write-Host "No computer reference file for $SensorId. Run CAL START in clean reference air."
        return
    }
    $reference = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if ($reference.schema_version -ne 1 -or $reference.sensor_id -ne $SensorId -or
        $reference.adc_pin -ne 3 -or $reference.divider_scale -ne 2.0 -or
        $reference.direction -ne 'RISING' -or
        $reference.baseline_adc_mv -lt 10 -or
        $reference.threshold_adc_mv -le $reference.baseline_adc_mv -or
        $reference.threshold_adc_mv -ge 2400 -or
        $null -eq $reference.sd_adc_mv -or $reference.sd_adc_mv -lt 0 -or
        $reference.sample_count -lt 60) {
        throw "Reference file $path is incompatible or invalid."
    }

    $values = @(
        'CAL IMPORT',
        '1',
        $SensorId,
        '3',
        '2.000',
        'RISING',
        ([double]$reference.baseline_adc_mv).ToString('0.###', $culture),
        ([double]$reference.threshold_adc_mv).ToString('0.###', $culture),
        ([double]$reference.sd_adc_mv).ToString('0.###', $culture),
        ([uint32]$reference.sample_count).ToString($culture),
        (Format-OptionalFloat $reference.temperature_c),
        (Format-OptionalFloat $reference.humidity_percent)
    )
    $SerialPort.WriteLine(($values -join ','))
    Write-Host "Sent calibration reference from $path"
}

$serialPort = $null
$writer = $null
$openDay = $null
$lastSavedAt = [DateTimeOffset]::MinValue
$lastSeenStatus = $null
$exitCode = 0
$readingState = @{}

try {
    $serialPort = [System.IO.Ports.SerialPort]::new($Port, 115200)
    $serialPort.ReadTimeout = 1000
    $serialPort.NewLine = "`n"
    $serialPort.DtrEnable = $true
    $serialPort.Open()
    Write-Host "Connected to $Port at 115200 baud. Files: $directory"
    Write-Host "Saving a reading every $LogIntervalSeconds seconds and on status changes. Press Ctrl+C to stop."

    Start-Sleep -Milliseconds 1500
    $serialPort.WriteLine('CAL EXPORT')
    $recognizedBoard = $false
    $actionSent = $false
    $probeDeadline = [DateTimeOffset]::Now.AddSeconds(8)

    while ($true) {
        if ($StopFile -and (Test-Path -LiteralPath $StopFile)) {
            Write-Host 'Capture stopped by user.'
            break
        }
        try { $line = $serialPort.ReadLine().Trim() }
        catch [System.TimeoutException] {
            $readingState.Clear()
            if (!$recognizedBoard -and [DateTimeOffset]::Now -ge $probeDeadline) {
                throw "$Port did not respond as the coop monitor."
            }
            if ($recognizedBoard -and
                [System.IO.Ports.SerialPort]::GetPortNames() -notcontains $Port) {
                throw "$Port disconnected."
            }
            continue
        }

        $fields = Read-ReadingLine -Line $line -State $readingState
        if ($line.StartsWith('@CAL,DATA,1,mq135-01,') -or
            $line -eq '@CAL,MISSING,mq135-01' -or
            $null -ne $fields) {
            $recognizedBoard = $true
        }
        if (!$recognizedBoard -and [DateTimeOffset]::Now -ge $probeDeadline) {
            throw "$Port did not respond as the coop monitor."
        }
        if (!$recognizedBoard) { continue }
        if ($recognizedBoard -and !$actionSent) {
            if ($CalibrationAction -eq 'Start') { $serialPort.WriteLine('CAL START') }
            elseif ($CalibrationAction -eq 'Cancel') { $serialPort.WriteLine('CAL CANCEL') }
            elseif ($CalibrationAction -eq 'Show') { $serialPort.WriteLine('CAL SHOW') }
            $actionSent = $true
        }

        if ($line.StartsWith('@CAL,')) {
            $parts = $line -split ','
            if ($parts.Count -ge 2 -and $parts[1] -eq 'DATA') {
                try {
                    $path = Save-Reference $parts
                    Write-Host "Calibration reference: $path"
                } catch { [Console]::Error.WriteLine("Calibration file error: $($_.Exception.Message)") }
            } elseif ($parts.Count -eq 3 -and $parts[1] -eq 'MISSING') {
                if ($CalibrationAction -ne 'Start') {
                    try { Send-Reference $serialPort $parts[2] }
                    catch { [Console]::Error.WriteLine("Calibration restore error: $($_.Exception.Message)") }
                }
            } else { Write-Host $line }
            continue
        }

        if ($null -eq $fields) { continue }
        $now = [DateTimeOffset]::Now
        $statusChanged = $null -ne $lastSeenStatus -and $fields[10] -ne $lastSeenStatus
        $lastSeenStatus = $fields[10]
        if (($now - $lastSavedAt).TotalSeconds -lt $LogIntervalSeconds -and
            !$statusChanged) { continue }

        $day = $now.ToString('yyyy-MM-dd', $culture)
        if ($day -ne $openDay) {
            if ($null -ne $writer) { $writer.Dispose() }
            $path = Join-Path $directory "sensor_readings_${day}_aht20_bmp280_readable_v2.csv"
            $newFile = !(Test-Path -LiteralPath $path) -or
                       (Get-Item -LiteralPath $path -ErrorAction SilentlyContinue).Length -eq 0
            $writer = [System.IO.StreamWriter]::new(
                $path, $true, [System.Text.UTF8Encoding]::new($true)
            )
            $writer.AutoFlush = $true
            if ($newFile) {
                $writer.WriteLine((Get-ReadingCsvHeader))
            }
            $openDay = $day
            Write-Host "Sensor readings: $path"
        }

        $timestamp = $now.ToString('yyyy-MM-dd HH:mm:ss.fff zzz', $culture)
        $writer.WriteLine((ConvertTo-ReadingCsvRow -Fields $fields -Timestamp $now -StatusChanged $statusChanged))
        $lastSavedAt = $now
        Write-Host "$timestamp  MQ=$($fields[3]) mV  AHT=$($fields[6]) C/$($fields[7]) %  BMP=$($fields[8]) C/$($fields[9]) hPa  $($fields[10])"
    }
}
catch {
    $message = "Capture stopped: $($_.Exception.Message)"
    if ($_.Exception.Message -match 'Access to the path .* is denied') {
        $message += " Close Arduino Serial Monitor or any other program using $Port."
    }
    [Console]::Error.WriteLine($message)
    $exitCode = if ($_.Exception.Message -like '*did not respond as the coop monitor*') { 2 } else { 1 }
}
finally {
    if ($null -ne $writer) { $writer.Dispose() }
    if ($null -ne $serialPort) { $serialPort.Dispose() }
}

if ($ReturnInsteadOfExit) { return $exitCode }
exit $exitCode
