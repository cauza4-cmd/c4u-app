@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title C4U APP - Gerar Instalador Teste

echo ============================================
echo   C4U APP - GERAR INSTALADOR WINDOWS TESTE
echo ============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Node.js nao foi encontrado neste computador.
  echo Instale o Node.js LTS e execute este arquivo novamente.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERRO] npm nao foi encontrado neste computador.
  pause
  exit /b 1
)

echo [1/2] Preparando dependencias...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo [ERRO] Nao foi possivel instalar as dependencias.
  pause
  exit /b 1
)

echo.
echo [2/2] Gerando C4U APP Setup.exe...
call npm run build:win
if errorlevel 1 (
  echo.
  echo [ERRO] A compilacao nao foi concluida.
  pause
  exit /b 1
)

echo.
echo ============================================
echo INSTALADOR GERADO COM SUCESSO
echo ============================================
echo.
echo Abra a pasta DIST.
echo O instalador tera nome parecido com:
echo C4U-APP-Setup-14.3.0-test.1.exe
echo.
start "" "%~dp0dist"
pause
