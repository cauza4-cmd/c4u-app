'use strict';
/** Catálogo independente e somente para orçamentos; nenhuma alteração em cadastros históricos. */
const crypto=require('node:crypto');
const SOURCE='Ásia Import';
const s=(v,n=500)=>String(v??'').trim().slice(0,n);
const price=v=>(v===null||v===undefined||v===''||!Number.isFinite(Number(v))||Number(v)<0)?null:Number(v);
const html=v=>s(v,240).replace(/&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:\d+|x[\da-f]+);/gi,m=>{const named={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '};if(named[m.toLowerCase()])return named[m.toLowerCase()];const n=/^&#x/i.test(m)?parseInt(m.slice(3,-1),16):parseInt(m.slice(2,-1),10);return Number.isInteger(n)&&n>0&&n<=0x10ffff?String.fromCodePoint(n):m});
function image(v){if(typeof v!=='string'||v.length>2048)return '';try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!/[?&](?:api_key|secret_key|token|password|senha|authorization)=/i.test(u.search)?u.href:''}catch{return ''}}
function imgs(raw){const src=[raw?.imagem,...(Array.isArray(raw?.galeria)?raw.galeria:[]).map(x=>typeof x==='string'?x:(x?.imagem||x?.url||x?.src||''))];return [...new Set(src.map(image).filter(Boolean))].slice(0,10)}
function categories(raw){const c=raw?.categorias;const a=Array.isArray(c)?c:(c&&typeof c==='object'?Object.values(c):[]);const names=a.map(v=>html(typeof v==='object'?(v.nome??v.name??''):v)).filter(Boolean);return {category:names[0]||'Sem categoria',subcategory:names.slice(1).join(', '),categories:names}}
function stock(v){return v===undefined||v===null||v===''||!Number.isSafeInteger(Number(v))||Number(v)<0?null:Number(v)}
function hashCatalog(rows){return crypto.createHash('sha256').update(JSON.stringify(rows||[])).digest('hex')}
function comparable(x){const {lastSupplierSync,missingFromLatestFeed,...rest}=x;return rest}
function normalizeRows(raw,existing=[],manual=[],at=new Date().toISOString()){
 if(!Array.isArray(raw)||!raw.length||raw.length>20000)throw Error('Resposta Ásia vazia ou volume inesperado. Prévia bloqueada.');
 const issues=[],seen=new Set(),all=[],codes=new Set(),manualCodes=new Set((manual||[]).flatMap(x=>[x.internalCode,x.supplierCode]).filter(Boolean).map(x=>s(x).toUpperCase()));let overlap=0,variationCount=0,withoutPrice=0,withoutImage=0;
 for(let i=0;i<raw.length;i++){
  const r=raw[i],parent=s(r?.referencia,100),name=html(r?.nome),pkey=parent.toUpperCase();
  if(!parent||!name||codes.has(pkey)){issues.push(`Produto ${i+1}: referência/nome vazio ou referência-pai repetida.`);continue}codes.add(pkey);
  const cs=categories(r),pic=imgs(r),vlist=Array.isArray(r.variacoes)?r.variacoes:[];
  if(r.variacoes!==undefined&&!Array.isArray(r.variacoes)){issues.push(`Produto ${parent}: variações inválidas.`);continue}
  const base={source:SOURCE,parentCode:parent,parentName:name,description:s(r.descricao,6000),category:cs.category,subcategory:cs.subcategory,categories:cs.categories,images:pic,image:pic[0]||'',dimensions:{height:price(r.altura),width:price(r.largura),length:price(r.comprimento),weight:price(r.peso)},origin:s(r.origem_faturamento,2),providerStatus:r.status,providerUpdatedAt:'',lastSupplierSync:at,missingFromLatestFeed:false};
  const variants=vlist.length?vlist:[null];
  for(const v of variants){
   const code=s(v?.referencia??parent,100),key=code.toUpperCase(),cost=price(v?v.preco:r.preco),quantity=stock(v?.qtd_estoque),sp=stock(v?.qtd_estoque_em_sp);
   if(!code||seen.has(key)){issues.push(`SKU ausente ou duplicado na Ásia: ${code||parent}.`);continue}seen.add(key);
   if(cost===null)withoutPrice++;
   const picture=image(v?.imagem)||base.image,attr=v?.atributos,colors=attr&&typeof attr==='object'?Object.values(attr).map(x=>html(typeof x==='object'?(x.nome??x.valor??x.value??''):x)).filter(Boolean):[];
   const vname=html(v?.nome),title=vname&&vname.toLowerCase()!==name.toLowerCase()?`${name} · ${vname}`:name;
   const row={...base,code,sku:code,name:title,color:colors.join(', ')||vname,images:[...new Set([picture,...pic].filter(Boolean))].slice(0,10),image:picture,cost,price:cost,supplierStock:quantity,supplierStockSP:sp,ncm:s(v?.ncm??r.ncm,50),deliveryForecast:Array.isArray(v?.previsao_entrega)?v.previsao_entrega.slice(0,10):[],attributes:attr&&typeof attr==='object'?attr:{},active:!([0,'0',false,'false'].includes(r.status)||[0,'0',false,'false'].includes(v?.status)),isVariation:Boolean(v)};
   all.push(row);if(v)variationCount++;if(!picture)withoutImage++;if(manualCodes.has(key))overlap++;
  }
 }
 if(issues.length||!all.length)throw Object.assign(Error(`Ásia: prévia bloqueada por ${issues.length||1} falha(s) de integridade; nada alterado.`),{issues:issues.slice(0,15)});
 const old=new Map((existing||[]).filter(x=>x.source===SOURCE).map(x=>[s(x.code).toUpperCase(),x]));let created=0,updated=0,unchanged=0;
 for(const x of all){const p=old.get(x.code.toUpperCase());if(!p)created++;else if(JSON.stringify(comparable(p))!==JSON.stringify(comparable(x)))updated++;else unchanged++}
 const missing=(existing||[]).filter(x=>x.source===SOURCE&&!seen.has(s(x.code).toUpperCase())).length;
 const summary={received:raw.length,products:codes.size,items:all.length,variations:variationCount,new:created,update:updated,unchanged,missingRetained:missing,manualOverlaps:overlap,missingImages:withoutImage,missingPrices:withoutPrice,active:all.filter(x=>x.active).length,ordersToSupplier:false,issues:0};
 return {items:all,summary,sample:all.slice(0,12).map(x=>({code:x.code,parentCode:x.parentCode,name:x.name,category:x.category,subcategory:x.subcategory,image:x.image,cost:x.cost,supplierStock:x.supplierStock,supplierStockSP:x.supplierStockSP,active:x.active,color:x.color})),issues:[],dbHash:hashCatalog(existing)};
}
function importStage(db,stage,at=new Date().toISOString()){
 if(hashCatalog(db.asiaCatalog||[])!==stage.dbHash)throw Error('Catálogo Ásia mudou desde a prévia. Refaça a prévia.');
 if(stage.summary.issues||stage.items.length!==stage.summary.items)throw Error('Prévia Ásia inconsistente; importação bloqueada.');
 const former=(db.asiaCatalog||[]).filter(x=>x.source===SOURCE),seen=new Set(stage.items.map(x=>x.code.toUpperCase()));
 const remaining=former.filter(x=>!seen.has(x.code.toUpperCase())).map(x=>({...x,missingFromLatestFeed:true}));
 db.asiaCatalog=[...(db.asiaCatalog||[]).filter(x=>x.source!==SOURCE),...stage.items.map(x=>({...x,lastSupplierSync:at,missingFromLatestFeed:false})),...remaining];
 db.settings={...(db.settings||{}),asiaLastSync:at,asiaLastCatalogCount:stage.items.length};
 return {...stage.summary,imported:stage.items.length,retained:remaining.length,total:db.asiaCatalog.length,updatedAt:at};
}
module.exports={SOURCE,normalizeRows,importStage,hashCatalog,image,categories,price,html};
