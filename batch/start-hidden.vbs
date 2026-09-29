' Runs Decals Plus Shop Manager invisibly (production mode on port 3000).
' Starting means RESTARTING: build the latest client, stop the copy that is already
' running from this folder, then start a fresh one - so an old server can never keep running
' behind a new build. Server output goes to data\logs\server-<date>.log.
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

' 2. Stop the Shop Manager server that is still running from this folder (same as
'    6-Stop-Hidden.bat) and wait until port 3000 is free. Exit code 2 = the port is still busy.
stopCode = sh.Run("powershell -NoProfile -ExecutionPolicy Bypass -File """ & root & "\batch\stop-server.ps1""", 0, True)
If stopCode = 2 Then
  MsgBox "Something is still using port 3000, so Shop Manager could not start." & vbCrLf & _
         "Run 6-Stop-Hidden.bat, or restart the PC, then try again.", vbExclamation, "Shop Manager"
  WScript.Quit 1
End If

' 3. Start the server, hidden, with its output in data\logs\server-<date>.log.
'    Same settings as 4-Start-Production.bat: the real database, daily backup at 2 AM (docs\BACKUP.md).
If Not fso.FolderExists(root & "\data") Then fso.CreateFolder root & "\data"
If Not fso.FolderExists(root & "\data\logs") Then fso.CreateFolder root & "\data\logs"
d = Now
logRel = "data\logs\server-" & Year(d) & "-" & Right("0" & Month(d), 2) & "-" & Right("0" & Day(d), 2) & ".log"
sh.Run "cmd /c set NODE_ENV=production&& set DB_PATH=./data/dp-erp.db&& set BACKUP_HOUR=2&& npx tsx server/index.ts >> " & logRel & " 2>&1", 0, False

' 4. Wait up to 30 seconds for the app to answer, then open it.
ok = False
On Error Resume Next
For i = 1 To 30
  WScript.Sleep 1000
  Set http = CreateObject("MSXML2.ServerXMLHTTP")
  http.setTimeouts 1000, 1000, 1000, 1000
  http.open "GET", "http://localhost:3000/api/health", False
  http.send
  If Err.Number = 0 Then
    If http.Status = 200 Then ok = True
  End If
  Err.Clear
  If ok Then Exit For
Next
On Error GoTo 0

If ok Then
  sh.Run "http://localhost:3000"
Else
  MsgBox "Shop Manager did not start within 30 seconds." & vbCrLf & _
         "Look at the newest file in:" & vbCrLf & root & "\data\logs" & vbCrLf & _
         "(or run 4-Start-Production.bat to watch it start).", vbExclamation, "Shop Manager"
End If
