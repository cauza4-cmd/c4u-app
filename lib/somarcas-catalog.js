'use strict';
/** Isolated Só Marcas quote-only catalog. Pure functions: never contact provider, edit existing quotes or create orders. */
const crypto=require('node:crypto');
const {safeRow}=require('./somarcas-connector');
const SOURCE='Só Marcas';
const PRICE_OPTIONS=Object.freeze([
 {key:'preco_sem_gravacao_sem_impostos',label:'Sem gravação · Sem impostos'},
 {key:'preco_com_gravacao_sem_impostos',label:'Com gravação · Sem impostos'},
 {key:'preco_sem_gravacao_com_impostos',label:'Sem gravação · Com impostos'},
 {key:'preco_com_gravacao_com_impostos',label:'Com gravação · Com impostos'}
]);
function hashCatalog(records){return crypto.createHash('sha256').update(JSON.stringify(records||[])).digest('hex')}
function isValidPrice(v){return v!==null&&v!==undefined&&Number.isFinite(v)&&v>=0}
function comparable(row){const {lastSupplierSync,missingFromLatestFeed,...rest}=row;return rest}
function normalizeRows(raw,existing=[],manual=[],at=new Date().toISOString()){
 if(!Array.isArray(raw)||!raw.length)throw Error('Resposta Só Marcas vazia ou inválida. Nenhuma importação autorizada.');
 if(raw.length>100000)throw Error('Quantidade inesperada de itens Só Marcas. Nenhuma importação autorizada.');
 const issues=[],seen=new Set(),items=[],overlaps=[];let overlapCount=0;
 const manualCodes=new Set((manual||[]).filter(x=>x.active!==false).flatMap(x=>[x.internalCode,x.supplierCode,...(x.supplierOptions||[]).map(y=>y.supplierCode)]).filter(Boolean).map(x=>String(x).trim().toUpperCase()));
 for(let i=0;i<raw.length;i++){
  const r=safeRow(raw[i]);
  if(!r||!r.codigo.trim()||!r.titulo.trim()){issues.push(`Registro ${i+1}: código ou título ausente.`);continue}
  const code=r.codigo.trim(),key=code.toUpperCase();
  if(seen.has(key)){issues.push(`Código Só Marcas repetido: ${code}.`);continue}seen.add(key);
  if(r.estado&&r.estado.toUpperCase()!=='SP'){issues.push(`Código ${code}: UF retornada ${r.estado}; esperado SP.`);continue}
  if(!PRICE_OPTIONS.some(o=>isValidPrice(r[o.key]))){issues.push(`Código ${code}: nenhuma modalidade de preço válida.`);continue}
  const images=[r.url_foto,...(r.matriz_de_fotos_adicionais||[])].filter((x,i,a)=>x&&a.indexOf(x)===i).slice(0,8);
  const rec={source:SOURCE,code,sku:code,name:r.titulo,description:r.descricao,category:r.categoria||'Sem categoria',subcategory:r.subcategoria||'',images,image:images[0]||'',supplierStock:r.estoque,ipi:r.ipi,ncm:r.ncm,engravingType:r.tipo_gravacao,region:'SP',prices:Object.fromEntries(PRICE_OPTIONS.map(o=>[o.key,r[o.key]])),minimumQty:r.quantidade_minima_sugerida,dimensions:r.dimensoes_do_produto,packaging:r.embalagem_do_produto,providerUpdatedAt:r.data_ultima_atualizacao,lastSupplierSync:at,missingFromLatestFeed:false};
  items.push(rec);
  if(manualCodes.has(key)){overlapCount++;if(overlaps.length<15)overlaps.push({code,reason:'Mesmo código em cadastro manual; origens isoladas.'})}
 }
 if(issues.length||items.length!==raw.length)throw Object.assign(Error(`Prévia bloqueada: ${issues.length} problema(s) nos dados da Só Marcas. Nenhum produto foi alterado.`),{issues:issues.slice(0,20)});
 const byCode=new Map((existing||[]).filter(x=>x.source===SOURCE).map(x=>[String(x.code||'').toUpperCase(),x]));
 let created=0,updated=0,unchanged=0;
 for(const x of items){const old=byCode.get(x.code.toUpperCase());if(!old)created++;else if(JSON.stringify(comparable(old))!==JSON.stringify(comparable(x)))updated++;else unchanged++}
 const missing=(existing||[]).filter(x=>x.source===SOURCE&&!seen.has(String(x.code||'').toUpperCase())).length;
 const summary={received:raw.length,valid:items.length,uniqueCodes:seen.size,new:created,update:updated,unchanged,missingRetained:missing,manualOverlaps:overlapCount,missingImages:items.filter(x=>!x.image).length,missingStock:items.filter(x=>x.supplierStock===null).length,missingPriceModalities:Object.fromEntries(PRICE_OPTIONS.map(o=>[o.key,items.filter(x=>x.prices[o.key]===null).length])),issues:0,ordersToSupplier:false,priceNotice:'Preços informativos: confirmar com os vendedores da Só Marcas.'};
 return {items,summary,issues:[],overlaps,sample:items.slice(0,8).map(x=>({code:x.code,name:x.name,category:x.category,subcategory:x.subcategory,stock:x.supplierStock,image:x.image,prices:x.prices,engravingType:x.engravingType})),dbHash:hashCatalog(existing)};
}
function importStage(db,stage,at=new Date().toISOString()){
 if(hashCatalog(db.somarcasCatalog||[])!==stage.dbHash)throw Error('Catálogo Só Marcas alterado desde a prévia. Gere outra prévia.');
 if(stage.summary.issues||stage.items.length!==stage.summary.received)throw Error('Prévia inconsistente: importação bloqueada.');
 const old=(db.somarcasCatalog||[]).filter(x=>x.source===SOURCE),byCode=new Map(old.map(x=>[x.code.toUpperCase(),x])),current=new Set(stage.items.map(x=>x.code.toUpperCase()));
 const fresh=stage.items.map(x=>{const prior=byCode.get(x.code.toUpperCase());return prior&&JSON.stringify(comparable(prior))===JSON.stringify(comparable(x))?{...prior,missingFromLatestFeed:false,lastSupplierSync:at}:x});
 const retained=old.filter(x=>!current.has(x.code.toUpperCase())).map(x=>({...x,missingFromLatestFeed:true}));
 db.somarcasCatalog=[...(db.somarcasCatalog||[]).filter(x=>x.source!==SOURCE),...fresh,...retained];
 db.settings={...(db.settings||{}),somarcasLastCatalogSync:at,somarcasLastCatalogCount:fresh.length};
 return {...stage.summary,imported:fresh.length,retained:retained.length,total:db.somarcasCatalog.length,updatedAt:at};
}
module.exports={SOURCE,PRICE_OPTIONS,normalizeRows,importStage,hashCatalog,isValidPrice};
