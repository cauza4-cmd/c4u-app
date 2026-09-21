'use strict';
/** SPOT Fase 3: read-only supplier sync transformations. No supplier order, quote or physical-stock writes. */
const {rowsOf}=require('./spot-connector');
const {normalizeFeeds,importStage}=require('./spot-catalog');
const STOCK_INTERVAL_MS=12*60*60*1000;
const CATALOG_INTERVAL_MS=24*60*60*1000;
const scalar=(row,name)=>{const k=Object.keys(row||{}).find(x=>x.toLowerCase()===name.toLowerCase());return k?row[k]:undefined};
function quantity(raw){if(raw===null||raw===undefined||String(raw).trim()==='')return null;const n=Number(raw);return Number.isSafeInteger(n)&&n>=0?n:null}
function applyStockFeed(db,data,at=new Date().toISOString()){
 const rows=rowsOf(data,'stocks');
 if(!Array.isArray(rows)||rows.length===0)throw Error('Feed de estoque vazio. Últimos dados mantidos.');
 const catalog=(db.spotCatalog||[]).filter(x=>x.source==='SPOT'&&x.sku);
 if(!catalog.length)throw Error('Importe o catálogo SPOT manualmente antes de ativar a sincronização.');
 const found=new Map();
 for(const row of rows){
  const sku=String(scalar(row,'Sku')||'').trim();
  if(!sku)throw Error('Feed de estoque com SKU vazio; sincronização recusada.');
  if(found.has(sku))throw Error('Feed de estoque com SKU duplicado; sincronização recusada.');
  const count=quantity(scalar(row,'Quantity'));
  if(count===null)throw Error('Feed de estoque com quantidade inválida; sincronização recusada.');
  const nextEntries=[];
  for(let i=1;i<=6;i++){
   const qty=quantity(scalar(row,`NextQuantity${i}`));const date=String(scalar(row,`NextDate${i}`)||'').trim().slice(0,40);
   if(qty!==null&&qty>0&&date)nextEntries.push({qty,date});
  }
  found.set(sku,{count,nextEntries,country:String(scalar(row,'Country')||'').slice(0,10)});
 }
 const matched=catalog.filter(x=>found.has(x.sku)).length;
 if(matched<Math.ceil(catalog.length*.90))throw Error('Feed de estoque incompleto (menos de 90% dos SKUs atuais). Últimos dados mantidos.');
 let updated=0;
 db.spotCatalog=(db.spotCatalog||[]).map(x=>{
  if(x.source!=='SPOT'||!found.has(x.sku))return x;
  const row=found.get(x.sku);
  if(x.supplierStock!==row.count||JSON.stringify(x.nextEntries||[])!==JSON.stringify(row.nextEntries)||x.stockCountry!==row.country)updated++;
  return {...x,supplierStock:row.count,nextEntries:row.nextEntries,stockCountry:row.country,lastSupplierSync:at};
 });
 db.settings={...(db.settings||{}),spotLastStockSync:at};
 return {mode:'stock',matched,updated,retained:catalog.length-matched,received:rows.length,total:catalog.length,updatedAt:at,ordersToSupplier:false};
}
function buildCatalogStage(feeds,db,at=new Date().toISOString()){
 const catalog=(db.spotCatalog||[]).filter(x=>x.source==='SPOT');
 if(!catalog.length)throw Error('Primeiro importe e valide o catálogo SPOT manualmente.');
 const stage=normalizeFeeds(feeds,db.spotCatalog||[],db.itemLibrary||[],at),s=stage.summary;
 if(s.issues||s.valid<Math.ceil(s.variants*.95)||s.missingPrices||s.missingStock)
  throw Error('Catálogo recebido com inconsistências ou preços/estoques ausentes. Últimos dados mantidos.');
 if(s.valid<Math.ceil(catalog.length*.9)||s.missingRetained>Math.floor(catalog.length*.1))
  throw Error('Catálogo novo muito menor que o existente. Sincronização bloqueada contra perda de registros.');
 return stage;
}
function applyCatalogStage(db,stage,at=new Date().toISOString()){
 const summary=importStage(db,stage,at);db.settings.spotLastStockSync=at;
 return {...summary,mode:'catalog',ordersToSupplier:false};
}
function nextAt(last,interval,now=Date.now()){
 const n=Date.parse(last||'');return Number.isFinite(n)?new Date(n+interval).toISOString():new Date(now).toISOString();
}
function due(last,interval,now=Date.now()){
 const n=Date.parse(last||'');return !Number.isFinite(n)||now-n>=interval;
}
function syncStatus(db,now=Date.now(),runtime={}){
 const settings=db.settings||{},sync=settings.spotSync||{},count=(db.spotCatalog||[]).filter(x=>x.source==='SPOT').length;
 const lastCatalog=settings.spotLastCatalogSync||'';
 const lastStock=settings.spotLastStockSync||lastCatalog;
 const enabled=process.env.SPOT_AUTO_SYNC_ENABLED!=='0'&&count>0;
 return {enabled,stockHours:12,catalogHours:24,count,busy:Boolean(runtime.busy),runningMode:runtime.mode||'',lastCatalog,lastStock,nextCatalog:nextAt(lastCatalog,CATALOG_INTERVAL_MS,now),nextStock:nextAt(lastStock,STOCK_INTERVAL_MS,now),lastAttempt:sync.lastAttempt||'',lastSuccess:sync.lastSuccess||'',lastMode:sync.lastMode||'',lastError:sync.lastError||'',lastSummary:sync.lastSummary||null,ordersToSupplier:false};
}
module.exports={STOCK_INTERVAL_MS,CATALOG_INTERVAL_MS,applyStockFeed,buildCatalogStage,applyCatalogStage,nextAt,due,syncStatus};
