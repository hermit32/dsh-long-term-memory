# dsh-host.ps1
# Locate the DeepSeek Harness Host that this user is actually running, so that
# notification and watchdog scripts never depend on a hard-coded port.
#
# Trust rules (deliberately narrow; a hint URL cannot bypass any of them):
#   1. Address: only loopback literals are accepted (127.0.0.1 / localhost / ::1).
#      Any other host is rejected before a single byte is sent.
#   2. Executable: a candidate port must be a listening port owned by a process
#      whose executable path equals the configured appExe.
#   3. Ownership: the owning PID is resolved from the TCP listener table and the
#      executable path is read from that process. If the path cannot be read
#      (protected process / permission denied) the result is a hard failure
#      ("cannot-verify-instance"), never an accepted endpoint.
#   4. Delivery: a delivery target must answer the dsh-im route probe with
#      404 unknown-bot/unknown-target. A JSON body containing "paused" is NOT
#      enough to send a notification.
#   5. The runtime hint ($env:DSH_WEB_URL) is only used to order candidates or,
#      when the process scan is unavailable, as a port to verify. It never adds
#      a port that is not owned by appExe.
#   Ambiguous results (several ports answering) are reported, not guessed.
#
# This file is dot-sourced by notify.ps1, watchdog.ps1 and status.ps1.

