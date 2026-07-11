@echo off
cd /d "%~dp0"

if not exist node_modules (
    echo Installing required packages, please wait...
    call npm install
    if errorlevel 1 (
        echo.
        echo npm install FAILED. Make sure Node.js is installed correctly.
        echo.
        pause
        exit /b 1
    )
)

echo.
echo Starting local scanner service...
echo Keep this window open, then go back to the website.
echo.
node server.js
pause
