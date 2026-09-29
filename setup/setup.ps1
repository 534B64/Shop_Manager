# Shop Manager - first-time setup (run by Setup.bat). Safe to run again: it never re-creates or
# overwrites the database, and it skips steps that are already done.
#
#   -DryRun         show what would change on THIS PC (shortcuts, start-at-login, firewall) without
#                   doing it. Everything inside the Shop Manager folder is still set up.
#   -ShopName / -Hostname / -StartAtLogin yes|no / -OpenFirewall yes|no   answer a question ahead of time
#   -SkipInstall    skip "npm ci" and the build (for testing)
param(
  [switch]$DryRun,
  [string]$ShopName = '',
  [string]$Hostname = '',
  [ValidateSet('', 'yes', 'no')][string]$StartAtLogin = '',
  [ValidateSet('', 'yes', 'no')][string]$OpenFirewall = '',
  [switch]$SkipInstall
)
. "$PSScriptRoot\common.ps1"
$root = Get-ShopRoot
Set-Location $root

function Say([string]$t) { Write-Host $t }
function Step([int]$n, [string]$t) { Write-Host ''; Write-Host "Step $n of 8 - $t" -ForegroundColor Cyan }
function Would([string]$t) { Write-Host "  [dry run] would $t" -ForegroundColor Yellow }

