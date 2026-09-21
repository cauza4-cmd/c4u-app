'use strict';
/** XBZ — GET de catálogo somente; cache persistente e cota local antecipada, nenhuma compra. */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const ENDPOINT='https://api.minhaxbz.com.br:5001/api/clientes/GetListaDeProdutos';
const INTERVAL_MS=12*60*60*1000;
const MAX_PER_DAY=20; // fornecedor informa 24; quatro acessos reservados para margem operacional
const MAX_BYTES=32*1024*1024;
const DIR=()=>process.env.XBZ_PRIVATE_DIR||path.join(os.homedir(),'.config','c4u');
function readSecret(name){const file=path.join(DIR(),name);if(!fs.existsSync(file))return '';const st=fs.lstatSync(file);if(!st.isFile()||(st.mode&0o077))throw Error('Arquivos XBZ precisam ser regulares e privados (chmod 600).');return fs.readFileSync(file,'utf8').trim()}
function credentials(){return {token:process.env.XBZ_TOKEN||readSecret('xbz-token'),cnpj:process.env.XBZ_CNPJ||readSecret('xbz-cnpj')}}
function dayBR(date=new Date()){return new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date)}
function readJSON(file,otherwise){if(!fs.existsSync(file))return otherwise;return JSON.parse(fs.readFileSync(file,'utf8'))}
function writePrivate(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+process.pid+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(value),{encoding:'utf8',mode:0o600,flag:'wx'});fs.renameSync(tmp,file);fs.chmodSync(file,0o600)}finally{try{fs.unlinkSync(tmp)}catch{}}}
function rowsFrom(payload){if(Array.isArray(payload))return payload;if(payload&&typeof payload==='object')for(const k of ['produtos','Produtos','products','Products','items','Items','data','Data','resultado','Resultado','lista','Lista']){const v=payload[k];if(Array.isArray(v))return v;if(v&&typeof v==='object'){for(const nested of ['produtos','Produtos','items','Items','data'])if(Array.isArray(v[nested]))return v[nested]}}return null}
function safeSchema(payload){const keys=payload&&typeof payload==='object'&&!Array.isArray(payload)?Object.keys(payload).slice(0,12).filter(k=>!/token|secret|senha|cnpj|key/i.test(k)):[];return keys.map(k=>k+':'+(Array.isArray(payload[k])?'array':typeof payload[k])).join(', ')||('tipo '+typeof payload)}
class XbzConnector{
 constructor({fetchImpl=globalThis.fetch,credentialsProvider=credentials,dir=DIR(),now=()=>Date.now()}={}){this.fetchImpl=fetchImpl;this.credentialsProvider=credentialsProvider;this.dir=dir;this.now=now;this.busy=false;this.ledgerFile=path.join(dir,'xbz-rate-ledger.json');this.cacheFile=path.join(dir,'xbz-feed-cache.json')}
 configured(){const c=this.credentialsProvider();return Boolean(/^\d{14}$/.test(c.cnpj)&&c.token)}
 ledger(){const x=readJSON(this.ledgerFile,{day:'',requests:0,lastAttempt:'',lastStatus:''});return x.day===dayBR(new Date(this.now()))?x:{day:dayBR(new Date(this.now())),requests:0,lastAttempt:x.lastAttempt||'',lastStatus:x.lastStatus||''}}
 cache(){const x=readJSON(this.cacheFile,null);if(!x)return null;if(!Array.isArray(x.products)||!Number.isFinite(Date.parse(x.fetchedAt))||x.products.length<1||x.products.length>100000)throw Error('Cache XBZ inválido: não substituir o catálogo anterior.');return x}
 status(){const l=this.ledger(),c=this.cache(),next=l.lastAttempt?Date.parse(l.lastAttempt)+INTERVAL_MS:0;return {configured:this.configured(),cached:!!c,cacheCount:c?.products.length||0,cachedAt:c?.fetchedAt||'',cacheAgeHours:c?Math.round((this.now()-Date.parse(c.fetchedAt))/360000)/10:null,lastAttempt:l.lastAttempt,lastStatus:l.lastStatus,requestsToday:l.requests,limit:MAX_PER_DAY,providerLimit:24,nextAllowedAt:next?new Date(next).toISOString():'',intervalHours:process.env.XBZ_SETUP_MODE==='1'?0:12,setupMode:process.env.XBZ_SETUP_MODE==='1',ordersToSupplier:false}}
 /** A requisição é debitada ANTES de sair; mesmo HTTP 500 ou falha de rede consome uma posição. */
 reserve(){
  fs.mkdirSync(this.dir,{recursive:true,mode:0o700});const lock=this.ledgerFile+'.lock';let fd;
  try{fd=fs.openSync(lock,'wx',0o600)}catch{throw Error('Outra consulta XBZ pode estar em andamento. Aguarde; nenhuma nova requisição feita.')}
  try{
   const l=this.ledger(),now=this.now(),last=Date.parse(l.lastAttempt||'');
   if(l.requests>=MAX_PER_DAY)throw Error('Limite preventivo de 20 consultas XBZ por dia atingido; nenhuma requisição feita.');
   if(process.env.XBZ_SETUP_MODE!=='1'&&Number.isFinite(last)&&now-last<INTERVAL_MS)throw Error('XBZ: intervalo mínimo de 12 horas ainda não cumprido. Cache anterior preservado.');
   const next={...l,requests:l.requests+1,lastAttempt:new Date(now).toISOString(),lastStatus:'Consulta reservada'};writePrivate(this.ledgerFile,next);return next;
  }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(lock)}catch{}}
 }
 recordStatus(text){try{const x=this.ledger();writePrivate(this.ledgerFile,{...x,lastStatus:String(text).slice(0,180)})}catch{}}
 async refresh(){
  if(this.busy)throw Error('XBZ já está consultando. Aguarde.');
  this.busy=true;
  try{
   const c=this.credentialsProvider();if(!/^\d{14}$/.test(c.cnpj)||!c.token)throw Error('Credenciais XBZ não configuradas nos arquivos privados.');
   this.reserve();
   const url=new URL(ENDPOINT);url.searchParams.set('cnpj',c.cnpj);url.searchParams.set('token',c.token);
   let response;try{response=await this.fetchImpl(url.toString(),{method:'GET',redirect:'error',signal:AbortSignal.timeout(60000),headers:{Accept:'application/json'}})}catch{throw Error('XBZ: falha de rede ou prazo excedido. Acesso contabilizado; cache anterior mantido.')}
   if(!response.ok){const code=response.status;throw Error(code===401?'XBZ HTTP 401: token ou CNPJ rejeitado. Não repetir automaticamente.':code===403?'XBZ HTTP 403: limite do fornecedor atingido. Não repetir automaticamente.':code===500?'XBZ HTTP 500: falha do fornecedor; cache anterior preservado.':`XBZ HTTP ${Number(code)||'desconhecido'}; cache preservado.`)}
   if(Number(response.headers?.get?.('content-length')||0)>MAX_BYTES)throw Error('XBZ: resposta excedeu 32 MB. Cache preservado.');
   const body=await response.text();if(Buffer.byteLength(body,'utf8')>MAX_BYTES)throw Error('XBZ: resposta excedeu 32 MB. Cache preservado.');
   let json;try{json=JSON.parse(body);if(typeof json==='string')json=JSON.parse(json)}catch{throw Error('XBZ: JSON externo ou interno inválido. Cache preservado.')}
   const products=rowsFrom(json);
   if(!products)throw Error('XBZ: estrutura desconhecida. Campos de topo: '+safeSchema(json)+'. Cache anterior preservado.');
   if(!products.length||products.length>100000||products.some(v=>!v||typeof v!=='object'||Array.isArray(v)))throw Error('XBZ: lista vazia, excessiva ou contém registros inválidos. Cache preservado.');
   const previous=this.cache();if(previous&&products.length<previous.products.length*.75)throw Error('XBZ: redução de mais de 25% no catálogo. Cache anterior preservado para revisão.');
   // Nunca persistir uma eventual credencial ecoada no JSON do fornecedor.
   const cleaned=JSON.parse(JSON.stringify(products,(key,value)=>/^(?:token|api_?key|secret_?key|secret|senha|password|cnpj|authorization)$/i.test(key)||typeof value==='string'&&(value===c.token||value===c.cnpj)?undefined:value));
   const fresh={fetchedAt:new Date(this.now()).toISOString(),products:cleaned,hash:crypto.createHash('sha256').update(JSON.stringify(cleaned)).digest('hex')};writePrivate(this.cacheFile,fresh);
   this.recordStatus('HTTP 200; '+products.length+' produtos armazenados no cache.');
   return {products:fresh.products,fetchedAt:fresh.fetchedAt,fromCache:false,hash:fresh.hash};
  }catch(e){this.recordStatus(e.message);throw e}finally{this.busy=false}
 }
 async get({allowFetch=false}={}){
  const cached=this.cache();if(cached&&this.now()-Date.parse(cached.fetchedAt)<INTERVAL_MS)return {...cached,fromCache:true};
  if(!allowFetch){if(cached)return {...cached,fromCache:true,stale:true};throw Error('Catálogo XBZ ainda não consultado. Solicite uma consulta ao administrador.');}
  return this.refresh();
 }
}
module.exports={XbzConnector,ENDPOINT,INTERVAL_MS,MAX_PER_DAY,rowsFrom,credentials,dayBR};
