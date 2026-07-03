@echo off
title Shop Manager - Dev Server
cd /d "%~dp0.."
echo ============================================
echo  Shop Manager - Starting (development)
echo  Opening http://localhost:5173 ...
echo  Close this window to stop the app.
echo ============================================
start "" cmd /c "timeout /t 6 /nobreak >nul & start http://localhost:5173"
call npm run dev
pause
