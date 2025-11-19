@echo off
setlocal

REM Resolve script directory (contains six.ps1 and other files)
set "SCRIPT_DIR=%~dp0"

REM Find Windows PowerShell path dynamically (prefer system path)
set "PS_DEFAULT=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "PS_EXE="
if exist "%PS_DEFAULT%" (
  set "PS_EXE=%PS_DEFAULT%"
) else (
  for /f "usebackq delims=" %%P in (`where powershell.exe 2^>NUL`) do (
    if not defined PS_EXE set "PS_EXE=%%P"
  )
)
if not defined PS_EXE (
  echo ERROR: powershell.exe not found.>&2
  exit /b 1
)

REM Let PowerShell resolve the Desktop path internally (avoid CMD for /f quoting issues)
set "DESKTOP_DIR="

REM Build a temporary PowerShell script to avoid complex CMD quoting issues
set "TMP_PS=%TEMP%\six_install_%RANDOM%%RANDOM%.ps1"
> "%TMP_PS%" echo Param([string]$PsPath, [string]$ScriptDir, [string]$Desktop)
>> "%TMP_PS%" echo $w = New-Object -ComObject WScript.Shell
>> "%TMP_PS%" echo if (-not $Desktop -or $Desktop.Trim() -eq '') { $Desktop = [Environment]::GetFolderPath('Desktop') }
>> "%TMP_PS%" echo $ln = Join-Path $Desktop 'six.lnk'
>> "%TMP_PS%" echo $s  = $w.CreateShortcut($ln)
>> "%TMP_PS%" echo $s.TargetPath       = $PsPath
>> "%TMP_PS%" echo $six = Join-Path $ScriptDir 'six_wrap.ps1'
>> "%TMP_PS%" echo $s.Arguments        = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + $six + '"'
>> "%TMP_PS%" echo $s.WorkingDirectory = $ScriptDir
>> "%TMP_PS%" echo $s.WindowStyle = 7  # 7=Minimized
>> "%TMP_PS%" echo $s.Save()
>> "%TMP_PS%" echo Write-Host ('Shortcut created: ' ^+ $ln)

REM Avoid trailing backslash breaking quoted args: append a dot if path ends with '\'
set "PASS_SCRIPT_DIR=%SCRIPT_DIR%"
if "%PASS_SCRIPT_DIR:~-1%"=="\" set "PASS_SCRIPT_DIR=%PASS_SCRIPT_DIR%."
REM Pass empty Desktop arg to let PS compute it safely
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%TMP_PS%" "%PS_EXE%" "%PASS_SCRIPT_DIR%" ""
set "RC=%ERRORLEVEL%"
del /q "%TMP_PS%" >NUL 2>&1

exit /b %RC%
