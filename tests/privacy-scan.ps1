# privacy-scan.ps1 - scan the release candidate for personal data classes.
#
# Reports only path, line number and category. It never prints the matched text,
# so running it on a dirty tree cannot leak the finding into a log.
#
# This file intentionally contains no project-specific nickname or user name:
# writing them here would re-introduce what the scan is meant to catch. Add your
# own private patterns at run time with:
#   .\privacy-scan.ps1 -ExtraPatterns @('some-private-token')
#
# Windows PowerShell 5.1 compatible.
param(
  [string]$PackageRoot = (Split-Path -Parent $PSScriptRoot),
  [string[]]$ExtraPatterns = @(),
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PackageRoot)) { throw "package root not found: $PackageRoot" }
$PackageRoot = [IO.Path]::GetFullPath($PackageRoot)

$categories = @(
  [pscustomobject]@{ Name = 'local-user-path'; Regex = '(?i)\b[A-Z]:\\+Users\\+[^\\\s"'',;<>]+' },
  [pscustomobject]@{ Name = 'workspace-id';    Regex = '\bws-[0-9a-f]{16}\b' },
  [pscustomobject]@{ Name = 'im-bot-id';       Regex = '\bwx_[0-9a-f]{16,}\b' },
  [pscustomobject]@{ Name = 'im-target-id';    Regex = '\btgt_[0-9a-f]{12,}\b' },
  [pscustomobject]@{ Name = 'im-user-id';      Regex = '\b[A-Za-z0-9]{10,}@im\.(wechat|bot)\b' },
  [pscustomobject]@{ Name = 'api-key';         Regex = '\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})' },
  [pscustomobject]@{ Name = 'private-key';     Regex = '-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----' },
  [pscustomobject]@{ Name = 'phone';           Regex = '(?<![0-9])1[3-9][0-9]{9}(?![0-9])' },
  [pscustomobject]@{ Name = 'email';           Regex = '\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b' },
  [pscustomobject]@{ Name = 'session-uuid';    Regex = '\bsession-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b' },
  [pscustomobject]@{ Name = 'token-env';       Regex = '\bDSH_[A-Z0-9_]*TOKEN[A-Z0-9_]*\b' }
)
foreach ($extra in $ExtraPatterns) {
  if ([string]::IsNullOrWhiteSpace($extra)) { continue }
  $categories += [pscustomobject]@{ Name = 'extra'; Regex = $extra }
}

$allowedWorkspaceIds = @('ws-0123456789abcdef')
$allowedEmails = @('user@example.com', 'noreply@example.com', 'you@example.com')
$allowedSessionIds = @('session-11111111-1111-4111-8111-111111111111')

# Detection code and test fixtures legitimately contain fake credentials; only
# the credential-shaped categories are exempt there, never the identity classes.
function Test-CredentialExempt([string]$relative) {
  return ($relative -match '(^|\\)test\\' -or $relative -match '(^|\\)tests\\' -or $relative -eq 'plugins\memory\lib\store.js')
}

$extensions = @('.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.ps1', '.txt', '.ts', '.svg', '.gitignore', '.example')
$files = Get-ChildItem -LiteralPath $PackageRoot -Recurse -File | Where-Object {
  ($extensions -contains $_.Extension) -or
  ($_.Name -eq '.gitignore') -or
  ($_.Name -match '^(LICENSE|LICENCE|COPYING|NOTICE)$')
}

$findings = New-Object System.Collections.ArrayList
$scanned = 0

foreach ($file in $files) {
  $relative = $file.FullName.Substring($PackageRoot.Length).TrimStart('\')
  $lines = @()
  try { $lines = [IO.File]::ReadAllLines($file.FullName, [Text.Encoding]::UTF8) } catch { continue }
  $scanned += 1
  $credentialExempt = Test-CredentialExempt $relative

  for ($index = 0; $index -lt $lines.Length; $index += 1) {
    $line = $lines[$index]
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    foreach ($category in $categories) {
      if ($credentialExempt -and ($category.Name -eq 'api-key' -or $category.Name -eq 'private-key')) { continue }
      $matches = [regex]::Matches($line, $category.Regex)
      foreach ($match in $matches) {
        $value = $match.Value
        if ($category.Name -eq 'workspace-id' -and ($allowedWorkspaceIds -contains $value)) { continue }
        if ($category.Name -eq 'email' -and ($allowedEmails -contains $value.ToLowerInvariant())) { continue }
        if ($category.Name -eq 'session-uuid' -and ($allowedSessionIds -contains $value)) { continue }
        if ($category.Name -eq 'local-user-path' -and $value -match '<') { continue }
        [void]$findings.Add([pscustomobject]@{
          Path     = $relative
          Line     = $index + 1
          Category = $category.Name
        })
      }
    }
  }
}

if (-not $Quiet) {
  Write-Host ("[privacy-scan] scanned {0} text files under {1}" -f $scanned, $PackageRoot)
  Write-Host ("[privacy-scan] credential-shaped fixtures inside test/ and the detector are exempt by design")
}

if ($findings.Count -eq 0) {
  Write-Host '[privacy-scan] OK: no personal-data pattern matched'
  exit 0
}

Write-Host ''
Write-Host '[privacy-scan] FINDINGS (path:line  category, values intentionally not printed)'
$findings | Sort-Object Path, Line, Category | ForEach-Object {
  Write-Host ("  {0}:{1}  [{2}]" -f $_.Path, $_.Line, $_.Category)
}
Write-Host ''
Write-Host ("[privacy-scan] FAILED: {0} finding(s). A clean scan is not proof of safety; review the file by hand." -f $findings.Count)
exit 1
