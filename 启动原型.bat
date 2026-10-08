@echo off
chcp 65001 >nul
title 订单交付风险分析助手 V0.3
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Python，无法启动本地静态服务器。
  echo 请确认 Python 已安装并已加入 PATH。
  pause
  exit /b 1
)

netstat -ano | findstr /R /C:":4173 .*LISTENING" >nul
if not errorlevel 1 (
  echo [错误] 端口 4173 已被其他程序占用。
  echo 请关闭之前的原型服务窗口后重新双击本文件。
  pause
  exit /b 1
)

echo 正在启动订单交付风险分析助手 V0.3（P0 原型）...
echo 浏览器地址：http://127.0.0.1:4173/
echo.
echo 请保持此窗口打开；关闭窗口将停止原型服务。
echo.

start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; Start-Process 'http://127.0.0.1:4173/'"
python -m http.server 4173 --bind 127.0.0.1

echo.
echo 原型服务已停止。
pause
