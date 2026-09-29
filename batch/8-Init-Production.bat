@echo off
title Shop Manager - Set up the REAL shop database
cd /d "%~dp0.."
call "%~dp0env.bat"
echo ============================================
echo  Shop Manager - REAL (production) database
echo ============================================
echo.
echo  Creates data\dp-erp.db for real sales: the price book and ONE admin
echo  account (you type the name and PIN). No sample data.
echo.
echo  It refuses if data\dp-erp.db already has anything in it. To start over,
echo  first move data\dp-erp.db (and dp-erp.db-wal / dp-erp.db-shm, if there)
echo  into another folder yourself. See docs\PRODUCTION-SETUP.md.
echo.
set DB_PATH=./data/dp-erp.db
call npm run db:init-prod
if errorlevel 1 (
  echo.
  echo  Nothing was set up - read the message above.
  pause
  exit /b 1
)
echo Next: double-click 4-Start-Production.bat. There must be NO "DEMO DATA" banner.
pause
