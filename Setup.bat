@echo off
title Shop Manager - Setup
cd /d "%~dp0"
echo.
echo  Shop Manager setup. This takes a few minutes and needs internet.
echo  You can run it again at any time - it will not touch your shop data.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup\setup.ps1" %*
echo.
pause