function Get-DshHomeRoot {
  # DSH_HOME wins, matching the Host's own resolution; otherwise ~/.dsh.
  $envHome = [string]$env:DSH_HOME
  if (-not [string]::IsNullOrWhiteSpace($envHome)) { return $envHome.TrimEnd('\') }
  return (Join-Path $env:USERPROFILE '.dsh')
}

function Get-DshDefaultConfig {
  [pscustomobject]@{
    # Required: notify-config.json must set appExe to the exact path of the
    # running Harness executable. There is deliberately no default binary path.
    appExe           = ''
    endpointPath     = '/api/dsh-im/delivery/messages'
    gatePath         = '/schedule-gate/state'
    requestTimeoutSec = 10
    lockWaitSec      = 60
    maxQueueItems    = 200
    maxQueueAgeDays  = 7
    maxAttempts      = 12
    maxLogBytes      = 2MB
  }
}

function Read-DshJsonFile {
  param([string]$Path, $Default = $null)
  try {
    if (-not (Test-Path -LiteralPath $Path)) { return $Default }
    $raw = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
    if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
    return ($raw | ConvertFrom-Json)
  } catch {
    return $Default
  }
}

function Get-DshHostConfig {
  param([string]$ConfigPath)
  $defaults = Get-DshDefaultConfig
  $cfg = Read-DshJsonFile -Path $ConfigPath -Default $null
  if ($null -eq $cfg) { return $defaults }
  foreach ($name in @('endpointPath', 'gatePath')) {
    $value = $cfg.$name
    if (-not [string]::IsNullOrWhiteSpace([string]$value)) { $defaults.$name = [string]$value }
  }
  if (-not [string]::IsNullOrWhiteSpace([string]$cfg.appExe)) { $defaults.appExe = [string]$cfg.appExe }
  foreach ($name in @('requestTimeoutSec', 'lockWaitSec', 'maxQueueItems', 'maxQueueAgeDays', 'maxAttempts')) {
    $raw = $cfg.$name
    if ($null -ne $raw) {
      $number = 0
      if ([int]::TryParse([string]$raw, [ref]$number) -and $number -gt 0) { $defaults.$name = $number }
    }
  }
  return $defaults
}

function Get-DshAppProcesses {
  param([string]$AppExe)
  # Returns @{ Available; Items }. Available=$false means the process table could
  # not be enumerated (permission denied / CIM failure), which callers must treat
  # as "cannot verify" instead of "nothing running".
  $state = [pscustomobject]@{ Available = $false; Items = @(); Error = $null }
  if ([string]::IsNullOrWhiteSpace($AppExe)) { return $state }
  try {
    $all = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    $state.Available = $true
  } catch {
    $state.Error = $_.Exception.Message
    return $state
  }
  $items = @()
  foreach ($process in $all) {
    $path = [string]$process.ExecutablePath
    if ([string]::IsNullOrWhiteSpace($path)) { continue }
    if (-not $path.Equals($AppExe, [StringComparison]::OrdinalIgnoreCase)) { continue }
    $started = $null
    try { $started = ([datetime]$process.CreationDate).ToString('o') } catch { }
    $items += [pscustomobject]@{
      ProcessId       = [int]$process.ProcessId
      ParentProcessId = [int]$process.ParentProcessId
      Name            = [string]$process.Name
      StartedAt       = $started
    }
  }
  $state.Items = $items
  return $state
}

function Test-DshLocalUrl {
  param([string]$Url)
  # Accepts only http loopback literals. Returns @{ Ok; Host; Port; Path; Reason }.
  $result = [pscustomobject]@{ Ok = $false; Host = $null; Port = 0; Path = $null; Reason = $null }
  if ([string]::IsNullOrWhiteSpace($Url)) { $result.Reason = 'empty'; return $result }
  $uri = $null
  try { $uri = [Uri]$Url } catch { $result.Reason = 'invalid-url'; return $result }
  if (-not $uri.IsAbsoluteUri) { $result.Reason = 'not-absolute'; return $result }
  if ($uri.Scheme -ne 'http') { $result.Reason = 'not-http'; return $result }
  $hostName = ([string]$uri.Host).ToLowerInvariant()
  if ($hostName -ne '127.0.0.1' -and $hostName -ne 'localhost' -and $hostName -ne '::1') {
    $result.Reason = 'not-loopback'
    return $result
  }
  if ($uri.Port -le 0) { $result.Reason = 'invalid-port'; return $result }
  $result.Ok = $true
  $result.Host = $hostName
  $result.Port = $uri.Port
  $result.Path = $uri.AbsolutePath
  return $result
}

function Get-DshPortOwnership {
  param([int]$Port, [string]$AppExe)
  # Resolve the PID that owns a listening port and prove it runs AppExe.
  # Reason codes: ok / not-listening / owner-unknown / owner-not-dsh.
  $result = [pscustomobject]@{ Ok = $false; OwnerPid = 0; OwnerPath = $null; Reason = $null }
  if ($Port -le 0) { $result.Reason = 'invalid-port'; return $result }
  $owners = @()
  try {
    $owners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop |
      Select-Object -ExpandProperty OwningProcess -Unique)
  } catch {
    try {
      $pattern = '(?im)^\s*TCP\s+\S+:' + $Port + '\s+\S+\s+LISTENING\s+(\d+)\s*$'
      $text = (& netstat.exe -ano 2>$null) -join "`n"
      foreach ($match in [regex]::Matches($text, $pattern)) {
        $ownerId = 0
        if ([int]::TryParse($match.Groups[1].Value, [ref]$ownerId)) { $owners += $ownerId }
      }
    } catch { }
  }
  $owners = @($owners | Where-Object { $_ -gt 0 } | Select-Object -Unique)
  if ($owners.Count -eq 0) { $result.Reason = 'not-listening'; return $result }
  $sawUnknown = $false
  foreach ($ownerId in $owners) {
    $process = $null
    try { $process = Get-Process -Id $ownerId -ErrorAction Stop } catch { $sawUnknown = $true; continue }
    if ($null -eq $process) { $sawUnknown = $true; continue }
    $path = $null
    try { $path = [string]$process.Path } catch { $path = $null }
    if ([string]::IsNullOrWhiteSpace($path)) { $sawUnknown = $true; continue }
    if ($path.Equals($AppExe, [StringComparison]::OrdinalIgnoreCase)) {
      $result.Ok = $true
      $result.OwnerPid = [int]$ownerId
      $result.OwnerPath = $path
      $result.Reason = 'ok'
      return $result
    }
  }
  if ($sawUnknown) { $result.Reason = 'owner-unknown' } else { $result.Reason = 'owner-not-dsh' }
  return $result
}

function Get-DshLoopbackListeners {
  param([int[]]$ProcessIds)
  # Returns @{ Port; ProcessId } pairs for loopback listeners owned by the
  # given processes. Port number alone is not enough: the owning process is
  # part of the instance identity.
  $listeners = @()
  if (-not $ProcessIds -or $ProcessIds.Count -eq 0) { return @() }
  $seen = @{}
  $viaCmdlet = $true
  foreach ($processId in $ProcessIds) {
    if ($processId -le 0) { continue }
    try {
      $connections = @(Get-NetTCPConnection -State Listen -OwningProcess $processId -ErrorAction Stop)
      foreach ($connection in $connections) {
        $address = [string]$connection.LocalAddress
        if ($address -ne '127.0.0.1' -and $address -ne '::1' -and $address -ne '0.0.0.0' -and $address -ne '::') { continue }
        $port = [int]$connection.LocalPort
        if ($seen.ContainsKey($port)) { continue }
        $seen[$port] = $true
        $listeners += [pscustomobject]@{ Port = $port; ProcessId = $processId }
      }
    } catch {
      $viaCmdlet = $false
      break
    }
  }
  if (-not $viaCmdlet) {
    $listeners = @()
    $seen = @{}
    try {
      $pattern = '(?im)^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$'
      $text = (& netstat.exe -ano 2>$null) -join "`n"
      foreach ($match in [regex]::Matches($text, $pattern)) {
        $ownerId = 0
        if (-not [int]::TryParse($match.Groups[2].Value, [ref]$ownerId)) { continue }
        if ($ProcessIds -notcontains $ownerId) { continue }
        $port = 0
        if (-not [int]::TryParse($match.Groups[1].Value, [ref]$port)) { continue }
        if ($seen.ContainsKey($port)) { continue }
        $seen[$port] = $true
        $listeners += [pscustomobject]@{ Port = $port; ProcessId = $ownerId }
      }
    } catch { }
  }
  return @($listeners | Sort-Object Port)
}

function Invoke-DshHttpProbe {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [ValidateSet('GET', 'POST')][string]$Method = 'GET',
    [string]$Body = $null,
    [int]$TimeoutSec = 2
  )
  $result = [pscustomobject]@{ Status = 0; Body = ''; Json = $null; Error = $null; Ok = $false }
  try {
    $parameters = @{
      Uri             = $Uri
      Method          = $Method
      TimeoutSec      = $TimeoutSec
      UseBasicParsing = $true
      Headers         = @{ 'Cache-Control' = 'no-store' }
    }
    if ($Method -eq 'POST') {
      $parameters['ContentType'] = 'application/json; charset=utf-8'
      $parameters['Body'] = [Text.Encoding]::UTF8.GetBytes($Body)
    }
    $response = Invoke-WebRequest @parameters
    $result.Status = [int]$response.StatusCode
    $result.Body = [string]$response.Content
    $result.Ok = ($result.Status -ge 200 -and $result.Status -lt 300)
  } catch {
    $errorRecord = $_
    $exception = $errorRecord.Exception
    $response = $null
    try { $response = $exception.Response } catch { }
    if ($null -ne $response) {
      try { $result.Status = [int]$response.StatusCode } catch { }
      try {
        $stream = $response.GetResponseStream()
        if ($null -ne $stream) {
          $reader = New-Object System.IO.StreamReader($stream)
          $result.Body = $reader.ReadToEnd()
          $reader.Dispose()
        }
      } catch { }
    }
    # Windows PowerShell 5.1 consumes the error stream and exposes the body
    # through ErrorDetails instead. Prefer it, then fall back to the stream.
    try {
      if (-not [string]::IsNullOrWhiteSpace([string]$errorRecord.ErrorDetails.Message)) {
        $result.Body = [string]$errorRecord.ErrorDetails.Message
      }
    } catch { }
    $result.Error = $exception.Message
  }
  if (-not [string]::IsNullOrWhiteSpace($result.Body)) {
    try { $result.Json = $result.Body | ConvertFrom-Json } catch { }
  }
  return $result
}

