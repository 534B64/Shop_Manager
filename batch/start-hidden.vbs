' Runs Decals Plus Shop Manager invisibly (production mode: http://<shopname>.local, or port 3000 if port 80 is busy).
' Starting means RESTARTING: build the latest client, stop the copy that is already
' running from this folder, then start a fresh one - so an old server can never keep running
' behind a new build. Server output goes to data\logs\server-<date>.log.
' Stop it with 6-Stop-Hidden.bat.
'   start-hidden.vbs            build, restart, open the browser when ready
'   start-hidden.vbs fast       skip the build (Setup/Update already built it)
'   start-hidden.vbs noopen     do not open the browser (used at Windows sign-in)
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

fast = False
noOpen = False
For Each a In WScript.Arguments
  If LCase(a) = "fast" Then fast = True
  If LCase(a) = "noopen" Then noOpen = True
Next

' Project root = parent of this script's folder
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = root

' Use the app's own Node (runtime\node, put there by Setup.bat) when it exists, else the PC's Node.
If fso.FileExists(root & "\runtime\node\node.exe") Then
  Set env = sh.Environment("PROCESS")
  env("PATH") = root & "\runtime\node;" & env("PATH")
End If

' 1. Build the client. The "0" means: no window. "True" means: wait for it to finish.
'    If the build fails the running app (if any) is left alone.
If Not (fast And fso.FileExists(root & "\dist\index.html")) Then
  buildCode = sh.Run("cmd /c npm run build", 0, True)
  If buildCode <> 0 Then
    MsgBox "Shop Manager could not be built (exit code " & buildCode & ")." & vbCrLf & _
           "The app that was already running, if any, was left alone." & vbCrLf & _
           "Run 4-Start-Production.bat to see the error message.", vbExclamation, "Shop Manager"
    WScript.Quit 1
  End If
End If

' 2. Stop the Shop Manager server that is still running from this folder (same as
'    6-Stop-Hidden.bat) and wait until its port is free. Exit code 2 = the port is still busy.
stopCode = sh.Run("powershell -NoProfile -ExecutionPolicy Bypass -File """ & root & "\batch\stop-server.ps1""", 0, True)
If stopCode = 2 Then
  MsgBox "Something is still using the port Shop Manager needs, so it could not start." & vbCrLf & _
         "Run 6-Stop-Hidden.bat, or restart the PC, then try again.", vbExclamation, "Shop Manager"
  WScript.Quit 1
End If

' 3. Start the server, hidden, with its output in data\logs\server-<date>.log.
'    Same settings as 4-Start-Production.bat: the real database, daily backup at 2 AM (docs\BACKUP.md).
'    The server picks port 80 (or PORT if set) and falls back to 3000; the shop name comes from data\shop.env.
If Not fso.FolderExists(root & "\data") Then fso.CreateFolder root & "\data"
If Not fso.FolderExists(root & "\data\logs") Then fso.CreateFolder root & "\data\logs"
d = Now
logRel = "data\logs\server-" & Year(d) & "-" & Right("0" & Month(d), 2) & "-" & Right("0" & Day(d), 2) & ".log"
sh.Run "cmd /c set NODE_ENV=production&& set DB_PATH=./data/dp-erp.db&& set BACKUP_HOUR=2&& npx tsx server/index.ts >> " & logRel & " 2>&1", 0, False

' 4. Open the browser once the app answers (says so if it never does).
If Not noOpen Then
  sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & root & "\setup\open-when-ready.ps1""", 0, False
End If
