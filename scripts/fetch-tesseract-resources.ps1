# Download Tesseract + eng.traineddata into src-tauri/resources/tesseract/
# so the cross-platform OCR engine works without any user-side install.
#
# Usage:
#   pwsh ./scripts/fetch-tesseract-resources.ps1
#   pwsh ./scripts/fetch-tesseract-resources.ps1 -TessdataOnly
#
# This script targets Windows dev hosts. On macOS / Linux use the bash version.

[CmdletBinding()]
param(
    [switch]$TessdataOnly,
    [string]$WinVersion = "5.5.0.20241111"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RootDir = Resolve-Path (Join-Path $ScriptDir "..")
$TessDir = Join-Path $RootDir "src-tauri/resources/tesseract"
$TessdataDir = Join-Path $TessDir "tessdata"
$WindowsDir = Join-Path $TessDir "windows-x64"
$TessdataUrl = "https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata"
$WinInstallerUrl = "https://digi.bib.uni-mannheim.de/tesseract/tesseract-ocr-w64-setup-$WinVersion.exe"

New-Item -ItemType Directory -Force -Path $TessdataDir, $WindowsDir | Out-Null

function Get-FileWithProgress {
    param([string]$Url, [string]$Destination)
    Write-Host "→ Downloading $(Split-Path -Leaf $Destination) ..."
    Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing
}

function Resolve-7zip {
    foreach ($candidate in @(
        "C:\Program Files\7-Zip\7z.exe",
        "C:\Program Files (x86)\7-Zip\7z.exe"
    )) {
        if (Test-Path $candidate) { return $candidate }
    }
    $cmd = Get-Command "7z" -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

function Get-Tessdata {
    $target = Join-Path $TessdataDir "eng.traineddata"
    if (Test-Path $target) {
        Write-Host "✓ tessdata/eng.traineddata already present (delete to re-download)"
        return
    }
    Get-FileWithProgress -Url $TessdataUrl -Destination $target
}

function Get-WindowsTesseract {
    $sevenzip = Resolve-7zip
    if (-not $sevenzip) {
        Write-Error @"
Extracting the Tesseract NSIS installer requires 7-Zip. Install via:

  • winget install 7zip.7zip
  • or download from https://www.7-zip.org/

Re-run this script after 7-Zip is on PATH or installed in the standard location.
"@
    }

    $tmp = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ("voxjot-tess-" + [Guid]::NewGuid().ToString())) -Force
    try {
        $installer = Join-Path $tmp.FullName "tesseract-installer.exe"
        Get-FileWithProgress -Url $WinInstallerUrl -Destination $installer

        Write-Host "→ Extracting Windows tesseract..."
        $extracted = Join-Path $tmp.FullName "extracted"
        & $sevenzip "x" "-y" "-o$extracted" $installer | Out-Null

        $tessExe = Get-ChildItem -Path $extracted -Recurse -Filter "tesseract.exe" -File |
            Select-Object -First 1
        if (-not $tessExe) {
            throw "Could not locate tesseract.exe after extraction."
        }
        $srcDir = $tessExe.DirectoryName

        Get-ChildItem -Path $WindowsDir -Filter *.exe | Remove-Item -Force -ErrorAction SilentlyContinue
        Get-ChildItem -Path $WindowsDir -Filter *.dll | Remove-Item -Force -ErrorAction SilentlyContinue

        Copy-Item -Path $tessExe.FullName -Destination (Join-Path $WindowsDir "tesseract.exe") -Force
        Get-ChildItem -Path $srcDir -Filter *.dll -File | ForEach-Object {
            Copy-Item -Path $_.FullName -Destination (Join-Path $WindowsDir $_.Name) -Force
        }

        Write-Host "✓ Windows tesseract installed at $WindowsDir"
    }
    finally {
        Remove-Item -Path $tmp.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Get-Tessdata
if (-not $TessdataOnly) {
    Get-WindowsTesseract
}

Write-Host ""
Write-Host "Done. Bundled assets live under:"
Write-Host "  $TessDir"
