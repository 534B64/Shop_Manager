# Waits for Shop Manager to answer, then opens it in the browser (used by the start scripts).
#   -NoOpen       only wait and print the address
#   -TimeoutSec   how long to wait (default 45)
param([switch]$NoOpen, [int]$TimeoutSec = 45)
. "$PSScriptRoot\common.ps1"

$ports = Get-LikelyPorts
$health = $null
$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
  $health = Get-ShopHealth $ports
  if ($health) { break }
  Start-Sleep -Seconds 1
}

if (-not $health) {
  if (-not $NoOpen) {
    Add-Type -AssemblyName PresentationFramework
    [void][Windows.MessageBox]::Show("Shop Manager did not start within $TimeoutSec seconds. Look in the data\logs folder, or run batch\4-Start-Production.bat to see the error message.", 'Shop Manager')
  }
  Write-Host 'Shop Manager did not answer.'
  exit 1
}

# On the shop PC itself, localhost always works. (Older servers report no port; use the one we probed.)
$port = if ($health.port) { [int]$health.port } else { [int]$health.probedPort }
$suffix = if ($port -eq 80) { '' } else { ":$port" }
$url = "http://localhost$suffix"
Write-Host $url
if (-not $NoOpen) { Start-Process $url }
exit 0
