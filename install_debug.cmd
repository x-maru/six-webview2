@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "PS_DEFAULT=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "PS_EXE="
if exist "%PS_DEFAULT%" ( set "PS_EXE=%PS_DEFAULT%" ) else (
  for /f "usebackq delims=" %%P in (`where powershell.exe 2^>NUL`) do if not defined PS_EXE set "PS_EXE=%%P"
)
if not defined PS_EXE ( echo ERROR: powershell.exe not found.>&2 & exit /b 1 )
set "TMP_PS=%TEMP%\six_install_dbg_%RANDOM%%RANDOM%.ps1"
> "%TMP_PS%" echo Param([string]$PsPath, [string]$ScriptDir)
>> "%TMP_PS%" echo $w = New-Object -ComObject WScript.Shell
>> "%TMP_PS%" echo $desktop = [Environment]::GetFolderPath('Desktop')
>> "%TMP_PS%" echo $ln = Join-Path $desktop 'six (debug).lnk'
>> "%TMP_PS%" echo $s  = $w.CreateShortcut($ln)
>> "%TMP_PS%" echo $cmdPath = $env:ComSpec; if (-not (Test-Path $cmdPath)) { $cmdPath = Join-Path $env:SystemRoot 'System32/cmd.exe' }
>> "%TMP_PS%" echo $s.TargetPath       = $cmdPath
>> "%TMP_PS%" echo $six = Join-Path $ScriptDir 'six.ps1'
>> "%TMP_PS%" echo $s.Arguments        = '/k "' + $PsPath + ' -NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + $six + '" -KeepOpen -ShowUrl -AllowMulti -InstanceTag debug -Diag"'
>> "%TMP_PS%" echo $s.WorkingDirectory = $ScriptDir
>> "%TMP_PS%" echo $s.Save()
>> "%TMP_PS%" echo Write-Host ('Debug shortcut created: ' ^+ $ln)

set "PASS_SCRIPT_DIR=%SCRIPT_DIR%"
if "%PASS_SCRIPT_DIR:~-1%"=="\" set "PASS_SCRIPT_DIR=%PASS_SCRIPT_DIR%."
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%TMP_PS%" "%PS_EXE%" "%PASS_SCRIPT_DIR%"
set "RC=%ERRORLEVEL%"
del /q "%TMP_PS%" >NUL 2>&1
exit /b %RC%
