' HermesStream - Launcher silencioso
' Doble clic para abrir la aplicación
' El servidor se inicia oculto en segundo plano

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Obtener directorio del script
scriptPath = fso.GetParentFolderName(WScript.ScriptFullName)

' Verificar si el backend ya está corriendo (puerto 8080)
On Error Resume Next
Set http = CreateObject("MSXML2.XMLHTTP")
http.Open "GET", "http://localhost:8080/api/videos", False
http.Send
backendRunning = (http.Status = 200)
On Error GoTo 0

If Not backendRunning Then
    ' Iniciar backend oculto (sirve el frontend compilado desde my-ui/build)
    WshShell.Run "powershell -WindowStyle Hidden -Command ""cd '" & scriptPath & "'; node server.js""", 0, False

    ' Esperar a que el backend arranque
    WScript.Sleep 3000
End If

' Abrir navegador (puerto 8080 - backend sirve el frontend)
WshShell.Run "http://localhost:8080"
