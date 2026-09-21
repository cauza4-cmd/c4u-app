'use strict';
const assert=require('node:assert/strict');
const {SpotConnector,preview,rowsOf}=require('../lib/spot-connector');
function mockResponse(body,status=200){return {ok:status>=200&&status<300,status,headers:{get:()=>''},text:async()=>JSON.stringify(body)}}
(async()=>{
 let calls=[], clock=Date.parse('2026-09-18T12:00:00Z');
 const key='MOCK_SECRET_ONLY';
 const fetchImpl=async(url,opt)=>{
  const parsed=new URL(url);
  assert.equal(parsed.origin,'https://ws.spotgifts.com.br');
  assert.equal(opt.redirect,'error');
  calls.push(parsed.pathname);
  if(parsed.pathname.endsWith('/AuthenticateClient')){
   assert.equal(parsed.searchParams.get('accessKey'),key);
   return mockResponse({Token:'MOCK_SESSION_ONLY'});
  }
  assert.equal(parsed.searchParams.get('token'),'MOCK_SESSION_ONLY');
  if(parsed.pathname.endsWith('/ValidateSession'))return mockResponse({Status:1});
  if(parsed.pathname.endsWith('/optionalsComplete')){
   assert.equal(parsed.searchParams.get('lang'),'PT');
   return mockResponse({OptionalsComplete:[{ProdReference:'BR10',Sku:'BR10-PT',Name:'Caneta metálica',Color:'Preto',YourPrice:12.50},{ProdReference:'BR11',Sku:'BR11-AZ',Name:'Garrafa',Color:'Azul',YourPrice:18.10}]});
  }
  if(parsed.pathname.endsWith('/products'))return mockResponse({ErrorCode:13,ErrorMessage:'Session expired'});
  throw Error('URL inesperada');
 };
 const c=new SpotConnector({fetchImpl,keyProvider:()=>key,now:()=>clock});
 assert.equal(c.status().configured,true);
 assert.deepEqual((await c.check()).ok,true);
 assert.equal(c.status().liveValidated,true);
 const p=await c.preview('optionalsComplete');
 assert.equal(p.count,2);assert.equal(p.sample[0].sku,'BR10-PT');assert.equal(p.sample[0].color,'Preto');
 assert.equal(p.fields.includes('YourPrice'),true);
 assert.deepEqual(calls.slice(0,3).map(x=>x.split('/').at(-1)),['AuthenticateClient','ValidateSession','optionalsComplete']);
 await assert.rejects(c.preview('anything'),/não permitido/);
 assert.equal(preview({Unexpected:{foo:1}},'stocks').recognized,false);
 assert.equal(rowsOf({Products:[{Sku:'ABC'}]},'products').length,1);
 assert.equal(calls.filter(x=>x.endsWith('AuthenticateClient')).length,1,'reaproveita token da sessão');
 clock+=21*60*60*1000;
 await c.preview('optionalsComplete');
 assert.equal(calls.filter(x=>x.endsWith('AuthenticateClient')).length,2,'renova token antes de 24h');
 const e=new SpotConnector({fetchImpl:async()=>mockResponse({ErrorCode:1,ErrorMessage:'invalid: MOCK_SECRET_ONLY'}),keyProvider:()=>key});
 await assert.rejects(e.check(),err=>!err.message.includes(key)&&/Chave inválida/.test(err.message));
 const missing=new SpotConnector({keyProvider:()=>'',fetchImpl});
 assert.equal(missing.status().configured,false);
 await assert.rejects(missing.check(),/Configure a Access Key/);
 const bad=new SpotConnector({keyProvider:()=>key,fetchImpl:async()=>({ok:false,status:429,headers:{get:()=>''},text:async()=>''})});
 await assert.rejects(bad.check(),/HTTP 429/);
 console.log('SPOT_CONECTOR_TESTES_OK: autenticação, sessão, consulta sem escrita, renovação, feeds permitidos e proteção de segredos.');
})().catch(err=>{console.error(err);process.exitCode=1});
