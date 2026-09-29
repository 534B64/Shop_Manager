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
set NODE_ENV=production
set DB_PATH=./data/dp-erp.db
if not defined BACKUP_HOUR set BACKUP_HOUR=2
start "" cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:3000"
call npm start
pause
