@echo off
title Shop Manager - Load DEMO (practice) data
cd /d "%~dp0.."
call "%~dp0env.bat"
echo ============================================
echo  Shop Manager - DEMO (practice) database
echo ============================================
echo.
echo  This fills data\demo.db with FAKE customers, jobs and demo accounts
echo  (Josiah 1234 / Amy 2222 / Sam 3333) for practice and testing.
echo.
echo  It never touches the real shop database (data\dp-erp.db), and it
echo  refuses to run on any database marked PRODUCTION.
echo  Setting up the REAL shop?  Close this and use 8-Init-Production.bat.
echo.
set CONFIRM=
set /p CONFIRM=Type DEMO and press Enter to continue (anything else cancels):
if /i not "%CONFIRM%"=="DEMO" (
  echo Cancelled - nothing was changed.
  pause
  exit /b 1
)
set DB_PATH=./data/demo.db
call npm run db:seed
if errorlevel 1 (
  echo.
  echo  REFUSED or FAILED - read the message above. Nothing real was touched.
  pause
  exit /b 1
)
echo.
echo Done. Next: double-click 3-Start-Dev.bat (it opens the demo database).
pause
