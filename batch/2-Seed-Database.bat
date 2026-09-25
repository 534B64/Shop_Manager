@echo off
title Shop Manager - Seed Database
cd /d "%~dp0.."
echo ============================================
echo  Shop Manager - Creating database with sample data
echo ============================================
call npm run db:seed
echo.
echo Done. Next: double-click 3-Start-Dev.bat
pause
