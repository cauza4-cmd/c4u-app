#!/usr/bin/env bash
set -euo pipefail
TARGET="${1:-}"
if [[ -z "$TARGET" || ! -d "$TARGET" ]]; then echo 'BLOQUEADO: informe pasta do C4U.'; exit 1; fi
INSTALLED="$(node -p "require(process.argv[1]).version" "$TARGET/package.json" 2>/dev/null || true)"
if [[ "$INSTALLED" != "16.0.7-spot.3.3-somarcas.1-test.1" ]]; then echo "BLOQUEADO: versão incompatível. Detectada: $INSTALLED; esperada: 16.0.7-spot.3.3-somarcas.1-test.1"; exit 1; fi
check(){ local name="$1" expected="$2" actual
 if [[ ! -f "$TARGET/$name" ]]; then echo "BLOQUEADO: arquivo ausente: $name"; exit 1; fi
 actual="$(sha256sum "$TARGET/$name" | cut -d' ' -f1)"
 if [[ "$actual" != "$expected" ]]; then echo "BLOQUEADO: arquivo modificado: $name. Não sobrescreva; envie o código atualizado para mesclagem."; exit 1; fi
}
check 'server.js' '2675716af122bc56caaa5492cfaa422087daab20db8fdd4117b3ceada30ab8fd'
check 'lib/somarcas-connector.js' 'ef2e345ac1bc156dfaa0a65eef6c41922e0a2e650e80ff419e182bb4fe1cb7d3'
check 'lib/unified-catalog.js' '6fc8b6692cd99a766aa9b530a43d034cc815f1260ababe7f1aa6453a63283a6c'
check 'public/app.js' 'cb48cbdf2835dab955e226b85baf9b50da3d41149f1df0772f6bb04f5b046622'
check 'public/index.html' '1bf33b4267caa5666b2db813bfd80e845a9fc1059e14d557b253250d4ffbe1c5'
check 'package.json' '196786d256248e8f01a7ca0d36bcbceefc0ea5b7d3ac8ef7a0f428abb13bf65c'
check 'package-lock.json' 'b02ed16b1ea1fbc1ed7d30fa842d0b3b6b32cd3d05310691b2b722fa403bb32b'
check 'tests/somarcas-phase1.js' '511f5d686ae12bd6eb6d16359eee56963b57b3289dce298654c7d45144cfa6d3'
echo 'PRECHECK_OK: versão e todos os arquivos sobrescritos conferem com o código enviado. Nenhum dado alterado.'
