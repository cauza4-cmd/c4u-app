@echo off
chcp 65001 >nul
title C4U APP - Endereco da Rede
cls
echo ==============================================
echo ENDERECOS DO C4U APP NA REDE LOCAL
echo ==============================================
echo.
powershell -NoProfile -Command "$ips=Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254*'} | Select-Object -ExpandProperty IPAddress; if(-not $ips){Write-Host 'Nenhum IPv4 local detectado.'} else {foreach($ip in $ips){Write-Host ('  http://' + $ip + ':3000')}}"
echo.
echo O C4U precisa estar aberto no computador servidor.
pause
