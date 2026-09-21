#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-/home/admin/c4u/C4U APP}"
fail(){ printf 'BLOQUEADO: %s\n' "$1"; exit 1; }
[ -d "$ROOT" ] || fail 'Pasta atual do C4U não existe.'
[ -f "$ROOT/data/db.json" ] || fail 'Banco de dados não encontrado; não instale.'
[ "$(node -p "require(process.argv[1]).version" "$ROOT/package.json")" = '16.0.7-spot.3-test.1' ] || fail 'Versão AWS diferente da Fase 3 esperada. Solicite nova cópia do código antes de mesclar.'
check(){ local expected="$1" file="$2" got; [ -f "$ROOT/$file" ] || fail "Falta $file"; got="$(sha256sum "$ROOT/$file" | cut -d' ' -f1)"; [ "$got" = "$expected" ] || fail "$file foi alterado em relação à versão testada. NÃO sobreponha; forneça a cópia atualizada da AWS para mesclar."; }
check '413f10c84f36c9487b42db4e7806cf8b22e60336b034b7b18221c482cec83f95' package.json
check 'b7eb3276fe1146aabb953692d109f37e3e76400eeb9f0be09b47f71a42a7cf60' server.js
check '48f8fa793396fd4032c918b2b27c9df1b13347b86ed5a7a4c43e2d11316b6951' public/app.js
check '95bcb1702a7ded3225188008a258b4361a6f7fb3b6240501e2c79e117751aa02' public/index.html
check 'e10bdeda454fbe5b278eef8f2d4911553e5fcb06747d4903d503b892041b16cb' lib/spot-catalog.js
check 'eb0c82c90f61f46d31a3e2ce226d4cc461a0271c85e974bc1002c256c66be35e' lib/spot-sync.js
check 'd3c223850e7a20b018a365d303ce93ca074d667dbdfd965fdfc84ac63a111638' public/c4u-personal-1606.js
check 'd9fbdcbfe927d6238ede3f32b52ea5fc2151cc4860b1f8eb3ac05b3eff7fbb3e' public/approval.html
grep -q 'spotSyncCost' "$ROOT/public/app.js" || fail 'Custo automático SPOT ausente da versão atual.'
grep -q 'spotSyncStatus' "$ROOT/public/app.js" || fail 'Painel da Fase 3 SPOT ausente da versão atual.'
printf '%s\n' 'PRECHECK_OK: versão Fase 3 e hashes dos arquivos da AWS conferidos; nenhum dado foi alterado.'
