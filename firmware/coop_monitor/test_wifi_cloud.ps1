$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$out = Join-Path $root 'outputs\wifi-cloud\tests'
$null = [IO.Directory]::CreateDirectory($out)
$compiler = Get-Command g++ -ErrorAction Stop
& $compiler.Source -std=c++11 -Wall -Wextra -Werror `
    (Join-Path $PSScriptRoot 'tests\queue_test.cpp') -o (Join-Path $out 'queue_test.exe')
if ($LASTEXITCODE -ne 0) { throw 'Queue test compilation failed.' }
& (Join-Path $out 'queue_test.exe')
if ($LASTEXITCODE -ne 0) { throw 'Queue tests failed.' }
& $compiler.Source -std=c++11 -Wall -Wextra -Werror `
    ('-I' + (Join-Path $PSScriptRoot 'tests\fakes')) `
    (Join-Path $PSScriptRoot 'tests\flash_storage_test.cpp') -o (Join-Path $out 'flash_storage_test.exe')
if ($LASTEXITCODE -ne 0) { throw 'FlashStorage adapter test compilation failed.' }
& (Join-Path $out 'flash_storage_test.exe')
if ($LASTEXITCODE -ne 0) { throw 'FlashStorage adapter tests failed.' }
& $compiler.Source -std=c++11 -Wall -Wextra -Werror `
    ('-I' + (Join-Path $PSScriptRoot 'tests\fakes')) `
    (Join-Path $PSScriptRoot 'tests\quick_session_test.cpp') -o (Join-Path $out 'quick_session_test.exe')
if ($LASTEXITCODE -ne 0) { throw 'Quick session test compilation failed.' }
& (Join-Path $out 'quick_session_test.exe')
if ($LASTEXITCODE -ne 0) { throw 'Quick session tests failed.' }
& (Join-Path $PSScriptRoot 'test_reading_format.ps1')
node (Join-Path $root 'cloud\apps-script\test_ingest.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Cloud endpoint tests failed.' }
