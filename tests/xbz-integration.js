'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {XbzConnector,ENDPOINT,INTERVAL_MS,MAX_PER_DAY,rowsFrom}=require('../lib/xbz-connector');
const {normalizeRows,importStage,hashCatalog}=require('../lib/xbz-catalog');
const {searchUnified}=require('../lib/unified-catalog');
const row=(i)=>({codigo:'XBZ-'+i,nome:'Garrafa '+i,descricao:'Produto XBZ',preco:'19,50',estoque:90+i,imagem:'https://cdn.example.org/p'+i+'.jpg',categorias:['Garrafas','Squeezes']});
(async()=>{
 assert.equal(ENDPOINT,'https://api.minhaxbz.com.br:5001/api/clientes/GetListaDeProdutos');assert.equal(MAX_PER_DAY,20);
 assert.equal(rowsFrom([row(1)]).length,1);assert.equal(rowsFrom({produtos:[row(1)]}).length,1);assert.equal(rowsFrom({Data:{Produtos:[row(1)]}}).length,1);assert.equal(rowsFrom({erro:'falha'}),null);
 const original={quotes:[{id:1,items:[{unitCost:42}]}],orders:[{id:2,items:[]}],physicalStock:[{id:3,quantity:12}],spotCatalog:[{source:'SPOT',sku:'S'}],somarcasCatalog:[{source:'Só Marcas',code:'SM'}],asiaCatalog:[{source:'Ásia Import',code:'A'}],itemLibrary:[{id:1,source:'manual',internalCode:'XBZ-1'}],products:[{id:3,integration:'XBZ',supplierCode:'legacy'}]};
 const db={...structuredClone(original),xbzCatalog:[],settings:{spotSync:{enabled:true}}};
 const stage=normalizeRows([row(1),row(2)],db.xbzCatalog,db.itemLibrary,'2026-09-19T00:00:00Z');
 assert.equal(stage.summary.received,2);assert.equal(stage.summary.manualOverlaps,1);assert.equal(stage.summary.missingImages,0);assert.equal(stage.items[0].cost,19.5);assert.equal(db.xbzCatalog.length,0);
 assert.throws(()=>importStage(db,{...stage,dbHash:'bad'}),/alterado/);
 assert.equal(importStage(db,stage).imported,2);assert.equal(db.xbzCatalog.length,2);
 assert.equal(db.settings.xbzSync.enabled,true);assert.equal(searchUnified(db,'XBZ-1').items.filter(x=>x.kind==='xbz').length,1);
 assert.equal(searchUnified(db,'',50,0,{supplier:'XBZ'}).items.length,3); // 2 XBZ API and legacy product remain
 for(const [k,v] of Object.entries(original))assert.deepEqual(db[k],v,k+' preserved');
 const twice=normalizeRows([row(1),row(2)],db.xbzCatalog,db.itemLibrary);assert.equal(twice.summary.unchanged,2);importStage(db,twice);
 assert.throws(()=>normalizeRows([row(1),row(1)]),/bloqueada/);assert.throws(()=>normalizeRows([{codigo:'A',nome:'A'}]),/nenhum preço/);assert.throws(()=>normalizeRows([{codigo:'A',nome:'A',preco:'5'}]),/nenhum estoque/);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xbz-test-'));
 try{
 let t=Date.parse('2026-09-19T04:00:00.000Z'),requests=0;
 const fakeFetch=async(u,opts)=>{requests++;const url=new URL(u);assert.equal(url.origin,'https://api.minhaxbz.com.br:5001');assert.equal(url.pathname,'/api/clientes/GetListaDeProdutos');assert.equal(url.searchParams.get('cnpj'),'00000000000000');assert.equal(url.searchParams.get('token'),'TEST_ONLY_SECRET');assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify([row(1),row(2)])}};
 const x=new XbzConnector({dir,now:()=>t,fetchImpl:fakeFetch,credentialsProvider:()=>({cnpj:'00000000000000',token:'TEST_ONLY_SECRET'})});
 assert.equal(x.status().requestsToday,0);const first=await x.get({allowFetch:true});assert.equal(first.fromCache,false);assert.equal(requests,1);assert.equal(x.status().requestsToday,1);
 const second=await x.get({allowFetch:true});assert.equal(second.fromCache,true);assert.equal(requests,1);
 await assert.rejects(x.refresh(),/12 horas/);assert.equal(x.status().requestsToday,1);
 const x2=new XbzConnector({dir,now:()=>t,fetchImpl:fakeFetch,credentialsProvider:()=>({cnpj:'00000000000000',token:'TEST_ONLY_SECRET'})});assert.equal((await x2.get({allowFetch:true})).fromCache,true);
 t+=INTERVAL_MS+1000;assert.equal((await x2.get({allowFetch:true})).fromCache,false);assert.equal(requests,2);assert.equal(x2.status().requestsToday,2);
 const cache=fs.readFileSync(path.join(dir,'xbz-feed-cache.json'),'utf8');assert(!cache.includes('TEST_ONLY_SECRET'));assert(!cache.includes('00000000000000'));
 assert.equal(fs.statSync(path.join(dir,'xbz-rate-ledger.json')).mode&0o077,0);assert.equal(fs.statSync(path.join(dir,'xbz-feed-cache.json')).mode&0o077,0);
 // HTTP 401 is not retried automatically and leaves the last valid snapshot intact.
 const fail=new XbzConnector({dir,now:()=>t+INTERVAL_MS+1,fetchImpl:async()=>({ok:false,status:401}),credentialsProvider:()=>({cnpj:'00000000000000',token:'TEST_ONLY_SECRET'})});
 await assert.rejects(fail.refresh(),/401/);assert.equal(fail.status().requestsToday,1,'daily quota resets after midnight São Paulo');assert.equal(fail.cache().products.length,2);
 const ledger=fail.ledger();fs.writeFileSync(path.join(dir,'xbz-rate-ledger.json'),JSON.stringify({...ledger,requests:MAX_PER_DAY}));assert.throws(()=>fail.reserve(),/limite preventivo/i);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
 const root=path.join(__dirname,'..'),server=fs.readFileSync(path.join(root,'server.js'),'utf8'),ui=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
 assert(server.includes("confirmation!=='IMPORTAR XBZ'"));assert(server.includes("createBackup('antes-importacao-xbz')"));assert(server.includes("const xbzTimer=setInterval"));assert(!server.includes("app.post('/api/integrations/xbz/sync',"),'old unthrottled route must be removed');
 assert(ui.includes('function openXbzQuoteItem')&&ui.includes('xbzSnapshot:{source:')&&ui.includes("if(item.kind==='xbz')return openXbzQuoteItem(item)"));
 assert.equal(hashCatalog(db.xbzCatalog).length,64);
 console.log('XBZ_TESTES_OK: cache 12h, quota durável 20/24, URL fixa, sem credenciais expostas, HTTP 401 sem retry, prévia, backup, idempotência, histórico e catálogos preservados, orçamentos sem compra. Testes com dados simulados; API real ainda NÃO testada.');
})().catch(e=>{console.error(e);process.exitCode=1});
