param([Parameter(ValueFromRemainingArguments=$true)][string[]]$WranglerArgs)
$ErrorActionPreference = 'Stop'
$coopNode = Get-Command node -ErrorAction SilentlyContinue
$coopNodePath = if ($coopNode) { $coopNode.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $coopNodePath)) { throw 'Install Node.js LTS, reopen PowerShell, and rerun this command.' }
$env:Path = (Split-Path -Parent $coopNodePath) + ';' + $env:Path
Push-Location $PSScriptRoot
try { & $coopNodePath (Join-Path $PSScriptRoot 'node_modules\wrangler\bin\wrangler.js') @WranglerArgs; $coopExitCode = $LASTEXITCODE } finally { Pop-Location }
exit $coopExitCode
