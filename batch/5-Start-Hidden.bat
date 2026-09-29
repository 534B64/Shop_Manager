@echo off
rem Launches the production server with NO visible window, then opens the browser.
rem It rebuilds first (about a minute); the desktop "Start Shop Manager" shortcut skips that.
rem Use 6-Stop-Hidden.bat to shut it down.
start "" wscript.exe "%~dp0start-hidden.vbs"
