# Shop Manager - update (run by Update.bat) after you unzipped a newer version over this folder.
# Order: (git pull, if this is a git clone) -> backup -> stop the app -> install -> build -> start -> open.
# The data folder is never touched, except that the backup adds a file to data\backups.
#
#   -NoGit      do not try "git pull"
#   -NoStart    do not restart the app or open the browser (for testing)
#   -SkipInstall  skip "npm ci" and the build (for testing)
param([switch]$NoGit, [switch]$NoStart, [switch]$SkipInstall)
. "$PSScriptRoot\common.ps1"
$root = Get-ShopRoot
Set-Location $root
function Say([string]$t) { Write-Host $t }
function Step([int]$n, [string]$t) { Write-Host ''; Write-Host "Step $n of 6 - $t" -ForegroundColor Cyan }

try {
  Write-Host '============================================'
  Write-Host ' Shop Manager - Update'
  Write-Host '============================================'
  Say " Folder: $root"

  # ---- 1. Node ----
  Step 1 'Checking Node.js'
  if (-not (Use-RuntimeNode $root) -and -not (Test-NodeAvailable)) {
    Say '  This folder has no Node.js yet. Getting it now (run Setup.bat if this is a brand-new install).'
    Install-RuntimeNode $root
    [void](Use-RuntimeNode $root)
  }
  Say ("  Using Node.js " + (& node --version))

  # ---- 2. git pull (optional) ----
  Step 2 'Looking for a newer version'
  if (-not $NoGit -and (Test-Path (Join-Path $root '.git')) -and (Get-Command git -ErrorAction SilentlyContinue)) {
    $dirty = (& git status --porcelain)
    if ($dirty) { Say '  This folder has local changes, so it was not updated with git. (Skipping git pull.)' }
    else {
      & git pull --ff-only
      if ($LASTEXITCODE -ne 0) { Say '  git pull did not work; continuing with the files that are here.' }
    }
  } else { Say '  Using the files that are in this folder (unzip the new version over it first).' }

  # ---- 3. Backup ----
  Step 3 'Backing up your data first'
  $dbFile = Join-Path $root 'data\dp-erp.db'
  $env:DB_PATH = './data/dp-erp.db'
  if ((Test-Path $dbFile) -and ((Get-Item $dbFile).Length -gt 0)) {
    if (-not (Test-Path (Join-Path $root 'node_modules'))) {
      Say '  (Installing the app files first so the backup tool can run.)'
      Invoke-Step 'Installing the app files (npm ci)' { & npm ci }
    }
    & npm run db:backup
    if ($LASTEXITCODE -ne 0) {
      throw 'The backup did not finish, so the update was NOT done. Your shop data and the running app are unchanged. See docs\BACKUP.md, or ask for help.'
    }
  } else { Say '  No shop database here yet - nothing to back up.' }

  # ---- 4. Stop ----
  Step 4 'Stopping the app for a moment'
  & powershell -NoProfile -ExecutionPolicy Bypass -File "$root\batch\stop-server.ps1"
  if ($LASTEXITCODE -eq 2) { throw 'Something is still using the app''s port. Restart the PC, then run Update.bat again.' }

  # ---- 5. Install + build ----
  Step 5 'Installing and building the new version (a few minutes)'
  if ($SkipInstall) { Say '  Skipped (-SkipInstall).' } else {
    Invoke-Step 'Installing the app files (npm ci)' { & npm ci }
    Invoke-Step 'Building the app (npm run build)' { & npm run build }
  }

  # ---- 6. Start ----
  Step 6 'Starting the app'
  if ($NoStart) { Say '  Skipped (-NoStart).'; exit 0 }
  & wscript.exe //nologo "$root\batch\start-hidden.vbs" fast noopen
  & powershell -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\open-when-ready.ps1"
  Write-Host ''
  Write-Host ' Update finished. Shop Manager is running the new version.' -ForegroundColor Green
  exit 0
} catch {
  Write-Host ''
  Write-Host ('Update stopped: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
