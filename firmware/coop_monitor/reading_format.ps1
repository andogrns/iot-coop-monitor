# Shared by live capture and offline verification; no serial or file side effects.
$script:ReadingStatusLabels = [ordered]@{
    CAL_STABILIZING = 'Calibration stabilizing'
    CAL_COLLECTING = 'Calibration collecting'
    WARMUP = 'Warming up'
    CAL_MISSING = 'Calibration missing'
    AHT_ERROR = 'AHT sensor error'
    BMP_ERROR = 'BMP sensor error'
    OLED_ERROR = 'OLED error'
    MQ_ADC_HIGH = 'MQ ADC high'
    GAS_WARNING = 'Gas warning'
    OK = 'OK'
}

function Get-ReadingCsvHeader {
    # Construct the degree sign explicitly for Windows PowerShell compatibility.
    $degree = [char]0x00B0
    return "Local timestamp,Record reason,Sample number,Uptime (s),MQ raw ADC,MQ ADC (mV),MQ output (V),MQ baseline ratio,AHT temperature (${degree}C),Humidity (%RH),BMP temperature (${degree}C),Pressure (hPa),Status"
}

function Convert-ReadingStatus {
    param([string]$Status)
    return (($Status -split '\|' | ForEach-Object {
        if ($script:ReadingStatusLabels.Contains($_)) { $script:ReadingStatusLabels[$_] }
        else { $_ }
    }) -join ' | ')
}

function Get-LegacyReadingFields {
    param([string]$Line)
    $fields = $Line -split ','
    if ($fields.Count -ne 11) { return $null }
    foreach ($index in 0..3) {
        if ($fields[$index] -notmatch '^\d+$') { return $null }
    }
    foreach ($index in 4..9) {
        if (($index -eq 4 -or $fields[$index] -ne '') -and
            $fields[$index] -notmatch '^-?\d+(?:\.\d+)?$') { return $null }
        if ($fields[$index] -eq '') { $fields[$index] = 'NA' }
    }
    if ($fields[10] -notmatch '^[A-Z][A-Z0-9_|]*$') { return $null }
    $fields[10] = Convert-ReadingStatus $fields[10]
    return ,$fields
}

function Read-ReadingLine {
    param([string]$Line, [System.Collections.IDictionary]$State)
    $lineText = $Line.Trim()
    if ($lineText -match '^--- Sample (\d+) \| Uptime (\d{2,}):([0-5]\d):([0-5]\d) ---$') {
        $State.Clear()
        $State.Fields = [string[]]::new(11)
        $State.Fields[0] = $Matches[1]
        $uptime = [uint64]$Matches[2] * 3600 + [uint64]$Matches[3] * 60 + [uint64]$Matches[4]
        $State.Fields[1] = $uptime.ToString([Globalization.CultureInfo]::InvariantCulture)
        $State.Step = 1
        return $null
    }
    # Backward compatibility permits capture before the new sketch is uploaded.
    $legacy = Get-LegacyReadingFields $lineText
    if ($null -ne $legacy) { $State.Clear(); return ,$legacy }
    if (!$State.Contains('Step')) { return $null }

    $number = '-?\d+(?:\.\d+)?'
    $optional = "(?:$number|NA)"
    switch ($State.Step) {
        1 {
            if ($lineText -match '^MQ-135\s*: ADC (\d+) mV \| Output (\d+\.\d+) V \| Raw (\d+)$') {
                $State.Fields[2] = $Matches[3]
                $State.Fields[3] = $Matches[1]
                $State.Fields[4] = $Matches[2]
                $State.Step = 2
                return $null
            }
        }
        2 {
            if ($lineText -match "^Baseline: ($number)x \([+-]\d+\.\d+%\) \| Warning threshold $number mV`$") {
                $State.Fields[5] = $Matches[1]
                $State.Step = 3
                return $null
            }
            if ($lineText -eq 'Baseline: NA | Warning threshold NA mV') {
                $State.Fields[5] = 'NA'
                $State.Step = 3
                return $null
            }
        }
        3 {
            if ($lineText -match "^AHT20\s*: Temperature ($optional) C \| Humidity ($optional) %RH`$") {
                $State.Fields[6] = $Matches[1]
                $State.Fields[7] = $Matches[2]
                $State.Step = 4
                return $null
            }
        }
        4 {
            if ($lineText -match "^BMP280\s*: Temperature ($optional) C \| Pressure ($optional) hPa`$") {
                $State.Fields[8] = $Matches[1]
                $State.Fields[9] = $Matches[2]
                $State.Step = 5
                return $null
            }
        }
        5 {
            if ($lineText -match '^Status\s*: (.+)$') {
                $labels = $Matches[1] -split ' \| '
                $valid = $true
                foreach ($label in $labels) {
                    if ($script:ReadingStatusLabels.Values -cnotcontains $label) { $valid = $false }
                }
                if ($labels.Count -gt 1 -and $labels -contains 'OK') { $valid = $false }
                if ($valid) {
                    $State.Fields[10] = $labels -join ' | '
                    $result = $State.Fields
                    $State.Clear()
                    return ,$result
                }
            }
        }
    }
    # Unexpected, missing or reordered lines invalidate the entire block.
    $State.Clear()
    return $null
}

function ConvertTo-ReadingCsvRow {
    param([string[]]$Fields, [DateTimeOffset]$Timestamp, [bool]$StatusChanged)
    $reason = if ($StatusChanged) { 'Status change' } else { 'Periodic' }
    $stamp = $Timestamp.ToString('yyyy-MM-dd HH:mm:ss.fff zzz', [Globalization.CultureInfo]::InvariantCulture)
    $cells = @($stamp, $reason) + $Fields
    return (($cells | ForEach-Object {
        if ($_ -match '[,"\r\n]') { '"' + $_.Replace('"', '""') + '"' }
        else { $_ }
    }) -join ',')
}
