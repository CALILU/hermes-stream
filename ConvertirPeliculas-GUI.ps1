# IsiPrime Batch Converter - GUI
# Selecciona una carpeta graficamente y convierte AVI/MKV a MP4

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Crear formulario
$form = New-Object System.Windows.Forms.Form
$form.Text = "IsiPrime Batch Converter"
$form.Size = New-Object System.Drawing.Size(500, 400)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(248, 250, 252)

# Titulo
$title = New-Object System.Windows.Forms.Label
$title.Text = "IsiPrime Batch Converter"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::FromArgb(99, 102, 241)
$title.Location = New-Object System.Drawing.Point(20, 20)
$title.Size = New-Object System.Drawing.Size(450, 35)
$form.Controls.Add($title)

# Subtitulo
$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "Convierte archivos AVI/MKV a MP4 con aceleracion GPU"
$subtitle.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$subtitle.ForeColor = [System.Drawing.Color]::Gray
$subtitle.Location = New-Object System.Drawing.Point(20, 55)
$subtitle.Size = New-Object System.Drawing.Size(450, 20)
$form.Controls.Add($subtitle)

# Grupo de carpeta
$groupFolder = New-Object System.Windows.Forms.GroupBox
$groupFolder.Text = "Carpeta de peliculas"
$groupFolder.Location = New-Object System.Drawing.Point(20, 90)
$groupFolder.Size = New-Object System.Drawing.Size(445, 70)
$form.Controls.Add($groupFolder)

# TextBox carpeta
$txtFolder = New-Object System.Windows.Forms.TextBox
$txtFolder.Location = New-Object System.Drawing.Point(15, 30)
$txtFolder.Size = New-Object System.Drawing.Size(330, 25)
$txtFolder.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$groupFolder.Controls.Add($txtFolder)

# Boton seleccionar
$btnBrowse = New-Object System.Windows.Forms.Button
$btnBrowse.Text = "Examinar..."
$btnBrowse.Location = New-Object System.Drawing.Point(355, 28)
$btnBrowse.Size = New-Object System.Drawing.Size(80, 28)
$btnBrowse.FlatStyle = "Flat"
$btnBrowse.BackColor = [System.Drawing.Color]::FromArgb(99, 102, 241)
$btnBrowse.ForeColor = [System.Drawing.Color]::White
$groupFolder.Controls.Add($btnBrowse)

# Opciones
$groupOptions = New-Object System.Windows.Forms.GroupBox
$groupOptions.Text = "Opciones"
$groupOptions.Location = New-Object System.Drawing.Point(20, 170)
$groupOptions.Size = New-Object System.Drawing.Size(445, 110)
$form.Controls.Add($groupOptions)

# Checkbox eliminar originales
$chkDelete = New-Object System.Windows.Forms.CheckBox
$chkDelete.Text = "Eliminar archivos originales despues de convertir"
$chkDelete.Location = New-Object System.Drawing.Point(15, 25)
$chkDelete.Size = New-Object System.Drawing.Size(300, 25)
$chkDelete.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$groupOptions.Controls.Add($chkDelete)

# Checkbox arreglar MP4 con audio bajo
$chkFixAudio = New-Object System.Windows.Forms.CheckBox
$chkFixAudio.Text = "Arreglar MP4 con audio bajo (<=200 kbps)"
$chkFixAudio.Location = New-Object System.Drawing.Point(15, 55)
$chkFixAudio.Size = New-Object System.Drawing.Size(300, 25)
$chkFixAudio.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$chkFixAudio.Checked = $true
$groupOptions.Controls.Add($chkFixAudio)

# ComboBox GPU
$lblGpu = New-Object System.Windows.Forms.Label
$lblGpu.Text = "GPU:"
$lblGpu.Location = New-Object System.Drawing.Point(320, 27)
$lblGpu.Size = New-Object System.Drawing.Size(35, 20)
$groupOptions.Controls.Add($lblGpu)

$cmbGpu = New-Object System.Windows.Forms.ComboBox
$cmbGpu.Location = New-Object System.Drawing.Point(355, 24)
$cmbGpu.Size = New-Object System.Drawing.Size(80, 25)
$cmbGpu.DropDownStyle = "DropDownList"
$cmbGpu.Items.AddRange(@("Auto", "NVIDIA", "Intel", "AMD", "CPU"))
$cmbGpu.SelectedIndex = 0
$groupOptions.Controls.Add($cmbGpu)

# Boton iniciar
$btnStart = New-Object System.Windows.Forms.Button
$btnStart.Text = "Iniciar Conversion"
$btnStart.Location = New-Object System.Drawing.Point(20, 300)
$btnStart.Size = New-Object System.Drawing.Size(445, 40)
$btnStart.Font = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
$btnStart.FlatStyle = "Flat"
$btnStart.BackColor = [System.Drawing.Color]::FromArgb(34, 197, 94)
$btnStart.ForeColor = [System.Drawing.Color]::White
$form.Controls.Add($btnStart)

# Evento seleccionar carpeta
$btnBrowse.Add_Click({
    $folderBrowser = New-Object System.Windows.Forms.FolderBrowserDialog
    $folderBrowser.Description = "Selecciona la carpeta con peliculas AVI/MKV"
    $folderBrowser.ShowNewFolderButton = $false

    if ($folderBrowser.ShowDialog() -eq "OK") {
        $txtFolder.Text = $folderBrowser.SelectedPath
    }
})

# Evento iniciar conversion
$btnStart.Add_Click({
    if ([string]::IsNullOrWhiteSpace($txtFolder.Text)) {
        [System.Windows.Forms.MessageBox]::Show(
            "Por favor, selecciona una carpeta con peliculas.",
            "Carpeta requerida",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )
        return
    }

    if (-not (Test-Path $txtFolder.Text)) {
        [System.Windows.Forms.MessageBox]::Show(
            "La carpeta especificada no existe.",
            "Error",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        )
        return
    }

    # Obtener rutas
    $scriptPath = Split-Path -Parent $PSCommandPath
    $converterPath = Join-Path $scriptPath "batch-converter.js"
    $folderPath = $txtFolder.Text

    # GPU
    $gpuMap = @{
        "Auto" = "auto"
        "NVIDIA" = "nvidia"
        "Intel" = "intel"
        "AMD" = "amd"
        "CPU" = "none"
    }
    $gpuOption = $gpuMap[$cmbGpu.SelectedItem]

    # Construir argumentos
    $extraArgs = ""
    if ($chkDelete.Checked) {
        $extraArgs += " --delete"
    }
    if (-not $chkFixAudio.Checked) {
        $extraArgs += " --no-fix-audio"
    }

    # Crear archivo batch temporal para evitar problemas de escape
    $tempBat = Join-Path $env:TEMP "isiprime_convert.bat"
    $batContent = "@echo off`r`ncd /d `"$scriptPath`"`r`nnode `"$converterPath`" `"$folderPath`"$extraArgs --gpu=$gpuOption`r`npause"
    [System.IO.File]::WriteAllText($tempBat, $batContent)

    # Ejecutar
    Start-Process "cmd.exe" -ArgumentList "/c `"$tempBat`""
})

# Mostrar formulario
$form.ShowDialog() | Out-Null
