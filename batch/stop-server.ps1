# Stops every running Shop Manager server (any process whose command line runs server/index.ts),
# then waits until port 3000 is free. Used by 6-Stop-Hidden.bat, 4-Start-Production.bat and
# start-hidden.vbs, so "Start" always means "restart": an old server can never keep running
# behind a newly built app.
#   -List      only show what would be stopped
#   -Pattern   override the match (for testing)
param(
  [switch]$List,
  [string]$Pattern = 'server[/\\]index\.ts',
  [int]$Port = 3000
)

$mine = @($PID)
$procs = @(Get-CimInstance Win32_Process | Where-Object {
  $mine -notcontains $_.ProcessId -and $_.CommandLine -and ($_.CommandLine -match $Pattern)
})

if ($procs.Count -eq 0) { Write-Host 'No Shop Manager server was running.' }
foreach ($p in $procs) {
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
