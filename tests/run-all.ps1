# run-all.ps1 - run every test suite in this release candidate.
# Windows PowerShell 5.1 compatible. No external modules, no network.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $root 'README.md'))) {
  throw "run-all.ps1 must live in <package>/tests/ (root not found at $root)"
}

$node = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $node) { throw 'node is not on PATH (need Node >= 20.3)' }

$suites = @(
  [pscustomobject]@{ Name = 'memory';          Dir = (Join-Path $root 'plugins\memory');           Args = @('--test') },
  [pscustomobject]@{ Name = 'session-manager'; Dir = (Join-Path $root 'plugins\session-manager');  Args = @('--test') },
  [pscustomobject]@{ Name = 'acceptance';      Dir = (Join-Path $root 'tests');                    Args = @('--test') }
)

$results = @()
foreach ($suite in $suites) {
  Write-Host ''
  Write-Host ("=== {0} ===" -f $suite.Name)
  Push-Location $suite.Dir
  try {
    $output = & node @($suite.Args) 2>&1
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  $text = ($output | Out-String)
  Write-Host ($output | Select-Object -Last 12 | Out-String)

  $tests = 'n/a'; $pass = 'n/a'; $fail = 'n/a'; $skip = 'n/a'
  $m = [regex]::Match($text, '(?m)^\u2139 tests (\d+)')
  if ($m.Success) { $tests = $m.Groups[1].Value }
  $m = [regex]::Match($text, '(?m)^\u2139 pass (\d+)')
  if ($m.Success) { $pass = $m.Groups[1].Value }
  $m = [regex]::Match($text, '(?m)^\u2139 fail (\d+)')
  if ($m.Success) { $fail = $m.Groups[1].Value }
  $m = [regex]::Match($text, '(?m)^\u2139 skipped (\d+)')
  if ($m.Success) { $skip = $m.Groups[1].Value }

  # The slider suite reports its assertion count in prose.
  $m = [regex]::Match($text, '(\d+) \u9879\u901a\u8fc7')
  if ($m.Success) { $pass = $m.Groups[1].Value; $tests = $m.Groups[1].Value + ' assertions' }

  $results += [pscustomobject]@{
    Suite  = $suite.Name
    Tests  = $tests
    Pass   = $pass
    Fail   = $fail
    Skip   = $skip
    Exit   = $code
  }
}

Write-Host ''
Write-Host '=== summary ==='
$results | Format-Table -AutoSize | Out-String | Write-Host

$failed = @($results | Where-Object { $_.Exit -ne 0 })
if ($failed.Count -gt 0) {
  Write-Host ("FAILED: {0} suite(s)" -f $failed.Count) -ForegroundColor Red
  exit 1
}
Write-Host 'ALL SUITES PASSED'
exit 0
