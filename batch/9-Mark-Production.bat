@echo off
title Shop Manager - Mark the existing database as REAL
cd /d "%~dp0.."
call "%~dp0env.bat"
echo ============================================
echo  Shop Manager - Mark your existing database as REAL
echo ============================================
echo.
echo  Your shop database (data\dp-erp.db) is already in use, but it was never
echo  labeled as the REAL one. This puts that label on it. The label makes the
echo  app refuse to load practice data into it, and makes Restore only accept
echo  real backups.
echo.
echo  It does NOT change any of your jobs, customers or payments, and you do
echo  not need to stop the app. It refuses if the database is already labeled.
echo  Do this once. Afterwards the Settings page called Shop shows
echo  "Production" under Data and backups.
echo.
set DB_PATH=./data/dp-erp.db
call npm run db:mark-production
if errorlevel 1 (
  echo.
  echo  Nothing was changed - read the message above.
  pause
  exit /b 1
)
pause
