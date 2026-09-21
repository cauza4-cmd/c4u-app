'use strict';
/** One read-only search over independent sources; filtering never changes supplier stock or quote snapshots. */
const clean=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const value=v=>Number.isFinite(Number(v))?Number(v):0;
const img=x=>typeof x==='string'&&(/^(?:https:\/\/|data:image\/(?:png|jpeg|webp);base64,)/i.test(x))?x:'';
const TABS=['Todos','SPOT','XBZ','Ásia','Só Marcas','Manuais'];
function sourceTab(raw,kind){
 if(kind==='spot')return 'SPOT';
 if(kind==='stock')return 'Manuais';
 const s=clean(raw);
 if(s.includes('spot'))return 'SPOT';if(s.includes('xbz'))return 'XBZ';
 if(s.includes('asia')||s.includes('ásia'))return 'Ásia';
 if(s.includes('so marcas')||s.includes('somarcas'))return 'Só Marcas';
 return 'Manuais';
}
function unifiedRecords(db){
 const result=[];
 for(const x of db.itemLibrary||[]){
  if(x.active===false)continue;
  const opts=(x.supplierOptions||[]).map(o=>Number(o.cost)).filter(n=>Number.isFinite(n)&&n>0);
  const src=x.source||'Cadastro manual';
  result.push({kind:'library',source:src,supplier:sourceTab(src,'library'),id:x.id,name:x.name||'Item',code:x.internalCode||x.supplierCode||'',sku:x.supplierCode||'',parentCode:x.parentCode||'',category:x.category||'Sem categoria',subcategory:x.subcategory||'',image:img(x.images?.[0]),images:Array.isArray(x.images)?x.images.filter(img).slice(0,12):[],cost:opts.length?Math.min(...opts):value(x.cost),stock:x.supplierStock??null,description:x.commercialDescription||x.technicalDescription||''});
 }
 for(const x of db.products||[]){
  if(x.active===false)continue;const src=x.integration||x.source||'Cadastro manual';
  result.push({kind:'product',source:src,supplier:sourceTab(src,'product'),id:x.id,supplierId:x.supplierId||0,name:x.name||x.description||'Produto',code:x.supplierCode||x.internalCode||x.code||'',sku:x.supplierCode||'',parentCode:x.parentCode||'',category:x.category||'Sem categoria',subcategory:x.subcategory||'',image:img(x.image||x.images?.[0]),images:Array.isArray(x.images)?x.images.filter(img).slice(0,12):[],cost:value(x.cost),stock:x.stock??null,description:x.description||''});
 }
 for(const x of db.physicalStock||[]){result.push({kind:'stock',source:'Estoque físico',supplier:'Manuais',id:x.id,name:x.name||'Item físico',code:x.code||'',sku:x.code||'',parentCode:'',category:'Estoque físico',subcategory:'',image:img(x.images?.[0]),images:Array.isArray(x.images)?x.images.filter(img).slice(0,12):[],cost:value(x.cost),stock:x.available??null,ownerClientId:x.ownerClientId||0,description:x.description||''})}
 for(const x of db.xbzCatalog||[]){
  if(x.source!=='XBZ'||x.active===false||x.missingFromLatestFeed)continue;
  result.push({kind:'xbz',source:'XBZ',supplier:'XBZ',id:x.code,name:x.name||'Produto XBZ',code:x.commercialCode||x.code,sku:x.variationCode||x.sku||x.code,parentCode:x.code,internalCode:x.code,variationCode:x.variationCode||'',commercialCode:x.commercialCode||x.code,category:x.category||'Sem categoria',subcategory:x.subcategory||'',image:img(x.image||x.images?.[0]),images:Array.isArray(x.images)?x.images.filter(img).slice(0,10):[],cost:x.cost??null,stock:x.supplierStock??null,stockReported:x.supplierStockReported??null,stockStatus:x.supplierStockStatus||'',stockMain:x.supplierStockMain??null,stockMainReported:x.supplierStockMainReported??null,stockMainStatus:x.supplierStockMainStatus||'',description:x.description||'',color:x.color||'',lastSupplierSync:x.lastSupplierSync||'',ncm:x.ncm||'',ordersToSupplier:false});
 }
 for(const x of db.asiaCatalog||[]){
  if(x.source!=='Ásia Import'||x.active===false||x.missingFromLatestFeed)continue;
  result.push({kind:'asia',source:'Ásia Import',supplier:'Ásia',id:x.code,name:x.name||'Produto Ásia',code:x.code,sku:x.sku||x.code,parentCode:x.parentCode||'',category:x.category||'Sem categoria',subcategory:x.subcategory||'',image:img(x.image||x.images?.[0]),images:Array.isArray(x.images)?x.images.filter(img).slice(0,10):[],cost:x.cost??null,stock:x.supplierStock??null,stockSP:x.supplierStockSP??null,description:x.description||'',color:x.color||'',origin:x.origin||'',isVariation:x.isVariation||false,ncm:x.ncm||'',lastSupplierSync:x.lastSupplierSync||'',ordersToSupplier:false});
 }
 for(const x of db.somarcasCatalog||[]){
  if(x.source!=='Só Marcas'||x.missingFromLatestFeed)continue;
  const prices=x.prices||{};
  result.push({kind:'somarcas',source:'Só Marcas',supplier:'Só Marcas',id:x.code,name:x.name||'Produto Só Marcas',code:x.code,sku:x.sku||x.code,parentCode:'',category:x.category||'Sem categoria',subcategory:x.subcategory||'',image:img(x.image||x.images?.[0]),images:Array.isArray(x.images)?x.images.filter(img).slice(0,8):[],cost:prices.preco_sem_gravacao_com_impostos??null,stock:x.supplierStock??null,description:x.description||'',engravingType:x.engravingType||'',prices,minimumQty:x.minimumQty??null,providerUpdatedAt:x.providerUpdatedAt||'',lastSupplierSync:x.lastSupplierSync||'',ncm:x.ncm||'',ipi:x.ipi??null,region:x.region||'SP'});
 }
 for(const x of db.spotCatalog||[]){if(x.source!=='SPOT')continue;result.push({kind:'spot',source:'SPOT',supplier:'SPOT',id:x.sku,name:x.name||'Produto SPOT',code:x.sku,sku:x.sku,reference:x.reference||'',webSku:x.webSku||'',parentCode:x.reference||'',color:x.colorName||'',category:x.category||'Sem categoria',subcategory:x.subcategory||'',image:img(x.images?.[0]),images:Array.isArray(x.images)?x.images.filter(img).slice(0,6):[],imageKind:x.imageKind||'',cost:value(x.price?.yourPrice),price:x.price||{},stock:x.supplierStock??null,lastSupplierSync:x.lastSupplierSync||'',description:x.description||''})}
 return result;
}
function score(row,q){
 if(!q)return 1;const query=clean(q),stripped=query.replace(/\s+/g,'');
 const codes=[row.code,row.sku,row.parentCode,row.reference,row.webSku,row.internalCode,row.variationCode].map(clean).filter(Boolean).map(x=>x.replace(/\s+/g,''));
 if(codes.some(c=>c===stripped))return 120;if(codes.some(c=>c.startsWith(stripped)))return 105;
 const name=clean(row.name);if(name===query)return 100;if(name.startsWith(query))return 90;
 if(name.split(/[^a-z0-9]+/).some(w=>w.startsWith(query)))return 78;if(name.includes(query))return 68;
 const tokens=query.split(/\s+/).filter(Boolean),hay=[name,clean(row.category),clean(row.subcategory),clean(row.color),...codes].join(' ');
 return tokens.length>1&&tokens.every(t=>hay.includes(t))?46:0;
}
function searchUnified(db,q='',limit=80,offset=0,options={}){
 const query=String(q||'').trim().slice(0,120),supplier=TABS.includes(options?.supplier)?options.supplier:'Todos',category=String(options?.category||'').slice(0,160),subcategory=String(options?.subcategory||'').slice(0,160);
 if(query.length===1)return {items:[],total:0,offset:0,limit:80,query,supplier,categories:[],subcategories:[],tabs:TABS,message:'Digite pelo menos 2 caracteres para pesquisar.'};
 let ranked=unifiedRecords(db).map((item,index)=>({item,index,rank:score(item,query)})).filter(x=>x.rank>0);
 const counts=Object.fromEntries(TABS.map(t=>[t,t==='Todos'?ranked.length:ranked.filter(x=>x.item.supplier===t).length]));
 if(supplier!=='Todos')ranked=ranked.filter(x=>x.item.supplier===supplier);
 const categories=[...new Set(ranked.map(x=>x.item.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
 if(category)ranked=ranked.filter(x=>x.item.category===category);
 const subcategories=[...new Set(ranked.flatMap(x=>String(x.item.subcategory||'').split(',').map(s=>s.trim()).filter(Boolean)))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
 if(subcategory)ranked=ranked.filter(x=>String(x.item.subcategory||'').split(',').map(s=>s.trim()).includes(subcategory));
 ranked.sort((a,b)=>b.rank-a.rank||(query?a.index-b.index:clean(a.item.name).localeCompare(clean(b.item.name),'pt-BR')));
 const start=Math.max(0,Math.floor(Number(offset)||0)),pageSize=Math.min(120,Math.max(1,Number(limit)||80));
 return {items:ranked.slice(start,start+pageSize).map(x=>x.item),total:ranked.length,offset:start,limit:pageSize,query,supplier,category,subcategory,categories,subcategories,tabs:TABS,counts,ordersToSupplier:false};
}
module.exports={unifiedRecords,searchUnified,score,sourceTab,TABS};
