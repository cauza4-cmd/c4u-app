#!/usr/bin/env bash
set -euo pipefail
TARGET="${1:-/home/admin/c4u/C4U APP}"
[ -d "$TARGET" ] || { echo 'BLOQUEADO: pasta do C4U não encontrada.'; exit 1; }
[ -f "$TARGET/data/db.json" ] || { echo 'BLOQUEADO: banco do C4U não encontrado; confira a instalação e C4U_DATA_DIR.'; exit 1; }
[ -f "$TARGET/lib/somarcas-connector.js" ] || { echo 'BLOQUEADO: integração Só Marcas ausente.'; exit 1; }
[ "$(node -p "require(process.argv[1]).version" "$TARGET/package.json")" = '16.0.7-spot.3.3-somarcas.2-test.1' ] || { echo 'BLOQUEADO: versão diferente. Não instale este pacote.'; exit 1; }
[ "$(sha256sum "$TARGET/package.json" | awk '{print $1}')" = 'abfefe8b0d9df27ef34abe132ef764cfed92af2c9c5d8a4277e59394714eb717' ] || { echo 'BLOQUEADO: arquivo divergente: package.json. Não instale.'; exit 1; }
[ "$(sha256sum "$TARGET/server.js" | awk '{print $1}')" = 'a9fc0cb8c17114c5b333b3e09dea767cd13ad6c8e223d1cf2f167c82b605f60e' ] || { echo 'BLOQUEADO: arquivo divergente: server.js. Não instale.'; exit 1; }
[ "$(sha256sum "$TARGET/public/app.js" | awk '{print $1}')" = 'bfa963cfc397427b6e5f87ac94391f6248d392cf841d6a0899eeb8ee297571bc' ] || { echo 'BLOQUEADO: arquivo divergente: public/app.js. Não instale.'; exit 1; }
[ "$(sha256sum "$TARGET/lib/unified-catalog.js" | awk '{print $1}')" = 'ce4760bf4a73f5935948308d2fcf67a522920e42a1367916bcf52c0001a4beef' ] || { echo 'BLOQUEADO: arquivo divergente: lib/unified-catalog.js. Não instale.'; exit 1; }
echo 'PRECHECK_ASIA_OK: versão e 4 arquivos de código conferidos; não realiza alterações.'
