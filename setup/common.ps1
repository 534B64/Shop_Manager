# Shared helpers for Setup.bat, Update.bat and the start scripts (dot-sourced: . "$PSScriptRoot\common.ps1").
# ASCII only on purpose: Windows PowerShell 5.1 reads BOM-less files as ANSI.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # the progress bar makes downloads very slow in PowerShell 5.1
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

$script:AppId = 'decals-plus-shop-manager'

function Get-ShopRoot { Split-Path -Parent $PSScriptRoot }

function Get-RuntimeNodeDir([string]$Root) { Join-Path $Root 'runtime\node' }

# Put the app's own Node first on PATH when it is installed. Returns $true if it was.
function Use-RuntimeNode([string]$Root) {
  $dir = Get-RuntimeNodeDir $Root
  if (Test-Path (Join-Path $dir 'node.exe')) {
    if (($env:PATH -split ';') -notcontains $dir) { $env:PATH = "$dir;$env:PATH" }
    return $true
  }
  return $false
}

function Test-NodeAvailable { return [bool](Get-Command node -ErrorAction SilentlyContinue) }

function Get-ShopEnvPath([string]$Root) { Join-Path $Root 'data\shop.env' }

# data\shop.env holds the shop's choices (SHOP_NAME, SHOP_HOSTNAME). The server reads SHOP_HOSTNAME from it.
function Read-ShopEnv([string]$Root) {
  $values = @{}
  $file = Get-ShopEnvPath $Root
  if (Test-Path $file) {
    foreach ($line in Get-Content $file) {
      if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$' -and -not $line.TrimStart().StartsWith('#')) {
        $values[$Matches[1]] = $Matches[2].Trim('"')
      }
    }
  }
  return $values
}

function Write-ShopEnv([string]$Root, [hashtable]$Values) {
  $file = Get-ShopEnvPath $Root
  New-Item -ItemType Directory -Force -Path (Split-Path $file) | Out-Null
  $lines = @('# Written by Setup.bat. Safe to delete; Setup asks again.')
  foreach ($k in ($Values.Keys | Sort-Object)) { $lines += ('{0}={1}' -f $k, $Values[$k]) }
  [IO.File]::WriteAllLines($file, $lines, (New-Object Text.UTF8Encoding($false)))
}

# "Decals Plus" -> "decalsplus". Lowercase letters, digits and hyphens only.
function ConvertTo-Hostname([string]$Text) {
  $s = ($Text.ToLower() -replace '[^a-z0-9]', '')
  if ($s.Length -gt 40) { $s = $s.Substring(0, 40) }
  if (-not $s) { $s = 'shop' }
  return $s
}

function Test-Hostname([string]$Name) { return [bool]($Name -match '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$') }

# The newest Node LTS in the 24.x line that has a Windows x64 zip (falls back to any LTS).
function Get-NodeLtsVersion {
  $index = Invoke-RestMethod -UseBasicParsing 'https://nodejs.org/dist/index.json'
  $lts = @($index | Where-Object { $_.lts -and ($_.files -contains 'win-x64-zip') })
  $pick = @($lts | Where-Object { $_.version -like 'v24.*' }) | Select-Object -First 1
  if (-not $pick) { $pick = $lts | Select-Object -First 1 }
  if (-not $pick) { throw 'Could not find a Node.js LTS download on nodejs.org.' }
  return [string]$pick.version
}

# Download Node from nodejs.org into <root>\runtime\node, checking the file against nodejs.org's SHA-256 list.
# No admin rights needed. Does nothing if it is already there.
function Install-RuntimeNode([string]$Root) {
  $dir = Get-RuntimeNodeDir $Root
  if (Test-Path (Join-Path $dir 'node.exe')) { Write-Host '  Node.js is already here. Skipping.'; return }
  $ver = Get-NodeLtsVersion
  $zipName = "node-$ver-win-x64.zip"
  $base = "https://nodejs.org/dist/$ver"
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('shop-node-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  try {
    Write-Host "  Downloading Node.js $ver (about 30 MB) from nodejs.org ..."
    $sums = (Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt").Content
    $line = ($sums -split "`n" | Where-Object { $_ -match ('\s' + [regex]::Escape($zipName) + '\s*$') } | Select-Object -First 1)
    if (-not $line) { throw "nodejs.org's checksum list does not include $zipName." }
    $expected = ($line.Trim() -split '\s+')[0].ToLower()
    $zip = Join-Path $tmp $zipName
    Invoke-WebRequest -UseBasicParsing "$base/$zipName" -OutFile $zip
    $actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
    if ($actual -ne $expected) { throw "The download is damaged or was changed on the way (checksum $actual, expected $expected). Nothing was installed." }
    Write-Host "  Checksum OK ($actual)."
    Write-Host '  Unpacking ...'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $out = Join-Path $tmp 'out'
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $out)
    $inner = Get-ChildItem $out -Directory | Select-Object -First 1
    New-Item -ItemType Directory -Force -Path (Split-Path $dir) | Out-Null
    if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
    Move-Item $inner.FullName $dir
    Write-Host "  Node.js $ver installed in $dir"
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}

# Run a program; stop with a plain message if it fails.
function Invoke-Step([string]$What, [scriptblock]$Do) {
  & $Do
  if ($LASTEXITCODE -ne 0) { throw "$What failed (see the messages above)." }
}

# Ask a question. Uses $Default when the answer is empty.
function Ask-Text([string]$Prompt, [string]$Default = '') {
  $suffix = if ($Default) { " [$Default]" } else { '' }
  $a = Read-Host "$Prompt$suffix"
  if ([string]::IsNullOrWhiteSpace($a)) { return $Default }
  return $a.Trim()
}

function Ask-YesNo([string]$Prompt, [bool]$Default = $true) {
  $hint = if ($Default) { 'Y/n' } else { 'y/N' }
  while ($true) {
    $a = (Read-Host "$Prompt ($hint)").Trim().ToLower()
    if (-not $a) { return $Default }
    if ($a -in 'y', 'yes') { return $true }
    if ($a -in 'n', 'no') { return $false }
    Write-Host '  Please type y or n.'
  }
}

# Ask the running server (any of the likely ports) who it is. Returns the health object, or $null.
function Get-ShopHealth([int[]]$Ports) {
  foreach ($p in $Ports) {
    try {
      $h = Invoke-RestMethod -UseBasicParsing -TimeoutSec 2 -Uri "http://127.0.0.1:$p/api/health"
      if ($h.app -eq $script:AppId) { return $h }
    } catch { }
  }
  return $null
}

function Get-LikelyPorts {
  if ($env:PORT) { return @([int]$env:PORT) }
  return @(80, 3000)
}
