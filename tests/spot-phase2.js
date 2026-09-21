'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {normalizeFeeds,importStage,searchCatalog,hashCatalog}=require('../lib/spot-catalog');
const fixture={
 products:{Products:[{ProdReference:'11112',Name:'Mochila para notebook',MainImage:'https://images.example.com/generic.jpg'},{ProdReference:'11110',Name:'Caneta esferográfica',MainImage:'https://images.example.com/caneta.jpg'}]},
 optionalsComplete:{OptionalsComplete:[{ProdReference:'11112',Sku:'11112-104',Name:'Mochila para notebook',ColorCode:'04',OptionalImage1:'11112_104.jpg'},{ProdReference:'11112',Sku:'11112-115',Name:'Mochila para notebook',ColorCode:'15',OptionalImage1:'11112_115.jpg'},{ProdReference:'11110',Sku:'11110-105',Name:'Caneta esferográfica',ColorDesc1:'Preto',OptionalImage1:'javascript:alert(1)'}]},
 colors:{Colors:[{ColorCode:'04',Description:'Azul'},{ColorCode:'15',Description:'Vermelho'}]},
 stocks:{Stocks:[{Sku:'11112-104',Quantity:4668,NextQuantity1:50,NextDate1:'2026-11-01'},{Sku:'11112-115',Quantity:51},{Sku:'11110-105',Quantity:1118}]},
 optionalsPrice:{OptionalsPrice:[{Sku:'11112-104',YourPrice:69.90,MinQt1:1,Price1:69.90,MinQt2:100,Price2:64.90},{Sku:'11112-115',YourPrice:69.90},{Sku:'11110-105',YourPrice:1.99}]}
};
const manual=[{id:5,internalCode:'11112-104',name:'Meu produto manual'}];
const stage=normalizeFeeds(fixture,[],manual,'2026-09-18T10:00:00.000Z');
assert.equal(stage.summary.products,2);assert.equal(stage.summary.valid,3);
assert.equal(stage.summary.new,3);assert.equal(stage.summary.manualOverlaps,1);
assert.equal(stage.summary.pricesUnverified,true);assert.equal(stage.summary.ordersToSupplier,false);
const a=stage.items.find(x=>x.sku==='11112-104'),b=stage.items.find(x=>x.sku==='11112-115');
assert.equal(a.colorName,'Azul');assert.equal(b.colorName,'Vermelho');assert.equal(a.supplierStock,4668);assert.equal(b.supplierStock,51);
assert.equal(a.images[0],'https://www.spotgifts.com.br/fotos/produtos/11112_104.jpg');assert.equal(b.images[0],'https://www.spotgifts.com.br/fotos/produtos/11112_115.jpg');assert.notEqual(a.images[0],b.images[0]);
assert.equal(stage.summary.imageVariants,2);assert.equal(stage.summary.genericImages,1);assert.equal(stage.summary.missingImages,0);
assert.deepEqual(a.price.tiers,[{minQty:1,supplierPrice:69.9},{minQty:100,supplierPrice:64.9}]);
assert.equal(a.price.verified,false);assert.equal(a.price.currency,null);assert.equal(stage.items[2].images[0],'https://images.example.com/caneta.jpg');
const db={itemLibrary:structuredClone(manual),physicalStock:[{id:9,available:99}],orders:[{id:15}],spotCatalog:[],settings:{}};
const original={itemLibrary:JSON.stringify(db.itemLibrary),physicalStock:JSON.stringify(db.physicalStock),orders:JSON.stringify(db.orders)};
const imported=importStage(db,stage);
assert.equal(imported.total,3);assert.equal(db.spotCatalog.length,3);
assert.equal(JSON.stringify(db.itemLibrary),original.itemLibrary);assert.equal(JSON.stringify(db.physicalStock),original.physicalStock);assert.equal(JSON.stringify(db.orders),original.orders);
assert.deepEqual(searchCatalog(db.spotCatalog,'11112').map(x=>x.sku),['11112-104','11112-115']);
assert.deepEqual(searchCatalog(db.spotCatalog,'caneta').map(x=>x.sku),['11110-105']);assert.equal(searchCatalog(db.spotCatalog,'ca').length,1);
assert.deepEqual(searchCatalog(db.spotCatalog,'zz'),[]);
assert.throws(()=>importStage(db,stage),/Catálogo alterado/);
const second=normalizeFeeds(fixture,db.spotCatalog,db.itemLibrary);assert.equal(second.summary.new,0);assert.equal(second.summary.update,0);assert.equal(second.summary.unchanged,3);
const snapshot=hashCatalog(db.spotCatalog);importStage(db,second);assert.equal(hashCatalog(db.spotCatalog),snapshot,'Importação repetida não altera dados idênticos');
const broken=structuredClone(fixture);broken.optionalsPrice.OptionalsPrice=[{Sku:'11112-104',YourPrice:69.9},{Sku:'11112-104',YourPrice:59.9}];
assert.throws(()=>normalizeFeeds(broken,[],manual),/inconsistências/,'Um feed com preços ambíguos deve bloquear a importação');
const bad=structuredClone(fixture);bad.stocks.Stocks=[];assert.throws(()=>normalizeFeeds(bad),/vazio/);
for(const unsafe of ['../outra.jpg','https://evil.test@spotgifts.com.br/1.jpg','http://example.org/a.jpg','javascript:alert(1)','/etc/passwd','a.svg','a.jpg?token=1','a..jpg']){
 const copy=structuredClone(fixture);copy.optionalsComplete.OptionalsComplete[0].OptionalImage1=unsafe;
 const staged=normalizeFeeds(copy,[],manual);
 assert.equal(staged.items[0].images[0],'https://images.example.com/generic.jpg',`Imagem insegura aceita: ${unsafe}`);
}
const root=path.resolve(__dirname,'..');const connector=fs.readFileSync(path.join(root,'lib/spot-connector.js'),'utf8');
assert(!/(?:this\.)?(?:request|fetchImpl)\s*\(\s*['"`]\s*(?:OrderV1|ServiceOrderV1|CancelOrderV1)/i.test(connector),'Proibido envio de pedidos ao fornecedor');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');assert(server.includes("confirmation!=='IMPORTAR SPOT'"));assert(server.includes("req.user.role!=='Administrador'"));
assert(server.includes("createBackup('antes-importacao-spot')"));
console.log('SPOT_FASE2_TESTES_OK: cores por SKU, faixas de preço importadas, estoque separado, proteção manual, prévia, idempotência, rejeição de feeds inválidos, nenhuma compra.');
// Teste de custo automático usando as próprias funções da interface, sem simular a API real.
const vm=require('node:vm');
const ui=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const start=ui.indexOf('function spotCostForQuantity('),end=ui.indexOf('function openSpotQuoteItem(',start);
assert(start>=0&&end>start,'Funções do preço automático não encontradas na interface');
const priceFunctions=vm.runInNewContext(ui.slice(start,end)+'\n({spotCostForQuantity,spotSyncCost})');
const {spotCostForQuantity,spotSyncCost}=priceFunctions;
const price={yourPrice:69.9,tiers:[{minQty:1,supplierPrice:69.9},{minQty:100,supplierPrice:64.9},{minQty:500,supplierPrice:59.9}]};
assert.equal(spotCostForQuantity(price,1).cost,69.9);
assert.equal(spotCostForQuantity(price,25).cost,69.9);
assert.equal(spotCostForQuantity(price,50).cost,69.9);
assert.equal(spotCostForQuantity(price,100).cost,64.9);
assert.equal(spotCostForQuantity(price,500).cost,59.9);
assert.equal(spotCostForQuantity(price,50).source,'tier');
assert.equal(spotCostForQuantity({yourPrice:0.342,tiers:[]},50).cost,0.342,'Preserva custos com três casas');
assert.equal(spotCostForQuantity({yourPrice:32.9,tiers:[]},50).cost,32.9,'Usa YourPrice quando não há faixas');
assert.equal(spotCostForQuantity({yourPrice:null,tiers:[{minQty:100,supplierPrice:20}]},50),null,'Não antecipa faixa de 100 para 50');
assert.equal(spotCostForQuantity({yourPrice:null,tiers:[{minQty:100,supplierPrice:20}]},100).cost,20);
assert.equal(spotCostForQuantity({yourPrice:0,tiers:[]},50),null,'Não cria orçamento sem preço de fornecedor');
assert.equal(spotCostForQuantity({yourPrice:null,tiers:[]},50),null);
assert.equal(spotCostForQuantity(price,0),null);
const automatic={qty:50,unitCost:69.9,spotSnapshot:{autoSupplierPrice:true,pricing:price}};
const changedQty=spotSyncCost(automatic,100,69.9);
assert.equal(changedQty.cost,64.9,'Trocar quantidade atualiza o custo com faixa SPOT');
assert.equal(changedQty.snapshot.autoSupplierPrice,true);
const overridden=spotSyncCost(automatic,50,66);
assert.equal(overridden.cost,66);assert.equal(overridden.snapshot.autoSupplierPrice,false,'Edição explícita preserva o custo manual');
assert.equal(spotSyncCost({...automatic,unitCost:66,spotSnapshot:overridden.snapshot},100,66).cost,66,'Não sobrescreve edições manuais');
assert.equal(spotSyncCost({qty:50,unitCost:17},100,17).cost,17,'Não altera produtos não SPOT');
assert(!ui.includes('spotQuoteCost')&&!ui.includes('spotQuoteChecked')&&!ui.includes('manualCostConfirmed:true'),'Remova modal obrigatório de custo/checkbox');
assert(ui.includes('spotSnapshot:{sku:item.sku')&&ui.includes('autoSupplierPrice:true,ordersToSupplier:false'),'Preço automático deve manter referência e proibir pedidos externos');
assert(ui.includes('if(window.qItems.some(x=>x.spotSnapshot?.autoSupplierPrice&&!(Number(x.unitCost)>0)))'),'Bloqueio de orçamento com custo SPOT ausente');
// Teste de interação: um clique adiciona o item sem modal, preenchendo preço do catálogo.
const itemUi=ui.slice(ui.indexOf('function openSpotQuoteItem('),ui.indexOf('function addLibraryItemToQuote(',ui.indexOf('function openSpotQuoteItem(')));
const notifications=[];const fakeWindow={qItems:[]};let paints=0,calcs=0;
const fakeDocument={getElementById:()=>({remove(){}})};
const quoteUi=vm.runInNewContext(ui.slice(start,end)+'\n'+itemUi+'\n({openSpotQuoteItem,spotCostForQuantity,spotSyncCost})',{window:fakeWindow,document:fakeDocument,blankItem:()=>({qty:50,unitCost:0}),paintItems:()=>paints++,calcUI:()=>calcs++,toast:t=>notifications.push(t)});
const picked={sku:'11112-104',reference:'11112',name:'Mochila azul',description:'Mochila',color:'Azul',stock:4668,lastSupplierSync:'2026-09-18',imageKind:'variacao',images:['https://www.spotgifts.com.br/fotos/produtos/11112_104.jpg'],price};
quoteUi.openSpotQuoteItem(picked);
assert.equal(fakeWindow.qItems.length,1);assert.equal(fakeWindow.qItems[0].unitCost,69.9);assert.equal(fakeWindow.qItems[0].qty,50);
assert.equal(fakeWindow.qItems[0].spotSnapshot.sku,'11112-104');assert.equal(fakeWindow.qItems[0].spotSnapshot.autoSupplierPrice,true);
assert.equal(fakeWindow.qItems[0].spotSnapshot.ordersToSupplier,false);
assert.equal(paints,1);assert.equal(calcs,1);
quoteUi.openSpotQuoteItem({...picked,sku:'sem-preco',price:{yourPrice:null,tiers:[]}});
assert.equal(fakeWindow.qItems.length,1,'Itens sem preço devem ser recusados, nunca usar custo zero');
assert(notifications.some(t=>t.includes('não informou preço')));
quoteUi.openSpotQuoteItem({...picked,sku:'min-100',price:{yourPrice:null,tiers:[{minQty:100,supplierPrice:45}]}});
assert.equal(fakeWindow.qItems[1].qty,100,'Escolhe a primeira quantidade elegível quando YourPrice inexiste');
assert.equal(fakeWindow.qItems[1].unitCost,45);
// O editor existente deve refletir a faixa quando a quantidade mudar, sem exibir confirmação.
const syncUi=ui.slice(ui.indexOf('function syncItem('),ui.indexOf('function readImage(',ui.indexOf('function syncItem(')));
const quoteFields={productId:'0',supplierId:'0',supplierCode:'11112-104',description:'Mochila',qty:'100',unitCost:'69.9',personalizationUnit:'0',freight:'0',taxPercent:'13',profitMargin:'30',commissionMargin:'3'};
const card={fields:Object.fromEntries(Object.entries(quoteFields).map(([k,v])=>[k,{value:v}]))};
const actualEditor=vm.runInNewContext(ui.slice(start,end)+'\n'+syncUi+'\n({syncItem})',{window:fakeWindow,cache:{products:[]},$:selector=>card.fields[selector.match(/name='([^']+)'/)?.[1]],calcUI:()=>{},});
actualEditor.syncItem(card,0);
assert.equal(fakeWindow.qItems[0].unitCost,64.9,'Formulário recalcula o custo após alterar quantidade');
assert.equal(card.fields.unitCost.value,'64.9','Campo visível mostra o preço recalculado');
card.fields.unitCost.value='60';actualEditor.syncItem(card,0);
assert.equal(fakeWindow.qItems[0].unitCost,60);assert.equal(fakeWindow.qItems[0].spotSnapshot.autoSupplierPrice,false);
card.fields.qty.value='200';actualEditor.syncItem(card,0);
assert.equal(fakeWindow.qItems[0].unitCost,60,'Edição voluntária não pode ser sobrescrita');
console.log('SPOT_PRECO_AUTOMATICO_TESTES_OK: preço direto da API, faixas 1/25/50/100/500, precisão, ausência de preço, mudança de quantidade e respeito à edição manual; sem compras.');

