' IsiPrime - Detener servidor reproductor (puerto 8080)
' No afecta al Batch Converter (puerto 3333)

Set WshShell = CreateObject("WScript.Shell")

' Buscar y matar solo el proceso en puerto 8080
' Usamos PowerShell para encontrar el PID del proceso en ese puerto
WshShell.Run "powershell -Command ""$p = Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess; if ($p) { Stop-Process -Id $p -Force }""", 0, True

MsgBox "Servidor IsiPrime (reproductor) detenido." & vbCrLf & "El Batch Converter sigue activo si estaba ejecutandose.", vbInformation, "IsiPrime"
