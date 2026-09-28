param(
    [ValidatePattern('^COM[1-9][0-9]*$')]
    [string]$Port,

    [string]$OutputDirectory,

    [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'
$culture = [System.Globalization.CultureInfo]::InvariantCulture
$utf8 = [System.Text.UTF8Encoding]::new($false, $true)

function Update-Crc32 {
    param([uint32]$Crc, [byte[]]$Bytes)
    foreach ($value in $Bytes) {
        $Crc = [uint32]($Crc -bxor [uint32]$value)
        for ($bit = 0; $bit -lt 8; $bit++) {
            if ($Crc -band 1) {
                $Crc = [uint32](($Crc -shr 1) -bxor [uint32]3988292384)
            } else {
                $Crc = [uint32]($Crc -shr 1)
            }
        }
    }
    return $Crc
}

function ConvertFrom-SdHexPath {
    param([string]$Hex)
    if ($Hex.Length -eq 0 -or $Hex.Length % 2 -ne 0 -or $Hex -notmatch '^[0-9A-F]+$') {
        throw 'Invalid filename in the ESP32 response.'
    }
    $path = $utf8.GetString([Convert]::FromHexString($Hex))
    if (!$path.StartsWith('/') -or $path.Contains('..') -or $path.Contains([char]0)) {
        throw 'Invalid file path in the ESP32 response.'
    }
    return $path
}

function Get-UsbSerialPorts {
    $key = Get-Item -LiteralPath 'HKLM:\HARDWARE\DEVICEMAP\SERIALCOMM'
    foreach ($deviceName in $key.GetValueNames()) {
        if ($deviceName -match 'Bth|Bluetooth') { continue }
        $candidate = [string]$key.GetValue($deviceName)
        if ($candidate -match '^COM[1-9][0-9]*$') { $candidate }
    }
}

function Select-Port {
    $ports = @(Get-UsbSerialPorts | Sort-Object -Unique)
    if ($ports.Count -eq 0) {
        throw 'No non-Bluetooth COM port found. Connect the ESP32-C3 by USB first.'
    }
    if ($ports.Count -eq 1) { return $ports[0] }
    Write-Host 'Available serial ports:'
    for ($index = 0; $index -lt $ports.Count; $index++) {
        Write-Host "  $($index + 1). $($ports[$index])"
    }
    $choice = Read-Host 'Choose a port number'
    [int]$number = 0
    if (![int]::TryParse($choice, [ref]$number) -or
        $number -lt 1 -or $number -gt $ports.Count) {
        throw 'Invalid port choice.'
    }
    return $ports[$number - 1]
}

function Read-SdLine {
    param($Connection)
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    while ($timer.Elapsed.TotalSeconds -lt 20) {
        try { $line = $Connection.ReadLine().TrimEnd([char]13) }
        catch [System.TimeoutException] { continue }
        if ($line -eq '@CAL,ERROR,UNKNOWN_COMMAND') {
            throw 'The connected firmware does not support microSD transfer commands. Upload the updated coop_monitor sketch.'
        }
        if ($line.StartsWith('@SD,ERROR,')) { throw "ESP32 microSD error: $line" }
        if ($line.StartsWith('@SD,')) { return $line }
        # Live readings and calibration messages may share Serial during a transfer.
    }
    throw 'Timed out waiting for the ESP32 microSD response.'
}

function Get-SdFiles {
    param($Connection)
    $Connection.DiscardInBuffer()
    $Connection.WriteLine('SD LISTPROTO')
    $start = Read-SdLine $Connection
    if ($start -ne '@SD,LIST,BEGIN,1') { throw "Unexpected list response: $start" }
    $files = [System.Collections.Generic.List[object]]::new()
    while ($true) {
        $line = Read-SdLine $Connection
        if ($line -match '^@SD,FILE,([0-9A-F]+),([0-9]+)$') {
            $files.Add([pscustomobject]@{
                Path = ConvertFrom-SdHexPath $Matches[1]
                Bytes = [uint64]::Parse($Matches[2], $culture)
            })
        } elseif ($line -match '^@SD,LIST,END,([0-9]+)$') {
            if ([uint64]::Parse($Matches[1], $culture) -ne $files.Count) {
                throw 'Incomplete microSD file list.'
            }
            return $files.ToArray()
        } else {
            throw "Unexpected list response: $line"
        }
    }
}

function Get-UniqueDownloadPath {
    param([string]$Directory, [string]$Name)
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($Name)
    $extension = [System.IO.Path]::GetExtension($Name)
    for ($index = 0; $index -le 9999; $index++) {
        $candidateName = if ($index -eq 0) { $Name } else { "$stem ($index)$extension" }
        $candidate = Join-Path $Directory $candidateName
        if (!(Test-Path -LiteralPath $candidate) -and
            !(Test-Path -LiteralPath "$candidate.partial")) { return $candidate }
    }
    throw 'No free download filename is available.'
}

function Receive-SdFile {
    param(
        $Connection,
        [string]$Path,
        [string]$Directory
    )
    $Connection.DiscardInBuffer()
    $Connection.WriteLine("SD GET $Path")
    $start = Read-SdLine $Connection
    if ($start -notmatch '^@SD,GET,BEGIN,([0-9A-F]+),([0-9]+)$' -or
        (ConvertFrom-SdHexPath $Matches[1]) -cne $Path) {
        throw "Unexpected download response: $start"
    }
    $expectedBytes = [uint64]::Parse($Matches[2], $culture)
    $null = [System.IO.Directory]::CreateDirectory($Directory)
    $name = [System.IO.Path]::GetFileName($Path)
    if ([string]::IsNullOrWhiteSpace($name)) { throw 'Invalid download filename.' }
    $destination = Get-UniqueDownloadPath $Directory $name
    $partial = "$destination.partial"
    $stream = $null
    $complete = $false
    [uint64]$receivedBytes = 0
    [uint32]$crc = [uint32]::MaxValue
    [uint64]$sequence = 0
    try {
        $stream = [System.IO.FileStream]::new($partial, [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        while ($true) {
            $line = Read-SdLine $Connection
            if ($line -match '^@SD,GET,DATA,([0-9]+),([0-9A-F]+)$') {
                if ([uint64]::Parse($Matches[1], $culture) -ne $sequence) {
                    throw 'Download chunk sequence mismatch.'
                }
                $hex = $Matches[2]
                if ($hex.Length -gt 256 -or $hex.Length % 2 -ne 0) {
                    throw 'Invalid download chunk length.'
                }
                [byte[]]$bytes = [Convert]::FromHexString($hex)
                if ($receivedBytes + $bytes.Length -gt $expectedBytes) {
                    throw 'Download exceeded the declared file size.'
                }
                $stream.Write($bytes, 0, $bytes.Length)
                $crc = Update-Crc32 $crc $bytes
                $receivedBytes += $bytes.Length
                $sequence++
                if ($receivedBytes -gt 0 -and $receivedBytes % 16384 -lt $bytes.Length) {
                    Write-Host "Received $receivedBytes / $expectedBytes bytes"
                }
            } elseif ($line -match '^@SD,GET,END,([0-9]+),([0-9A-F]{8})$') {
                [uint64]$reportedBytes = [uint64]::Parse($Matches[1], $culture)
                $reportedCrc = $Matches[2]
                $actualCrc = ([uint32]($crc -bxor [uint32]::MaxValue)).ToString('X8', $culture)
                if ($receivedBytes -ne $expectedBytes -or
                    $reportedBytes -ne $expectedBytes -or
                    $reportedCrc -cne $actualCrc) {
                    throw 'Downloaded file failed size or CRC32 verification.'
                }
                $stream.Flush($true)
                $stream.Dispose()
                $stream = $null
                [System.IO.File]::Move($partial, $destination)
                $complete = $true
                return $destination
            } else {
                throw "Unexpected download response: $line"
            }
        }
    } finally {
        if ($null -ne $stream) { $stream.Dispose() }
        if (!$complete -and (Test-Path -LiteralPath $partial)) {
            Remove-Item -LiteralPath $partial
        }
    }
}

if ($SelfTest) {
    $known = $utf8.GetBytes('123456789')
    $result = [uint32]((Update-Crc32 ([uint32]::MaxValue) $known) -bxor [uint32]::MaxValue)
    if ($result.ToString('X8', $culture) -ne 'CBF43926') { throw 'CRC32 self-test failed.' }
    if ((ConvertFrom-SdHexPath '2F434F4F50303030312E435356') -ne '/COOP0001.CSV') {
        throw 'Path decoding self-test failed.'
    }
    $pathHex = '2F434F4F50303030312E435356'
    $fake = [pscustomobject]@{
        Lines = [System.Collections.Generic.Queue[string]]::new()
        Sent = [System.Collections.Generic.List[string]]::new()
    }
    $fake | Add-Member ScriptMethod ReadLine { return $this.Lines.Dequeue() }
    $fake | Add-Member ScriptMethod WriteLine { param($text) $this.Sent.Add($text) }
    $fake | Add-Member ScriptMethod DiscardInBuffer { }
    $fake.Lines.Enqueue('@SD,LIST,BEGIN,1')
    $fake.Lines.Enqueue("@SD,FILE,$pathHex,9")
    $fake.Lines.Enqueue('@SD,LIST,END,1')
    $listed = @(Get-SdFiles $fake)
    if ($listed.Count -ne 1 -or $listed[0].Path -ne '/COOP0001.CSV' -or
        $listed[0].Bytes -ne 9 -or $fake.Sent[0] -ne 'SD LISTPROTO') {
        throw 'File-list protocol self-test failed.'
    }
    $testDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('coop-sd-' + [guid]::NewGuid().ToString('N'))
    try {
        $fake.Lines.Enqueue("@SD,GET,BEGIN,$pathHex,9")
        $fake.Lines.Enqueue('@SD,GET,DATA,0,313233343536373839')
        $fake.Lines.Enqueue('@SD,GET,END,9,CBF43926')
        $saved = Receive-SdFile $fake '/COOP0001.CSV' $testDirectory
        if ([System.IO.File]::ReadAllText($saved) -ne '123456789' -or
            $fake.Sent[1] -ne 'SD GET /COOP0001.CSV') {
            throw 'File-download protocol self-test failed.'
        }
        $fake.Lines.Enqueue("@SD,GET,BEGIN,$pathHex,9")
        $fake.Lines.Enqueue('@SD,GET,DATA,0,313233343536373839')
        $fake.Lines.Enqueue('@SD,GET,END,9,00000000')
        $rejected = $false
        try { $null = Receive-SdFile $fake '/COOP0001.CSV' $testDirectory }
        catch { $rejected = $_.Exception.Message -like '*CRC32*' }
        if (!$rejected -or @(Get-ChildItem -LiteralPath $testDirectory -File).Count -ne 1) {
            throw 'Corrupted-download cleanup self-test failed.'
        }
    } finally {
        if (Test-Path -LiteralPath $testDirectory) {
            Get-ChildItem -LiteralPath $testDirectory -File | Remove-Item
            Remove-Item -LiteralPath $testDirectory
        }
    }
    Write-Host 'SD transfer protocol self-test passed.'
    return
}

if ([string]::IsNullOrWhiteSpace($Port)) { $Port = Select-Port }
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $PSScriptRoot '..\..\outputs\sd_downloads'
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
$connection = [System.IO.Ports.SerialPort]::new($Port, 115200)
$connection.NewLine = "`n"
$connection.ReadTimeout = 1000
$connection.WriteTimeout = 3000
$connection.DtrEnable = $true
try {
    Write-Host "Opening $Port. Close Serial Monitor and manual logging first."
    $connection.Open()
    Start-Sleep -Seconds 2
    while ($true) {
        $files = @(Get-SdFiles $connection)
        if ($files.Count -eq 0) {
            Write-Host 'The microSD card contains no files.'
            break
        }
        Write-Host 'Files on microSD:'
        for ($index = 0; $index -lt $files.Count; $index++) {
            Write-Host ("  {0,3}. {1} ({2:N0} bytes)" -f
                ($index + 1), $files[$index].Path, $files[$index].Bytes)
        }
        $choice = Read-Host 'Enter a file number to download, R to refresh, or Q to quit'
        if ($choice -match '^[Qq]$') { break }
        if ($choice -match '^[Rr]$') { continue }
        [int]$number = 0
        if (![int]::TryParse($choice, [ref]$number) -or
            $number -lt 1 -or $number -gt $files.Count) {
            Write-Host 'Invalid choice.'
            continue
        }
        $saved = Receive-SdFile $connection $files[$number - 1].Path $OutputDirectory
        Write-Host "Saved and verified: $saved"
    }
} catch {
    Write-Error "SD transfer stopped: $($_.Exception.Message)"
    exit 1
} finally {
    if ($connection.IsOpen) { $connection.Close() }
    $connection.Dispose()
}
