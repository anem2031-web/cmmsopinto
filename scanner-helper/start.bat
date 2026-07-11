@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
    echo تثبيت المكتبات المطلوبة لأول مرة...
    call npm install
)
echo.
echo تشغيل خدمة السكانر المحلية...
echo سيب النافذة دي شغّالة وارجع للموقع.
echo.
node server.js
pause