function Test-DshGateProbe {
  param([string]$BaseUrl, [string]$GatePath = '/schedule-gate/state', [int]$TimeoutSec = 2)
  if ([string]::IsNullOrWhiteSpace($BaseUrl)) { return $null }
  $probe = Invoke-DshHttpProbe -Uri ($BaseUrl.TrimEnd('/') + $GatePath) -Method GET -TimeoutSec $TimeoutSec
  if (-not $probe.Ok -or $null -eq $probe.Json) { return $null }
  $names = @($probe.Json.PSObject.Properties.Name)
  if ($names -notcontains 'paused') { return $null }
  return $probe.Json
}

function Test-DshDeliveryProbe {
  param([string]$Url, [int]$TimeoutSec = 2)
  # POSTs a deliberately unknown bot. The dsh-im delivery route rejects it with
  # 404 unknown-bot/unknown-target, which proves the route exists without
  # delivering a message. A 200 {"sent":true} is NOT accepted here: an impostor
  # must not be able to fake the route.
  if ([string]::IsNullOrWhiteSpace($Url)) { return $false }
  $payload = '{"botId":"dsh-probe-does-not-exist","targetId":"dsh-probe-does-not-exist","text":"probe","format":"plain"}'
  $probe = Invoke-DshHttpProbe -Uri $Url -Method POST -Body $payload -TimeoutSec $TimeoutSec
  if ($null -eq $probe.Json) { return $false }
  $code = ''
  try { $code = [string]$probe.Json.error.code } catch { }
  return ($code -eq 'unknown-bot' -or $code -eq 'unknown-target')
}

