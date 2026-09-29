# Stops the Shop Manager server(s) that run from THIS project folder, then waits until port 3000 is free.
# Used by 6-Stop-Hidden.bat, 4-Start-Production.bat and start-hidden.vbs, so "Start" always means
# "restart": an old server can never keep running behind a newly built app.
#
# Only processes whose command line runs server/index.ts AND mentions this project's folder are
# stopped (another copy of the app elsewhere, a test copy, a worktree are left alone), plus the
# wrapper processes (cmd / npx / tsx) that started them.
#   -List      only show what would be stopped
#   -Pattern   override the "runs the server" match (for testing)
#   -Root      override the project folder (for testing)
# Exit code: 0 ok, 2 = something is still using the port afterwards.
param(
  [switch]$List,
  [string]$Pattern = 'server[/\\]index\.ts',
  [string]$Root = '',
  [int]$Port = 3000
)

if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
$Root = $Root.TrimEnd('\', '/')
$fwd = $Root -replace '\\', '/'
# The ways the folder shows up in a command line: C:\a b\app\, C:/a b/app/, file:///C:/a%20b/app/
$variants = @(($Root + '\'), ($fwd + '/'), ('file:///' + ($fwd -replace ' ', '%20') + '/'), ('file:///' + [uri]::EscapeUriString($fwd) + '/'))
function Mentions-Root($cl) {
  foreach ($v in $variants) { if ($cl.IndexOf($v, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true } }
  return $false
}

$all = @(Get-CimInstance Win32_Process)
$cands = @($all | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and ($_.CommandLine -match $Pattern) })
$mine = @{}
foreach ($p in $cands) { if (Mentions-Root $p.CommandLine) { $mine[[int]$p.ProcessId] = $p } }
# Wrappers: candidates that are the parent of something already chosen (repeat up the chain).
do {
  $added = $false
  foreach ($p in $cands) {
    if ($mine.ContainsKey([int]$p.ProcessId)) { continue }
    foreach ($m in @($mine.Values)) {
      if ([int]$m.ParentProcessId -eq [int]$p.ProcessId) { $mine[[int]$p.ProcessId] = $p; $added = $true; break }
    }
  }
} while ($added)

if ($mine.Count -eq 0) { Write-Host 'No Shop Manager server from this folder was running.' }
foreach ($p in $mine.Values) {
  if ($List) { Write-Host ('Would stop PID ' + $p.ProcessId + ': ' + $p.Name); continue }
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  Write-Host ('Stopped PID ' + $p.ProcessId)
}
if ($List) { exit 0 }

# Give Windows a moment to release the port before the new server starts.
$free = $false
for ($i = 0; $i -lt 20; $i++) {
  $listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $listening) { $free = $true; break }
  Start-Sleep -Milliseconds 500
}
if ($free) { Write-Host ('Port ' + $Port + ' is free.') }
else {
  Write-Host ('WARNING: something is still using port ' + $Port + ' (PID ' + (($listening | Select-Object -First 1).OwningProcess) + '). Close it, then start again.')
  exit 2
}
