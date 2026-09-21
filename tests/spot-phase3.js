'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {applyStockFeed,buildCatalogStage,applyCatalogStage,syncStatus,due,STOCK_INTERVAL_MS,CATALOG_INTERVAL_MS}=require('../lib/spot-sync');
const at='2026-09-18T10:00:00.000Z';
const feeds={
 products:{Products:[{ProdReference:'11112',Name:'Mochila para notebook',MainImage:'11112_set.jpg'}]},
 optionalsComplete:{OptionalsComplete:[{Sku:'11112-104',ProdReference:'11112',Name:'Mochila azul',ColorCode:'104',OptionalImage1:'11112_104.jpg'},{Sku:'11112-115',ProdReference:'11112',Name:'Mochila bordô',ColorCode:'115',OptionalImage1:'11112_115.jpg'}]},
 colors:{Colors:[{ColorCode:'104',Description:'Azul'},{ColorCode:'115',Description:'Bordô'}]},
 stocks:{Stocks:[{Sku:'11112-104',Quantity:20,NextQuantity1:100,NextDate1:'2026-11-01'},{Sku:'11112-115',Quantity:50}]},
 optionalsPrice:{OptionalsPrice:[{Sku:'11112-104',YourPrice:10,MinQt1:1,Price1:10,MinQt2:100,Price2:9},{Sku:'11112-115',YourPrice:11,MinQt1:1,Price1:11}]}
};
let db={spotCatalog:[],itemLibrary:[{id:1,internalCode:'11112-104',name:'Item manual'}],physicalStock:[{id:1,available:900}],quotes:[{id:1,items:[{qty:100,unitCost:10,spotSnapshot:{sku:'11112-104',stockAtQuote:20}}]}],orders:[{id:1,total:1000}],finance:[{id:1,amount:1000}],settings:{}};
const stage0=require('../lib/spot-catalog').normalizeFeeds(feeds,[],db.itemLibrary,at);
require('../lib/spot-catalog').importStage(db,stage0,at);
assert.equal(db.spotCatalog.length,2);
const unaffected=Object.fromEntries(['itemLibrary','physicalStock','quotes','orders','finance'].map(key=>[key,JSON.stringify(db[key])]));
const originalPrice=JSON.stringify(db.spotCatalog[0].price);
const stocks={Stocks:[{Sku:'11112-104',Quantity:0,NextQuantity1:110,NextDate1:'2026-11-02'},{Sku:'11112-115',Quantity:75}]};
let status=applyStockFeed(db,stocks,'2026-09-18T22:00:00.000Z');
assert.equal(status.matched,2);assert.equal(status.updated,2);
assert.equal(db.spotCatalog[0].supplierStock,0,'Zero disponível é válido, não é nulo');
assert.equal(db.spotCatalog[1].supplierStock,75);
assert.equal(JSON.stringify(db.spotCatalog[0].price),originalPrice,'Atualização de estoque não altera preços');
assert.equal(db.settings.spotLastStockSync,'2026-09-18T22:00:00.000Z');
for(const [k,v] of Object.entries(unaffected))assert.equal(JSON.stringify(db[k]),v,k+' alterado indevidamente');
const before=JSON.stringify(db);
assert.throws(()=>applyStockFeed(db,{Stocks:[]}),/vazio/);assert.equal(JSON.stringify(db),before);
assert.throws(()=>applyStockFeed(db,{Stocks:[{Sku:'11112-104',Quantity:3},{Sku:'11112-104',Quantity:9}]}),/duplicado/);assert.equal(JSON.stringify(db),before);
assert.throws(()=>applyStockFeed(db,{Stocks:[{Sku:'11112-104',Quantity:'???'},{Sku:'11112-115',Quantity:4}]}),/inválida/);assert.equal(JSON.stringify(db),before);
assert.throws(()=>applyStockFeed(db,{Stocks:[{Sku:'11112-104',Quantity:4}]}),/incompleto/);assert.equal(JSON.stringify(db),before);
const changed=structuredClone(feeds);changed.optionalsPrice.OptionalsPrice[0].Price2=8.50;
const stage=buildCatalogStage(changed,db,'2026-09-19T10:00:00.000Z');
status=applyCatalogStage(db,stage,'2026-09-19T10:00:00.000Z');
assert.equal(status.ordersToSupplier,false);assert.equal(db.spotCatalog[0].price.tiers[1].supplierPrice,8.5);
assert.equal(db.spotCatalog[1].supplierStock,50,'Atualização diária inclui o estoque do feed completo');
for(const [k,v] of Object.entries(unaffected))assert.equal(JSON.stringify(db[k]),v,k+' alterado após preço/catálogo');
const broken=structuredClone(changed);broken.optionalsPrice.OptionalsPrice=[];
assert.throws(()=>buildCatalogStage(broken,db),/vazio/);
assert.equal(db.spotCatalog[0].price.tiers[1].supplierPrice,8.5,'Falha não modifica catálogo');
const next=syncStatus(db,Date.parse('2026-09-19T10:01:00Z'));
assert.equal(next.enabled,true);assert.equal(next.stockHours,12);assert.equal(next.catalogHours,24);assert.equal(next.ordersToSupplier,false);
assert.equal(next.nextStock,'2026-09-19T22:00:00.000Z');assert.equal(next.nextCatalog,'2026-09-20T10:00:00.000Z');
assert.equal(due('2026-09-18T00:00:00Z',STOCK_INTERVAL_MS,Date.parse('2026-09-18T11:59:59Z')),false);
assert.equal(due('2026-09-18T00:00:00Z',STOCK_INTERVAL_MS,Date.parse('2026-09-18T12:00:00Z')),true);
assert.equal(due('2026-09-18T00:00:00Z',CATALOG_INTERVAL_MS,Date.parse('2026-09-19T00:00:00Z')),true);
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
assert(server.includes("['stocks']")&&server.includes('for(const name of (mode==='),'Agenda utiliza exclusivamente feeds de leitura');
assert(server.includes('spotAutoTick')&&server.includes('setInterval')&&server.includes("req.user.role!=='Administrador'"));
assert(!/spotConnector\.(?:order|sendOrder|createOrder|cancelOrder)\s*\(/i.test(server),'Envio de compras ao fornecedor é proibido');
assert(!/\bOrderV1\s*\(/.test(server),'Não pode chamar endpoint de compras da SPOT');
const front=fs.readFileSync(path.join(__dirname,'..','public/app.js'),'utf8');
assert(front.includes('spotSyncStock')&&front.includes('spotSyncCatalog')&&front.includes('c4uNewMapModal'));
assert(front.includes('autoSupplierPrice:true,ordersToSupplier:false'),'Fase 2 de preço automático deve persistir');
console.log('SPOT_FASE3_TESTES_OK: agendas 12h/24h, custo/estoque isolados, segurança de feeds, falhas preservam dados, nenhuma compra, Fase 2 e mapas mantidos.');
