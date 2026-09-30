@echo off
title Shop Manager - Stop hidden server
echo Stopping the Shop Manager server...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-server.ps1"
echo Done.
pause
