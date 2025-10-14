# six-webview2 launcher (temporary: Edge app mode)
param(
  [string]$File = "_six.html"
)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$index = Join-Path $here $File

# Use Edge in app mode to approximate a WebView2 host
$edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
if (!(Test-Path $edge)) { $edge = "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe" }

if (Test-Path $edge) {
  Start-Process -FilePath $edge -ArgumentList "--app=file:///$index" -WorkingDirectory $here
} else {
  Write-Host "Edge not found. Open $index manually."
}
