<#
.SYNOPSIS
  Send a proactive WeChat notification through the local dsh-im delivery API.

.DESCRIPTION
  The Host address is discovered at run time from the running DeepSeek Harness
  instance (see lib\dsh-host.ps1); no port is hard-coded. The discovered port is
  validated by a DSH-specific request before it is used.

  Messages are deduplicated, failed deliveries are queued, and a queue can be
  flushed again later. The queue file is written atomically and bounded; the log
  is rotated. Any Harness workspace can call this script: it only sends text and
  never changes the WeChat bot binding or the main assistant workspace.

  Exit codes: 0 sent / duplicate / status, 2 queued, 3 failure.

.EXAMPLES
  .\notify.ps1 -Title "✅ 任务完成" -Message "全部测试通过。"
  .\notify.ps1 -Workspace "Python 开发" -Title "任务完成" -Message "测试通过。"
  .\notify.ps1 -TextFile .\summary.txt
  .\notify.ps1 -Status
  .\notify.ps1 -FlushQueue
  .\notify.ps1 -FlushQueue -AllWorkspaces
#>
[CmdletBinding(DefaultParameterSetName = 'Send')]
param(
  [Parameter(ParameterSetName = 'Send', Position = 0)]
  [Alias('Message')]
  [string]$Text,

  [Parameter(ParameterSetName = 'Send')]
  [string]$TextFile,

  [Parameter(ParameterSetName = 'Send')]
  [string]$Workspace,

  [Parameter(ParameterSetName = 'Send')]
  [string]$Title,

  [Parameter(ParameterSetName = 'Send')]
  [switch]$NoPrefix,

  [Parameter(ParameterSetName = 'Flush')]
  [switch]$FlushQueue,

  [Parameter(ParameterSetName = 'Flush')]
  [switch]$AllWorkspaces,

  [Parameter(ParameterSetName = 'Status')]
  [switch]$Status,

  [Parameter(ParameterSetName = 'Send')]
  [switch]$Force,

  [Parameter(ParameterSetName = 'Send')]
  [ValidateRange(1, 1440)]
  [int]$DedupeWindowMinutes = 10,

  # Optional state root used by the watchdog when flushing a workspace-local queue.
  [string]$StateDir
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $root 'lib\dsh-host.ps1')

$configPath = Join-Path $root 'notify-config.json'
$workspaceLabelsPath = Join-Path $root 'workspace-labels.json'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$centralStateRoot = $root
$config = Get-DshHostConfig -ConfigPath $configPath
$endpointPath = [string]$config.endpointPath
$requestTimeoutSec = [int]$config.requestTimeoutSec
if ($requestTimeoutSec -lt 3) { $requestTimeoutSec = 3 }
$lockWaitSec = [int]$config.lockWaitSec
if ($lockWaitSec -lt ($requestTimeoutSec * 2)) { $lockWaitSec = $requestTimeoutSec * 2 }
$maxQueueItems = [int]$config.maxQueueItems
$maxQueueAgeDays = [int]$config.maxQueueAgeDays
$maxAttempts = [int]$config.maxAttempts
$maxLogBytes = 2097152

# --------------------------------------------------------------------------
# workspace / state resolution
# --------------------------------------------------------------------------

function Format-NotifyLabel {
  param(
    [string]$Value,
    [int]$MaxLength = 40,
    [string]$Fallback = '未命名工作区'
  )
  $label = [string]$Value
  $label = $label -replace '[\r\n\t]+', ' '
  $label = $label -replace '[【】\[\]]', ''
  $label = $label.Trim()
  if ($label.Length -gt $MaxLength) { $label = $label.Substring(0, $MaxLength).Trim() }
  if ([string]::IsNullOrWhiteSpace($label)) { return $Fallback }
  return $label
}

