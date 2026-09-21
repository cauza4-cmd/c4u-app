'use strict';
/** Ásia Import — somente consulta HTTPS POST, nenhuma rota de compra. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const ENDPOINT='https://api.asiaimport.com.br/';
const KEY_FILE=()=>process.env.ASIA_API_KEY_FILE||path.join(os.homedir(),'.config','c4u','asia-api-key');
const SECRET_FILE=()=>process.env.ASIA_SECRET_KEY_FILE||path.join(os.homedir(),'.config','c4u','asia-secret-key');
const MAX_BYTES=16*1024*1024,PER_PAGE=100,MAX_PRODUCTS=20000;
function readSecret(file){if(!fs.existsSync(file))return '';const st=fs.lstatSync(file);if(!st.isFile()||(st.mode&0o077))throw Error('Credenciais Ásia: arquivos regulares com chmod 600 são necessários.');return fs.readFileSync(file,'utf8').trim()}
function credentials(){return {key:process.env.ASIA_API_KEY||readSecret(KEY_FILE()),secret:process.env.ASIA_SECRET_KEY||readSecret(SECRET_FILE())}}
class AsiaConnector{
 constructor({fetchImpl=globalThis.fetch,credentialsProvider=credentials}={}){this.fetchImpl=fetchImpl;this.credentialsProvider=credentialsProvider;this.lastCheck='';this.lastStatus='Não testado'}
 configured(){const c=this.credentialsProvider();return Boolean(c.key&&c.secret)}
 status(){return {configured:this.configured(),endpoint:ENDPOINT,lastCheck:this.lastCheck,lastStatus:this.lastStatus,ordersToSupplier:false,autoSync:false,mode:'consulta e importação manual protegida'}}
 async page(page=1,perPage=PER_PAGE){
  const c=this.credentialsProvider();if(!c.key||!c.secret)throw Error('Credenciais Ásia não configuradas nos arquivos privados da AWS.');
  if(!Number.isSafeInteger(page)||page<1||page>200||!Number.isSafeInteger(perPage)||perPage<1||perPage>PER_PAGE)throw Error('Paginação Ásia inválida.');
  const body=new FormData();for(const [k,v] of Object.entries({api_key:c.key,secret_key:c.secret,funcao:'listarProdutos2',pagina:String(page),por_pagina:String(perPage)}))body.append(k,v);
  let r;try{r=await this.fetchImpl(ENDPOINT,{method:'POST',body,redirect:'error',signal:AbortSignal.timeout(45000),headers:{Accept:'application/json'}})}catch{throw Error('Falha de rede ou tempo esgotado na consulta Ásia. Nenhuma importação realizada.')}
  if(!r.ok)throw Error(r.status===401||r.status===403?'Ásia recusou autenticação; confira o acesso.':`Ásia respondeu HTTP ${r.status}.`);
  if(Number(r.headers?.get?.('content-length')||0)>MAX_BYTES)throw Error('Página Ásia excede limite de segurança.');
  let text;try{text=await r.text()}catch{throw Error('Falha ao ler resposta Ásia.')}if(Buffer.byteLength(text,'utf8')>MAX_BYTES)throw Error('Página Ásia excede limite de segurança.');
  let d;try{d=JSON.parse(text)}catch{throw Error('Ásia não retornou JSON válido.')}
  if(!d||!Array.isArray(d.produtos)||!Number.isSafeInteger(Number(d.pagina))||Number(d.pagina)!==page||!Number.isSafeInteger(Number(d.total_paginas))||!Number.isSafeInteger(Number(d.total_produtos)))throw Error('Ásia retornou paginação ou lista inválida.');
  if(Number(d.total_produtos)<1||Number(d.total_produtos)>MAX_PRODUCTS||Number(d.total_paginas)<1||Number(d.total_paginas)>200||d.produtos.length>perPage)throw Error('Volume ou paginação inesperados na Ásia.');
  this.lastCheck=new Date().toISOString();this.lastStatus=`Página ${page} consultada`;
  return d;
 }
 async test(){const d=await this.page(1,PER_PAGE);return {ok:true,firstPage:d.pagina,totalPages:d.total_paginas,totalProducts:d.total_produtos,count:d.produtos.length,ordersToSupplier:false}}
 async catalog(){
  const first=await this.page(1,PER_PAGE),total=Number(first.total_produtos),pages=Number(first.total_paginas);
  if(pages!==Math.ceil(total/PER_PAGE)||first.produtos.length!==Math.min(PER_PAGE,total))throw Error('Paginação Ásia inconsistente na primeira página. Prévia bloqueada.');
  const data=[...first.produtos];
  for(let p=2;p<=pages;p++){
   const d=await this.page(p,PER_PAGE);
   if(Number(d.total_produtos)!==total||Number(d.total_paginas)!==pages||d.produtos.length!==Math.min(PER_PAGE,total-(p-1)*PER_PAGE))throw Error(`Paginação Ásia mudou ou página ${p} incompleta. Prévia bloqueada.`);
   data.push(...d.produtos);
  }
  if(data.length!==total)throw Error('Catálogo Ásia incompleto. Nenhum produto será importado.');
  this.lastStatus=`Catálogo consultado: ${total} produtos-pai`;
  return {data,totalProducts:total,totalPages:pages,checkedAt:this.lastCheck};
 }
}
module.exports={AsiaConnector,ENDPOINT,credentials,MAX_PRODUCTS,PER_PAGE};
