param([Parameter(Mandatory)][string]$Port,
      [string]$ConfigPath)
$ErrorActionPreference = 'Stop'
# PSScriptRoot can be empty during parameter-default binding in Windows PowerShell 5.1.
if (!$ConfigPath) { $ConfigPath = Join-Path $PSScriptRoot 'dashboard.local.json' }
if (!(Test-Path -LiteralPath $ConfigPath)) { throw 'Missing dashboard.local.json. Follow the Cloudflare provisioning README.' }
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if ($config.protocolVersion -ne 1 -or $config.endpoint -cne 'https://coop-monitor-worker.coop-monitor-worker.workers.dev/api/device/exchange' -or
    $config.token -cnotmatch '^[0-9a-f]{64}$' -or $config.deviceId -cnotmatch '^[A-Za-z0-9_-]{1,64}$') {
    throw 'Protocol version 1, the deployed Cloudflare endpoint, deviceId and a 64-character lowercase device token are required. Legacy cloud.local.json is not compatible.'
}
$ssid = Read-Host '2.4 GHz Wi-Fi SSID (spaces allowed)'
if (!$ssid -or [Text.Encoding]::UTF8.GetByteCount($ssid) -gt 32 -or $ssid -match '[\x00-\x1f\x7f]') { throw 'SSID must be 1-32 UTF-8 bytes with no control characters.' }
$password = Read-Host 'Wi-Fi password (leave empty for an open network)' -AsSecureString
$serial = [IO.Ports.SerialPort]::new($Port,115200,[IO.Ports.Parity]::None,8,[IO.Ports.StopBits]::One)
$serial.NewLine = "`n"
$serial.Encoding = [Text.Encoding]::UTF8
$serial.ReadTimeout = 250
$serial.WriteTimeout = 2000
function Send-Setting([string]$Command) {
    $serial.WriteLine($Command)
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while ([DateTime]::UtcNow -lt $deadline) {
        try { $line = $serial.ReadLine().Trim() } catch [TimeoutException] { continue }
        if ($line -like '@NET,SAVED*') { return }
        if ($line -like '@NET,ERROR,*') { throw 'The monitor rejected a setting. Check lengths, device ID and the deployed Cloudflare endpoint.' }
    }
    throw 'No setting acknowledgement. Check the COM port and Cloudflare firmware. Close Serial Monitor before provisioning.'
}
$pointer = [IntPtr]::Zero
$plainPassword = $null
try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $passwordBytes = [Text.Encoding]::UTF8.GetByteCount($plainPassword)
    if ($plainPassword -match '[\x00-\x1f\x7f]' -or ($plainPassword -and
        !(($passwordBytes -ge 8 -and $passwordBytes -le 63) -or $plainPassword -match '^[0-9A-Fa-f]{64}$'))) {
        throw 'Wi-Fi password must be 8-63 UTF-8 bytes or a 64-character hex key, with no control characters.'
    }
    $serial.Open()
    Start-Sleep -Milliseconds 1500
    $serial.DiscardInBuffer()
    Send-Setting "WIFI SSID $ssid"
    if ($plainPassword) { Send-Setting "WIFI PASS $plainPassword" } else { Send-Setting 'WIFI OPEN' }
    Send-Setting "CLOUD URL $($config.endpoint)"
    Send-Setting "CLOUD ID $($config.deviceId)"
    Send-Setting "CLOUD TOKEN $($config.token)"
    $serial.WriteLine('NET RECONNECT')
    Write-Host 'Settings saved. Secrets were not printed. Close this helper before opening Serial Monitor.'
} finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $plainPassword = $null
    $config = $null
    $password.Dispose()
    $serial.Dispose()
}
