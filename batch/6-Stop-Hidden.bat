@echo off
title Decals Plus - Stop hidden server
echo Stopping the hidden Shop Manager server...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*server/index.ts*' -or $_.CommandLine -like '*server\index.ts*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('Stopped PID ' + $_.ProcessId) }"
echo Done.
pause