function Test-DshDeliveryEndpoint {
  param([string]$Url, [string]$AppExe, [int]$TimeoutSec = 2)
  # Full verification for a concrete delivery URL: loopback + ownership +
  # delivery-route probe. Used for the config endpoint override and for the
  # discovered Host before any real message is sent.
  $local = Test-DshLocalUrl -Url $Url
  if (-not $local.Ok) {
    return [pscustomobject]@{ Ok = $false; Reason = $local.Reason; Port = 0; OwnerPid = 0 }
  }
  $ownership = Get-DshPortOwnership -Port $local.Port -AppExe $AppExe
  if (-not $ownership.Ok) {
    return [pscustomobject]@{ Ok = $false; Reason = $ownership.Reason; Port = $local.Port; OwnerPid = $ownership.OwnerPid }
  }
  if (-not (Test-DshDeliveryProbe -Url $Url -TimeoutSec $TimeoutSec)) {
    return [pscustomobject]@{ Ok = $false; Reason = 'delivery-route-unverified'; Port = $local.Port; OwnerPid = $ownership.OwnerPid }
  }
  return [pscustomobject]@{ Ok = $true; Reason = 'ok'; Port = $local.Port; OwnerPid = $ownership.OwnerPid }
}

function Find-DshHost {
  param(
    [string]$AppExe,
    [string]$EndpointPath = '/api/dsh-im/delivery/messages',
    [string]$GatePath = '/schedule-gate/state',
    [int]$TimeoutSec = 2,
    [string]$HintUrl
  )
  $result = [pscustomobject]@{
    Ok             = $false
    BaseUrl        = $null
    Port           = 0
    Method         = $null
    HostPid        = 0
    AppPid         = 0
    AppStartedAt   = $null
    InstanceId     = $null
    AppProcesses   = @()
    CandidatePorts = @()
    ScanAvailable  = $false
    Ambiguous      = $false
    Verified       = $null
    Error          = $null
  }

  # 1. Hint validation happens before any network or process access.
  $hint = $null
  if (-not [string]::IsNullOrWhiteSpace($HintUrl)) {
    $hintLocal = Test-DshLocalUrl -Url $HintUrl
    if (-not $hintLocal.Ok) {
      $result.Error = 'hint-not-local'
      $result.Verified = 'rejected'
      return $result
    }
    $hint = $hintLocal
  }

  # 2. Process scan.
  $scan = Get-DshAppProcesses -AppExe $AppExe
  $result.ScanAvailable = [bool]$scan.Available
  $apps = @($scan.Items)
  $result.AppProcesses = $apps

  if ($apps.Count -gt 0) {
    $appIds = @($apps | ForEach-Object { $_.ProcessId })
    $roots = @($apps | Where-Object { $appIds -notcontains $_.ParentProcessId })
    if ($roots.Count -gt 0) {
      $root = $roots | Sort-Object { $_.StartedAt } | Select-Object -Last 1
    } else {
      $root = $apps | Select-Object -First 1
    }
    $result.AppPid = $root.ProcessId
    $result.AppStartedAt = $root.StartedAt
    $result.InstanceId = '{0}:{1}' -f $root.ProcessId, $root.StartedAt
    $result.Verified = 'process-scan'

    $listeners = @(Get-DshLoopbackListeners -ProcessIds $appIds)
    $ports = @($listeners | ForEach-Object { $_.Port })
    if ($null -ne $hint -and $ports -contains $hint.Port) {
      $ports = @($hint.Port) + @($ports | Where-Object { $_ -ne $hint.Port })
    }
    $result.CandidatePorts = $ports

    $hits = @()
    foreach ($port in $ports) {
      if ($port -le 0) { continue }
      $baseUrl = 'http://127.0.0.1:{0}' -f $port
      $gate = Test-DshGateProbe -BaseUrl $baseUrl -GatePath $GatePath -TimeoutSec $TimeoutSec
      if ($null -ne $gate) {
        $hits += [pscustomobject]@{ BaseUrl = $baseUrl; Port = $port; Method = 'gate'; Gate = $gate }
        continue
      }
      if (Test-DshDeliveryProbe -Url ($baseUrl + $EndpointPath) -TimeoutSec $TimeoutSec) {
        $hits += [pscustomobject]@{ BaseUrl = $baseUrl; Port = $port; Method = 'delivery-route'; Gate = $null }
      }
    }

    if ($hits.Count -eq 0) {
      $result.Error = 'host-not-answering'
      return $result
    }
    if ($hits.Count -gt 1) {
      $result.Ambiguous = $true
      $result.Error = 'ambiguous-multiple-ports'
      $result.BaseUrl = $hits[0].BaseUrl
      $result.Port = $hits[0].Port
      $result.Method = $hits[0].Method
      return $result
    }
    $hit = $hits[0]
    $owner = $listeners | Where-Object { $_.Port -eq $hit.Port } | Select-Object -First 1
    if ($null -ne $owner) { $result.HostPid = [int]$owner.ProcessId }
    $result.Ok = $true
    $result.BaseUrl = $hit.BaseUrl
    $result.Port = $hit.Port
    $result.Method = $hit.Method
    return $result
  }

  # 3. No enumerable instance. A hint may be used only as the port to verify,
  #    never as proof of identity.
  if ($null -eq $hint) {
    $result.Error = if ($scan.Available) { 'no-running-instance' } else { 'scan-unavailable' }
    return $result
  }
  $ownership = Get-DshPortOwnership -Port $hint.Port -AppExe $AppExe
  if (-not $ownership.Ok) {
    $result.Error = switch ($ownership.Reason) {
      'owner-unknown' { 'cannot-verify-instance' }
      'not-listening' { 'hint-not-listening' }
      'invalid-port' { 'hint-not-local' }
      default { 'hint-not-owned' }
    }
    $result.Verified = 'rejected'
    return $result
  }
  $baseUrl = 'http://127.0.0.1:{0}' -f $hint.Port
  $gate = Test-DshGateProbe -BaseUrl $baseUrl -GatePath $GatePath -TimeoutSec $TimeoutSec
  if ($null -eq $gate -and -not (Test-DshDeliveryProbe -Url ($baseUrl + $EndpointPath) -TimeoutSec $TimeoutSec)) {
    $result.Error = 'host-not-answering'
    $result.Verified = 'port-ownership'
    return $result
  }
  $result.Ok = $true
  $result.BaseUrl = $baseUrl
  $result.Port = $hint.Port
  $result.Method = 'verified-hint'
  $result.HostPid = $ownership.OwnerPid
  $result.Verified = 'port-ownership'
  # The instance identity is deliberately left empty: only the port owner was
  # verified, not the whole instance (process enumeration was unavailable).
  return $result
}

