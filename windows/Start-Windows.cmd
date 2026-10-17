@echo off
setlocal
cd /d "%~dp0code\desktop-pet"
where node.exe >nul 2>nul
if errorlevel 1 if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "PATH=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%PATH%"
where npm.cmd >nul 2>nul
if errorlevel 1 if exist "%~dp0..\.tooling\bin\npm.cmd" set "PATH=%~dp0..\.tooling\bin;%PATH%"
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Install Node.js LTS with npm, then open this shortcut again.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm.cmd ci
  if errorlevel 1 goto failed
)

rem ---------------------------------------------------------------------------
rem If this machine already has a prepared AND activated configuration, start the
rem real companion: licensed Live2D model, cloud dialogue, speech and the web
rem console. Only fall back to the offline echo preview when nothing is set up.
rem
rem Why this matters: the preview backend never sends a presentation policy, so
rem the model renders frozen, and it deliberately refuses to open the console.
rem ---------------------------------------------------------------------------
set "TRIAL=%~dp0.local\model-evaluation\trial\user-trial"
if exist "%TRIAL%\config.json" if exist "%TRIAL%\activation.json" (
  echo Starting AAAAGENT with your local configuration...
  call npm.cmd start
  if errorlevel 1 goto failed
  exit /b 0
)

echo No local configuration found - starting the offline development preview.
echo The model will stay still and the console is unavailable in this mode.
echo To set up the real companion, run:  npm.cmd run configure-local
call npm.cmd run dev
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo AAAAGENT could not start. See README-WINDOWS.md.
pause
exit /b 1
