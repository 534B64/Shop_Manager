@echo off
title Shop Manager - Production Server
cd /d "%~dp0.."
echo ============================================
echo  Shop Manager - Restarting (production): stops any running copy,
echo  builds the latest, then starts it
echo  Single server on http://localhost:3000
echo  Database: data\dp-erp.db (the REAL shop database)
echo  Daily backup at 2 AM into data\backups (see docs\BACKUP.md)
echo  Close this window to stop the app.
echo ============================================
call npm run build
if errorlevel 1 (
  echo.
  echo  The build FAILED - read the message above. The running app, if any, was left alone.
  pause
  exit /b 1
)
echo Stopping any Shop Manager server that is already running...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-server.ps1"
if errorlevel 2 (
  echo.
  echo  Something is still using port 3000, so Shop Manager cannot start.
  echo  Run 6-Stop-Hidden.bat, or restart the PC, then try again.
  pause
  exit /b 1
)
set NODE_ENV=production
set DB_PATH=./data/dp-erp.db
if not defined BACKUP_HOUR set BACKUP_HOUR=2
rem Opens the browser once the app answers (up to 30 s); says so if it never does.
start "" powershell -NoProfile -Command "for($i=0;$i -lt 30;$i++){try{Invoke-WebRequest http://localhost:3000/api/health -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process http://localhost:3000; exit}catch{Start-Sleep 1}}; Add-Type -AssemblyName PresentationFramework; [void][Windows.MessageBox]::Show('Shop Manager did not start within 30 seconds. Look at the black window for the error message.','Shop Manager')"
call npm start
pause
