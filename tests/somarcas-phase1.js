"use strict";
const assert=require('node:assert/strict');
const {SomarcasConnector,safeImage,safeRow,ENDPOINT}=require('../lib/somarcas-connector');
function response(body,status=200){return {ok:status>=200&&status<300,status,headers:{get:()=>null},text:async()=>typeof body==='string'?body:JSON.stringify(body)}}
(async()=>{
 const mockCredentials={username:'mock-username',password:'mock-password'};
 const rows=[{codigo:'AB-01',titulo:'Bolsa',descricao:'Bolsa teste',url_foto:'https://cdngeneral2.somarcas.com.br/clientes/100px/AB01.gif',estoque:0,estado:'SP',preco_sem_gravacao_sem_impostos:10,preco_com_gravacao_sem_impostos:11,preco_sem_gravacao_com_impostos:12,preco_com_gravacao_com_impostos:13,data_ultima_atualizacao:'2026-09-18 10:00:00'},
 {codigo:'AB-02',titulo:'Caneta',estoque:12,estado:'SP',preco_sem_gravacao_com_impostos:2.5}];
 let calls=0;
 const c=new SomarcasConnector({credentialsProvider:()=>mockCredentials,now:()=>Date.parse('2026-09-18T15:00:00Z'),fetchImpl:async(url,opts)=>{
  calls++;assert.equal(url,ENDPOINT);assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');assert.equal(opts.headers.Accept,'application/json');
  const [type,encoded]=opts.headers.Authorization.split(' ');assert.equal(type,'Basic');assert.equal(Buffer.from(encoded,'base64').toString(),'mock-username:mock-password');return response(rows);
 }});
 assert.equal(c.status().configured,true);assert.equal(c.status().ordersToSupplier,false);
 const p=await c.preview();assert.equal(p.count,2);assert.equal(p.valid,2);assert.equal(p.sample[0].estoque,0);assert.equal(p.sample[0].preco_com_gravacao_com_impostos,13);assert.equal(p.sample[0].url_foto,rows[0].url_foto);assert.equal(calls,1);
 assert.equal(p.ordersToSupplier,false);assert.match(p.priceNotice,/informativos/);
 assert.equal(safeImage('http://example.com/x.png'),'');assert.equal(safeImage('https://evil.example/x.png'),'');assert.equal(safeImage('https://www.somarcas.com.br/fotos/a.jpg'),'https://www.somarcas.com.br/fotos/a.jpg');
 assert.equal(safeRow({codigo:'X',titulo:'T',senha:'NEVER'})?.senha,undefined);
 const missing=new SomarcasConnector({credentialsProvider:()=>({username:'',password:''}),fetchImpl:async()=>{throw Error('Should not fetch')}});
 await assert.rejects(missing.preview(),/Configure login e senha/);
 for(const status of [401,403]){
  const bad=new SomarcasConnector({credentialsProvider:()=>mockCredentials,fetchImpl:async()=>response('secret from provider',status)});
  await assert.rejects(bad.preview(),e=>!e.message.includes('secret')&&/recusou/.test(e.message));
 }
 const badFormat=new SomarcasConnector({credentialsProvider:()=>mockCredentials,fetchImpl:async()=>response({products:rows})});
 await assert.rejects(badFormat.preview(),/array de produtos documentado/);
 const badJson=new SomarcasConnector({credentialsProvider:()=>mockCredentials,fetchImpl:async()=>response('NOT JSON')});
 await assert.rejects(badJson.preview(),/não é JSON/);
 const oversized=new SomarcasConnector({credentialsProvider:()=>mockCredentials,fetchImpl:async()=>({ok:true,headers:{get:()=>String(99*1024*1024)}})});
 await assert.rejects(oversized.preview(),/64 MB/);
 const route=require('node:fs').readFileSync(require('node:path').join(__dirname,'../server.js'),'utf8');
 assert.match(route,/somarcasAdmin/);assert.match(route,/\/api\/integrations\/somarcas\/preview/);
 assert.doesNotMatch(route,/\/api\/integrations\/somarcas\/(?:order|buy|purchase)/);
 console.log('SOMARCAS_FASE1_TESTES_OK: autenticação Basic no servidor, GET único, campos, fotos, erro seguro, sem compra.');
})().catch(e=>{console.error(e);process.exitCode=1});
