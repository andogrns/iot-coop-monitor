# Offline protocol checks. Does not open a COM port or touch measurement logs.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'reading_format.ps1')

function Assert-Equal($Actual, $Expected, [string]$Message) {
    if ($Actual -cne $Expected) { throw "${Message}: expected [$Expected], got [$Actual]" }
}

function Read-Blocks([string[]]$Lines) {
    $state = @{}
    foreach ($line in $Lines) {
        $fields = Read-ReadingLine $line $state
        if ($null -ne $fields) { ,$fields }
    }
}

$normal = @(
    '--- Sample 900 | Uptime 00:30:00 ---'
    'MQ-135  : ADC 1100 mV | Output 2.200 V | Raw 1800'
    'Baseline: 1.1000x (+10.0%) | Warning threshold 1150 mV'
    'AHT20   : Temperature 29.45 C | Humidity 72.30 %RH'
    'BMP280  : Temperature 30.12 C | Pressure 1008.65 hPa'
    'Status  : OK'
)
$rows = @(Read-Blocks $normal)
Assert-Equal $rows.Count 1 'Complete record count'
Assert-Equal ($rows[0] -join ',') '900,1800,1800,1100,2.200,1.1000,29.45,72.30,30.12,1008.65,OK' 'All field positions'
$stamp = [DateTimeOffset]'2026-09-23T14:30:00.123+07:00'
$csv = ConvertTo-ReadingCsvRow $rows[0] $stamp $false
Assert-Equal $csv '2026-09-23 14:30:00.123 +07:00,Periodic,900,1800,1800,1100,2.200,1.1000,29.45,72.30,30.12,1008.65,OK' 'CSV format'
$table = @((Get-ReadingCsvHeader), $csv) | ConvertFrom-Csv
Assert-Equal @($table.PSObject.Properties).Count 13 'CSV column count'
Assert-Equal $table.'MQ ADC (mV)' '1100' 'Numeric cell without unit suffix'
$degree = [char]0x00B0
Assert-Equal $table."AHT temperature (${degree}C)" '29.45' 'Celsius header'

$missing = $normal.Clone()
$missing[2] = 'Baseline: NA | Warning threshold NA mV'
$missing[3] = 'AHT20   : Temperature NA C | Humidity NA %RH'
$missing[4] = 'BMP280  : Temperature NA C | Pressure NA hPa'
$missing[5] = 'Status  : Warming up | Calibration missing | AHT sensor error | BMP sensor error'
$rows = @(Read-Blocks $missing)
Assert-Equal $rows.Count 1 'Missing values are a valid record'
Assert-Equal ($rows[0][5..9] -join ',') 'NA,NA,NA,NA,NA' 'Missing measurement markers'
$csv = ConvertTo-ReadingCsvRow $rows[0] $stamp $true
Assert-Equal ($csv -split ',')[1] 'Status change' 'Status change reason'
Assert-Equal ($csv -split ',')[12] 'Warming up | Calibration missing | AHT sensor error | BMP sensor error' 'Combined flags'

foreach ($omitted in 0..5) {
    $broken = for ($i = 0; $i -lt 6; ++$i) { if ($i -ne $omitted) { $normal[$i] } }
    $rows = @(Read-Blocks $broken)
    Assert-Equal $rows.Count 0 "Dropped line $omitted must not produce a row"
    $rows = @(Read-Blocks ($broken + $normal))
    Assert-Equal $rows.Count 1 "Recover after dropped line $omitted"
}
$rows = @(Read-Blocks ($normal[0..2] + @('@CAL,SAVED') + $normal[3..5] + $normal))
Assert-Equal $rows.Count 1 'Calibration message interrupts partial block safely'
$bad = $normal.Clone()
$bad[5] = 'Status  : OK | Gas warning'
Assert-Equal @(Read-Blocks $bad).Count 0 'Contradictory status is rejected'
$bad[5] = 'Status  : Unknown status'
Assert-Equal @(Read-Blocks $bad).Count 0 'Malformed status is rejected'
$long = $normal.Clone()
$long[0] = '--- Sample 999999 | Uptime 123:45:56 ---'
$long[2] = 'Baseline: 0.9000x (-10.0%) | Warning threshold 1150 mV'
$long[3] = 'AHT20   : Temperature -2.50 C | Humidity 72.30 %RH'
$rows = @(Read-Blocks $long)
Assert-Equal $rows[0][1] '445556' 'Uptime beyond 24 and 99 hours'
Assert-Equal $rows[0][6] '-2.50' 'Negative temperature'

$rows = @(Read-Blocks @('1,2,1800,1100,2.200,,,,,,WARMUP|CAL_MISSING'))
Assert-Equal $rows.Count 1 'Legacy Serial compatibility'
Assert-Equal ($rows[0][5..9] -join ',') 'NA,NA,NA,NA,NA' 'Legacy empty values'
Assert-Equal $rows[0][10] 'Warming up | Calibration missing' 'Legacy flag conversion'