try {
  Write-Host '============================================'
  Write-Host ' Shop Manager - Setup'
  Write-Host '============================================'
  Say " Folder: $root"
  if ($DryRun) { Write-Host ' DRY RUN: nothing will be changed on this PC outside this folder.' -ForegroundColor Yellow }

  # ---- 1. Where the folder lives ----
  Step 1 'Checking the folder'
  if ($root -match 'OneDrive|Dropbox|Google Drive|iCloud') {
    Say '  This folder is inside a cloud-synced folder (OneDrive/Dropbox/...).'
    Say '  It works, but syncing can lock the database while the shop is busy. A plain folder such as'
    Say '  C:\ShopManager is safer; back up the data\backups folder to the cloud separately.'
    if (-not (Ask-YesNo '  Continue here anyway?' $true)) { Say '  Move the folder, then run Setup.bat again.'; exit 1 }
  } else { Say '  OK.' }

  # ---- 2. Node.js ----
  Step 2 'Getting Node.js (the engine that runs Shop Manager)'
  Install-RuntimeNode $root
  [void](Use-RuntimeNode $root)
  if (-not (Test-NodeAvailable)) { throw 'Node.js is not available.' }
  Say ("  Using Node.js " + (& node --version))

  # ---- 3. Stop an old copy so files are not locked ----
  Step 3 'Making sure Shop Manager is not already running from this folder'
  if ($DryRun) { & powershell -NoProfile -ExecutionPolicy Bypass -File "$root\batch\stop-server.ps1" -List }
  else { & powershell -NoProfile -ExecutionPolicy Bypass -File "$root\batch\stop-server.ps1" }

  # ---- 4. Install + build ----
  Step 4 'Installing and building the app (a few minutes the first time)'
  if ($SkipInstall) { Say '  Skipped (-SkipInstall).' } else {
    Invoke-Step 'Installing the app files (npm ci)' { & npm ci }
    Invoke-Step 'Building the app (npm run build)' { & npm run build }
  }

  # ---- 5. Shop name and address ----
  Step 5 'Your shop name and its address'
  $cfg = Read-ShopEnv $root
  $name = if ($ShopName) { $ShopName } else { Ask-Text '  What is your shop called? (for example: Decals Plus)' $cfg['SHOP_NAME'] }
  if (-not $name) { $name = 'Shop' }
  $suggest = if ($cfg['SHOP_HOSTNAME']) { $cfg['SHOP_HOSTNAME'] } else { ConvertTo-Hostname $name }
  $host_ = if ($Hostname) { $Hostname } else { Ask-Text "  Address other devices will type (letters and numbers only)" $suggest }
  $host_ = $host_.Trim().ToLower()
  while (-not (Test-Hostname $host_)) {
    if ($Hostname) { throw "'$Hostname' is not a valid address name (letters, numbers and hyphens only)." }
    Say '  Use only letters, numbers and hyphens (no spaces).'
    $host_ = (Ask-Text '  Address name' $suggest).Trim().ToLower()
  }
  Write-ShopEnv $root @{ SHOP_NAME = $name; SHOP_HOSTNAME = $host_ }
  Say "  Saved. Other devices will open  http://$host_.local"

  # ---- 6. Database ----
  Step 6 'The shop database'
  $dbFile = Join-Path $root 'data\dp-erp.db'
  $env:DB_PATH = './data/dp-erp.db'
  # db:init-prod decides: a labeled or used database is left alone (INIT_SKIP_IF_SETUP), while a missing,
  # empty or freshly server-created one gets its first admin account (you can add everyone else later).
  $env:INIT_SKIP_IF_SETUP = '1'
  if (-not ((Test-Path $dbFile) -and ((Get-Item $dbFile).Length -gt 0))) {
    Say '  No database yet. Next you create the first admin account.'
  }
  Invoke-Step 'Setting up the shop database' { & npm run db:init-prod }
  Remove-Item Env:INIT_SKIP_IF_SETUP -ErrorAction SilentlyContinue

  # ---- 7. Firewall ----
  Step 7 'Letting other devices connect (Windows Firewall)'
  $nodeExe = (Get-Command node).Source
  if (Test-FirewallRules $nodeExe) { Say '  Firewall rules are already in place.' } else {
    Say '  Other PCs and phones need two firewall openings (private networks only): the web page and the'
    Say '  shop name lookup. Windows asks for administrator permission for this one step.'
    $doFw = if ($OpenFirewall) { $OpenFirewall -eq 'yes' } else { Ask-YesNo '  Add the firewall rules now?' $true }
    if (-not $doFw) {
      Say '  Skipped. Without them, only THIS PC can open Shop Manager - other devices will not connect.'
      Say '  Run Setup.bat again any time to add them.'
    } elseif ($DryRun) {
      Would 'run this elevated (PowerShell as administrator, nothing read from a file):'
      (Get-FirewallScript $nodeExe) -split "`r?`n" | ForEach-Object { Say "      $_" }
    } else {
      $script_ = Get-FirewallScript $nodeExe
      $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script_))
      try {
        Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded
      } catch { Say '  Windows did not get permission, so nothing was changed.' }
      if (Test-FirewallRules $nodeExe) { Say '  Firewall rules added (both the web page and the shop name lookup).' }
      else { Write-Host '  WARNING: the firewall rules were NOT added. Other devices will not be able to connect until they are. Run Setup.bat again and say yes when Windows asks.' -ForegroundColor Yellow }
    }
  }

  # ---- 8. Start + shortcuts ----
  Step 8 'Starting Shop Manager and making shortcuts'
  $port = 80
  if ($DryRun) { Would 'start Shop Manager now (batch\start-hidden.vbs)' } else {
    Say '  Starting ...'
    & wscript.exe //nologo "$root\batch\start-hidden.vbs" fast noopen
    $health = $null
    for ($i = 0; $i -lt 45 -and -not $health; $i++) { Start-Sleep 1; $health = Get-ShopHealth (Get-LikelyPorts) }
    if ($health) { $port = if ($health.port) { [int]$health.port } else { [int]$health.probedPort }; Say "  Running on port $port." } else { Say '  It did not answer yet. Check data\logs\ if the shortcut does not open.' }
  }
  $suffix = if ($port -eq 80) { '' } else { ":$port" }
  $address = "http://$host_.local$suffix"        # for OTHER devices
  $localAddress = "http://localhost$suffix"      # on this PC itself, always works

  $desktop = [Environment]::GetFolderPath('Desktop')
  $startupFolder = [Environment]::GetFolderPath('Startup')
  $wsh = New-Object -ComObject WScript.Shell
  function New-Lnk([string]$path, [string]$target, [string]$args_, [string]$desc, [int]$style = 1) {
    if ($DryRun) { Would "create shortcut $path -> $target $args_"; return }
    $s = $wsh.CreateShortcut($path)
    $s.TargetPath = $target; $s.Arguments = $args_; $s.WorkingDirectory = $root; $s.Description = $desc
    $s.WindowStyle = $style
    $ico = Join-Path $root 'public\favicon.ico'
    if (Test-Path $ico) { $s.IconLocation = $ico }
    $s.Save()
    Say "  Created $path"
  }
  $urlFile = Join-Path $desktop 'Shop Manager.url'
  if ($DryRun) { Would "create shortcut $urlFile -> $localAddress" } else {
    [IO.File]::WriteAllText($urlFile, "[InternetShortcut]`r`nURL=$localAddress`r`nIconFile=$root\public\favicon.ico`r`nIconIndex=0`r`n")
    Say "  Created $urlFile"
  }
  New-Lnk (Join-Path $desktop 'Start Shop Manager.lnk') 'wscript.exe' ('//nologo "' + $root + '\batch\start-hidden.vbs" fast') 'Start Shop Manager' 7
  New-Lnk (Join-Path $desktop 'Stop Shop Manager.lnk') "$root\batch\6-Stop-Hidden.bat" '' 'Stop Shop Manager'

  $atLogin = if ($StartAtLogin) { $StartAtLogin -eq 'yes' } else { Ask-YesNo '  Start Shop Manager automatically (hidden) when this PC signs in?' $true }
  $startupLnk = Join-Path $startupFolder 'Shop Manager.lnk'
  if ($atLogin) {
    New-Lnk $startupLnk 'wscript.exe' ('//nologo "' + $root + '\batch\start-hidden.vbs" fast noopen') 'Start Shop Manager at login' 7
  } elseif (Test-Path $startupLnk) {
    if ($DryRun) { Would "remove $startupLnk" } else { Remove-Item $startupLnk -Force; Say '  Removed the start-at-login shortcut.' }
  }

  # ---- Summary ----
  Write-Host ''
  Write-Host '============================================' -ForegroundColor Green
  Write-Host ' All set.' -ForegroundColor Green
  Write-Host '============================================' -ForegroundColor Green
  Say " On this PC:           $localAddress   (the desktop shortcut)"
  Say " On other devices:     $address"
  $lan = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^(127|169\.254)\.' -and $_.PrefixOrigin -ne 'WellKnown' -and $_.InterfaceAlias -notmatch 'vethernet|wsl|hyper-v|virtualbox|vmware|vbox|docker|tailscale|zerotier|vpn|loopback' } | Select-Object -ExpandProperty IPAddress)
  if ($lan.Count) { Say ("   (if a phone cannot open that, try http://" + $lan[0] + $suffix + ")") }
  Say ' Sign in with:        the admin name and PIN you chose'
  Say " Your data lives in:  $root\data"
  Say " Backups (nightly):   $root\data\backups"
  Write-Host ''
  Say ' Next:'
  Say '  1. Open the address above and sign in. Tell everyone the new address and replace any old :3000 bookmarks.'
  Say '  2. Add an account for each person: Settings > Accounts.'
  Say '  3. To update later: unzip the new version over this folder, then double-click Update.bat.'
  Say '  4. Copy data\backups somewhere safe now and then (a USB drive or cloud folder).'
  if ($DryRun) { Write-Host ''; Write-Host ' (Dry run: no shortcuts, startup item or firewall rules were really created.)' -ForegroundColor Yellow }
  exit 0
} catch {
  Write-Host ''
  Write-Host ('Setup stopped: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Nothing was harmed. Fix the problem above and run Setup.bat again - it picks up where it left off.'
  exit 1
}
