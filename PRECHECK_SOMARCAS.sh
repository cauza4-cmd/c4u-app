#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-/home/admin/c4u/C4U APP}"
fail(){ printf "BLOQUEADO: %s\n" "$1"; exit 1; }
[ -f "$ROOT/data/db.json" ] || fail "Banco não encontrado."
[ "$(node -p "require(process.argv[1]).version" "$ROOT/package.json")" = "16.0.7-spot.3.3-test.1" ] || fail "Versão diferente da base mesclada; exporte o código atualizado antes de instalar."
[ "$(sha256sum "$ROOT/server.js" | cut -d' ' -f1)" = "4e976c9cc534e6b20577f23443109617200904f925b5455dd0f8d10c6ea3a053" ] || fail "Arquivo server.js foi alterado; não sobreponha."
[ "$(sha256sum "$ROOT/public/app.js" | cut -d' ' -f1)" = "0e27fdf2e049dc4fbf3a1caf874dce154ae8ddd678c0a8b0693c4eaa073e7ef5" ] || fail "Arquivo public/app.js foi alterado; não sobreponha."
[ "$(sha256sum "$ROOT/package.json" | cut -d' ' -f1)" = "7d3c720f75e7e62f6c7d47b97baed1c9fc16b91fa68bbc5312895f72a281b65e" ] || fail "Arquivo package.json foi alterado; não sobreponha."
[ "$(sha256sum "$ROOT/public/index.html" | cut -d' ' -f1)" = "1bf33b4267caa5666b2db813bfd80e845a9fc1059e14d557b253250d4ffbe1c5" ] || fail "Arquivo public/index.html foi alterado; não sobreponha."
[ "$(sha256sum "$ROOT/lib/spot-sync.js" | cut -d' ' -f1)" = "eb0c82c90f61f46d31a3e2ce226d4cc461a0271c85e974bc1002c256c66be35e" ] || fail "Arquivo lib/spot-sync.js foi alterado; não sobreponha."
[ "$(sha256sum "$ROOT/lib/unified-catalog.js" | cut -d' ' -f1)" = "6fc8b6692cd99a766aa9b530a43d034cc815f1260ababe7f1aa6453a63283a6c" ] || fail "Arquivo lib/unified-catalog.js foi alterado; não sobreponha."
[ "$(sha256sum "$ROOT/public/c4u-dialogs.js" | cut -d' ' -f1)" = "71f19a78d8f158e541523c735b06f15f84443773f177ef76654793826ba057af" ] || fail "Arquivo public/c4u-dialogs.js foi alterado; não sobreponha."
printf "%s\n" "PRECHECK_OK: versão e código da AWS conferem; banco não alterado."
