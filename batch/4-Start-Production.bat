@echo off
title Shop Manager - Production Server
cd /d "%~dp0.."
call "%~dp0env.bat"
echo ============================================
echo  Shop Manager - Restarting (production): stops any running copy,
echo  builds the latest, then starts it
echo  Single server: http://YOURSHOPNAME.local  (port 80; falls back to port 3000 if 80 is busy)
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
  echo  Something is still using the port Shop Manager needs, so it cannot start.
  echo  Run 6-Stop-Hidden.bat, or restart the PC, then try again.
  pause
  exit /b 1
)
set NODE_ENV=production
set DB_PATH=./data/dp-erp.db
if not defined BACKUP_HOUR set BACKUP_HOUR=2
rem Opens the browser once the app answers (up to 45 s; on port 80, or 3000 if 80 was busy); says so if it never does.
start "" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\setup\open-when-ready.ps1"
call npm start
pause
