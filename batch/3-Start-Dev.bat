@echo off
title Shop Manager - Dev Server
cd /d "%~dp0.."
echo ============================================
echo  Shop Manager - Starting (development)
echo  Database: data\demo.db  (DEMO practice data - fill it with 2-Seed-Database.bat)
echo  Opening http://localhost:5173 ...
echo  Close this window to stop the app.
echo ============================================
rem Development always runs on the demo database, never the real one (ADR 0008).
set DB_PATH=./data/demo.db
start "" cmd /c "timeout /t 6 /nobreak >nul & start http://localhost:5173"
call npm run dev
pause
