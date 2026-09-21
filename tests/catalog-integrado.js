'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {searchUnified}=require('../lib/unified-catalog');
const {SOURCE,planSpreadsheetCleanup,applySpreadsheetCleanup}=require('../lib/spreadsheet-cleanup');
const {importProducts}=require('../lib/imports');
const db={itemLibrary:[
 {id:1,source:SOURCE,active:true,internalCode:'AS-OLD',name:'Item antigo da planilha',category:'Bolsas',subcategory:'Térmicas'},
 {id:2,source:SOURCE,active:true,internalCode:'AS-USED',name:'Item referenciado na cotação',category:'Bolsas',subcategory:'Mochilas, Térmicas'},
 {id:3,source:SOURCE,active:true,internalCode:'AS-EDIT',name:'Item editado',updatedAt:'2026-01-01'},
 {id:4,source:'Cadastro manual',active:true,internalCode:'AS-MAN',name:'Bolsa manual'},
 {id:5,source:'Asia Import - API',active:true,internalCode:'AS-API',name:'Bolsa fornecedor API',category:'Bolsas',subcategory:'Mochilas'}
],products:[{id:2,integration:'XBZ',name:'Bolsa XBZ',supplierCode:'XBZ-1'}],physicalStock:[{id:11,libraryItemId:2,code:'ST-1',name:'Estoque físico',available:5}],spotCatalog:[{source:'SPOT',sku:'11112-104',reference:'11112',name:'Mochila azul SPOT',images:['https://www.spotgifts.com.br/fotos/produtos/11112_104.jpg'],price:{yourPrice:50,tiers:[{minQty:100,supplierPrice:45}]},supplierStock:100}],quotes:[{id:7,items:[{libraryItemId:2,unitCost:12}]}],orders:[{id:6,items:[{librarySnapshot:{id:2},unitCost:12}]}],spreadsheets:[{id:4,title:'Planilha de custos'}],suppliers:[{id:4,name:'Asia Import'}],settings:{spotSync:{stockHours:12,catalogHours:24}},counters:{itemLibrary:12,suppliers:5}};
const originals={quotes:JSON.stringify(db.quotes),orders:JSON.stringify(db.orders),physicalStock:JSON.stringify(db.physicalStock),spotCatalog:JSON.stringify(db.spotCatalog),spreadsheets:JSON.stringify(db.spreadsheets)};
const all=searchUnified(db,'bolsa');assert(all.items.some(x=>x.supplier==='XBZ'));assert(all.items.some(x=>x.supplier==='Ásia'));assert(all.items.some(x=>x.supplier==='Manuais'));
let result=searchUnified(db,'',30,0,{supplier:'Ásia'});assert.equal(result.total,4);assert(result.categories.includes('Bolsas'));
result=searchUnified(db,'',30,0,{supplier:'Ásia',category:'Bolsas',subcategory:'Mochilas'});assert.equal(result.total,2);
result=searchUnified(db,'11112-104');assert.equal(result.items.length,1);assert.equal(result.items[0].supplier,'SPOT');
const plan=planSpreadsheetCleanup(db);assert.equal(plan.candidates,3);assert.equal(plan.deleteCount,1);assert.equal(plan.archiveCount,2);
const summary=applySpreadsheetCleanup(db,plan);assert.equal(summary.deleted,1);assert.equal(summary.archived,2);
assert(!db.itemLibrary.some(x=>x.id===1));assert.equal(db.itemLibrary.find(x=>x.id===2).active,false);assert.equal(db.itemLibrary.find(x=>x.id===3).active,false);
assert.equal(db.itemLibrary.find(x=>x.id===4).active,true);assert.equal(db.itemLibrary.find(x=>x.id===5).active,true);
for(const [k,v] of Object.entries(originals))assert.equal(JSON.stringify(db[k]),v,`${k} must not change`);
assert.equal(searchUnified(db,'AS-OLD').total,0);assert.equal(searchUnified(db,'AS-USED').total,0);
const beforeManual=JSON.stringify(db.itemLibrary.find(x=>x.id===4));
const imported=importProducts(db,[{referencia:'AS-MAN',nome:'Novo produto real da Ásia',preco:13,categorias:'Mochilas'}],{source:'Asia Import - API'});
assert.equal(imported.created,1);assert.equal(db.itemLibrary.find(x=>x.id===4).source,'Cadastro manual');assert.equal(JSON.stringify(db.itemLibrary.find(x=>x.id===4)),beforeManual);
assert(db.itemLibrary.some(x=>x.source==='Asia Import - API'&&x.internalCode==='AS-MAN'));
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'public/app.js'),'utf8'),server=fs.readFileSync(path.join(root,'server.js'),'utf8');
assert(app.includes('function paintLibrarySupplierFilters')&&app.includes('function previewSpreadsheetCleanup'));
assert(app.includes('function mindMapLinkNodes')&&app.includes('c4u-mind-node-notes'));
assert(app.includes('function spotSyncCost')&&app.includes('function openSpotQuoteItem'));
assert(server.includes('/api/itemLibrary/spreadsheet-cleanup/preview')&&server.includes('/api/itemLibrary/spreadsheet-cleanup/execute'));
assert(!/spotConnector\.(?:order|sendOrder|createOrder|cancelOrder)\s*\(/i.test(server));
console.log('CATALOGO_INTEGRADO_TESTES_OK: fornecedores, categorias/subcategorias, busca, isolamento API, limpeza seletiva, histórico, estoque, SPOT e mapa preservados.');
