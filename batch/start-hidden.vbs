' Runs Decals Plus Shop Manager invisibly (production mode on port 3000).
' Starting means RESTARTING: build the latest client, stop any copy that is already
' running, then start a fresh one - so an old server can never keep running behind a new build.
' Stop it with 6-Stop-Hidden.bat.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Project root = parent of this script's folder
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = root

' 1. Build the client. The "0" means: no window. "True" means: wait for it to finish.
'    If the build fails the running app (if any) is left alone.
buildCode = sh.Run("cmd /c npm run build", 0, True)
If buildCode <> 0 Then
  MsgBox "Shop Manager could not be built (exit code " & buildCode & ")." & vbCrLf & _
         "The app that was already running, if any, was left alone." & vbCrLf & _
         "Run 4-Start-Production.bat to see the error message.", vbExclamation, "Shop Manager"
  WScript.Quit 1
End If

' 2. Stop any Shop Manager server that is still running (same as 6-Stop-Hidden.bat) and
'    wait until port 3000 is free.
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & root & "\batch\stop-server.ps1""", 0, True

' 3. Start the server, hidden. Same as 4-Start-Production.bat: the real database, daily backup at 2 AM (docs\BACKUP.md).
sh.Run "cmd /c set NODE_ENV=production&& set DB_PATH=./data/dp-erp.db&& set BACKUP_HOUR=2&& npx tsx server/index.ts", 0, False

' Give it time to boot, then open the app.
WScript.Sleep 6000
sh.Run "http://localhost:3000"
