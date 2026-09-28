$ErrorActionPreference = 'Stop'
$directory = [System.IO.Directory]::CreateDirectory(
    (Join-Path $PSScriptRoot '..\..\outputs\sensor_logs')
).FullName
$stopPath = Join-Path $directory 'stop_logging.signal'
[System.IO.File]::WriteAllText($stopPath, 'stop')
Write-Output 'Stop requested. The capture window will close after its current serial read finishes.'
