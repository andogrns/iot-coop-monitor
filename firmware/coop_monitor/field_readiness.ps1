# Read-only assessment shared by live preflight and offline diagnostic tests.
function New-FieldEvidence {
    return @{ Samples=@(); Sensors=@(); Networks=@(); Mq=@(); Calibration='unknown'; Config=$null; LastStatus=$null; Resets=0 }
}
function Convert-DiagnosticFields([string]$Line) {
    $value=@{}
    foreach($part in ($Line -split ',')) {
        if($part -match '^([^=]+)=(.*)$') {$value[$Matches[1]]=$Matches[2]}
    }
    return $value
}
function Add-FieldEvidence {
    param([hashtable]$Evidence,[string]$Line,[double]$ElapsedSeconds,[string[]]$Reading)
    if($null -ne $Reading) {$Evidence.Samples+=,@{at=$ElapsedSeconds;fields=$Reading}}
    if($Line -like '@SENSOR,*') {
        $v=Convert-DiagnosticFields $Line; $v.at=$ElapsedSeconds; $Evidence.Sensors+=,$v
    } elseif($Line -like '@MQ,ADC,*') {
        $v=Convert-DiagnosticFields $Line; $v.at=$ElapsedSeconds; $Evidence.Mq+=,$v
    } elseif($Line -match '^@NET,STATUS,([^;]+); wifi=(connected|offline); pending=(\d+); dropped=(\d+); commands=(ready|blocked)$') {
        $Evidence.LastStatus=@{message=$Matches[1];wifi=$Matches[2];pending=[int]$Matches[3];dropped=[long]$Matches[4];commands=$Matches[5]}
    } elseif($Line -like '@NET,DIAGNOSTIC,*') {
        $v=Convert-DiagnosticFields $Line; $v.at=$ElapsedSeconds
        $v.status=$Evidence.LastStatus; $Evidence.Networks+=,$v
    } elseif($Line -match '^@CAL,MISSING,(.+)$') {$Evidence.Calibration='missing:'+ $Matches[1]}
    elseif($Line -match '^@CAL,DATA,1,([^,]+),') {$Evidence.Calibration='saved:'+ $Matches[1]}
    elseif($Line -like '@CONFIG,*') {$Evidence.Config=Convert-DiagnosticFields $Line}
    elseif($Line -match 'USB_UART_CHIP_RESET|rst:0x') {$Evidence.Resets++}
}
function Get-FieldReadiness {
    param([hashtable]$Evidence,[double]$ElapsedSeconds)
    $reasons=[Collections.Generic.List[string]]::new()
    $samples=@($Evidence.Samples); $sensors=@($Evidence.Sensors); $networks=@($Evidence.Networks)
    $interval=if($Evidence.Config -and $Evidence.Config.ContainsKey('interval_s')) {[int]$Evidence.Config.interval_s} else {5}
    $badSamples=@($samples | Where-Object { $_.fields[6..9] -contains 'NA' -or $_.fields[10] -match 'sensor error|ADC high' }).Count
    $gaps=0; $reboots=$Evidence.Resets
    for($i=1;$i -lt $samples.Count;$i++) {
        $a=$samples[$i-1].fields; $b=$samples[$i].fields
        if([long]$b[0] -le [long]$a[0] -or [long]$b[1] -lt [long]$a[1]) {$reboots++}
        elseif([long]$b[0]-[long]$a[0] -ne 1 -or [long]$b[1]-[long]$a[1] -gt $interval+3) {$gaps++}
    }
    $failed=0; $totalFailed=0; $recovered=0
    if($sensors.Count) {
        foreach($key in @('aht_failed','bmp_failed')) {
            $totalFailed += [long]$sensors[-1][$key]
            $delta=[long]$sensors[-1][$key]-[long]$sensors[0][$key]
            if($delta -lt 0) {$reboots++} else {$failed+=$delta}
        }
        $recovered=[long]$sensors[-1].aht_recovered-[long]$sensors[0].aht_recovered
    }
    $freshSample=$samples.Count -gt 0 -and $ElapsedSeconds-[double]$samples[-1].at -le [math]::Max(15,2*$interval+3)
    $sensorReady=$sensors.Count -gt 0 -and $ElapsedSeconds-[double]$sensors[-1].at -le 90 -and $sensors[-1].aht -eq 'ready' -and $sensors[-1].bmp -eq 'ready' -and $sensors[-1].mq_module -eq 'mq135-02'
    $acquisition=$samples.Count -ge 6 -and $freshSample -and $sensorReady -and !$badSamples -and !$gaps -and !$reboots -and !$failed
    if(!$acquisition) {$reasons.Add('Acquisition check incomplete or sensor failures/gaps/resets observed.')}
    $good=@($networks | Where-Object {
        $_.status -and $_.status.wifi -eq 'connected' -and $_.status.message -eq 'CLOUD CONNECTED' -and
        $_.clock -eq 'ready' -and $_.http -eq '200' -and $_.stage -eq 'exchange accepted' -and [long]$_.success_ms -gt 0
    })
    $recent=@($good | Where-Object {$ElapsedSeconds-[double]$_.at -le 90})
    $distinctSuccess=@($recent | ForEach-Object {$_.success_ms} | Sort-Object -Unique)
    $dropStable=$false
    if($networks.Count -ge 3) {
        $tail=@($networks | Select-Object -Last 3)
        if(@($tail | Where-Object {!$_.status}).Count -eq 0) {
            $dropStable=$tail[0].status.dropped -eq $tail[-1].status.dropped
        }
    }
    $last=$Evidence.LastStatus
    $cloud=$recent.Count -ge 3 -and $distinctSuccess.Count -ge 2 -and
        $last -and $last.message -eq 'CLOUD CONNECTED' -and $last.wifi -eq 'connected' -and
        $last.pending -le 12 -and $dropStable
    if(!$cloud) {$reasons.Add('Live cloud delivery not proven: require fresh accepted HTTPS exchanges, draining queue and stable drop counter.')}
    if($Evidence.Calibration -notlike 'saved:mq135-02') {$reasons.Add('Replacement MQ has no confirmed saved profile; raw voltage only until conditioning and clean-air calibration are accepted.')}
    if($recovered -gt 0) {$reasons.Add('AHT retries persist; this is acquisition evidence, not a resolved bus fault.')}
    $mqRails=0
    foreach($check in $Evidence.Mq) {$mqRails += [int]$check.zero_raw+[int]$check.full_raw+[int]$check.adc_high}
    $mqObserved=@($Evidence.Mq).Count -gt 0
    if(!$mqObserved) {$reasons.Add('MQ diagnostic response not observed.')}
    if($mqRails) {$reasons.Add('MQ diagnostic found zero/full-scale/high readings.')}
    return [ordered]@{
        acquisition_pass=$acquisition; device_cloud_path_pass=[bool]$cloud
        preliminary_recording_ready=[bool]($acquisition -and $cloud -and $mqObserved -and !$mqRails)
        backend_history_readback_required=$true; formal_mq_acceptance_required=$true
        samples=$samples.Count; invalid_samples=$badSamples; gaps=$gaps; reset_observations=$reboots
        final_failure_counters=$failed; cumulative_final_failures=$totalFailed; aht_recovered_delta=$recovered; sensor_snapshots=$sensors.Count
        accepted_exchange_snapshots=$good.Count; recent_accepted_snapshots=$recent.Count
        distinct_recent_success_times=$distinctSuccess.Count; drop_counter_stable=$dropStable
        last_network=$last; calibration=$Evidence.Calibration; config=$Evidence.Config
        mq_diagnostic_runs=@($Evidence.Mq).Count; mq_rail_events=$mqRails
        cautions=@($reasons); scope='Device-side evidence only; verify actual new History rows before field launch.'
    }
}
