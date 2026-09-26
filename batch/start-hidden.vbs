' Runs Decals Plus Shop Manager invisibly (production mode on port 3000).
' Stop it with 6-Stop-Hidden.bat.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Project root = parent of this script's folder
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = root

' Build the client (first run / after updates), then start the server — all hidden.
' The "0" means: no window. "False" means: don't wait here.
' Same as 4-Start-Production.bat: the real database, daily backup at 2 AM (docs\BACKUP.md).
sh.Run "cmd /c npm run build && set NODE_ENV=production&& set DB_PATH=./data/dp-erp.db&& set BACKUP_HOUR=2&& npx tsx server/index.ts", 0, False

' Give it time to build + boot, then open the app.
WScript.Sleep 15000
sh.Run "http://localhost:3000"
