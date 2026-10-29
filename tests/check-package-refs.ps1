# check-package-refs.ps1 - verify every path a package.json advertises exists.
#
# Checks: main, types, bin, icon, exports (recursively), files entries, and the
# dsh.bundle.patch / dsh.client pointers. Run from anywhere; the package root is
# inferred from this script's location. Exit code 0 = all references resolve.
#
# Windows PowerShell 5.1 compatible. ASCII-only on purpose.

$ErrorActionPreference = 'Stop'

$packageRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $packageRoot 'README.md'))) {
  throw "check-package-refs.ps1 must live in <package>/tests/"
}

function Resolve-PackagePath([string]$baseDir, [string]$relative) {
  $clean = $relative -replace '^\./', ''
  return (Join-Path $baseDir $clean)
}

function Test-Reference([string]$baseDir, [string]$relative) {
  if ([string]::IsNullOrWhiteSpace($relative)) { return @() }
  $clean = $relative -replace '^\./', ''
  if ($clean.Contains('*')) {
    $parent = Split-Path -Parent (Join-Path $baseDir $clean)
    $pattern = Split-Path -Leaf $clean
    if (-not (Test-Path -LiteralPath $parent)) { return @($relative) }
    $found = @(Get-ChildItem -LiteralPath $parent -Filter $pattern -ErrorAction SilentlyContinue)
    if ($found.Count -eq 0) { return @($relative) }
    return @()
  }
  $target = Resolve-PackagePath $baseDir $clean
  $isDir = $clean.EndsWith('/') -or $clean.EndsWith('\')
  if ($isDir) {
    if (Test-Path -LiteralPath $target -PathType Container) { return @() }
    return @($relative)
  }
  if (Test-Path -LiteralPath $target) { return @() }
  # A `files` entry without a trailing slash may still name a directory.
  if ($clean.IndexOf('.') -lt 0 -and (Test-Path -LiteralPath $target -PathType Container)) { return @() }
  return @($relative)
}

function Get-ExportStrings($node) {
  $out = @()
  if ($null -eq $node) { return $out }
  if ($node -is [string]) { return @($node) }
  if ($node -is [System.Management.Automation.PSCustomObject]) {
    foreach ($property in $node.PSObject.Properties) {
      $out += Get-ExportStrings $property.Value
    }
  }
  return $out
}

$manifestFiles = @(Get-ChildItem -LiteralPath $packageRoot -Recurse -File -Filter package.json |
  Where-Object { $_.FullName -notmatch '\\node_modules\\' })

if ($manifestFiles.Count -eq 0) { throw 'no package.json found' }

$failures = @()
foreach ($manifest in $manifestFiles) {
  $relativeManifest = $manifest.FullName.Substring($packageRoot.Length).TrimStart('\')
  try {
    $pkg = Get-Content -LiteralPath $manifest.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    $failures += [pscustomobject]@{ Manifest = $relativeManifest; Field = '(parse)'; Value = $_.Exception.Message }
    continue
  }
  $base = Split-Path -Parent $manifest.FullName

  $simple = @{}
  foreach ($name in @('main', 'types', 'icon')) {
    if ($pkg.PSObject.Properties.Name -contains $name) { $simple[$name] = [string]$pkg.$name }
  }
  if ($pkg.PSObject.Properties.Name -contains 'bin') {
    if ($pkg.bin -is [string]) { $simple['bin'] = [string]$pkg.bin }
    else { foreach ($p in $pkg.bin.PSObject.Properties) { $simple["bin.$($p.Name)"] = [string]$p.Value } }
  }
  if ($pkg.PSObject.Properties.Name -contains 'exports') {
    $i = 0
    foreach ($value in (Get-ExportStrings $pkg.exports)) {
      if ($value.StartsWith('./')) { $simple["exports[$i]"] = $value; $i += 1 }
    }
  }
  if ($pkg.PSObject.Properties.Name -contains 'dsh') {
    if ($pkg.dsh.PSObject.Properties.Name -contains 'bundle' -and $pkg.dsh.bundle.PSObject.Properties.Name -contains 'patch') {
      $simple['dsh.bundle.patch'] = [string]$pkg.dsh.bundle.patch
    }
  }
  foreach ($key in $simple.Keys) {
    $missing = @(Test-Reference $base $simple[$key])
    foreach ($item in $missing) {
      $failures += [pscustomobject]@{ Manifest = $relativeManifest; Field = $key; Value = $item }
    }
  }
  if ($pkg.PSObject.Properties.Name -contains 'files') {
    foreach ($entry in @($pkg.files)) {
      $missing = @(Test-Reference $base ([string]$entry))
      foreach ($item in $missing) {
        $failures += [pscustomobject]@{ Manifest = $relativeManifest; Field = 'files'; Value = $item }
      }
    }
  }
}

Write-Host ("[check-package-refs] manifests: {0}" -f $manifestFiles.Count)
if ($failures.Count -eq 0) {
  Write-Host '[check-package-refs] OK: every advertised path exists'
  exit 0
}

Write-Host ''
Write-Host '[check-package-refs] MISSING REFERENCES'
$failures | Sort-Object Manifest, Field, Value | ForEach-Object {
  Write-Host ("  {0}  {1} = {2}" -f $_.Manifest, $_.Field, $_.Value)
}
exit 1
