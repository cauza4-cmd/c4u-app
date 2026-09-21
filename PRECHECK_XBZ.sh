#!/usr/bin/env bash
set -euo pipefail
TARGET="${1:-}"
if [[ -z "$TARGET" || ! -d "$TARGET" ]]; then echo 'BLOQUEADO: informe a pasta real do C4U.'; exit 2; fi
if [[ ! -f "$TARGET/package.json" ]]; then echo 'BLOQUEADO: package.json ausente.'; exit 2; fi
VERSION="$(cd "$TARGET" && node -p "require('./package.json').version")"
if [[ "$VERSION" != '16.0.7-spot.3.3-somarcas.2-asia.1-test.1' ]]; then echo "BLOQUEADO: versão incompatível: $VERSION"; exit 2; fi
EXPECTED=1029cf3468d7f50edcecab2fb1e6910917bed69cd593649d6277139c1d73c494
ACTUAL="$(sha256sum "$TARGET/package.json" | cut -d" " -f1)"
if [[ "$EXPECTED" != "$ACTUAL" ]]; then echo "BLOQUEADO: package.json mudou depois do pacote de origem. Não sobrescreva."; exit 2; fi
EXPECTED=5d06f434b6b3264cf146835e14556db44abd5c9dbd4a21336bac0c4fbabdb730
ACTUAL="$(sha256sum "$TARGET/server.js" | cut -d" " -f1)"
if [[ "$EXPECTED" != "$ACTUAL" ]]; then echo "BLOQUEADO: server.js mudou depois do pacote de origem. Não sobrescreva."; exit 2; fi
EXPECTED=ee06dcc7419fc7515cdf9084fefb7a53107f73ddf18811752939686e6e485369
ACTUAL="$(sha256sum "$TARGET/public/app.js" | cut -d" " -f1)"
if [[ "$EXPECTED" != "$ACTUAL" ]]; then echo "BLOQUEADO: public/app.js mudou depois do pacote de origem. Não sobrescreva."; exit 2; fi
EXPECTED=672120127ce53c899f364993c03a3f5feca06770413e13b1e757ef955d72a91b
ACTUAL="$(sha256sum "$TARGET/lib/unified-catalog.js" | cut -d" " -f1)"
if [[ "$EXPECTED" != "$ACTUAL" ]]; then echo "BLOQUEADO: lib/unified-catalog.js mudou depois do pacote de origem. Não sobrescreva."; exit 2; fi
if [[ -e "$TARGET/lib/xbz-connector.js" || -e "$TARGET/lib/xbz-catalog.js" ]]; then echo 'BLOQUEADO: uma implementação nova da XBZ já está presente. Não sobrescreva.'; exit 2; fi
if [[ ! -f "$TARGET/data/db.json" && -z "${C4U_DATA_DIR:-}" ]]; then echo 'AVISO: banco de dados não encontrado no caminho padrão; confirme C4U_DATA_DIR antes de prosseguir.'; fi
echo PRECHECK_XBZ_OK
