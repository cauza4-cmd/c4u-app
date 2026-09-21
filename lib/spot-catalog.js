'use strict';
/** SPOT quote-only importer: pure transformations. Does NOT call the supplier or send orders. */
const crypto=require('node:crypto');
const {rowsOf}=require('./spot-connector');
const FEED_NAMES=['products','optionalsComplete','colors','stocks','optionalsPrice'];
const text=(v,max=300)=>typeof v==='string'?v.trim().slice(0,max):typeof v==='number'&&Number.isFinite(v)?String(v):'';
function get(o,field){if(!o||typeof o!=='object')return undefined;const k=Object.keys(o).find(x=>x.toLowerCase()===field.toLowerCase());return k?o[k]:undefined}
function str(o,field,max=300){return text(get(o,field),max)}
function amount(v){if(typeof v!=='number'&&typeof v!=='string')return null;const s=String(v).trim();if(!/^\d+(?:[.,]\d{1,6})?$/.test(s))return null;const n=Number(s.replace(',','.'));return Number.isFinite(n)&&n>=0?n:null}
function positiveInteger(v){const n=Number(v);return Number.isSafeInteger(n)&&n>=0?n:null}
// SPOT returns filenames such as "11112_104.jpg", not necessarily absolute URLs.
// Only resolve a single, safe image filename against the verified SPOT image directory.
// Never resolve arbitrary relative paths, credentials, schemes or query strings.
const SPOT_IMAGE_BASE='https://www.spotgifts.com.br/fotos/produtos/';
function imageUrl(v){
 const s=text(v,2000);
 if(!s||s.length>1800)return '';
 if(/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}\.(?:jpe?g|png|webp)$/i.test(s)&&!s.includes('..'))
  return SPOT_IMAGE_BASE+encodeURIComponent(s);
 try{const u=new URL(s);if(u.protocol!=='https:'||u.username||u.password)return '';return u.href}catch{return ''}
}
function uniqueImages(...values){const result=[];for(const value of values){const vals=Array.isArray(value)?value:[value];for(const v of vals){const url=imageUrl(v);if(url&&!result.includes(url)&&result.length<6)result.push(url)}}return result}
function norm(v){return text(v,200).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim()}
function normalizeFeeds(feeds, existing=[], library=[], at=new Date().toISOString()){
 const errors=[];const rows={};
 for(const name of FEED_NAMES){const data=rowsOf(feeds[name],name);if(!Array.isArray(data)||!data.length)throw Error(`Feed ${name} vazio ou não reconhecido; nenhum catálogo foi preparado.`);rows[name]=data}
 const parents=new Map();for(const p of rows.products){const ref=str(p,'ProdReference',75);if(ref&& !parents.has(ref))parents.set(ref,p)}
 const colors=new Map();for(const c of rows.colors){const code=str(c,'ColorCode',40);if(code)colors.set(code,str(c,'Description',100))}
 function indexed(list,label){const map=new Map();for(const rec of list){const sku=str(rec,'Sku',100);if(!sku){errors.push(`${label}: linha sem SKU.`);continue}if(map.has(sku)){errors.push(`${label}: SKU repetido ${sku}.`);map.set(sku,null)}else map.set(sku,rec)}return map}
 const stocks=indexed(rows.stocks,'Estoque'),prices=indexed(rows.optionalsPrice,'Preço');
 const seen=new Set(),results=[];
 for(const item of rows.optionalsComplete){
  const sku=str(item,'Sku',100),ref=str(item,'ProdReference',75);
  if(!sku||!ref){errors.push('Variação com SKU ou referência ausente.');continue}
  if(seen.has(sku)){errors.push(`Variação duplicada ${sku}; segunda ocorrência ignorada.`);continue}seen.add(sku);
  const p=parents.get(ref);if(!p){errors.push(`SKU ${sku} sem produto principal ${ref}.`);continue}
  if(stocks.get(sku)===null||prices.get(sku)===null){errors.push(`SKU ${sku} possui estoque ou preço ambíguo.`);continue}
  const stock=stocks.get(sku),pr=prices.get(sku);
  const colorCode=str(item,'ColorCode',40)||str(pr,'ColorCode',40);
  const desc=[str(item,'ColorDesc1',100),str(item,'ColorDesc2',100)].filter(Boolean);
  const colorName=colors.get(colorCode)||desc.join(' / ')||'';
  const imageVariant=uniqueImages(get(item,'OptionalImage1'),get(item,'OptionalImage2'),get(item,'AllImageList'));
  const imageMain=uniqueImages(get(p,'MainImage'),get(item,'MainImage'));
  const tiers=[];
  for(let i=1;i<=10;i++){
   const min=positiveInteger(get(pr,`MinQt${i}`)),price=amount(get(pr,`Price${i}`));
   if(min!==null&&min>0&&price!==null)tiers.push({minQty:min,supplierPrice:price});
  }
  tiers.sort((a,b)=>a.minQty-b.minQty);
  if(new Set(tiers.map(x=>x.minQty)).size!==tiers.length){errors.push(`SKU ${sku}: faixas de preço com quantidades repetidas.`);continue}
  const nextEntries=[];
  for(let i=1;i<=6;i++){const qty=positiveInteger(get(stock,`NextQuantity${i}`)),date=str(stock,`NextDate${i}`,40);if(qty!==null&&qty>0&&date)nextEntries.push({qty,date})}
  const rec={source:'SPOT',sku,webSku:str(item,'WebSku',100),reference:ref,category:str(p,'Category',150)||str(p,'Type',150)||str(p,'ProductType',150)||str(item,'Type',150)||str(item,'Category',150),subcategory:str(p,'Subcategory',150)||str(p,'SubType',150)||str(p,'ProductSubType',150)||str(item,'SubType',150)||str(item,'Subcategory',150),name:str(item,'Name',240)||str(p,'Name',240),description:str(item,'Description',1500)||str(p,'Description',1500),colorCode,colorName,images:imageVariant.length?imageVariant:imageMain,imageKind:imageVariant.length?'variacao':'generica',supplierStock:stock?positiveInteger(get(stock,'Quantity')):null,stockCountry:str(stock,'Country',10),nextEntries,price:{yourPrice:amount(get(pr,'YourPrice')??get(item,'YourPrice')),tiers,currency:null,verified:false},lastSupplierSync:at};
  if(!rec.name){errors.push(`SKU ${sku} sem nome.`);continue}
  results.push(rec);
 }
 if(results.length===0)throw Error('Nenhuma variação válida; catálogo não pode ser importado.');
 if(results.length<rows.optionalsComplete.length*0.90)throw Error('Mais de 10% das variações apresentam inconsistências; importação bloqueada.');
 const existingBySku=new Map(existing.filter(x=>x.source==='SPOT'&&x.sku).map(x=>[x.sku,x]));
 const manualCodes=new Set(library.filter(x=>x.active!==false).flatMap(x=>[x.internalCode,x.supplierCode,...(x.supplierOptions||[]).map(y=>y.supplierCode)].filter(Boolean).map(norm)));
 const comparable=r=>{const {lastSupplierSync,...rest}=r;return rest};
 let created=0,updated=0,unchanged=0,manualOverlaps=0;
 const sample=[],changes=[];
 for(const rec of results){const old=existingBySku.get(rec.sku);if(!old){created++;changes.push({sku:rec.sku,action:'novo'})}else if(JSON.stringify(comparable(old))!==JSON.stringify(comparable(rec))){updated++;changes.push({sku:rec.sku,action:'atualização'})}else unchanged++;
  if(manualCodes.has(norm(rec.sku))){manualOverlaps++;if(sample.length<12)sample.push({sku:rec.sku,detail:'Mesmo código em item manual: preservado separadamente.'})}
 }
 const missing=existing.filter(x=>x.source==='SPOT'&&!results.some(row=>row.sku===x.sku)).length;
 const imageVariants=results.filter(x=>x.imageKind==='variacao').length,genericImages=results.filter(x=>x.imageKind==='generica'&&x.images.length).length,missingImages=results.filter(x=>!x.images.length).length,missingStock=results.filter(x=>x.supplierStock===null).length,missingPrices=results.filter(x=>x.price.yourPrice===null&&x.price.tiers.length===0).length;
 const summary={products:rows.products.length,variants:rows.optionalsComplete.length,colors:rows.colors.length,stockRows:rows.stocks.length,priceRows:rows.optionalsPrice.length,valid:results.length,new:created,update:updated,unchanged,missingRetained:missing,manualOverlaps,issues:errors.length,imageVariants,genericImages,missingImages,missingStock,missingPrices,pricesUnverified:true,ordersToSupplier:false};
 const dbHash=hashCatalog(existing);
 return {items:results,summary,issues:errors.slice(0,25),sample:results.slice(0,6).map(x=>({sku:x.sku,reference:x.reference,name:x.name,color:x.colorName,stock:x.supplierStock,price:x.price.yourPrice,imageKind:x.imageKind})),overlaps:sample,changes:changes.slice(0,15),dbHash};
}
function hashCatalog(catalog){return crypto.createHash('sha256').update(JSON.stringify(catalog||[])).digest('hex')}
function importStage(db,stage,at=new Date().toISOString()){
 if(hashCatalog(db.spotCatalog||[])!==stage.dbHash)throw Error('Catálogo alterado desde a prévia. Prepare uma nova prévia antes de importar.');
 const oldBySku=new Map((db.spotCatalog||[]).filter(x=>x.source==='SPOT').map(x=>[x.sku,x]));
 const other=(db.spotCatalog||[]).filter(x=>x.source!=='SPOT');
 const fresh=stage.items.map(item=>{const old=oldBySku.get(item.sku);return old&&JSON.stringify({...old,lastSupplierSync:''})===JSON.stringify({...item,lastSupplierSync:''})?old:item});
 const retained=[...oldBySku.values()].filter(x=>!stage.items.some(item=>item.sku===x.sku));
 db.spotCatalog=[...other,...fresh,...retained];
 db.settings={...(db.settings||{}),spotLastCatalogSync:at,spotLastCatalogCount:fresh.length};
 return {...stage.summary,total:db.spotCatalog.length,updatedAt:at};
}
function searchCatalog(items,search='',limit=35){const q=norm(search);if(q.length<2)return [];
 return (items||[]).filter(x=>x.source==='SPOT').map(x=>{const sku=norm(x.sku),ref=norm(x.reference),name=norm(x.name);const score=sku===q?120:ref===q?110:sku.startsWith(q)?100:ref.startsWith(q)?90:name.startsWith(q)?80:name.split(/[^a-z0-9]+/).some(word=>word.startsWith(q))?70:name.includes(q)?50:0;return {x,score}}).filter(x=>x.score).sort((a,b)=>b.score-a.score||a.x.sku.localeCompare(b.x.sku)).slice(0,Math.min(50,Math.max(1,limit))).map(x=>x.x);
}
module.exports={normalizeFeeds,importStage,hashCatalog,searchCatalog,FEED_NAMES};