function Get-WorkspaceRoot {
  param([string]$CurrentPath)
  $normalized = $CurrentPath.TrimEnd('\').TrimEnd('/')
  if ($normalized -match '^[A-Za-z]:$') { $normalized += '\' }
  $best = $normalized
  $bestLength = -1

  $registryPath = Join-Path (Get-DshHomeRoot) 'storages\workspace.json'
  try {
    if (Test-Path -LiteralPath $registryPath) {
      $registry = [IO.File]::ReadAllText($registryPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
      foreach ($property in $registry.tables.workspaces.PSObject.Properties) {
        $candidate = [string]$property.Value.path
        if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
        try {
          $candidateRoot = [IO.Path]::GetFullPath($candidate).TrimEnd('\').TrimEnd('/')
          if ($candidateRoot -match '^[A-Za-z]:$') { $candidateRoot += '\' }
        } catch { continue }
        $prefix = if ($candidateRoot.EndsWith('\')) { $candidateRoot } else { $candidateRoot + '\' }
        if ($normalized -ieq $candidateRoot -or $normalized.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
          if ($candidateRoot.Length -gt $bestLength) {
            $bestLength = $candidateRoot.Length
            $best = $candidateRoot
          }
        }
      }
    }
  } catch { }
  return $best
}

function Get-WorkspaceContext {
  param([string]$Explicit)
  $currentPath = ''
  try { $currentPath = (Get-Location).Path } catch { }
  if ([string]::IsNullOrWhiteSpace($currentPath)) { $currentPath = $env:USERPROFILE }
  $rootPath = Get-WorkspaceRoot -CurrentPath $currentPath

  if (-not [string]::IsNullOrWhiteSpace($Explicit)) {
    return [pscustomobject]@{ Root = $rootPath; Label = (Format-NotifyLabel -Value $Explicit) }
  }

  $map = Read-DshJsonFile -Path $workspaceLabelsPath -Default $null
  if ($null -ne $map) {
    foreach ($property in $map.PSObject.Properties) {
      $key = ([string]$property.Name).TrimEnd('\').TrimEnd('/')
      if ($key -match '^[A-Za-z]:$') { $key += '\' }
      if ($key -ieq $rootPath) {
        return [pscustomobject]@{ Root = $rootPath; Label = (Format-NotifyLabel -Value ([string]$property.Value)) }
      }
    }
  }

  $leaf = Split-Path -Leaf $rootPath
  if ([string]::IsNullOrWhiteSpace($leaf)) { $leaf = $rootPath }
  return [pscustomobject]@{ Root = $rootPath; Label = (Format-NotifyLabel -Value $leaf) }
}

function Add-NotifyEnvelope {
  param(
    [string]$Message,
    [string]$Source,
    [string]$Title,
    [bool]$NoSource = $false
  )
  $body = ([string]$Message).Trim()
  $lines = @()
  if (-not $NoSource -and -not [string]::IsNullOrWhiteSpace($Source)) {
    $alreadyPrefixed = $body.StartsWith("【$Source】", [StringComparison]::Ordinal)
    if (-not $alreadyPrefixed) { $lines += "【$Source】" }
  }
  if (-not [string]::IsNullOrWhiteSpace($Title)) {
    $lines += (Format-NotifyLabel -Value $Title -MaxLength 80 -Fallback '')
  }
  if ($lines.Count -eq 0) { return $body }
  return (($lines -join "`n") + "`n" + $body)
}

$workspaceContext = Get-WorkspaceContext
$workspaceRoot = $workspaceContext.Root
if (-not [string]::IsNullOrWhiteSpace($StateDir)) {
  $stateRoot = [IO.Path]::GetFullPath($StateDir)
} else {
  $centralFull = [IO.Path]::GetFullPath($centralStateRoot).TrimEnd('\').TrimEnd('/')
  $rootPrefix = if ($workspaceRoot.EndsWith('\')) { $workspaceRoot } else { $workspaceRoot + '\' }
  $centralInsideWorkspace = $centralFull -ieq $workspaceRoot -or $centralFull.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)
  if ($centralInsideWorkspace) { $stateRoot = $centralStateRoot } else { $stateRoot = Join-Path $workspaceRoot '.dsh-notify' }
}
$statePath  = Join-Path $stateRoot 'notify-state.json'
$queuePath  = Join-Path $stateRoot 'notify-queue.jsonl'
$droppedPath = Join-Path $stateRoot 'notify-queue.dropped.jsonl'
$logPath    = Join-Path $stateRoot 'logs\notify.log'
$script:queueParseErrors = 0
$script:corruptBackupMade = $false

# Cross-workspace callers may run under a sandbox that can write only their
# workspace and a private temp directory. Logging/bookkeeping is best-effort;
# sending must still work even if the state directory cannot be created.
try { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logPath) | Out-Null } catch { }

# --------------------------------------------------------------------------
# logging / small helpers
# --------------------------------------------------------------------------

function Write-NotifyLog {
  param([string]$Message)
  $line = '{0} {1}' -f (Get-Date).ToString('o'), $Message
  try {
    if ((Test-Path -LiteralPath $logPath) -and ((Get-Item -LiteralPath $logPath).Length -gt $maxLogBytes)) {
      $old = "$logPath.1"
      if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Force }
      Move-Item -LiteralPath $logPath -Destination $old -Force
    }
  } catch { }
  try { [IO.File]::AppendAllText($logPath, $line + "`r`n", $utf8NoBom) } catch { }
}

function Write-JsonFileAtomic {
  param([string]$Path, $Value)
  $json = $Value | ConvertTo-Json -Depth 8
  $directory = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
  $temporary = '{0}.{1}.tmp' -f $Path, ([guid]::NewGuid().ToString('n'))
  $stream = New-Object System.IO.FileStream($temporary, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $bytes = $utf8NoBom.GetBytes($json)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
  } finally {
    $stream.Dispose()
  }
  if (Test-Path -LiteralPath $Path) {
    try {
      [IO.File]::Replace($temporary, $Path, [NullString]::Value)
      return
    } catch { }
  }
  Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Get-TextHash {
  param([string]$Value)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    return ([BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-', '').ToLowerInvariant()
  } finally { $sha.Dispose() }
}

function Get-QueueCount {
  try {
    if (-not (Test-Path -LiteralPath $queuePath)) { return 0 }
    return @([IO.File]::ReadAllLines($queuePath, [Text.Encoding]::UTF8) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count
  } catch { return 0 }
}

# --------------------------------------------------------------------------
# queue: append-only enqueue, atomic rewrite, bounded size
# --------------------------------------------------------------------------

function Get-QueueItems {
  $items = @()
  if (-not (Test-Path -LiteralPath $queuePath)) { return @() }
  try {
    $lines = [IO.File]::ReadAllLines($queuePath, [Text.Encoding]::UTF8)
  } catch {
    Write-NotifyLog "queue-read-failed error=$($_.Exception.Message)"
    return @()
  }
  $bad = 0
  foreach ($line in $lines) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    try {
      $items += ($line | ConvertFrom-Json)
    } catch {
      $bad += 1
    }
  }
  if ($bad -gt 0) {
    $script:queueParseErrors = $bad
    Write-NotifyLog "queue-contains-corrupt-lines count=$bad"
    if (-not $script:corruptBackupMade) {
      $script:corruptBackupMade = $true
      try {
        $backup = '{0}.corrupt-{1}.jsonl' -f $queuePath, (Get-Date -Format 'yyyyMMdd-HHmmss')
        Copy-Item -LiteralPath $queuePath -Destination $backup -Force
        Write-NotifyLog "queue-corrupt-backup path=$backup"
      } catch { }
    }
  }
  return $items
}

function Invoke-WithQueueLock {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Action,
    [int]$TimeoutSec = 5
  )
  # Single synchronization rule: every read-modify-write of the queue file runs
  # inside this lock. A caller that cannot take the lock must fail loudly; it
  # must never write anyway and must never report success.
  $mutex = New-Object System.Threading.Mutex($false, 'Local\DSHAssistantNotifyQueue')
  $locked = $false
  try {
    $locked = $mutex.WaitOne([int]($TimeoutSec * 1000))
    if (-not $locked) { throw 'queue lock busy' }
    return (& $Action)
  } finally {
    if ($locked) { try { $mutex.ReleaseMutex() | Out-Null } catch { } }
    $mutex.Dispose()
  }
}

function Write-QueueItemsUnlocked {
  param([object[]]$Items)
  # Caller MUST hold Local\DSHAssistantNotifyQueue.
  $lines = @()
  foreach ($item in @($Items)) {
    if ($null -ne $item) { $lines += ($item | ConvertTo-Json -Compress -Depth 5) }
  }
  $payload = ($lines -join "`n")
  if ($lines.Count -gt 0) { $payload += "`n" }
  $directory = Split-Path -Parent $queuePath
  if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
  $temporary = '{0}.{1}.tmp' -f $queuePath, ([guid]::NewGuid().ToString('n'))
  $stream = New-Object System.IO.FileStream($temporary, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $bytes = $utf8NoBom.GetBytes($payload)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
  } finally {
    $stream.Dispose()
  }
  if (Test-Path -LiteralPath $queuePath) {
    try { [IO.File]::Replace($temporary, $queuePath, [NullString]::Value); return } catch { }
  }
  Move-Item -LiteralPath $temporary -Destination $queuePath -Force
}

function Update-QueueItems {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Mutator,
    $State = $null,
    [int]$TimeoutSec = 5
  )
  # Re-reads the queue under the lock, applies the mutator, writes atomically.
  # Callers pass a decision table as -State; items appended by another process
  # while the caller was working are re-read here and preserved.
  return (Invoke-WithQueueLock -TimeoutSec $TimeoutSec -Action {
    $current = @(Get-QueueItems)
    $next = @(& $Mutator $current $State)
    Write-QueueItemsUnlocked -Items $next
    return @($next)
  })
}

function Add-DroppedRecord {
  param($Item, [string]$Reason)
  try {
    $record = [pscustomobject]@{
      id        = [string]$Item.id
      hash      = [string]$Item.hash
      createdAt = [string]$Item.createdAt
      attempts  = $Item.attempts
      droppedAt = (Get-Date).ToUniversalTime().ToString('o')
      reason    = $Reason
      preview   = if ([string]$Item.text) { ([string]$Item.text).Substring(0, [Math]::Min(60, ([string]$Item.text).Length)) } else { '' }
    }
    [IO.File]::AppendAllText($droppedPath, ($record | ConvertTo-Json -Compress -Depth 4) + "`r`n", $utf8NoBom)
  } catch { }
}

function Remove-QueueItemsByHash {
  param([string]$Hash)
  $kept = Update-QueueItems -TimeoutSec 5 -State @{ Hash = $Hash } -Mutator {
    param($items, $state)
    return @($items | Where-Object { [string]$_.hash -ne [string]$state.Hash })
  }
  return @($kept).Count
}

function Add-QueueItem {
  param([string]$Message, [string]$Hash, [string]$Reason)
  # Append one JSON line instead of rewriting the whole file: a crash can only
  # lose the line being written, never the existing queue.
  $item = [pscustomobject]@{
    id            = [guid]::NewGuid().ToString('n')
    hash          = $Hash
    text          = $Message
    createdAt     = (Get-Date).ToUniversalTime().ToString('o')
    attempts      = 0
    nextAttemptAt = (Get-Date).ToUniversalTime().ToString('o')
    lastError     = $Reason
  }
  $added = Invoke-WithQueueLock -TimeoutSec 5 -Action {
    $existing = @(Get-QueueItems)
    if ($existing | Where-Object { [string]$_.hash -eq $Hash }) {
      Write-NotifyLog "queue-duplicate-skip hash=$Hash reason=$Reason"
      return $false
    }
    $directory = Split-Path -Parent $queuePath
    if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
    $line = ($item | ConvertTo-Json -Compress -Depth 5) + "`r`n"
    $bytes = $utf8NoBom.GetBytes($line)
    $stream = New-Object System.IO.FileStream($queuePath, [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try {
      $stream.Write($bytes, 0, $bytes.Length)
      $stream.Flush($true)
    } finally {
      $stream.Dispose()
    }
    $count = $existing.Count + 1
    if ($count -gt $maxQueueItems) {
      $all = @(Get-QueueItems)
      $sorted = @($all | Sort-Object { [string]$_.createdAt })
      $dropCount = @($sorted).Count - $maxQueueItems
      if ($dropCount -gt 0) {
        for ($i = 0; $i -lt $dropCount; $i++) { Add-DroppedRecord -Item $sorted[$i] -Reason 'queue-limit' }
        $keep = @($sorted | Select-Object -Last $maxQueueItems)
        Write-QueueItemsUnlocked -Items $keep
        Write-NotifyLog "queue-trimmed dropped=$dropCount max=$maxQueueItems"
      }
    }
    Write-NotifyLog "queued hash=$Hash reason=$Reason queue=$count"
    return $true
  }
  return [bool]$added
}

# --------------------------------------------------------------------------
# dedupe state
# --------------------------------------------------------------------------

function Test-Duplicate {
  param([string]$Hash, [int]$WindowMinutes)
  $state = Read-DshJsonFile -Path $statePath -Default ([pscustomobject]@{ version = 1; recent = @() })
  $cutoff = (Get-Date).ToUniversalTime().AddMinutes(-1 * $WindowMinutes)
  foreach ($entry in @($state.recent)) {
    if ($null -eq $entry) { continue }
    if ([string]$entry.hash -eq $Hash) {
      try {
        if (([datetime]$entry.at).ToUniversalTime() -ge $cutoff) { return $true }
      } catch { }
    }
  }
  return $false
}

function Add-DuplicateMark {
  param([string]$Hash)
  $state = Read-DshJsonFile -Path $statePath -Default ([pscustomobject]@{ version = 1; recent = @() })
  $cutoff = (Get-Date).ToUniversalTime().AddDays(-2)
  $kept = @()
  foreach ($entry in @($state.recent)) {
    if ($null -eq $entry) { continue }
    if ([string]$entry.hash -eq $Hash) { continue }
    try { if (([datetime]$entry.at).ToUniversalTime() -ge $cutoff) { $kept += $entry } } catch { }
  }
  $kept += [pscustomobject]@{ hash = $Hash; at = (Get-Date).ToUniversalTime().ToString('o') }
  if ($kept.Count -gt 500) { $kept = @($kept | Select-Object -Last 500) }
  Write-JsonFileAtomic -Path $statePath -Value ([pscustomobject]@{ version = 1; recent = $kept })
}

# --------------------------------------------------------------------------
# delivery
# --------------------------------------------------------------------------

function Resolve-DeliveryEndpoint {
  # Returns @{ Ok; Url; BaseUrl; Port; Method; InstanceId; Error; Override; Verified }
  # Every accepted target must be loopback, owned by the configured appExe and
  # answer the delivery-route probe. The config override is not a bypass.
  $rawConfig = Read-DshJsonFile -Path $configPath -Default $null
  $override = ''
  if ($null -ne $rawConfig) {
    $candidate = [string]$rawConfig.endpoint
    if (-not [string]::IsNullOrWhiteSpace($candidate)) { $override = $candidate }
  }
  $appExe = [string]$config.appExe
  if (-not [string]::IsNullOrWhiteSpace($override)) {
    $check = Test-DshDeliveryEndpoint -Url $override -AppExe $appExe -TimeoutSec 3
    if (-not $check.Ok) {
      return [pscustomobject]@{
        Ok = $false; Url = $null; BaseUrl = $null; Port = 0
        Method = 'config-override'; InstanceId = $null; Override = $true; Verified = $false
        Error = ('endpoint-override-rejected ({0})' -f $check.Reason)
      }
    }
    return [pscustomobject]@{
      Ok = $true; Url = $override; BaseUrl = $override; Port = $check.Port
      Method = 'config-override'; InstanceId = $null; Override = $true; Verified = $true; Error = $null
    }
  }
  $found = Find-DshHostForConfig -ConfigPath $configPath
  if (-not $found.Ok) {
    return [pscustomobject]@{
      Ok = $false; Url = $null; BaseUrl = $null; Port = 0
      Method = $null; InstanceId = $null; Override = $false; Verified = $false
      Error = ('host-not-found ({0})' -f $(if ($found.Error) { $found.Error } else { 'unknown' }))
    }
  }
  $url = $found.BaseUrl.TrimEnd('/') + $endpointPath
  if (-not (Test-DshDeliveryProbe -Url $url -TimeoutSec 3)) {
    # A Host that only answers the schedule-gate route is not proof that the
    # dsh-im delivery route exists. Refuse instead of sending into the void.
    return [pscustomobject]@{
      Ok = $false; Url = $null; BaseUrl = $found.BaseUrl; Port = $found.Port
      Method = $found.Method; InstanceId = $found.InstanceId; Override = $false; Verified = $false
      Error = 'delivery-route-unverified'
    }
  }
  return [pscustomobject]@{
    Ok = $true; Url = $url; BaseUrl = $found.BaseUrl; Port = $found.Port
    Method = $found.Method; InstanceId = $found.InstanceId; Override = $false; Verified = $true; Error = $null
  }
}

function Send-Delivery {
  param(
    [Parameter(Mandatory = $true)][string]$Message,
    [string]$Hash,
    [pscustomobject]$Endpoint
  )
  $rawConfig = Read-DshJsonFile -Path $configPath -Default $null
  if ($null -eq $rawConfig -or [string]::IsNullOrWhiteSpace($rawConfig.botId) -or [string]::IsNullOrWhiteSpace($rawConfig.targetId)) {
    throw 'notify-config.json is missing botId or targetId'
  }
  if ($null -eq $Endpoint -or -not $Endpoint.Ok -or [string]::IsNullOrWhiteSpace($Endpoint.Url)) {
    throw ('delivery endpoint unavailable: {0}' -f $(if ($Endpoint) { $Endpoint.Error } else { 'unknown' }))
  }
  $body = [ordered]@{
    botId    = [string]$rawConfig.botId
    targetId = [string]$rawConfig.targetId
    text     = $Message
    format   = 'plain'
  } | ConvertTo-Json -Compress -Depth 3
  $probe = Invoke-DshHttpProbe -Uri $Endpoint.Url -Method POST -Body $body -TimeoutSec $requestTimeoutSec
  if (-not $probe.Ok -or $null -eq $probe.Json -or $probe.Json.sent -ne $true) {
    $detail = ''
    try { $detail = [string]$probe.Json.error.code } catch { }
    if ([string]::IsNullOrWhiteSpace($detail)) { $detail = $probe.Error }
    if ([string]::IsNullOrWhiteSpace($detail)) { $detail = ('http-{0}' -f $probe.Status) }
    throw ('delivery failed: {0}' -f $detail)
  }
  Write-NotifyLog "sent hash=$Hash endpoint=$($Endpoint.Url) method=$($Endpoint.Method) instance=$($Endpoint.InstanceId) length=$($Message.Length)"
  # The message already left; bookkeeping must never turn this into a failure.
  try { Add-DuplicateMark -Hash $Hash } catch {
    Write-NotifyLog "dedupe-state-write-failed hash=$Hash error=$($_.Exception.Message)"
  }
  try { Remove-QueueItemsByHash -Hash $Hash } catch {
    Write-NotifyLog "queue-cleanup-failed hash=$Hash error=$($_.Exception.Message)"
  }
  return $true
}

function Invoke-FlushQueue {
  # Snapshot under the queue lock, send outside it, then merge the outcome back
  # under the lock against a FRESH read. A notification enqueued while this
  # flush was sending is therefore never overwritten by the old snapshot.
  $snapshot = @(Invoke-WithQueueLock -TimeoutSec 5 -Action { @(Get-QueueItems) })
  if ($snapshot.Count -eq 0) { return [pscustomobject]@{ sent = 0; remaining = 0; dropped = 0; skipped = 0 } }
  $endpoint = Resolve-DeliveryEndpoint
  $now = (Get-Date).ToUniversalTime()
  $plan = @{}
  $sentCount = 0
  $dropped = 0
  $skipped = 0
  $ageCutoff = $now.AddDays(-1 * $maxQueueAgeDays)

  foreach ($item in $snapshot) {
    $id = [string]$item.id
    $hash = [string]$item.hash
    $created = $now
    try { $created = ([datetime]$item.createdAt).ToUniversalTime() } catch { }
    if ($created -lt $ageCutoff) {
      Add-DroppedRecord -Item $item -Reason 'expired'
      $plan[$id] = [pscustomobject]@{ Action = 'remove' }
      $dropped += 1
      Write-NotifyLog "queue-expired hash=$hash id=$id ageDays=$maxQueueAgeDays"
      continue
    }
    $attempts = 0
    try { $attempts = [int]$item.attempts } catch { }
    if ($attempts -ge $maxAttempts) {
      Add-DroppedRecord -Item $item -Reason 'max-attempts'
      $plan[$id] = [pscustomobject]@{ Action = 'remove' }
      $dropped += 1
      Write-NotifyLog "queue-gave-up hash=$hash id=$id attempts=$attempts"
      continue
    }

    $due = $true
    try { $due = ([datetime]$item.nextAttemptAt).ToUniversalTime() -le $now } catch { }
    if (-not $due) { continue }

    if (Test-Duplicate -Hash $hash -WindowMinutes $DedupeWindowMinutes) {
      $plan[$id] = [pscustomobject]@{ Action = 'remove' }
      $skipped += 1
      Write-NotifyLog "queue-already-delivered hash=$hash id=$id"
      continue
    }

    try {
      Send-Delivery -Message ([string]$item.text) -Hash $hash -Endpoint $endpoint | Out-Null
      $plan[$id] = [pscustomobject]@{ Action = 'remove' }
      $sentCount += 1
      Write-NotifyLog "queue-sent hash=$hash id=$id"
    } catch {
      $attempts = $attempts + 1
      $delayMinutes = [Math]::Min(60, [Math]::Pow(2, [Math]::Min(6, $attempts)) * 2)
      $plan[$id] = [pscustomobject]@{
        Action        = 'retry'
        Attempts      = $attempts
        NextAttemptAt = $now.AddMinutes($delayMinutes).ToString('o')
        LastError     = $_.Exception.Message
      }
      Write-NotifyLog "queue-failed hash=$hash attempts=$attempts error=$($_.Exception.Message)"
    }
  }

  $merged = Update-QueueItems -TimeoutSec 10 -State $plan -Mutator {
    param($current, $state)
    $next = @()
    foreach ($entry in @($current)) {
      if ($null -eq $entry) { continue }
      $entryId = [string]$entry.id
      $decision = $null
      if ($state.ContainsKey($entryId)) { $decision = $state[$entryId] }
      if ($null -ne $decision -and $decision.Action -eq 'remove') { continue }
      if ($null -ne $decision -and $decision.Action -eq 'retry') {
        $entry.attempts = $decision.Attempts
        $entry.nextAttemptAt = $decision.NextAttemptAt
        $entry.lastError = $decision.LastError
      }
      $next += $entry
    }
    return $next
  }
  return [pscustomobject]@{ sent = $sentCount; remaining = @($merged).Count; dropped = $dropped; skipped = $skipped }
}

function Show-Status {
  $queue = @(Get-QueueItems)
  $endpoint = Resolve-DeliveryEndpoint
  $rawConfig = Read-DshJsonFile -Path $configPath -Default $null
  [pscustomobject]@{
    version       = 2
    workspace     = $workspaceContext.Label
    workspaceRoot = $workspaceRoot
    stateRoot     = $stateRoot
    discovery     = [pscustomobject]@{
      ok         = $endpoint.Ok
      endpoint   = $endpoint.Url
      method     = $endpoint.Method
      instanceId = $endpoint.InstanceId
      error      = $endpoint.Error
      override   = $endpoint.Override
      verified   = $endpoint.Verified
    }
    botId         = if ($rawConfig) { $rawConfig.botId } else { $null }
    targetId      = if ($rawConfig) { $rawConfig.targetId } else { $null }
    queueCount    = $queue.Count
    queueMax      = $maxQueueItems
    queued        = @($queue | Select-Object id, createdAt, attempts, lastError)
  } | ConvertTo-Json -Depth 5
}

function Invoke-FlushAllWorkspaces {
  # Runs one child notify.ps1 per queue root so each root keeps its own dedupe
  # state and its own lock scope. The parent must not hold the main lock.
  $targets = @()
  $centralQueue = Join-Path $centralStateRoot 'notify-queue.jsonl'
  if ((Test-Path -LiteralPath $centralQueue) -and ((Get-Item -LiteralPath $centralQueue).Length -gt 0)) {
    $targets += [pscustomobject]@{ Name = 'central'; StateDir = $centralStateRoot }
  }
  foreach ($workspacePath in @(Get-DshRegisteredWorkspacePaths)) {
    $candidateDir = Join-Path $workspacePath '.dsh-notify'
    $candidateQueue = Join-Path $candidateDir 'notify-queue.jsonl'
    if (-not (Test-Path -LiteralPath $candidateQueue)) { continue }
    if ((Get-Item -LiteralPath $candidateQueue).Length -le 0) { continue }
    $targets += [pscustomobject]@{ Name = $workspacePath; StateDir = $candidateDir }
  }
  $results = @()
  $failed = @()
  foreach ($target in $targets) {
    $output = ''
    $code = -1
    $parsed = $null
    try {
      $raw = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'notify.ps1') -FlushQueue -StateDir $target.StateDir 2>&1
      $code = $LASTEXITCODE
      $output = ($raw -join ' ').Trim()
      try { $parsed = $output | ConvertFrom-Json } catch { }
    } catch {
      $code = 1
      $output = $_.Exception.Message
    }
    $ok = ($code -eq 0 -and $null -ne $parsed)
    $entry = [pscustomobject]@{
      target    = $target.Name
      stateDir  = $target.StateDir
      exitCode  = $code
      ok        = $ok
      sent      = if ($parsed) { $parsed.sent } else { $null }
      remaining = if ($parsed) { $parsed.remaining } else { $null }
      dropped   = if ($parsed) { $parsed.dropped } else { $null }
      error     = if ($parsed) { $parsed.error } else { $null }
      output    = $output
    }
    $results += $entry
    if (-not $ok) { $failed += $entry }
  }
  return [pscustomobject]@{
    ok          = ($failed.Count -eq 0)
    targets     = @($targets).Count
    failedCount = $failed.Count
    failures    = @($failed | ForEach-Object {
      [pscustomobject]@{ target = $_.target; stateDir = $_.stateDir; exitCode = $_.exitCode; output = $_.output }
    })
    workspaces  = $results
  }
}

# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

# -AllWorkspaces must run children, so it is handled before taking the lock.
# Any failing workspace fails the whole command and is named in the output.
if ($FlushQueue -and $AllWorkspaces) {
  try {
    $aggregate = Invoke-FlushAllWorkspaces
    $aggregate | ConvertTo-Json -Depth 6 -Compress
    if ($aggregate.ok) { exit 0 }
    exit 3
  } catch {
    [pscustomobject]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    exit 3
  }
}

$mutex = New-Object System.Threading.Mutex($false, 'Local\DSHAssistantNotifyHelper')
$locked = $false
try {
  $locked = $mutex.WaitOne($lockWaitSec * 1000)
  if (-not $locked) {
    # A slow concurrent sender must never swallow a notification: enqueue it
    # under the queue lock instead of failing outright.
    if ($Status) {
      [pscustomobject]@{ sent = $false; error = 'notify lock busy'; queueCount = (Get-QueueCount) } | ConvertTo-Json -Compress
      exit 3
    }
    if ($FlushQueue) {
      Write-NotifyLog 'flush-skipped lock-busy'
      [pscustomobject]@{ sent = 0; remaining = (Get-QueueCount); skipped = 'lock-busy' } | ConvertTo-Json -Compress
      exit 0
    }
    if ([string]::IsNullOrWhiteSpace($Text) -and -not [string]::IsNullOrWhiteSpace($TextFile)) {
      if (Test-Path -LiteralPath $TextFile) { $Text = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $TextFile), [Text.Encoding]::UTF8) }
    }
    if ([string]::IsNullOrWhiteSpace($Text)) {
      [pscustomobject]@{ sent = $false; error = 'text is empty' } | ConvertTo-Json -Compress
      exit 3
    }
    $label = if ($NoPrefix) { '' } else { (Get-WorkspaceContext -Explicit $Workspace).Label }
    $envelope = (Add-NotifyEnvelope -Message $Text.Trim() -Source $label -Title $Title -NoSource:$NoPrefix).Trim()
    if ($envelope.Length -gt 20000) { $envelope = $envelope.Substring(0, 20000) + "`n…（内容已截断）" }
    $lateHash = Get-TextHash -Value $envelope
    try {
      Add-QueueItem -Message $envelope -Hash $lateHash -Reason 'notify-lock-busy' | Out-Null
      Write-NotifyLog "queued-lock-busy hash=$lateHash"
      [pscustomobject]@{ sent = $false; queued = $true; reason = 'lock-busy' } | ConvertTo-Json -Compress
      exit 2
    } catch {
      Write-NotifyLog "queue-write-failed hash=$lateHash error=$($_.Exception.Message)"
      [pscustomobject]@{ sent = $false; queued = $false; error = 'notify lock busy'; queueError = $_.Exception.Message } | ConvertTo-Json -Compress
      exit 3
    }
  }

  if ($Status) { Show-Status; exit 0 }

  if ($FlushQueue) {
    try {
      $flush = Invoke-FlushQueue
      Write-NotifyLog ("flush-complete sent={0} dropped={1} skipped={2} remaining={3}" -f $flush.sent, $flush.dropped, $flush.skipped, $flush.remaining)
      $flush | ConvertTo-Json -Compress
      exit 0
    } catch {
      Write-NotifyLog "flush-failed error=$($_.Exception.Message)"
      [pscustomobject]@{ sent = 0; remaining = (Get-QueueCount); error = $_.Exception.Message } | ConvertTo-Json -Compress
      exit 3
    }
  }

  if ([string]::IsNullOrWhiteSpace($Text) -and -not [string]::IsNullOrWhiteSpace($TextFile)) {
    if (-not (Test-Path -LiteralPath $TextFile)) { throw "text file not found: $TextFile" }
    $Text = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $TextFile), [Text.Encoding]::UTF8)
  }
  if ([string]::IsNullOrWhiteSpace($Text)) { throw 'text is empty' }
  $Text = $Text.Trim()
  $sourceLabel = if ($NoPrefix) { '' } else { (Get-WorkspaceContext -Explicit $Workspace).Label }
  $Text = Add-NotifyEnvelope -Message $Text -Source $sourceLabel -Title $Title -NoSource:$NoPrefix
  $Text = $Text.Trim()
  if ($Text.Length -gt 20000) { $Text = $Text.Substring(0, 20000) + "`n…（内容已截断）" }

  $hash = Get-TextHash -Value $Text
  if (-not $Force -and (Test-Duplicate -Hash $hash -WindowMinutes $DedupeWindowMinutes)) {
    Write-NotifyLog "duplicate-suppressed hash=$hash"
    [pscustomobject]@{ sent = $false; duplicate = $true } | ConvertTo-Json -Compress
    exit 0
  }

  $endpoint = Resolve-DeliveryEndpoint
  try {
    Send-Delivery -Message $Text -Hash $hash -Endpoint $endpoint | Out-Null
    [pscustomobject]@{ sent = $true; endpoint = $endpoint.Url; method = $endpoint.Method } | ConvertTo-Json -Compress
    exit 0
  } catch {
    $deliveryError = $_.Exception.Message
    try {
      Add-QueueItem -Message $Text -Hash $hash -Reason $deliveryError | Out-Null
      [pscustomobject]@{ sent = $false; queued = $true; error = $deliveryError } | ConvertTo-Json -Compress
      exit 2
    } catch {
      Write-NotifyLog "queue-write-failed hash=$hash error=$($_.Exception.Message)"
      [pscustomobject]@{ sent = $false; queued = $false; error = $deliveryError; queueError = $_.Exception.Message } | ConvertTo-Json -Compress
      exit 3
    }
  }
} catch {
  Write-NotifyLog "fatal error=$($_.Exception.Message)"
  [pscustomobject]@{ sent = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
  exit 3
} finally {
  if ($locked) { try { $mutex.ReleaseMutex() | Out-Null } catch { } }
  $mutex.Dispose()
}
