@echo off
chcp 65001 >nul
title BenoSoft Server
cd /d "%~dp0"
echo ==========================================
echo   Starting BenoSoft Server...
echo ==========================================
echo.
set PORT=5173
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  echo Install Node.js from https://nodejs.org then try again.
  echo.
  pause
  exit /b 1
)
start "" http://localhost:%PORT%
node server.js
echo.
echo Server stopped.
pause