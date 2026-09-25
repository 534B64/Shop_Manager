@echo off
title Shop Manager - Install
cd /d "%~dp0.."
echo ============================================
echo  Shop Manager - Installing dependencies
echo ============================================
call npm install
echo.
echo Done. Next: double-click 2-Seed-Database.bat
pause
