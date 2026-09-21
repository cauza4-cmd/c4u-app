@echo off
chcp 65001 >nul
title C4U APP - SERVIDOR REDE LOCAL
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias pela primeira vez...
  call npm install
  if errorlevel 1 (
    echo.
    echo Nao foi possivel instalar as dependencias.
    pause
    exit /b 1
  )
)
echo.
echo ==============================================
echo C4U APP - SERVIDOR DA REDE LOCAL
echo ==============================================
echo Mantenha esta janela aberta durante o uso.
echo.
start "" http://localhost:3000
node server.js
pause
