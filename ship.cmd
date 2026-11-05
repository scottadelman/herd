@echo off
rem Commits and pushes the latest changes to GitHub, as you.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ship.ps1"
echo.
pause
