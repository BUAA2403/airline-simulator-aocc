@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-AOCC.ps1" -Open
if errorlevel 1 (
  echo.
  echo AOCC could not start. See the error above and .data\server-error.log.
  pause
  exit /b 1
)
endlocal
