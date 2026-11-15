param(
    [Parameter(Mandatory)][ValidatePattern('^COM[1-9][0-9]*$')][string]$Port,
    [ValidateRange(60,1800)][int]$DurationSeconds=900,
    [string]$OutputDirectory,
    [switch]$ReconnectOnce
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'reading_format.ps1')
. (Join-Path $PSScriptRoot 'field_readiness.ps1')
if(!$OutputDirectory) {
    $stamp=[DateTime]::UtcNow.ToString('yyyyMMdd_HHmmss')
    $OutputDirectory=Join-Path $PSScriptRoot ('../../outputs/field-preflight/'+$stamp)
}
$dir=[IO.Directory]::CreateDirectory($OutputDirectory).FullName
$utf8=[Text.UTF8Encoding]::new($false)
$trace=[IO.StreamWriter]::new((Join-Path $dir 'serial.private.jsonl'),$false,$utf8)
$csv=[IO.StreamWriter]::new((Join-Path $dir 'readings.csv'),$false,$utf8)
$trace.AutoFlush=$true; $csv.AutoFlush=$true
$csv.WriteLine((Get-ReadingCsvHeader))
$serial=[IO.Ports.SerialPort]::new($Port,115200)
$serial.DtrEnable=$false; $serial.RtsEnable=$false; $serial.ReadTimeout=200; $serial.WriteTimeout=1500; $serial.NewLine="`n"
$timer=[Diagnostics.Stopwatch]::new(); $evidence=New-FieldEvidence; $state=@{}
$nextStatus=0; $nextSensor=0; $nextMq=0; $nextHeartbeat=30; $reconnected=$false; $fatal=$null
try {
    $serial.Open(); $serial.DiscardInBuffer(); $timer.Start()
    $start=[DateTimeOffset]::UtcNow
    Write-Output ('Preflight started '+$start.ToString('o')+'; output '+$dir)
    foreach($command in @('CAL EXPORT','CONFIG SHOW')) {$serial.WriteLine($command)}
    while($timer.Elapsed.TotalSeconds -lt $DurationSeconds) {
        $elapsed=$timer.Elapsed.TotalSeconds
        if($elapsed -ge $nextStatus) {$serial.WriteLine('NET STATUS');$nextStatus+=10}
        if($elapsed -ge $nextSensor) {$serial.WriteLine('SENSOR STATUS');$nextSensor+=60}
        if($elapsed -ge $nextMq) {$serial.WriteLine('MQ CHECK');$nextMq+=300}
        if($ReconnectOnce -and !$reconnected -and $elapsed -ge 60) {
            if(!$evidence.LastStatus -or $evidence.LastStatus.wifi -ne 'connected') {
                $serial.WriteLine('NET RECONNECT')
                $trace.WriteLine((@{utc=[DateTimeOffset]::UtcNow.ToString('o');elapsed_s=$elapsed;command='NET RECONNECT'}|ConvertTo-Json -Compress))
                Write-Output 'One reconnect requested using existing saved settings.'
            }
            $reconnected=$true
        }
        if($elapsed -ge $nextHeartbeat) {
            $result=Get-FieldReadiness $evidence $elapsed
            [IO.File]::WriteAllText((Join-Path $dir 'latest.json'),($result|ConvertTo-Json -Depth 6),$utf8)
            Write-Output ('elapsed='+[int]$elapsed+' samples='+$result.samples+' acquisition='+$result.acquisition_pass+' cloud='+$result.device_cloud_path_pass)
            $nextHeartbeat+=30
        }
        try {$line=$serial.ReadLine().Trim()} catch [TimeoutException] {continue}
        $stamp=[DateTimeOffset]::Now
        $trace.WriteLine((@{utc=$stamp.ToUniversalTime().ToString('o');elapsed_s=[math]::Round($timer.Elapsed.TotalSeconds,3);line=$line}|ConvertTo-Json -Compress))
        $reading=Read-ReadingLine $line $state
        Add-FieldEvidence -Evidence $evidence -Line $line -ElapsedSeconds $timer.Elapsed.TotalSeconds -Reading $reading
        if($null -ne $reading) {$csv.WriteLine((ConvertTo-ReadingCsvRow $reading $stamp $false))}
    }
} catch {$fatal=$_.Exception.Message;throw} finally {
    $serial.Dispose();$timer.Stop();$trace.Dispose();$csv.Dispose()
    $result=Get-FieldReadiness $evidence $timer.Elapsed.TotalSeconds
    $result.duration_s=[math]::Round($timer.Elapsed.TotalSeconds,3);$result.port_closed=$true;$result.fatal_error=$fatal
    [IO.File]::WriteAllText((Join-Path $dir 'result.json'),($result|ConvertTo-Json -Depth 6),$utf8)
    Write-Output ($result|ConvertTo-Json -Depth 6)
}
if($result.preliminary_recording_ready) {exit 0} else {exit 2}