function Find-DshHostForConfig {
  param([string]$ConfigPath, [string]$HintUrl = $env:DSH_WEB_URL)
  $cfg = Get-DshHostConfig -ConfigPath $ConfigPath
  return (Find-DshHost -AppExe $cfg.appExe -EndpointPath $cfg.endpointPath `
    -GatePath $cfg.gatePath -TimeoutSec 2 -HintUrl $HintUrl)
}

function Get-DshRegisteredWorkspacePaths {
  # Workspace roots registered in <DSH_HOME>/storages/workspace.json, de-duplicated.
  $paths = @()
  $registryPath = Join-Path (Get-DshHomeRoot) 'storages\workspace.json'
  if (-not (Test-Path -LiteralPath $registryPath)) { return $paths }
  try {
    $registry = [IO.File]::ReadAllText($registryPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
    $seen = @{}
    foreach ($property in $registry.tables.workspaces.PSObject.Properties) {
      $candidate = [string]$property.Value.path
      if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
      try { $candidate = [IO.Path]::GetFullPath($candidate).TrimEnd('\') } catch { }
      $key = $candidate.ToLowerInvariant()
      if ($seen.ContainsKey($key)) { continue }
      $seen[$key] = $true
      $paths += $candidate
    }
  } catch { }
  return $paths
}
