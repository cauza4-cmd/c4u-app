"use strict";
/** Só Marcas, consulta exclusivamente de catálogo. Nunca enviar compras, nem escrever no C4U. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ENDPOINT = 'https://www.somarcas.com.br/api-lista-preco-revenda-v1-0-0.php?estado=SP';
const USER_FILE = () => process.env.SOMARCAS_USER_FILE || path.join(os.homedir(), '.config', 'c4u', 'somarcas-user');
const PASSWORD_FILE = () => process.env.SOMARCAS_PASSWORD_FILE || path.join(os.homedir(), '.config', 'c4u', 'somarcas-password');
const MAX_BYTES = 64*1024*1024;
const IMAGE_DOMAIN='somarcas.com.br'; // Domínio oficial e subdomínios da Só Marcas.
const IMAGE_CDN_HOST='cdnprodutos.azureedge.net'; // Host de fotos confirmado pelo retorno real da API Só Marcas.
function fileSecret(name){
  if(!fs.existsSync(name)) return '';
  const st=fs.lstatSync(name);
  if(!st.isFile() || (st.mode&0o077)) throw Error('Credenciais Só Marcas: arquivo deve ser regular e ter permissão chmod 600.');
  return fs.readFileSync(name,'utf8').trim();
}
function credentials(){
  const username=process.env.SOMARCAS_USER || fileSecret(USER_FILE());
  const password=process.env.SOMARCAS_PASSWORD || fileSecret(PASSWORD_FILE());
  return {username,password};
}
function safeImage(value){
  if(typeof value!=='string'||value.length>2048) return '';
  try{const url=new URL(value);return url.protocol==='https:'&&(url.hostname===IMAGE_DOMAIN||url.hostname.endsWith('.'+IMAGE_DOMAIN)||url.hostname===IMAGE_CDN_HOST||url.hostname==='cdndeprodutos.azureedge.net')&&!url.username&&!url.password&&!url.port&&!/[?&](?:token|key|password|senha|accesskey|authorization)=/i.test(url.search) ? url.href : ''}catch{return ''}
}
const str=(value,max=500)=>String(value??'').slice(0,max);
const price=value=>value===null||value===undefined||value===''?null:(Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null);
function categoryText(value){
 if(typeof value==='string'||typeof value==='number')return str(value,150).trim();
 if(value&&typeof value==='object'&&!Array.isArray(value))return categoryText(value.nome??value.descricao??value.titulo??value.categoria??value.name??'');
 return '';
}
function categoryList(value){
 let entries=Array.isArray(value)?value:[];
 if(typeof value==='string'){
  const text=value.trim();
  if(text.startsWith('[')){try{entries=JSON.parse(text)}catch{entries=[]}}
  else if(text.includes('|'))entries=text.split('|');
  else if(text)entries=[text];
 }
 return (Array.isArray(entries)?entries:[]).slice(0,6).map(categoryText).filter(Boolean);
}
function photoList(value){
 let entries=Array.isArray(value)?value:[];
 if(typeof value==='string'&&value.trim().startsWith('[')){try{entries=JSON.parse(value)}catch{entries=[]}}
 return (Array.isArray(entries)?entries:[]).slice(0,16).map(x=>safeImage(typeof x==='string'?x:(x?.url_foto??x?.url??x?.foto??x?.imagem??''))).filter(Boolean).slice(0,7);
}

function safeRow(row){
  if(!row || typeof row!=='object' || Array.isArray(row)) return null;
  return {
    codigo:str(row.codigo,80), titulo:str(row.titulo,240), descricao:str(row.descricao,700),
    url_foto:safeImage(row.url_foto),tipo_gravacao:str(row.tipo_gravacao,160),ncm:str(row.ncm,40),
    estoque:price(row.estoque),ipi:price(row.ipi),estado:str(row.estado,2),
    preco_sem_gravacao_sem_impostos:price(row.preco_sem_gravacao_sem_impostos),
    preco_com_gravacao_sem_impostos:price(row.preco_com_gravacao_sem_impostos),
    preco_sem_gravacao_com_impostos:price(row.preco_sem_gravacao_com_impostos),
    preco_com_gravacao_com_impostos:price(row.preco_com_gravacao_com_impostos),
    data_ultima_atualizacao:str(row.data_ultima_atualizacao,32),
    categoria:categoryText(row.categoria_do_produto)||categoryText(row.categoria)||categoryList(row.matriz_de_categorias)[0]||'',
    subcategoria:categoryText(row.sub_categoria)||categoryText(row.subcategoria)||categoryList(row.matriz_de_categorias).slice(1).join(' / ')||'',
    matriz_de_fotos_adicionais:photoList(row.matriz_de_fotos_adicionais),
    quantidade_minima_sugerida:price(row.quantidade_minima_sugerida),
    dimensoes_do_produto:str(row.dimensoes_do_produto,240),
    embalagem_do_produto:str(row.embalagem_do_produto,240)
  };
}
class SomarcasConnector {
  constructor({fetchImpl=globalThis.fetch,credentialsProvider=credentials,now=Date.now}={}){
    this.fetchImpl=fetchImpl;this.credentialsProvider=credentialsProvider;this.now=now;
    this.lastCheck='';this.lastStatus='Não testado';
  }
  configured(){const c=this.credentialsProvider();return Boolean(c.username&&c.password)}
  status(){return {configured:this.configured(),endpoint:ENDPOINT,region:'SP',mode:'somente consulta',lastCheck:this.lastCheck,lastStatus:this.lastStatus,ordersToSupplier:false,imported:false}}
  async preview(){
    const {data,countUnique,rawCount,invalid}=await this.catalog();
    return {ok:true,count:rawCount,valid:data.length,invalid,uniqueCodes:countUnique,
      sample:data.slice(0,6),fields:Object.keys(data[0]||{}).filter(k=>/^[\w-]{1,60}$/.test(k)&&!/password|senha|authorization|token|secret/i.test(k)).slice(0,40),
      checkedAt:this.lastCheck,regionRequested:'SP',mode:'prévia de leitura; banco não alterado',priceNotice:'Preços informativos: Só Marcas valida valores somente após orçamento com vendedores.',ordersToSupplier:false};
  }
  async catalog(){
    const c=this.credentialsProvider();
    if(!c.username||!c.password)throw Error('Configure login e senha Só Marcas em arquivos privados no servidor.');
    const basic=Buffer.from(c.username+':'+c.password,'utf8').toString('base64');
    let res;
    try{res=await this.fetchImpl(ENDPOINT,{method:'GET',redirect:'error',headers:{Authorization:'Basic '+basic,Accept:'application/json'},signal:AbortSignal.timeout(45000)})}
    catch{throw Error('Falha de conexão ou tempo esgotado ao consultar Só Marcas.');}
    if(!res.ok)throw Error(res.status===401||res.status===403?'Só Marcas recusou a autenticação; confira credenciais e acesso.':`Só Marcas retornou HTTP ${res.status}.`);
    if(Number(res.headers?.get?.('content-length')||0)>MAX_BYTES)throw Error('Resposta da Só Marcas maior que 64 MB.');
    let text;try{text=await res.text()}catch{throw Error('Não foi possível ler a resposta da Só Marcas.')}
    if(Buffer.byteLength(text,'utf8')>MAX_BYTES)throw Error('Resposta da Só Marcas maior que 64 MB.');
    let data;try{data=JSON.parse(text)}catch{throw Error('Resposta da Só Marcas não é JSON válido.')}
    if(!Array.isArray(data))throw Error('Retorno diferente do array de produtos documentado. Nada foi importado.');
    const rows=data.map(safeRow),valid=rows.filter(r=>r&&r.codigo&&r.titulo);
    const countUnique=new Set(valid.map(r=>r.codigo)).size;
    this.lastCheck=new Date(this.now()).toISOString();this.lastStatus=`Consulta concluída: ${data.length} registros`;
    return {data:valid,rawCount:data.length,invalid:data.length-valid.length,countUnique};
  }
}
module.exports={SomarcasConnector,ENDPOINT,safeRow,safeImage,credentials};
