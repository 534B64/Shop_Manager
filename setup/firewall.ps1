# Adds (or removes) the Windows Firewall rules that let other devices reach Shop Manager.
# NEEDS ADMIN. Setup.bat runs only this script elevated, after asking.
#   TCP 80 and 3000 : the web page      UDP 5353 : the <name>.local name lookup
# Private networks only (home/work), and only for the app's node.exe.
param(
  [Parameter(Mandatory = $true)][string]$NodePath,
  [switch]$Remove,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$web = 'Shop Manager web page (TCP 80, 3000)'
$mdns = 'Shop Manager shop name (UDP 5353)'

if ($DryRun) {
  if ($Remove) { Write-Host "Would remove firewall rules: $web ; $mdns" }
  else {
    Write-Host "Would add inbound rule '$web': TCP 80,3000, program $NodePath, Private profile"
    Write-Host "Would add inbound rule '$mdns': UDP 5353, program $NodePath, Private profile"
  }
  exit 0
}

foreach ($n in $web, $mdns) { Get-NetFirewallRule -DisplayName $n -ErrorAction SilentlyContinue | Remove-NetFirewallRule }
if ($Remove) { Write-Host 'Firewall rules removed.'; exit 0 }
New-NetFirewallRule -DisplayName $web -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80, 3000 -Program $NodePath -Profile Private | Out-Null
New-NetFirewallRule -DisplayName $mdns -Direction Inbound -Action Allow -Protocol UDP -LocalPort 5353 -Program $NodePath -Profile Private | Out-Null
Write-Host 'Firewall rules added.'