# Compile only the actual firmware formatting functions with a tiny host Serial
# adapter. This checks output compatibility, not ESP32 libraries or hardware.
$compiler = Get-Command g++ -ErrorAction SilentlyContinue
if ($null -ne $compiler) {
    $sketch = Get-Content (Join-Path $PSScriptRoot 'coop_monitor.ino') -Raw
    $structs = foreach ($name in @('Reading', 'Calibration')) {
        [regex]::Match($sketch, "(?s)struct $name \{.*?\n\};").Value
    }
    $floatPrinter = [regex]::Match($sketch, '(?s)void printFloatOrNA\(.*?\n\}').Value
    $start = $sketch.IndexOf('void formatReadableStatus(')
    $end = $sketch.IndexOf('void formatFloatOrNA(', $start)
    $formatter = $sketch.Substring($start, $end - $start)
    $sdEnd = $sketch.IndexOf('void logReading(', $end)
    $sdFormatter = $sketch.Substring($end, $sdEnd - $end)
    $adapter = @'
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <cmath>
using std::isfinite;
struct HostSerial {
  void print(const char *s) { std::fputs(s, stdout); }
  void print(float v, uint8_t decimals) { std::printf("%.*f", decimals, v); }
  void println() { std::putchar('\n'); }
  void println(const char *s) { std::puts(s); }
  template<typename... T> void printf(const char *fmt, T... args) { std::printf(fmt, args...); }
} Serial;
'@
    $main = @'
int main() {
  Reading r{};
  r.mqRaw = 1800; r.mqAdcMv = 1100; r.mqModuleV = 2.2f;
  r.ahtTemperatureC = 29.45f; r.humidityPercent = 72.3f;
  r.bmpTemperatureC = 30.12f; r.pressureHpa = 1008.65f;
  r.ahtValid = true; r.bmpValid = true;
  calibration.valid = true; calibration.baselineMv = 1000; calibration.thresholdMv = 1150;
  printReadingBlock(r, "OK", 1800);
  char row[384];
  if (!formatLogRow(row, sizeof(row), r, "OK", 1800, false)) return 1;
  std::printf("SDROW:%s\n", row);
  calibration.valid = false; r.ahtValid = false; r.bmpValid = false;
  printReadingBlock(r, "WARMUP|CAL_MISSING|AHT_ERROR|BMP_ERROR", 2);
  if (!formatLogRow(row, sizeof(row), r,
                    "WARMUP|CAL_MISSING|AHT_ERROR|BMP_ERROR", 2, true)) return 2;
  std::printf("SDROW:%s\n", row);
  printReadingBlock(r, "CAL_STABILIZING|CAL_COLLECTING|WARMUP|CAL_MISSING|AHT_ERROR|BMP_ERROR|OLED_ERROR|MQ_ADC_HIGH|GAS_WARNING", 445556);
}
'@
    $temp = Join-Path ([IO.Path]::GetTempPath()) ('coop-format-' + [guid]::NewGuid().ToString('N'))
    $null = [IO.Directory]::CreateDirectory($temp)
    $cpp = Join-Path $temp 'formatter.cpp'
    $exe = Join-Path $temp 'formatter.exe'
    try {
        @($adapter, ($structs -join "`n"), 'Calibration calibration; uint32_t sampleNumber = 900;', $floatPrinter, $formatter, $sdFormatter, $main) -join "`n" | Set-Content -LiteralPath $cpp -Encoding utf8
        & $compiler.Source -std=c++11 -Wall -Wextra -Werror $cpp -o $exe
        if ($LASTEXITCODE -ne 0) { throw 'Host formatter compilation failed.' }
        $lines = @(& $exe)
        if ($LASTEXITCODE -ne 0) { throw 'Host formatter execution failed.' }
        Assert-Equal ($lines[0..5] -join "`n") ($normal -join "`n") 'Actual firmware display'
        $rows = @(Read-Blocks $lines)
        Assert-Equal $rows.Count 3 'Actual firmware to capture integration'
        Assert-Equal ($rows[1][5..9] -join ',') 'NA,NA,NA,NA,NA' 'Firmware invalid readings'
        Assert-Equal ($rows[2][10] -split ' \| ').Count 9 'Every status label is recognized'
        $sdRows = @($lines | Where-Object { $_ -like 'SDROW:*' } | ForEach-Object { $_.Substring(6) })
        Assert-Equal $sdRows.Count 2 'MicroSD row count'
        Assert-Equal $sdRows[0] 'Periodic,900,1800,1800,1100,2.200,1.1000,29.45,72.30,30.12,1008.65,OK' 'MicroSD numeric CSV row'
        Assert-Equal $sdRows[1] 'Status change,900,2,1800,1100,2.200,NA,NA,NA,NA,NA,Warming up | Calibration missing | AHT sensor error | BMP sensor error' 'MicroSD NA and status row'
        Write-Host 'PASS: actual firmware Serial and MicroSD formatters compiled on host.'
    } finally {
        foreach ($file in @($cpp, $exe)) { if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file } }
        # Non-recursive: remove only the now-empty test directory.
        if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp }
    }
} else { Write-Host 'SKIP: host formatter compilation (g++ unavailable).' }

Write-Host 'PASS: CSV round-trip, units, missing values, legacy compatibility, status labels, incomplete blocks and recovery.'
