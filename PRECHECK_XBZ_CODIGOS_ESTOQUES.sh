#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-/home/admin/c4u/C4U APP}"
if [[ ! -f "$ROOT/package.json" ]]; then echo 'BLOQUEADO: pasta do C4U não encontrada.'; exit 1; fi
ACTUAL=$(node -p "require(process.argv[1]).version" "$ROOT/package.json")
if [[ "$ACTUAL" != '16.0.7-spot.3.3-somarcas.2-asia.1-xbz.1-test.1' ]]; then
 echo 'BLOQUEADO: versão diferente; instalação cancelada.'; exit 1
fi
verify() {
 local rel="$1" expected="$2" actual
 if [[ ! -f "$ROOT/$rel" ]]; then echo "BLOQUEADO: arquivo ausente: $rel"; exit 1; fi
 actual=$(sha256sum "$ROOT/$rel" | cut -d' ' -f1)
 if [[ "$actual" != "$expected" ]]; then echo "BLOQUEADO: arquivo $rel diferente da cópia revisada; NÃO sobrescrever."; exit 1; fi
}
verify 'lib/xbz-catalog.js' '22e1472db67cfcf1001b23cbca2c351f446a9995386890dc734fc91a9c8673b7'
verify 'lib/unified-catalog.js' '81b64e983a1f79167a54b1540f7155a07ca86f2e8fcb0ea34bd0c7cc518b56c4'
verify 'public/app.js' '30a2fa6659bff78fed2add5607527f6aba312b0fe55e252ee411d578d608771b'
echo 'PRECHECK_XBZ_CODIGOS_OK'
