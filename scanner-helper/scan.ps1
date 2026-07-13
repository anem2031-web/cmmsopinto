# ============================================================
# scan.ps1 - Drives the scanner via WIA (Windows Image Acquisition)
# and saves the scanned image as a JPEG file at the given path.
#
# Works with any scanner registered as a WIA device on Windows
# (includes Epson L6270 and most modern Epson/Canon/HP scanners).
#
# Usage: powershell -ExecutionPolicy Bypass -File scan.ps1 -OutputPath "C:\temp\scan.jpg"
# Output: a single JSON line on stdout:
#   {"success":true,"path":"..."} or {"success":false,"error":"..."}
# ============================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

function Write-Result($success, $data) {
    $result = @{ success = $success } + $data
    $result | ConvertTo-Json -Compress
}

try {
    $manager = New-Object -ComObject WIA.DeviceManager

    if ($manager.DeviceInfos.Count -eq 0) {
        Write-Result $false @{ error = "No scanner found. Make sure the scanner is powered on, connected, and visible in the Windows 'Fax and Scan' app." }
        exit 1
    }

    # Pick the first Scanner-type device (Type = 1) if multiple WIA devices exist
    # (e.g. a printer that also registers as a camera or fax device)
    $deviceInfo = $null
    for ($i = 1; $i -le $manager.DeviceInfos.Count; $i++) {
        $candidate = $manager.DeviceInfos.Item($i)
        if ($candidate.Type -eq 1) { $deviceInfo = $candidate; break }
    }
    if ($null -eq $deviceInfo) { $deviceInfo = $manager.DeviceInfos.Item(1) }

    $device = $deviceInfo.Connect()
    $item = $device.Items.Item(1)

    # Set scan settings (color, 300 DPI) - best-effort, ignore failures since
    # not every scanner supports every property
    function Set-WiaProperty($properties, $propId, $value) {
        try {
            foreach ($p in $properties) {
                if ($p.PropertyID -eq $propId) { $p.Value = $value; return }
            }
        } catch { }
    }

    Set-WiaProperty $item.Properties 6146 1     # Current Intent: 1 = Color
    Set-WiaProperty $item.Properties 6147 300   # Horizontal Resolution (DPI) - matches direct Windows scan quality; JPEG re-encode below keeps size small
    Set-WiaProperty $item.Properties 6148 300   # Vertical Resolution (DPI)

    # Standard WIA JPEG format GUID (note: many drivers ignore this and return BMP anyway)
    $wiaFormatJPEG = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}"
    $image = $item.Transfer($wiaFormatJPEG)

    # Remove any old file at this path first (WIA refuses to overwrite an existing file)
    if (Test-Path $OutputPath) { Remove-Item $OutputPath -Force }

    # ── Re-encode to a guaranteed-standard JPEG via .NET ──
    # WIA drivers often return BMP or non-standard JPEG regardless of the requested
    # format GUID. Server-side image libraries (e.g. sharp) then reject the upload
    # with "unsupported image format". Round-tripping through System.Drawing
    # guarantees a plain baseline JPEG and also keeps the file size reasonable.
    $rawPath = [System.IO.Path]::ChangeExtension($OutputPath, ".raw.tmp")
    if (Test-Path $rawPath) { Remove-Item $rawPath -Force }
    $image.SaveFile($rawPath)

    Add-Type -AssemblyName System.Drawing
    $bmp = [System.Drawing.Image]::FromFile($rawPath)
    try {
        $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
            Where-Object { $_.MimeType -eq "image/jpeg" }
        $encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
        $encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
            [System.Drawing.Imaging.Encoder]::Quality, [long]85)
        $bmp.Save($OutputPath, $jpegCodec, $encParams)
    }
    finally {
        $bmp.Dispose()
        Remove-Item $rawPath -Force -ErrorAction SilentlyContinue
    }

    Write-Result $true @{ path = $OutputPath }
}
catch {
    Write-Result $false @{ error = $_.Exception.Message }
    exit 1
}
