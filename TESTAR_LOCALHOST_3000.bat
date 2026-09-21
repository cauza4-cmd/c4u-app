@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title C4U - Teste local porta 3000
set "PORT=3000"
set "HOST=127.0.0.1"
where node >nul 2>&1 || (echo Instale Node.js antes de iniciar.& pause & exit /b 1)
if not exist "node_modules\express" (
  echo Instalando dependencias do C4U...
  call npm install --omit=dev --no-audit --no-fund || (echo Erro no npm install.& pause & exit /b 1)
)
echo Abra no navegador: http://localhost:3000
echo Para encerrar, use Ctrl+C.
node server.js
pause
