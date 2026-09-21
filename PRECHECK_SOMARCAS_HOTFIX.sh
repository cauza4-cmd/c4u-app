#!/usr/bin/env bash
set -euo pipefail
TARGET="${1:-}"
if [[ -z "$TARGET" || ! -d "$TARGET" ]]; then echo 'BLOQUEADO: informe pasta válida do C4U.'; exit 1; fi
VERSION="$(node -p "require(process.argv[1]).version" "$TARGET/package.json" 2>/dev/null || true)"
if [[ "$VERSION" != '16.0.7-spot.3.3-somarcas.2-test.1' ]]; then echo "BLOQUEADO: versão incompatível: $VERSION"; exit 1; fi
if [[ ! -f "$TARGET/lib/somarcas-connector.js" ]]; then echo 'BLOQUEADO: conector ausente'; exit 1; fi
ACTUAL="$(sha256sum "$TARGET/lib/somarcas-connector.js" | cut -d' ' -f1)"
if [[ "$ACTUAL" != '0bbb65cb83c303f468c83ff7fa76b44ab9a1f4836f61e44e4d7ec579155c2bf4' ]]; then echo 'BLOQUEADO: conector alterado. Não sobrescreva; envie versão atualizada para mesclagem.'; exit 1; fi
echo 'PRECHECK_OK: conector compatível. Nenhum dado alterado.'
