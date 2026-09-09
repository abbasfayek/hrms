@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
chcp 65001 >nul
title BenoSoft - Go Online
color 0E
mode con: cols=85 lines=45

:menu
cls
echo.
echo   ====================================================
echo    BenoSoft - System access from anywhere
echo   ====================================================
echo.
echo    [1] Launch local server (port 5173)
echo    [2] Create a temporary public link (cloudflared)
echo    [3] Show Local Network IP
echo    [4] Exit
echo.
set /p CHOICE="   Choose an option (1-4): "

if "%CHOICE%"=="1" goto opt1
if "%CHOICE%"=="2" goto opt2
if "%CHOICE%"=="3" goto opt3
if "%CHOICE%"=="4" goto opt4
goto menu

:opt1
start "BenoSoft Server" /min node server.js
timeout /t 2 /nobreak >nul
start "" http://localhost:5173
echo.
echo   Server started. You can close this window.
timeout /t 3 /nobreak >nul
goto end

:opt2
set "CF="
if exist "%~dp0cloudflared.exe" set "CF=%~dp0cloudflared.exe"
where cloudflared >nul 2>nul && set "CF=cloudflared"
if defined CF goto starttunnel
cls
echo.
echo   cloudflared is not installed yet.
echo   It should be in this folder as: cloudflared.exe
echo.
echo   Download it free from GitHub Cloudflare releases,
echo   then put cloudflared-windows-amd64.exe in this
echo   folder and rename it to cloudflared.exe
echo.
pause
goto end

:starttunnel
echo.
echo   Starting the server...
start "BenoSoft Server" /min node server.js
del tunnel.log >nul 2>nul
timeout /t 3 /nobreak >nul
cls
echo   ====================================================
echo    Creating the public link... please wait.
echo    This window will open your browser automatically
echo    when the link is ready.
echo   ====================================================
echo.
echo   Tunnel running in a separate window. Keep this
echo   window and the BenoSoft Tunnel window open.
echo.
start "BenoSoft Tunnel" /min cmd /c ""%CF%" tunnel --url http://localhost:5173 --protocol http2 > tunnel.log 2>&1"
set /a WAITCNT=0

:waiturl
timeout /t 2 /nobreak >nul
findstr /r /c:"https://[a-z0-9-]*.trycloudflare.com" tunnel.log > tunnel_url.tmp 2>nul
if errorlevel 1 goto notyet
goto parsed

:notyet
set /a WAITCNT=WAITCNT+1
if !WAITCNT! GEQ 25 goto notun
goto waiturl

:parsed
for /f "tokens=3,4" %%a in (tunnel_url.tmp) do set "TUN=%%b"
if not defined TUN for /f "tokens=3" %%a in (tunnel_url.tmp) do set "TUN=%%a"
set "TUNURL=%TUN: =%"
echo.
echo   ====================================================
echo    PUBLIC LINK READY:
echo    %TUNURL%
echo   ====================================================
echo.
echo   Send this link to your people. Opening it asks for the
echo   access token (kept secret in data\access_token.json on this PC).
echo.
echo   Opening your browser now...
start "" "%TUNURL%"
echo.
pause
goto end

:notun
cls
echo.
echo   Could not get a public link after 50 seconds.
echo   Check your internet connection and try again.
echo   If it keeps failing, send me the contents of this
echo   window so I can fix it.
echo.
pause
goto end

:opt3
cls
echo.
echo   Other devices on the SAME network can open:
echo.
powershell.exe -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -notlike '127.*' | ForEach-Object { Write-Output ('   http://' + $_.IPAddress + ':5173') }"
echo.
pause
goto end

:opt4
goto end

:end
exit /b