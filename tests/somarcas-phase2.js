'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {normalizeRows,importStage,hashCatalog,PRICE_OPTIONS}=require('../lib/somarcas-catalog');
const {searchUnified}=require('../lib/unified-catalog');
const {safeRow,SomarcasConnector,ENDPOINT}=require('../lib/somarcas-connector');
const sample=(code='AV-00111',name='Avental Preto')=>({codigo:code,titulo:name,descricao:'Teste de descrição',url_foto:'https://cdngeneral2.somarcas.com.br/clientes/100px/AV00111.gif',tipo_gravacao:'Silk',ncm:'6217.10.00',estoque:0,ipi:0,estado:'SP',preco_sem_gravacao_sem_impostos:20.97,preco_com_gravacao_sem_impostos:21.67,preco_sem_gravacao_com_impostos:23.1,preco_com_gravacao_com_impostos:24.5,matriz_de_categorias:[{nome:'Vestuário'},{nome:'Aventais'}],quantidade_minima_sugerida:25,data_ultima_atualizacao:'2026-09-18 10:00:00'});
(async()=>{
 const example=sample();
 assert.equal(PRICE_OPTIONS.length,4);
 const safe=safeRow({...example,senha:'não copiar',matriz_de_fotos_adicionais:['https://www.somarcas.com.br/fotos/a.jpg','http://unsafe.example.org/x.png']});
 assert.equal(safe.categoria,'Vestuário');assert.equal(safe.subcategoria,'Aventais');assert.equal(safe.matriz_de_fotos_adicionais.length,1);assert.equal(safe.senha,undefined);
 const db={somarcasCatalog:[],itemLibrary:[{id:3,source:'Cadastro manual',internalCode:example.codigo,name:'Produto manual',active:true}],spotCatalog:[{sku:'11112-104',source:'SPOT',name:'Mochila SPOT',price:{yourPrice:50}}],physicalStock:[{id:4,name:'Estoque físico',quantity:10}],quotes:[{id:8,items:[{supplierCode:'AV-00111',unitCost:37,somarcasSnapshot:{costAtQuote:37}}]}],orders:[{id:9,items:[{unitCost:15}]}],settings:{spotSync:{stockHours:12,catalogHours:24}}};
 const preserved={itemLibrary:JSON.stringify(db.itemLibrary),spotCatalog:JSON.stringify(db.spotCatalog),physicalStock:JSON.stringify(db.physicalStock),quotes:JSON.stringify(db.quotes),orders:JSON.stringify(db.orders),settingsSpot:JSON.stringify(db.settings.spotSync)};
 let stage=normalizeRows([example,sample('BC-02040','Balança')],db.somarcasCatalog,db.itemLibrary,'2026-09-18T11:00:00Z');
 assert.equal(stage.summary.received,2);assert.equal(stage.summary.new,2);assert.equal(stage.summary.manualOverlaps,1);assert.equal(stage.summary.missingStock,0);assert.equal(stage.summary.missingImages,0);assert.equal(stage.items[0].supplierStock,0);assert.equal(stage.items[0].prices.preco_com_gravacao_com_impostos,24.5);
 assert.equal(db.somarcasCatalog.length,0,'preview must not mutate db');
 assert.throws(()=>normalizeRows([example,example]),/bloqueada/);assert.throws(()=>normalizeRows([{...example,estado:'PR'}]),/bloqueada/);assert.throws(()=>normalizeRows([{...example,preco_sem_gravacao_sem_impostos:null,preco_com_gravacao_sem_impostos:null,preco_sem_gravacao_com_impostos:null,preco_com_gravacao_com_impostos:null}]),/bloqueada/);assert.throws(()=>normalizeRows([]),/vazia/);
 assert.throws(()=>importStage(db,{...stage,dbHash:'wrong'}),/alterado/);
 const summary=importStage(db,stage,'2026-09-18T11:00:00Z');assert.equal(summary.imported,2);assert.equal(db.somarcasCatalog.length,2);
 let results=searchUnified(db,'AV-00111');assert.equal(results.total,2,'supplier overlap must stay separate');assert(results.items.some(x=>x.kind==='somarcas'));assert(results.items.some(x=>x.kind==='library'));
 results=searchUnified(db,'',40,0,{supplier:'Só Marcas'});assert.equal(results.total,2);assert(results.categories.includes('Vestuário'));assert.equal(results.items[0].prices.preco_com_gravacao_com_impostos,24.5);
 results=searchUnified(db,'',40,0,{supplier:'Só Marcas',category:'Vestuário',subcategory:'Aventais'});assert.equal(results.total,2);
 for(const [key,value] of Object.entries(preserved)){const current=key==='settingsSpot'?db.settings.spotSync:db[key];assert.equal(JSON.stringify(current),value,`${key} changed`)}
 stage=normalizeRows([example,sample('BC-02040','Balança')],db.somarcasCatalog,db.itemLibrary,'2026-09-18T12:00:00Z');assert.equal(stage.summary.unchanged,2);importStage(db,stage);assert.equal(db.somarcasCatalog.length,2);
 stage=normalizeRows([sample('BC-02040','Balança')],db.somarcasCatalog,db.itemLibrary);assert.equal(stage.summary.missingRetained,1);importStage(db,stage);assert.equal(db.somarcasCatalog.length,2);assert.equal(db.somarcasCatalog.find(x=>x.code==='AV-00111').missingFromLatestFeed,true);assert.equal(searchUnified(db,'AV-00111').items.filter(x=>x.kind==='somarcas').length,0);
 // Mock verifies only GET to fixed HTTPS endpoint, server-side Basic auth; never attempts supplier orders.
 let calls=0;const connector=new SomarcasConnector({credentialsProvider:()=>({username:'mock',password:'mock'}),fetchImpl:async(url,opts)=>{calls++;assert.equal(url,ENDPOINT);assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');assert(opts.headers.Authorization.startsWith('Basic '));return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify([example])}}});
 const fetched=await connector.catalog();assert.equal(fetched.data.length,1);assert.equal(calls,1);assert.equal(fetched.data[0].preco_com_gravacao_com_impostos,24.5);
 const root=path.join(__dirname,'..'),server=fs.readFileSync(path.join(root,'server.js'),'utf8'),app=fs.readFileSync(path.join(root,'public/app.js'),'utf8'),html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
 assert(server.includes('/api/integrations/somarcas/catalog/prepare')&&server.includes('/api/integrations/somarcas/catalog/import'));assert(server.includes('somarcasAdmin')&&server.includes('antes-importacao-somarcas'));assert(server.includes('IMPORTAR SO MARCAS'));assert(!/somarcasConnector\.(?:order|sendOrder|createOrder|cancelOrder|purchase)\s*\(/i.test(server));
 assert(app.includes('somarcasPriceTable')&&app.includes('function openSomarcasQuoteItem')&&app.includes('somarcasSnapshot')&&app.includes("if(item.kind==='somarcas')return openSomarcasQuoteItem(item)"));assert(html.includes('c4u-somarcas.css'));
 assert.equal(hashCatalog(db.somarcasCatalog).length,64);
 console.log('SOMARCAS_FASE2_TESTES_OK: 4 preços, imagem, categorias, 0 estoque, prévia, permissão admin, idempotência, preservação dos outros dados, orçamentos imutáveis, GET apenas e sem compra.');
})().catch(e=>{console.error(e);process.exitCode=1});
