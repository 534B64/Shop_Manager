@echo off
rem Launches the production server with NO visible window, then opens the browser.
rem Use 6-Stop-Hidden.bat to shut it down.
start "" wscript.exe "%~dp0start-hidden.vbs"
