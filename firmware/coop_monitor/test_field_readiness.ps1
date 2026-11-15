$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'field_readiness.ps1')
function Assert-Check([bool]$Condition,[string]$Name) {if(!$Condition) {throw $Name}}
function New-Trace {
    $e=New-FieldEvidence
    Add-FieldEvidence $e '@CONFIG,revision=4,mode=automatic,manual_mv=0,consecutive=3,interval_s=5' 0
    Add-FieldEvidence $e '@CAL,MISSING,mq135-02' 0
    Add-FieldEvidence $e '@SENSOR,hz=100000,aht=ready,aht_error=none,aht_recovered=0,aht_failed=0,bmp=ready,bmp_addr=0x77,bmp_chip=0x58,bmp_chip_read=ok,bmp_error=none,bmp_recovered=0,bmp_failed=0,mq_module=mq135-02,mq_calibration=missing' 0
    Add-FieldEvidence $e '@MQ,ADC,n=256,zero_raw=0,full_raw=0,adc_high=0' 1
    for($i=0;$i -lt 8;$i++) {
        $f=[string[]]@([string](100+$i),[string](5*$i),'236','183','0.366','NA','24.00','30.00','24.50','939.00','Calibration missing')
        Add-FieldEvidence -Evidence $e -Line '' -ElapsedSeconds (5*$i) -Reading $f
    }
    return $e
}
function Add-Network([hashtable]$E,[string]$Message='CLOUD CONNECTED',[string]$Wifi='connected',[string]$Stage='exchange accepted',[bool]$StaticSuccess=$false,[bool]$GrowingDrops=$false) {
    foreach($t in @(20,30,40)) {
        $drops=if($GrowingDrops) {$t} else {7}
        $success=if($StaticSuccess) {1000} else {$t*1000}
        Add-FieldEvidence $E "@NET,STATUS,$Message; wifi=$Wifi; pending=1; dropped=$drops; commands=ready" $t
        Add-FieldEvidence $E "@NET,DIAGNOSTIC,wifi_status=3,rssi=-50,clock=ready,http=200,tls=0,stage=$Stage,detail=,attempt_ms=$success,success_ms=$success,heap=100000,stack_free=2000" $t
    }
}
$e=New-Trace;Add-Network $e
$r=Get-FieldReadiness $e 40
Assert-Check $r.preliminary_recording_ready 'Fresh accepted exchanges and complete samples must pass preliminary recording'
Assert-Check $r.formal_mq_acceptance_required 'Missing MQ calibration must remain an explicit acceptance prerequisite'
Assert-Check $r.backend_history_readback_required 'Device evidence must not claim backend History readback'

$e=New-Trace;Add-Network $e -Message 'WIFI OFFLINE' -Wifi 'offline'
Assert-Check (!(Get-FieldReadiness $e 40).device_cloud_path_pass) 'Offline status must fail even with HTTP 200 fields'
$e=New-Trace;Add-Network $e -Message 'UPLOADS PAUSED'
Assert-Check (!(Get-FieldReadiness $e 40).device_cloud_path_pass) 'Paused HTTP 200 must fail'
$e=New-Trace;Add-Network $e -StaticSuccess $true
Assert-Check (!(Get-FieldReadiness $e 40).device_cloud_path_pass) 'Unchanging historical success timestamp must fail'
$e=New-Trace;Add-Network $e -Stage 'response invalid, oversized or interrupted'
Assert-Check (!(Get-FieldReadiness $e 40).device_cloud_path_pass) 'HTTP 200 without accepted protocol response must fail'
$e=New-Trace;Add-Network $e -GrowingDrops $true
Assert-Check (!(Get-FieldReadiness $e 40).device_cloud_path_pass) 'Increasing drop counter must fail'
$e=New-Trace;Add-Network $e
Add-FieldEvidence $e '@NET,STATUS,WIFI OFFLINE; wifi=offline; pending=10; dropped=7; commands=ready' 41
Assert-Check (!(Get-FieldReadiness $e 41).device_cloud_path_pass) 'Latest offline state must override earlier success'
$e=New-Trace;Add-Network $e
$e.Samples[7].fields[7]='NA'
Assert-Check (!(Get-FieldReadiness $e 40).acquisition_pass) 'Invalid humidity must fail'
$e=New-Trace;Add-Network $e
$e.Samples[7].fields[0]='109'
Assert-Check (!(Get-FieldReadiness $e 40).acquisition_pass) 'Sequence gap must fail'
$e=New-Trace;Add-Network $e
Assert-Check (!(Get-FieldReadiness $e 100).acquisition_pass) 'Stale last sensor sample must fail'
$e=New-Trace;Add-Network $e
$later=@{}+$e.Sensors[0];$later.at=40;$later.aht_failed='1';$e.Sensors+=,$later
Assert-Check (!(Get-FieldReadiness $e 40).acquisition_pass) 'New final sensor failure counter must fail'
$e=New-Trace;Add-Network $e
$e.Sensors[0].aht_failed='5'
Assert-Check (Get-FieldReadiness $e 40).acquisition_pass 'Unchanged historical failures must not masquerade as new run failures'
$e=New-Trace;Add-Network $e
$e.Sensors[0].at=-100
Assert-Check (!(Get-FieldReadiness $e 40).acquisition_pass) 'Stale sensor diagnostic must fail'
$e=New-Trace;Add-Network $e
$e.Mq[0].full_raw='1'
Assert-Check (!(Get-FieldReadiness $e 40).preliminary_recording_ready) 'Clipped MQ diagnostic must fail'
$e=New-Trace;Add-Network $e
$e.Sensors[0].mq_module='mq135-01'
Assert-Check (!(Get-FieldReadiness $e 40).acquisition_pass) 'Wrong physical module identity must fail'
$e=New-Trace;Add-Network $e
$e.Mq=@()
Assert-Check (!(Get-FieldReadiness $e 40).preliminary_recording_ready) 'Missing MQ diagnostic must fail'
Write-Output 'PASS: field readiness accepts fresh evidence and rejects offline, paused, stale, malformed-response, loss and sensor-fault cases.'
