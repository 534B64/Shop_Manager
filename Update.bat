@echo off
title Shop Manager - Update
cd /d "%~dp0"
echo.
echo  Shop Manager update. Unzip the new version over this folder first, then this runs.
echo  Your shop data is backed up first and is never changed.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup\update.ps1" %*
echo.
pause
