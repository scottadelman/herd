@echo off
rem First-time setup: creates your GitHub repo and pushes the project, as you.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-github.ps1"
echo.
pause
