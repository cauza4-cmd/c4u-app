@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title C4U APP - Teste Electron
where npm >nul 2>&1 || (echo npm nao encontrado.& pause & exit /b 1)
if not exist node_modules (
  echo Preparando dependencias pela primeira vez...
  call npm install --no-audit --no-fund || (pause & exit /b 1)
)
call npm start
