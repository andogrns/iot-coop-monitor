param(
  [Parameter(Mandatory=$true)][string]$Port,
  [string]$OutputPath = ("mq135-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".csv")
)
$ErrorActionPreference = 'Stop'
$serial = New-Object System.IO.Ports.SerialPort $Port,115200,None,8,one
$serial.ReadTimeout = 1000
$writer = $null
try {
  # CreateNew prevents overwriting an existing log.
  $stream = [IO.File]::Open($OutputPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
  $writer = New-Object IO.StreamWriter($stream)
  $writer.AutoFlush = $true
  $writer.WriteLine('host_time,sample,uptime_ms,raw_adc,estimated_ao_mv,status')
  $serial.Open()
  Write-Host "Logging $Port to $OutputPath. Press Ctrl+C to stop. Close Serial Monitor first."
  while ($true) {
    try { $line = $serial.ReadLine().Trim() }
    catch [TimeoutException] { continue }
    if ($line -match '^\d+,\d+,\d+(\.\d+)?,\d+(\.\d+)?,(ADC_HIGH|LOW_CHECK_WIRING|WARMUP|READING)$') {
      $writer.WriteLine((Get-Date -Format o) + ',' + $line)
      Write-Host $line
    }
  }
}
finally {
  if ($serial.IsOpen) { $serial.Close() }
  $serial.Dispose()
  if ($null -ne $writer) { $writer.Dispose() }
}
