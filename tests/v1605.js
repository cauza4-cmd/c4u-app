'use strict';
/* Isolated route tests: stub only Express registration; all new handlers and filesystem are real.
   The test NEVER writes into the distributed data/db.json. */
const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),Module=require('module');
const {rank,searchItems,quality}=require('../lib/product-quality');
assert.deepEqual(searchItems([{name:'Caderno personalizado',internalCode:'CAD-A'},{name:'Caneta azul',internalCode:'CAN-A'},{name:'Caneta preta',internalCode:'CAN-B'}],'caneta').map(x=>x.internalCode),['CAN-A','CAN-B']);
assert.equal(searchItems([{name:'Caderno',internalCode:'CAD'}],'caneta').length,0);
assert.equal(searchItems([{name:'Caneta azul',internalCode:'AZ1'},{name:'Caneta azul',internalCode:'AZ2'}],'AZ2')[0].internalCode,'AZ2');
assert(quality([{id:1,name:'Caneta azul',internalCode:'A1',colors:['azul'],images:['foto']},{id:2,name:'Caneta preta',internalCode:'A2',colors:['preto'],images:['foto']}]).issues.some(x=>x.type==='shared-photo-different-colors'));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'c4u-1605-'));
fs.copyFileSync(path.resolve(__dirname,'../data/db.json'),path.join(temporary,'db.json'));
const initial=JSON.parse(fs.readFileSync(path.join(temporary,'db.json'),'utf8'));
const [admin,seller,third]=[initial.users.find(u=>u.active&&u.role==='Administrador'),initial.users.find(u=>u.active&&u.role==='Vendedor'),initial.users.filter(u=>u.active&&u.role==='Vendedor')[1]];
assert(admin&&seller&&third);
const threadId=11111;
initial.itemLibrary[0].images.push(initial.itemLibrary[0].images[0]);
initial.chatThreads.push({id:threadId,type:'direct',memberIds:[admin.id,seller.id],name:'',createdAt:new Date().toISOString(),lastReadBy:{}});
initial.counters.chatThreads=Math.max(initial.counters.chatThreads||0,threadId+1);
fs.writeFileSync(path.join(temporary,'db.json'),JSON.stringify(initial));
process.env.C4U_DATA_DIR=temporary;process.env.C4U_BACKUP_DIR=path.join(temporary,'backups');process.env.HOST='127.0.0.1';
const routes={};const express=()=>({set(){},use(){},get(p,fn){routes['GET '+p]=fn},post(p,fn){routes['POST '+p]=fn},put(p,fn){routes['PUT '+p]=fn},delete(p,fn){routes['DELETE '+p]=fn},patch(p,fn){routes['PATCH '+p]=fn},listen(_p,_h,_fn){return {close(){}}}});
express.json=()=>()=>{};express.static=()=>()=>{};
const original=Module._load;Module._load=function(request,...rest){return request==='express'?express:original.call(this,request,...rest)};
try{require('../server.js')}finally{Module._load=original}
function response(){return {statusCode:200,headers:{},status(n){this.statusCode=n;return this},json(body){this.body=body;return this},end(){this.ended=true;return this},setHeader(k,v){this.headers[k]=v;return this},sendFile(filename){this.sentFile=filename;return this},send(v){this.body=v;return this}}}
function call(method,route,user,params={},body={}){const handler=routes[method+' '+route];assert(handler,'Missing route '+method+' '+route);const res=response();handler({user,params,body,query:{},headers:{}},res);return res}
let r=call('POST','/api/mindmaps',admin,{}, {title:'Campanha interna'});assert.equal(r.statusCode,201);const map=r.body;
r=call('GET','/api/mindmaps/:id',third,{id:map.id});assert.equal(r.statusCode,404,'Unshared map must stay private');
r=call('GET','/api/mindmaps/:id',admin,{id:map.id});assert.equal(r.statusCode,200);
r=call('PUT','/api/mindmaps/:id',admin,{id:map.id},{title:'Campanha ajustada',nodes:[{id:'central',label:'Campanha',x:50,y:80,color:'#f0eaff'}]});assert.equal(r.statusCode,200);
r=call('PUT','/api/mindmaps/:id',admin,{id:map.id},{title:'x',nodes:[{id:'bad',label:'x',x:'NaN',y:1}]});assert.equal(r.statusCode,400);
r=call('POST','/api/mindmaps/:id/share',third,{id:map.id},{threadId});assert.equal(r.statusCode,404);
r=call('POST','/api/mindmaps/:id/share',admin,{id:map.id},{threadId});assert.equal(r.statusCode,201);
r=call('GET','/api/mindmaps/:id',seller,{id:map.id});assert.equal(r.statusCode,200);
r=call('GET','/api/mindmaps/:id',third,{id:map.id});assert.equal(r.statusCode,404);
r=call('PUT','/api/mindmaps/:id',seller,{id:map.id},{title:'Intrusão',nodes:[]});assert.equal(r.statusCode,403);
const payload=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
r=call('POST','/api/chat/threads/:id/attachments',third,{id:threadId},{mime:'application/pdf',name:'documento.pdf',base64:payload.toString('base64')});assert.equal(r.statusCode,404);
r=call('POST','/api/chat/threads/:id/attachments',admin,{id:threadId},{mime:'application/pdf',name:'documento.pdf',base64:payload.toString('base64')});assert.equal(r.statusCode,201);const attachment=r.body;
r=call('GET','/api/chat/attachments/:id',admin,{id:attachment.id});assert.equal(r.statusCode,404,'Orphan file not publicly accessible');
r=call('POST','/api/chat/threads/:id/messages',admin,{id:threadId},{text:'Arquivo enviado',attachmentId:attachment.id});assert.equal(r.statusCode,201);
r=call('GET','/api/chat/attachments/:id',seller,{id:attachment.id});assert.equal(r.statusCode,200);assert(fs.existsSync(r.sentFile),'Attachment kept on disk');
r=call('GET','/api/chat/attachments/:id',third,{id:attachment.id});assert.equal(r.statusCode,404);
r=call('POST','/api/chat/threads/:id/attachments',admin,{id:threadId},{mime:'application/pdf',name:'fake.pdf',base64:Buffer.from('not-a-pdf').toString('base64')});assert.equal(r.statusCode,400);
r=call('GET','/api/itemLibrary/quality',seller);assert.equal(r.statusCode,403);
r=call('GET','/api/itemLibrary/quality',admin);assert.equal(r.statusCode,200);assert.equal(r.body.total,1386);
r=call('POST','/api/itemLibrary/quality/dedupe',seller);assert.equal(r.statusCode,403);
r=call('POST','/api/itemLibrary/quality/dedupe',admin);assert.equal(r.statusCode,200);assert(r.body.imagesRemoved>=1,'Expected exact repeated image to be removed');assert(fs.existsSync(path.join(temporary,'backups',r.body.backup)),'Backup before dedupe');
assert(!fs.existsSync(path.resolve(__dirname,'../data/chat-uploads')),'No files written into original source');
fs.rmSync(temporary,{recursive:true,force:true});
console.log('PASSOU: busca caneta/caderno e código exato; relatório de fotos somente leitura; mapas CRUD, compartilhamento e permissões; PDF em disco com autorização por participante; rejeição de arquivo falso; remoção explícita de imagem idêntica com backup.');
