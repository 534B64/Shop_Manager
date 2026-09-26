@echo off
title Shop Manager - Production Server
cd /d "%~dp0.."
echo ============================================
echo  Shop Manager - Building and starting (production)
echo  Single server on http://localhost:3000
echo  Database: data\dp-erp.db (the REAL shop database)
echo  Daily backup at 2 AM into data\backups (see docs\BACKUP.md)
echo  Close this window to stop the app.
echo ============================================
call npm run build
set NODE_ENV=production
set DB_PATH=./data/dp-erp.db
if not defined BACKUP_HOUR set BACKUP_HOUR=2
start "" cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:3000"
call npm start
pause
