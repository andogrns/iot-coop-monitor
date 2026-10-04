param([Parameter(Mandatory)][string]$Port,
      [string]$ConfigPath)
$ErrorActionPreference = 'Stop'
# PSScriptRoot can be empty during parameter-default binding in Windows PowerShell 5.1.
if (!$ConfigPath) { $ConfigPath = Join-Path $PSScriptRoot 'cloud.local.json' }
if (!(Test-Path -LiteralPath $ConfigPath)) { throw 'Missing cloud.local.json. Follow the cloud setup README.' }
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if (!$config.endpoint_url -or $config.device_token -notmatch '^[0-9a-f]{64}$') {
    throw 'Cloud deployment is not configured yet: endpoint_url and device_token are required.'
}
$ssid = Read-Host '2.4 GHz Wi-Fi SSID (spaces allowed)'
$password = Read-Host 'Wi-Fi password (leave empty for an open network)' -AsSecureString
$serial = [IO.Ports.SerialPort]::new($Port,115200,[IO.Ports.Parity]::None,8,[IO.Ports.StopBits]::One)
$serial.NewLine = "`n"
$serial.ReadTimeout = 250
$serial.WriteTimeout = 2000
function Send-Setting([string]$Command) {
    $serial.WriteLine($Command)
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while ([DateTime]::UtcNow -lt $deadline) {
        try { $line = $serial.ReadLine().Trim() } catch [TimeoutException] { continue }
        if ($line -like '@NET,SAVED*') { return }
        if ($line -like '@NET,ERROR,*') { throw 'The monitor rejected a setting. Check lengths and the deployed /exec URL.' }
    }
    throw 'No setting acknowledgement. Check the COM port and WiFi Cloud firmware.'
}
$pointer = [IntPtr]::Zero
$plainPassword = $null
try {
    $serial.Open()
    Start-Sleep -Milliseconds 1500
    $serial.DiscardInBuffer()
    Send-Setting "WIFI SSID $ssid"
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ($plainPassword) { Send-Setting "WIFI PASS $plainPassword" } else { Send-Setting 'WIFI OPEN' }
    Send-Setting "CLOUD URL $($config.endpoint_url)"
    Send-Setting "CLOUD TOKEN $($config.device_token)"
    $serial.WriteLine('NET RECONNECT')
    Write-Host 'Settings saved. Secrets were not printed. Close this helper before opening Serial Monitor.'
} finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $plainPassword = $null
    $password.Dispose()
    $serial.Dispose()
}
