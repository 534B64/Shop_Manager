@echo off
title Shop Manager - Production Server
cd /d "%~dp0.."
echo ============================================
echo  Shop Manager - Building and starting (production)
echo  Single server on http://localhost:3000
echo  Close this window to stop the app.
echo ============================================
call npm run build
set NODE_ENV=production
start "" cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:3000"
call npm start
pause
