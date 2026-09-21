'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'c4u-1606-'));
fs.copyFileSync(path.join(__dirname,'../data/db.json'),path.join(tmp,'db.json'));
const input=JSON.parse(fs.readFileSync(path.join(tmp,'db.json')));
const [first,second,third]=[input.users.find(u=>u.active&&u.role==='Administrador'),...input.users.filter(u=>u.active&&u.role!=='Administrador').slice(0,2)];
assert(first&&second&&third);const threadId=1234000;
input.chatThreads.push({id:threadId,type:'group',memberIds:[first.id,second.id],name:'Equipe',createdAt:new Date().toISOString(),lastReadBy:{}});input.counters.chatThreads=threadId+1;
fs.writeFileSync(path.join(tmp,'db.json'),JSON.stringify(input));
process.env.C4U_DATA_DIR=tmp;process.env.C4U_BACKUP_DIR=path.join(tmp,'backups');process.env.HOST='127.0.0.1';process.env.PORT='39993';
const routes={};const express=()=>({set(){},use(){},get(p,fn){routes['GET '+p]=fn},post(p,fn){routes['POST '+p]=fn},put(p,fn){routes['PUT '+p]=fn},delete(p,fn){routes['DELETE '+p]=fn},patch(p,fn){routes['PATCH '+p]=fn},listen(){return{close(){}}}});
express.json=()=>()=>{};express.static=()=>()=>{};
const orig=Module._load;Module._load=function(req,...rest){return req==='express'?express:orig.call(this,req,...rest)};try{require('../server.js')}finally{Module._load=orig}
function resp(){return{statusCode:200,status(c){this.statusCode=c;return this},json(data){this.body=data;return this},end(){this.done=true;return this}}}
function call(method,url,user,body={},params={}){const fn=routes[method+' '+url];assert(fn,'missing '+method+' '+url);const r=resp();fn({user,body,params,query:{},headers:{},sessionToken:'test'},r);return r}
let r=call('POST','/api/personal/notes',first,{title:'Meu plano',content:'Privado'});assert.equal(r.statusCode,201);const note=r.body;
assert.equal(call('GET','/api/personal/notes',second).body.length,0);
assert.equal(call('PUT','/api/personal/notes/:id',second,{title:'Roubar',content:'x'},{id:note.id}).statusCode,404);
assert.equal(call('DELETE','/api/personal/notes/:id',second,{}, {id:note.id}).statusCode,404);
assert.equal(call('GET','/api/personal/notes',first).body[0].content,'Privado');
r=call('POST','/api/personal/reminders',second,{title:'Telefonar',detail:'Retornar',dueAt:new Date(Date.now()+86400000).toISOString()});assert.equal(r.statusCode,201);const rem=r.body;
assert.equal(call('GET','/api/personal/reminders',first).body.length,0);
assert.equal(call('PUT','/api/personal/reminders/:id',second,{title:'Feito',detail:'x',done:true},{id:rem.id}).body.done,true);
assert.equal(call('GET','/api/personal/reminders',second).body[0].done,true);
r=call('GET','/api/me/profile',second);assert.equal(r.body.id,second.id);assert.equal(r.body.passwordHash,undefined);
r=call('PUT','/api/me/profile',second,{name:'Meu Teste',email:'teste1606@example.org',role:'Administrador',login:'adm',permissions:['*'],availabilityStatus:'busy',irisAutoOpen:false});assert.equal(r.statusCode,200);
assert.equal(r.body.role,second.role);assert.equal(r.body.login,second.login);assert.equal(r.body.availabilityStatus,'busy');assert.equal(r.body.preferences.irisAutoOpen,false);
r=call('GET','/api/me/profile',first);assert.equal(r.body.id,first.id);
r=call('PUT','/api/me/profile',first,{name:'Admin',email:'teste1606@example.org'});assert.equal(r.statusCode,409);
// User-owned favorites; thread must be a participant, and private maps must not leak.
r=call('POST','/api/personal/favorites',second,{type:'chat',entityId:threadId});assert.equal(r.statusCode,200);const fav=r.body;
assert.equal(call('POST','/api/personal/favorites',third,{type:'chat',entityId:threadId}).statusCode,404);
assert.equal(call('GET','/api/personal/favorites',first).body.length,0);
assert.equal(call('DELETE','/api/personal/favorites/:id',first,{}, {id:fav.id}).statusCode,404);
assert.equal(call('GET','/api/personal/favorites',second).body.length,1);
r=call('POST','/api/mindmaps',first,{title:'Projeto colaborativo'});assert.equal(r.statusCode,201);const map=r.body;
assert.equal(call('POST','/api/mindmaps/:id/comments',third,{text:'Intrusão'},{id:map.id}).statusCode,404);
assert.equal(call('POST','/api/mindmaps/:id/share',first,{threadId,permission:'edit'},{id:map.id}).statusCode,201);
assert.equal(call('GET','/api/mindmaps/:id',second,{}, {id:map.id}).body.editUserIds.includes(second.id),true);
r=call('PUT','/api/mindmaps/:id',second,{title:'Editado pelo colega',revision:1,nodes:[{id:'central',label:'Projeto',x:20,y:20}]},{id:map.id});assert.equal(r.statusCode,200);
assert.equal(call('PUT','/api/mindmaps/:id',first,{title:'Desatualizado',revision:1,nodes:[]},{id:map.id}).statusCode,409);
assert.equal(call('POST','/api/mindmaps/:id/comments',second,{text:'Nova ideia!',nodeId:'central'},{id:map.id}).statusCode,201);
assert.equal(call('GET','/api/mindmaps/:id/comments',third,{}, {id:map.id}).statusCode,404);
assert.equal(call('GET','/api/mindmaps/:id/comments',first,{}, {id:map.id}).body.length,1);
const otherInput=JSON.parse(fs.readFileSync(path.join(tmp,'db.json')));
assert.equal(otherInput.users.find(u=>u.id===second.id).role,second.role);
assert.equal(otherInput.personalNotes.find(x=>x.id===note.id).userId,first.id);
assert.equal(otherInput.personalFavorites.find(x=>x.id===fav.id).userId,second.id);
assert.equal(call('GET','/api/briefing',third).body.counts.messages,0);
// Late reminder produces one notification for its owner, not the other users.
const due=call('POST','/api/personal/reminders',first,{title:'Lembrete confidencial',detail:'Só meu',dueAt:'2020-01-01T10:00'}).body;
const before=JSON.parse(fs.readFileSync(path.join(tmp,'db.json'))).notifications.filter(n=>n.userId===first.id&&n.kind==='reminder').length;
call('POST','/api/presence/heartbeat',first,{});call('POST','/api/presence/heartbeat',first,{});
const after=JSON.parse(fs.readFileSync(path.join(tmp,'db.json'))).notifications.filter(n=>n.userId===first.id&&n.kind==='reminder');assert.equal(after.length,before+1);assert.equal(after.at(-1).entityId,due.id);
assert.equal(call('GET','/api/briefing/endday',second).body.pendingReminders,0);
assert.equal(call('GET','/api/briefing/endday',first).body.pendingReminders>=1,true);
// Mentions notify only members, with a distinct kind in the recipient inbox.
const beforeMention=JSON.parse(fs.readFileSync(path.join(tmp,'db.json'))).notifications.filter(n=>n.userId===second.id&&n.kind==='mention').length;
const msg=call('POST','/api/chat/threads/:id/messages',first,{text:'@'+second.login+' veja o mapa'},{id:threadId});assert.equal(msg.statusCode,201);
const mentions=JSON.parse(fs.readFileSync(path.join(tmp,'db.json'))).notifications.filter(n=>n.userId===second.id&&n.kind==='mention');assert.equal(mentions.length,beforeMention+1);
assert.equal(JSON.parse(fs.readFileSync(path.join(tmp,'db.json'))).notifications.filter(n=>n.userId===third.id&&n.kind==='mention').length,0);

fs.rmSync(tmp,{recursive:true,force:true});
console.log('PASSOU v16.0.6: privacidade entre 3 usuários para notas/lembretes/favoritos; perfil sem escalonamento; status e preferências pessoais; colaboração e comentários de mapas; controle de revisão; briefing privado, fechamento, lembretes idempotentes e menções por participante.');
