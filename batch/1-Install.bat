@echo off
title Shop Manager - Install
cd /d "%~dp0.."
echo ============================================
echo  Shop Manager - Installing dependencies
echo ============================================
call npm install
echo.
echo Done. Next:
echo   - to practice with FAKE data:  2-Seed-Database.bat, then 3-Start-Dev.bat
echo   - to set up the REAL shop:     8-Init-Production.bat, then 4-Start-Production.bat
pause
