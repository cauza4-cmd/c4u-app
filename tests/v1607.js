'use strict';
/* Regressões v16.0.7. Todos os writes usam um banco temporário, nunca data/db.json. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'c4u-1607-'));
const dbPath=path.join(temp,'db.json');
fs.copyFileSync(path.join(root,'data/db.json'),dbPath);
const seed=JSON.parse(fs.readFileSync(dbPath,'utf8'));
const admin=seed.users.find(u=>u.active!==false&&u.role==='Administrador');
assert(admin);
const seller={id:88888,name:'Usuário de teste',role:'Teste',permissions:['quotes']};
const qId=999000;
seed.quotes.push({id:qId,number:'ORC-TESTE',clientId:0,clientSnapshot:{company:'Cliente de teste'},salespersonId:admin.id,salesperson:admin.name,items:[{qty:3,productName:'Produto teste'}],total:192.45,paymentDueDate:'2026-10-01',status:'quotation',createdAt:new Date().toISOString()});
fs.writeFileSync(dbPath,JSON.stringify(seed));
process.env.C4U_DATA_DIR=temp;process.env.C4U_BACKUP_DIR=path.join(temp,'backups');process.env.PORT='39997';process.env.HOST='127.0.0.1';
const routes={};const express=()=>({set(){},use(){},get(p,fn){routes['GET '+p]=fn},post(p,fn){routes['POST '+p]=fn},put(p,fn){routes['PUT '+p]=fn},delete(p,fn){routes['DELETE '+p]=fn},patch(p,fn){routes['PATCH '+p]=fn},listen(){return {close(){}}}});
express.json=()=>()=>{};express.static=()=>()=>{};
const before=Module._load;Module._load=function(req,...args){return req==='express'?express:before.call(this,req,...args)};
try{require('../server.js')}finally{Module._load=before}
function call(route,params={},body={},user=admin){const res={statusCode:200,status(n){this.statusCode=n;return this},json(x){this.body=x;return this},end(){return this}};const handler=routes['POST '+route];assert(handler,`Rota ${route} ausente`);handler({params,body,user,method:'POST',headers:{},query:{}},res);return res}
try{
 let r=call('/api/quotes/:id/convert',{id:qId},{},seller);assert.equal(r.statusCode,403,'A conversão respeita acesso a pedidos');
 assert.equal(JSON.parse(fs.readFileSync(dbPath)).orders.length,0,'Sem alteração por usuário não autorizado');
 r=call('/api/quotes/:id/convert',{id:qId});assert.equal(r.statusCode,201);
 const order=r.body;assert.equal(order.quoteId,qId);assert.equal(order.total,192.45);
 let saved=JSON.parse(fs.readFileSync(dbPath,'utf8'));
 assert.equal(saved.orders.length,1);assert.equal(saved.finance.length,1);
 assert.equal(saved.finance[0].orderId,order.id);assert.equal(saved.finance[0].amount,192.45);assert.equal(saved.finance[0].dueDate,'2026-10-01');
 assert.equal(saved.quotes.find(q=>q.id===qId).status,'approved');
 r=call('/api/quotes/:id/convert',{id:qId});assert.equal(r.statusCode,201);
 saved=JSON.parse(fs.readFileSync(dbPath,'utf8'));
 assert.equal(saved.orders.length,1,'Conversão repetida não duplica pedido');assert.equal(saved.finance.length,1,'Conversão repetida não duplica financeiro');
 r=call('/api/orders',{}, {items:[{qty:2,unitCost:10,personalizationUnit:0,freight:0,taxPercent:13,profitMargin:30,commissionMargin:3}],clientSnapshot:{company:'Cliente de teste'},paymentDueDate:'2026-10-02'});
 assert.equal(r.statusCode,201);saved=JSON.parse(fs.readFileSync(dbPath,'utf8'));
 assert.equal(saved.orders.length,2);assert.equal(saved.finance.length,2);
 assert.equal(saved.finance[1].orderId,r.body.id);
 const front=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
 assert(!front.includes("prompt('Novo subtópico:'"),'Não pode usar prompt para subtópicos');
 assert(!front.includes("prompt('Título do novo mapa mental:"),'Não pode usar prompt para criar mapa');
 assert(front.includes('mindNodeLabel')&&front.includes('const label=\'Nova ideia\'')&&front.includes('c4uNewMapModal'),'Subtópico é inserido diretamente, e novo mapa tem modal próprio');
 assert(front.includes('if(!c4uCacheReady)')&&front.includes('c4uLastRefresh>30000'),'Navegação utiliza cache imediatamente');
 assert(front.includes('c4uRefreshEpoch++'),'Cache é invalidado ao trocar de usuário');
 console.log('PASSOU v16.0.7: conversão orçamento→pedido, financeiro idempotente, pedido manual, permissões, navegação via cache, troca de conta, formulários internos de mapas.');
}finally{fs.rmSync(temp,{recursive:true,force:true})}
