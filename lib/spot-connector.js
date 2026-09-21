'use strict';
/**
 * SPOT / Stricker Brasil REST read-only connector.
 * Fixed HTTPS destination; never expose the access key or session token to the browser.
 * This first stage intentionally has NO write operations to the C4U database or SPOT.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = 'https://ws.spotgifts.com.br/api/v1SSL/';
const FEEDS = Object.freeze({
  products: 'products',
  productsTree: 'productsTree',
  optionals: 'optionals',
  optionalsComplete: 'optionalsComplete',
  optionalsPrice: 'optionalsPrice',
  colors: 'colors',
  stocks: 'stocks',
  customizationOptions: 'customizationOptions',
  customizationTables: 'customizationTables',
  catalogPrices: 'catalogPrices',
  canceledProducts: 'canceledproducts',
  productTypes: 'productTypes'
});
const MAX_BYTES = 32 * 1024 * 1024;
const KEY_FILE = () => process.env.SPOT_ACCESS_KEY_FILE || path.join(os.homedir(), '.config', 'c4u', 'spot-access-key');

function secret(){
  if (process.env.SPOT_ACCESS_KEY && process.env.SPOT_ACCESS_KEY.trim()) return process.env.SPOT_ACCESS_KEY.trim();
  const pathname = KEY_FILE();
  if (!fs.existsSync(pathname)) return '';
  const stat = fs.statSync(pathname);
  if (!stat.isFile() || (stat.mode & 0o077)) throw new Error('Arquivo da chave SPOT com permissões inseguras. Defina chmod 600.');
  return fs.readFileSync(pathname, 'utf8').trim();
}
function unwrap(data, key) {
  if (!data || typeof data !== 'object') return data;
  if (data[key + 'Result'] && typeof data[key + 'Result'] === 'object') return data[key + 'Result'];
  return data;
}
function supplierError(data){
  if (!data || typeof data !== 'object') return '';
  const code = data.ErrorCode ?? data.errorCode;
  if (code === undefined || code === null || String(code) === '' || String(code) === '0') return '';
  const known = {'1':'Chave inválida.','10':'Chave ausente.','12':'Token ausente.','13':'Sessão expirada.','14':'Limite diário de requisições atingido.','15':'Conta não habilitada; contate o fornecedor.'};
  return known[String(code)] || `Erro SPOT (código ${String(code).replace(/[^\d]/g,'').slice(0,4)||'desconhecido'}).`;
}
function val(obj,fields){
  for(const field of fields){
    const key=Object.keys(obj||{}).find(k=>k.toLowerCase()===field.toLowerCase());
    if(key && obj[key]!==undefined && obj[key]!==null && typeof obj[key]!=='object')return String(obj[key]).slice(0,180);
  }
  return '';
}
function rowsOf(data,feed){
  const d=unwrap(data,feed);
  if(Array.isArray(d))return d;
  if(!d||typeof d!=='object')return null;
  const candidates=[feed,'ProductsTree','Products','Optionals','OptionalsComplete','OptionalsPrice','Stocks','Colors','CustomizationOptions','CustomizationTables','CatalogPrices','CanceledProducts','ProductTypes','items','data'];
  for(const key of candidates){
    const foundKey=Object.keys(d).find(k=>k.toLowerCase()===key.toLowerCase());
    if(!foundKey)continue;
    const value=d[foundKey];
    if(Array.isArray(value))return value;
    if(value&&typeof value==='object'){
      for(const inner of Object.values(value))if(Array.isArray(inner))return inner;
    }
  }
  return null;
}
function preview(data,feed){
  const rows=rowsOf(data,feed);
  if(!rows)return {feed,recognized:false,count:null,sample:[],fields:[],reason:'Estrutura de lista não reconhecida. Nenhum dado será importado.'};
  const sample=rows.slice(0,5).map(raw=>({
    reference:val(raw,['ProdReference','ProductReference','Reference','Referencia','Ref']),
    sku:val(raw,['Sku','WebSku','SKU','Codigo','Code']),
    name:val(raw,['Name','ProductName','Nome','DescriptionShort','ShortDescription']),
    color:val(raw,['Color','Colour','Cor','ColorName']),
    stock:val(raw,['Stock','Quantity','Available','AvailableStock']),
    price:val(raw,['YourPrice','Price','Preco'])
  }));
  const byFeed={
    colors:['ColorCode','Description'],
    stocks:['Sku','Quantity','NextQuantity1','NextDate1','Country'],
    optionalsPrice:['ProdReference','Sku','ColorDesc1','YourPrice','MinQt1','Price1','MinQt2','Price2','MinQt3','Price3'],
    optionalsComplete:['ProdReference','Sku','Name','ColorCode','ColorDesc1','YourPrice','OptionalImage1'],
    products:['ProdReference','Name','MainImage','IsStockout','OnlineExclusive']
  };
  const columns=byFeed[feed]||['ProdReference','Sku','Name','YourPrice'];
  const scalar=(raw,key)=>{const value=Object.entries(raw||{}).find(([k])=>k.toLowerCase()===key.toLowerCase())?.[1];return typeof value==='string'||typeof value==='number'||typeof value==='boolean'?String(value).slice(0,200):''};
  const displayRows=rows.slice(0,5).map(raw=>columns.map(c=>scalar(raw,c)));
  return {feed,recognized:true,count:rows.length,fields:Object.keys(rows[0]||{}).filter(k=>/^[\w-]{1,48}$/.test(k)&&!/token|secret|accesskey|password/i.test(k)).slice(0,80),sample,columns,displayRows};
}
class SpotConnector {
  constructor({fetchImpl=globalThis.fetch, keyProvider=secret, now=Date.now}={}) {
    this.fetchImpl=fetchImpl;this.keyProvider=keyProvider;this.now=now;
    this.token='';this.expiresAt=0;this.pendingAuth=null;
    this.lastCheck='';this.lastStatus='Não testado';this.authValidated=false;
  }
  configured(){return Boolean(this.keyProvider())}
  status(){return {configured:this.configured(),endpoint:BASE,mode:'somente leitura',lastCheck:this.lastCheck,lastStatus:this.lastStatus,feeds:Object.keys(FEEDS),liveValidated:this.authValidated};}
  async request(endpoint,params={},timeoutMs=35000){
    const url = new URL(endpoint,BASE);
    if(url.origin!=='https://ws.spotgifts.com.br')throw Error('Destino SPOT inválido.');
    for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
    let response;
    try{
      response=await this.fetchImpl(url.toString(),{
        method:'GET',headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(timeoutMs)
      });
    }catch{
      throw new Error('Falha de rede ou tempo excedido ao consultar SPOT.');
    }
    if(!response.ok)throw new Error(`SPOT respondeu HTTP ${response.status}.`);
    if(Number(response.headers?.get?.('content-length')||0)>MAX_BYTES)throw Error('Resposta SPOT acima de 32 MB; solicite feed menor.');
    let body;
    try{body=await response.text()}catch{throw Error('Falha ao receber dados da SPOT.');}
    if(Buffer.byteLength(body,'utf8')>MAX_BYTES)throw Error('Resposta SPOT acima de 32 MB; solicite feed menor.');
    let data;
    try{data=JSON.parse(body)}catch{throw Error('A SPOT não retornou JSON válido; verifique o serviço e o endpoint.');}
    const err=supplierError(data);
    if(err)throw Error(err);
    return data;
  }
  async authenticate(force=false){
    if(!force && this.token && this.expiresAt>this.now())return this.token;
    if(this.pendingAuth)return this.pendingAuth;
    this.pendingAuth=(async()=>{
      const key=this.keyProvider();
      if(!key)throw Error('Configure a Access Key SPOT exclusivamente no servidor.');
      const data=unwrap(await this.request('AuthenticateClient',{accessKey:key},20000),'AuthenticateClient');
      const error=supplierError(data);if(error)throw Error(error);
      const token=data?.Token ?? data?.token;
      if(typeof token!=='string'||!token.trim())throw Error('A autenticação SPOT não retornou token. Verifique a habilitação da conta.');
      this.token=token.trim();
      // The guide states UP TO 24h. Refresh early and retry on error 13.
      this.expiresAt=this.now()+20*60*60*1000;
      return this.token;
    })();
    try{return await this.pendingAuth}finally{this.pendingAuth=null;}
  }
  async check(){
    try{
      const token=await this.authenticate(true);
      const data=unwrap(await this.request('ValidateSession',{token},20000),'ValidateSession');
      const error=supplierError(data);if(error)throw Error(error);
      const valid=data?.Status ?? data?.status;
      if(!(valid===1 || valid===true || String(valid)==='1'))throw Error('A SPOT não confirmou a sessão.');
      this.lastCheck=new Date(this.now()).toISOString();this.lastStatus='Autenticação validada';this.authValidated=true;
      return {ok:true,authenticated:true,validated:true,checkedAt:this.lastCheck};
    }catch(e){this.lastCheck=new Date(this.now()).toISOString();this.lastStatus='Falha na validação';this.authValidated=false;throw e;}
  }
  async feed(name){
    const endpoint=FEEDS[name];
    if(!Object.hasOwn(FEEDS,name))throw Error('Feed SPOT não permitido.');
    const make=async(token)=>{const data=unwrap(await this.request(endpoint,{token,...(name==='catalogPrices'||name==='canceledProducts'?{}:{lang:'PT'})},45000),endpoint);const error=supplierError(data);if(error)throw Error(error);return data;};
    let token=await this.authenticate();
    try{return await make(token)}catch(e){
      if(!/sessão expirada|token ausente/i.test(e.message))throw e;
      token=await this.authenticate(true);
      return make(token);
    }
  }
  async preview(name){
    const data=await this.feed(name);
    this.lastCheck=new Date(this.now()).toISOString();
    this.lastStatus=`Feed ${name} consultado`;
    return preview(data,name);
  }
}
module.exports={SpotConnector,FEEDS,preview,rowsOf};
