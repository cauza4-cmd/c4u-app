@echo off
chcp 65001 >nul
title C4U APP - Configurar Rede Local
cd /d "%~dp0"
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo O Windows vai pedir permissao de Administrador.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo.
echo Configurando Firewall do Windows para o C4U APP...
netsh advfirewall firewall delete rule name="C4U APP Rede Local" >nul 2>&1
netsh advfirewall firewall add rule name="C4U APP Rede Local" dir=in action=allow protocol=TCP localport=3000 profile=private
if errorlevel 1 (
  echo.
  echo Nao foi possivel criar a regra do Firewall.
  echo Verifique se sua rede Wi-Fi esta marcada como PRIVADA no Windows.
  pause
  exit /b 1
)
echo.
echo Regra criada com sucesso para a porta 3000 em redes PRIVADAS.
echo.
echo Enderecos IPv4 desta maquina:
powershell -NoProfile -Command "$ips=Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254*'} | Select-Object -ExpandProperty IPAddress; foreach($ip in $ips){Write-Host ('  http://' + $ip + ':3000')}"
echo.
echo Use um desses enderecos no navegador do segundo computador.
echo Os computadores precisam estar na mesma rede local.
pause
