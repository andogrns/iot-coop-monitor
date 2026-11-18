$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$out = Join-Path $root 'outputs\i2c-diagnosis\tests'
$null = [IO.Directory]::CreateDirectory($out)
$compiler = Get-Command g++ -ErrorAction Stop
& $compiler.Source -std=c++11 -Wall -Wextra -Werror `
    ('-I' + (Join-Path $PSScriptRoot 'tests\aht20_fakes')) `
    (Join-Path $PSScriptRoot 'tests\aht20_reader_test.cpp') -o (Join-Path $out 'aht20_reader_test.exe')
if ($LASTEXITCODE -ne 0) { throw 'AHT20 test compilation failed.' }
& (Join-Path $out 'aht20_reader_test.exe')
if ($LASTEXITCODE -ne 0) { throw 'AHT20 tests failed.' }
& $compiler.Source -std=c++11 -Wall -Wextra -Werror `
    ('-I' + (Join-Path $PSScriptRoot 'tests\aht20_fakes')) `
    (Join-Path $PSScriptRoot 'tests\oled_transport_test.cpp') -o (Join-Path $out 'oled_transport_test.exe')
if ($LASTEXITCODE -ne 0) { throw 'OLED transport test compilation failed.' }
& (Join-Path $out 'oled_transport_test.exe')
if ($LASTEXITCODE -ne 0) { throw 'OLED transport tests failed.' }
& $compiler.Source -std=c++11 -Wall -Wextra -Werror `
    ('-I' + (Join-Path $PSScriptRoot 'tests\bmp280_fakes')) `
    ('-I' + (Join-Path $PSScriptRoot 'tests\aht20_fakes')) `
    (Join-Path $PSScriptRoot 'tests\bmp280_reader_test.cpp') -o (Join-Path $out 'bmp280_reader_test.exe')
if ($LASTEXITCODE -ne 0) { throw 'BMP280 test compilation failed.' }
& (Join-Path $out 'bmp280_reader_test.exe')
if ($LASTEXITCODE -ne 0) { throw 'BMP280 tests failed.' }
