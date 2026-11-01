$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$destination = Join-Path $root 'client/electron/.icons'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$source = [System.Drawing.Image]::FromFile((Join-Path $root 'client/electron/assets/icon.png'))
$bitmap = New-Object System.Drawing.Bitmap 256, 256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$png = New-Object System.IO.MemoryStream
try {
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.DrawImage($source, 0, 0, 256, 256)
  $bitmap.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $png.ToArray()
  $stream = [System.IO.File]::Create((Join-Path $destination 'icon.ico'))
  $writer = New-Object System.IO.BinaryWriter $stream
  try {
    # ICO header and one 256px PNG image entry; source artwork stays unchanged.
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
    $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
    $writer.Write([uint16]1); $writer.Write([uint16]32)
    $writer.Write([uint32]$bytes.Length); $writer.Write([uint32]22); $writer.Write($bytes)
  } finally { $writer.Dispose(); $stream.Dispose() }
} finally { $png.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $source.Dispose() }
