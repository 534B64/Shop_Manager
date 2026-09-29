@echo off
rem Used by the other batch files: use the app's own Node (runtime\node, installed by Setup.bat) when it is there.
if exist "%~dp0..\runtime\node\node.exe" set "PATH=%~dp0..\runtime\node;%PATH%"
