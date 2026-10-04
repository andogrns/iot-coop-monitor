param([string]$ConfigPath,
      [switch]$QuickTest)
$ErrorActionPreference = 'Stop'
if (!$ConfigPath) { $ConfigPath = Join-Path $PSScriptRoot '..\..\firmware\coop_monitor\cloud.local.json' }
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if ($config.endpoint_url -notmatch '^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$' -or
    $config.device_token -notmatch '^[0-9a-f]{64}$') { throw 'A real deployed /exec URL and device token are required in the ignored config.' }
Add-Type -AssemblyName System.Net.Http
$handler = [Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$client = [Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds(45)
function Request-Ingestion([string]$Token, [array]$Records) {
    $request = @{version=1; token=$Token; records=$Records}
    if ($QuickTest) { $request.version=2; $request.session=$session }
    $json = $request | ConvertTo-Json -Depth 6 -Compress
    $body = [Net.Http.StringContent]::new($json,[Text.Encoding]::UTF8,'application/json')
    $response = $null
    try {
        $response = $client.PostAsync($config.endpoint_url,$body).GetAwaiter().GetResult()
        if ([int]$response.StatusCode -in 302,303) {
            $location = $response.Headers.Location
            if (!$location -or $location.Scheme -ne 'https' -or $location.Host -ne 'script.googleusercontent.com' -or $location.UserInfo) {
                throw 'Response redirect refused; credentials were not replayed.'
            }
            $response.Dispose()
            # The redirect GET carries no request token/body. System TLS validation stays enabled.
            $response = $client.GetAsync($location).GetAwaiter().GetResult()
        }
        if ([int]$response.StatusCode -ne 200) { throw 'Endpoint did not return HTTP 200.' }
        $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if ($text.Length -gt 4096) { throw 'Endpoint response exceeded the acknowledgement limit.' }
        return $text | ConvertFrom-Json
    } finally { if ($response) { $response.Dispose() }; $body.Dispose() }
}
try {
    $boot = [Guid]::NewGuid().ToString('N')
    $session = @{id=[Guid]::NewGuid().ToString('N');duration_min=30;outcome='Stopped';
      calibration=@{baseline_mv=1000;threshold_mv=1150;sd_mv=12;samples=150;temperature_c=29;humidity_pct=65}}
    $records = @(1..2 | ForEach-Object {
        @{id="test-000000000000:${boot}:$_"; device_id='test-000000000000'; boot_id=$boot;
          sample=$_; uptime_s=($_ * 30); sampled_utc_ms=$null; reason='Periodic';
          mq_raw=1200; mq_adc_mv=900; mq_output_v=1.8; mq_ratio=$null;
          aht_temp_c=28.5; humidity_pct=65.0; bmp_temp_c=29.0; pressure_hpa=1010.0;
          status='Calibration missing'; dropped_total=0}
    })
    $records[1].sampled_utc_ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    if ($QuickTest) { foreach ($record in $records) { $record.elapsed_test_s=($record.sample-1)*2; $record.status='Warming up' } }
    $wrongToken = if ($config.device_token -eq ('0' * 64)) { '1' * 64 } else { '0' * 64 }
    $rejected = Request-Ingestion $wrongToken $records
    if ($rejected.ok -or $rejected.error -ne 'UNAUTHORIZED') { throw 'Wrong-token rejection failed.' }
    # Replaying the same IDs models a lost acknowledgement; the Sheet should gain two rows total.
    foreach ($attempt in 1..2) {
        $accepted = Request-Ingestion $config.device_token $records
        if (!$accepted.ok -or @($accepted.acknowledged).Count -ne 2) { throw 'Missing acknowledgement.' }
        for ($i=0; $i -lt 2; $i++) {
            if ($accepted.acknowledged[$i] -ne $records[$i].id) { throw 'Acknowledged IDs differ from the request.' }
        }
    }
    Write-Host 'PASS: live wrong-token rejection and two matching acknowledgements for the same test batch.'
    Write-Host 'Read back these IDs in Sheets: exactly two synthetic test rows should exist, with separate receipt/sample times.'
    $records | ForEach-Object { Write-Output $_.id }
    if ($QuickTest) { Write-Host ('QuickTests session: ' + $session.id) }
    Write-Host 'This verifies the server path only; it does not upload firmware or test physical sensors/flash.'
} finally { $client.Dispose(); $handler.Dispose() }
