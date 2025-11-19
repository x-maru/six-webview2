# six wrapper to show message box on abnormal termination
param(
  [Parameter(Position=0, ValueFromRemainingArguments=$true)]
  [string[]]$Args
)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $here 'six.ps1'
if (-not (Test-Path $script)){
  Add-Type -AssemblyName PresentationFramework -ErrorAction SilentlyContinue
  [System.Windows.MessageBox]::Show("six.ps1 not found in: $here","six",'OK','Error') | Out-Null
  exit 1
}
# Prepare lightweight logging to TEMP and force non-terminating errors to throw
$start = Get-Date
$LogPath = Join-Path $env:TEMP ('six-launch-' + (Get-Date -Format yyyyMMdd_HHmmss) + '.log')
try { Start-Transcript -Path $LogPath -Append -ErrorAction SilentlyContinue | Out-Null } catch {}
$oldEap = $ErrorActionPreference
$ErrorActionPreference = 'Stop'
try {
  & $script @Args
} catch {
  $err = $_
  try {
    "[ERROR] $(Get-Date -Format o)" | Out-File -FilePath $LogPath -Append -Encoding UTF8
    ($err | Format-List * -Force | Out-String) | Out-File -FilePath $LogPath -Append -Encoding UTF8
    if ($err.ScriptStackTrace) { "ScriptStackTrace:\n$($err.ScriptStackTrace)" | Out-File -FilePath $LogPath -Append -Encoding UTF8 }
  } catch {}
  try { Add-Type -AssemblyName PresentationFramework -ErrorAction SilentlyContinue } catch {}
  [System.Windows.MessageBox]::Show(("six launch failed:\n{0}\n\nSee log:\n{1}" -f $err.Exception.Message,$LogPath), "six", 'OK','Error') | Out-Null
  exit 1
} finally {
  $ErrorActionPreference = $oldEap
  try { Stop-Transcript -ErrorAction SilentlyContinue | Out-Null } catch {}
}
$elapsed = (Get-Date) - $start
$launched = $global:SixLaunched
if (-not $launched -and $elapsed.TotalSeconds -lt 2){
  try { Add-Type -AssemblyName PresentationFramework -ErrorAction SilentlyContinue } catch {}
  [System.Windows.MessageBox]::Show(("six did not start properly.\nRun the 'six (debug)' shortcut for details.\n\nLog (if any):\n{0}" -f $LogPath), "six", 'OK','Warning') | Out-Null
}

# Keep visible briefly to reduce flicker when launched via shortcut
Start-Sleep -Milliseconds 300
