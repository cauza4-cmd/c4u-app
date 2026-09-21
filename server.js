const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const {quality,dedupeWithinItem}=require('./lib/product-quality');
const {SpotConnector}=require('./lib/spot-connector');
const {SomarcasConnector}=require('./lib/somarcas-connector');
const {AsiaConnector}=require('./lib/asia-connector');
const {XbzConnector,INTERVAL_MS:XBZ_INTERVAL_MS}=require('./lib/xbz-connector');
const {normalizeRows:prepareXbzCatalog,importStage:commitXbzCatalog,hashCatalog:hashXbzCatalog}=require('./lib/xbz-catalog');
const xbzConnector=new XbzConnector();
const {normalizeRows:prepareAsiaCatalog,importStage:commitAsiaCatalog,hashCatalog:hashAsiaCatalog}=require('./lib/asia-catalog');
const asiaConnector=new AsiaConnector();
const {normalizeRows:prepareSomarcasCatalog,importStage:commitSomarcasCatalog,hashCatalog:hashSomarcasCatalog}=require('./lib/somarcas-catalog');
const somarcasConnector=new SomarcasConnector();
const {searchUnified}=require('./lib/unified-catalog');
const {planSpreadsheetCleanup,applySpreadsheetCleanup}=require('./lib/spreadsheet-cleanup');
const {normalizeFeeds,importStage,hashCatalog,searchCatalog,FEED_NAMES}=require('./lib/spot-catalog');
const spotConnector=new SpotConnector();
const {STOCK_INTERVAL_MS,CATALOG_INTERVAL_MS,applyStockFeed,buildCatalogStage,applyCatalogStage,due,syncStatus}=require('./lib/spot-sync');
const {importClients,importProducts,xlsxClientRows,xlsxProductRows,id:importId}=require('./lib/imports');

const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
const DATA_DIR = process.env.C4U_DATA_DIR || path.join(__dirname,'data');
fs.mkdirSync(DATA_DIR,{recursive:true});
const DB_PATH = path.join(DATA_DIR,'db.json');
if(!fs.existsSync(DB_PATH)){
  const seed=path.join(__dirname,'data','db.json');
  if(fs.existsSync(seed)) fs.copyFileSync(seed,DB_PATH);
  else fs.writeFileSync(DB_PATH,JSON.stringify({counters:{},settings:{}},null,2),'utf8');
}
// v16.0.8: mantém o banco JSON em memória e só relê do disco quando o arquivo
// realmente mudou. Isso evita dezenas de parses de um DB grande a cada troca de aba.
let dbCache=null;
let dbCacheSignature='';
function dbSignature(){
  try{const st=fs.statSync(DB_PATH);return `${st.mtimeMs}:${st.size}`}catch{return ''}
}
const sessions = new Map();
const realtimeClients = new Set();
const PRESENCE_TIMEOUT_MS = 30000;
function nowIso(){return new Date().toISOString()}
function broadcast(type,payload={}){
  const msg=`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for(const res of [...realtimeClients]){try{res.write(msg)}catch{realtimeClients.delete(res)}}
}
function activeSessions(){
  const now=Date.now();
  return [...sessions.entries()].filter(([,s])=>now-new Date(s.lastSeen||s.createdAt).getTime()<=PRESENCE_TIMEOUT_MS);
}
function presenceSnapshot(db){
  const active=activeSessions();
  const byUser=new Map();
  for(const [token,s] of active){if(!byUser.has(s.userId))byUser.set(s.userId,[]);byUser.get(s.userId).push({token:token.slice(0,8),machineId:s.machineId||'',deviceName:s.deviceName||'Computador',ip:s.ip||'',userAgent:s.userAgent||'',lastSeen:s.lastSeen||s.createdAt})}
  return {machinesOnline:active.length,users:(db.users||[]).filter(u=>u.active!==false).map(u=>({id:u.id,name:u.name,login:u.login||'',role:u.role||'',availabilityStatus:u.availabilityStatus||'available',active:u.active!==false,online:byUser.has(u.id),machines:byUser.get(u.id)||[],lastSeen:(byUser.get(u.id)||[]).map(x=>x.lastSeen).sort().pop()||u.lastLoginAt||''}))};
}

app.use(express.json({limit:'20mb'}));
app.use(express.static(path.join(__dirname,'public')));

const DEFAULT_SETTINGS = {
  systemName:'C4U APP', companyName:'Toca dos Brindes', companyLegalName:'', companyDocument:'', companyIE:'', companyPhone:'', companyEmail:'', companyAddress:'', companyCity:'', companyState:'', companyZipCode:'', companyLogo:'', primaryColor:'#6f2dbd', contrastColor:'#3e1364',
  quoteTitle:'PROPOSTA COMERCIAL', quoteSubtitle:'Soluções personalizadas para sua empresa', quoteFooter:'Obrigado pela oportunidade. Estamos à disposição.',
  quoteClientNameSize:34, quoteShowImages:true, quoteShowSeller:true, quoteShowPayment:true,
  invoiceTitle:'DOCUMENTO COMERCIAL INTERNO', invoiceAccent:'#394150', invoiceFooter:'Documento interno para conferência. Não substitui NF-e, DANFE ou documento fiscal autorizado pela SEFAZ.',
  quoteAccent:'#6f2dbd', quoteHeaderBg:'#f3eafd', quoteClientNameColor:'#2f123f', quoteLogoText:'T', quoteShowCompany:true,
  xbz:{enabled:false,baseUrl:'',catalogPath:'',productPath:'',authHeader:'Authorization',tokenPrefix:'Bearer ',token:'',lastSync:'',lastStatus:'Não configurado'},
  prospectingLists:{contactChannels:['E-mail','Telefone','WhatsApp','LinkedIn','Instagram','Formulário do site','Presencial','Outro'],leadOrigins:['Feiras','Feiras Brasil','Feiras do Brasil','Feiras & Negócios','UBRAFE','Site do evento','LinkedIn','Indicação','Pesquisa no Google','Outro'],segments:['Construção civil','Tecnologia','Varejo','Indústria','Saúde','Eventos','Outro']}
};
const COLLECTIONS=['clients','suppliers','products','quotes','orders','finance','invoices','users','activities','audit','deliveryRoutes','calendarEvents','documents','itemLibrary','documentTemplates','pdfHistory','tasks','notifications','spreadsheets','chatThreads','chatMessages','inboxMessages','clientFiles','approvalRequests','recordVersions','accessRequests','trustedDevices','prospectingLeads','customerFollowUps','routePlans','physicalStock','mindMaps','chatAttachments','personalNotes','personalReminders','personalFavorites','mindMapComments','spotCatalog','somarcasCatalog','asiaCatalog','xbzCatalog'];
const FEATURE_MIGRATION_V15_2='prospecting_and_route_v15_2';
function readDB(){
  const signature=dbSignature();
  if(dbCache && signature && signature===dbCacheSignature)return dbCache;
  const db=JSON.parse(fs.readFileSync(DB_PATH,'utf8')); db.counters=db.counters||{};
  for(const c of COLLECTIONS){ if(!Array.isArray(db[c])) db[c]=[]; if(!db.counters[c]) db.counters[c]=db[c].reduce((m,x)=>Math.max(m,Number(x.id)||0),0)+1; }
  db.settings={...DEFAULT_SETTINGS,...(db.settings||{})};
  db.settings.prospectingLists={...DEFAULT_SETTINGS.prospectingLists,...(db.settings.prospectingLists||{})};
  let seededTemplates=false;
  if(!db.documentTemplates.some(t=>t.type==='quote')){db.documentTemplates.push({id:nextId(db,'documentTemplates'),type:'quote',name:'Orçamento Padrão',isDefault:true,active:true,title:'PROPOSTA COMERCIAL',subtitle:'Soluções personalizadas para sua empresa',accent:'#6f2dbd',headerBg:'#f3eafd',clientColor:'#2f123f',clientNameSize:34,showCompany:true,showImages:true,showSeller:true,showPayment:true,showUnitPrice:true,showDocument:true,showPhone:true,showEmail:true,imageSize:'medium',introText:'Olá {{cliente}}, preparamos esta proposta especialmente para sua necessidade.',footer:'Obrigado pela oportunidade. Estamos à disposição.',createdAt:new Date().toISOString()});seededTemplates=true}
  if(!db.documentTemplates.some(t=>t.type==='invoice')){db.documentTemplates.push({id:nextId(db,'documentTemplates'),type:'invoice',name:'Pré-Nota Padrão',isDefault:true,active:true,title:'PRÉ-NOTA',accent:'#394150',showCompany:true,showSeller:true,showPayment:true,showDelivery:true,showDocument:true,showPhone:true,showEmail:true,warningText:'DOCUMENTO INTERNO • SEM VALOR FISCAL',footer:'Documento interno para conferência. Não substitui NF-e, DANFE ou documento fiscal autorizado pela SEFAZ.',createdAt:new Date().toISOString()});seededTemplates=true}
  const removedGoogleMaps=Boolean(db.settings.googleMaps); if(removedGoogleMaps) delete db.settings.googleMaps;
  const removedPhotoEditor=Object.prototype.hasOwnProperty.call(db,'layouts'); if(removedPhotoEditor){ delete db.layouts; if(db.counters) delete db.counters.layouts; }
  if(db.settings.systemName==='C4U SIST') db.settings.systemName='C4U APP';
  db.migrations=Array.isArray(db.migrations)?db.migrations:[];
  // Acesso: não recriar usuários antigos nem reintroduzir senhas históricas no startup.
  if(removedGoogleMaps||removedPhotoEditor||seededTemplates) fs.writeFileSync(DB_PATH,JSON.stringify(db,null,2),'utf8');
  dbCache=db; dbCacheSignature=dbSignature();
  return db;
}
function writeDB(db){
  const tmp=DB_PATH+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(db,null,2),'utf8');
  fs.renameSync(tmp,DB_PATH);
  dbCache=db; dbCacheSignature=dbSignature();
  if(typeof unifiedSearchCache!=='undefined')unifiedSearchCache.clear();
  broadcast('data-change',{at:nowIso()});
}
function nextId(db,c){const id=db.counters[c]||1;db.counters[c]=id+1;return id}
function num(v){return Number(v||0)}
function today(){return new Date().toISOString().slice(0,10)}
function businessLocalParts(offsetDays=0){const dt=new Date(Date.now()+offsetDays*86400000);const fmt=new Intl.DateTimeFormat('en-GB',{timeZone:process.env.C4U_TIMEZONE||'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});const parts=Object.fromEntries(fmt.formatToParts(dt).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`}
function checkPersonalReminderNotifications(db,uid){const now=businessLocalParts();let changed=false;for(const r of db.personalReminders||[]){if(Number(r.userId)!==Number(uid)||r.done||r.notifiedAt||!r.dueAt||String(r.dueAt).slice(0,16)>now)continue;notify(db,{userId:uid,title:'Lembrete: '+String(r.title||'Pendência'),message:String(r.detail||'').slice(0,250),kind:'reminder',page:'reminders',entityId:r.id});r.notifiedAt=nowIso();changed=true;}return changed}

function safeUser(u){if(!u)return null;const {passwordHash,passwordSalt,...s}=u;return s}
function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){return {salt,hash:crypto.scryptSync(String(password),salt,64).toString('hex')}}
function verifyPassword(password,u){if(!u?.passwordHash||!u?.passwordSalt)return false;const h=crypto.scryptSync(String(password),u.passwordSalt,64);const stored=Buffer.from(u.passwordHash,'hex');return stored.length===h.length&&crypto.timingSafeEqual(stored,h)}
function audit(db,user,action,entity,entityId,detail=''){db.audit.push({id:nextId(db,'audit'),userId:user?.id||0,userName:user?.name||'Sistema',action,entity,entityId,detail,createdAt:new Date().toISOString()})}


const DEFAULT_ROLE_PERMISSIONS={
 'Administrador':['*'],
 'Vendedor':['dashboard','mindMaps','chat','prospecting','routePlanner','clients','crm','quotes','priceHistory','approvals','orders','calendar','tasks','documents','filesCenter','itemLibrary','products','suppliers','notifications','search'],
 'Financeiro':['dashboard','mindMaps','chat','clients','orders','finance','invoices','calendar','tasks','documents','filesCenter','notifications','reports','search'],
 'Produção':['dashboard','mindMaps','chat','routePlanner','clients','orders','calendar','tasks','documents','filesCenter','products','itemLibrary','notifications','search']
};
function permissionsFor(user){if(user?.role==='Administrador')return ['*'];return Array.isArray(user?.permissions)?user.permissions:(DEFAULT_ROLE_PERMISSIONS[user?.role]||DEFAULT_ROLE_PERMISSIONS.Vendedor)}
function can(user,perm){const p=permissionsFor(user);return p.includes('*')||p.includes(perm)}
function snapshotVersion(db,user,collection,record,action='EDITAR'){
 if(!record)return; const id=nextId(db,'recordVersions');
 db.recordVersions.push({id,collection,recordId:record.id,recordNumber:record.number||record.name||record.description||'',action,snapshot:JSON.parse(JSON.stringify(record)),userId:user?.id||0,userName:user?.name||'Sistema',createdAt:nowIso()});
 if(db.recordVersions.length>2500)db.recordVersions=db.recordVersions.slice(-2500);
}
function notify(db,{userId=0,title,message='',kind='info',page='',entityId=0}={}){db.notifications.push({id:nextId(db,'notifications'),userId,title,message,kind,page,entityId,read:false,createdAt:nowIso()});}
function backupDir(){const d=process.env.C4U_BACKUP_DIR || path.join(__dirname,'backups');fs.mkdirSync(d,{recursive:true});return d}
function createBackup(label='manual'){
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');const file=`db-${stamp}-${label}.json`;fs.copyFileSync(DB_PATH,path.join(backupDir(),file));
 const files=fs.readdirSync(backupDir()).filter(x=>x.endsWith('.json')).sort().reverse();for(const old of files.slice(30)){try{fs.unlinkSync(path.join(backupDir(),old))}catch{}}
 return file;
}
let lastAutoBackupDay='';function ensureDailyBackup(){const day=today();if(day!==lastAutoBackupDay){try{createBackup('automatico');lastAutoBackupDay=day}catch{}}}
function tokenFromReq(req){
  const h=String(req.headers.authorization||'');
  if(h.startsWith('Bearer '))return h.slice(7).trim();
  if(req.query&&req.query.token)return String(req.query.token);
  return '';
}
app.post('/api/auth/login',(req,res)=>{
  const db=readDB();
  const ident=String(req.body.login||req.body.email||'').trim().replace(/\s+/g,'');
  const password=String(req.body.password||'');
  const user=db.users.find(u=>u.active!==false&&(String(u.login||'').trim().replace(/\s+/g,'').toLowerCase()===ident.toLowerCase()||String(u.email||'').trim().replace(/\s+/g,'').toLowerCase()===ident.toLowerCase()));
  if(!user||!verifyPassword(password,user))return res.status(401).json({error:'Login, e-mail ou senha inválidos.'});
  const token=crypto.randomBytes(32).toString('hex');
  const session={userId:user.id,createdAt:nowIso(),lastSeen:nowIso(),machineId:String(req.body.machineId||''),deviceName:String(req.body.deviceName||'Computador'),ip:req.ip,userAgent:String(req.headers['user-agent']||'')};
  sessions.set(token,session);
  user.lastLoginAt=nowIso(); writeDB(db);
  broadcast('presence-change',{at:nowIso()});
  res.json({token,user:{...safeUser(user),permissions:permissionsFor(user)}});
});
app.post('/api/auth/device',(req,res)=>{
  const db=readDB(),machineId=String(req.body.machineId||'').trim();
  if(!machineId)return res.status(404).json({error:'Computador não liberado.'});
  const trusted=db.trustedDevices.find(d=>d.active!==false&&d.machineId===machineId);
  if(!trusted)return res.status(404).json({error:'Computador não liberado.'});
  const user=db.users.find(u=>u.id===Number(trusted.userId)&&u.active!==false);
  if(!user)return res.status(403).json({error:'O usuário vinculado a este computador não está ativo.'});
  const token=crypto.randomBytes(32).toString('hex');
  const session={userId:user.id,createdAt:nowIso(),lastSeen:nowIso(),machineId,deviceName:String(req.body.deviceName||trusted.deviceName||'Computador'),ip:req.ip,userAgent:String(req.headers['user-agent']||''),trustedDeviceId:trusted.id};
  sessions.set(token,session);trusted.lastUsedAt=nowIso();trusted.lastIp=req.ip;user.lastLoginAt=nowIso();writeDB(db);broadcast('presence-change',{at:nowIso()});res.json({token,user:{...safeUser(user),permissions:permissionsFor(user)},trusted:true});
});
app.post('/api/auth/access-request',(req,res)=>{
  const db=readDB(),machineId=String(req.body.machineId||'').trim(),deviceName=String(req.body.deviceName||'Computador').slice(0,120);
  if(!machineId)return res.status(400).json({error:'Identificação do computador ausente.'});
  const already=db.trustedDevices.find(d=>d.active!==false&&d.machineId===machineId);if(already)return res.json({ok:true,alreadyApproved:true});
  let row=db.accessRequests.find(r=>r.machineId===machineId&&r.status==='pending');
  if(!row){row={id:nextId(db,'accessRequests'),machineId,deviceName,ip:req.ip,status:'pending',createdAt:nowIso()};db.accessRequests.push(row)}else{row.deviceName=deviceName;row.ip=req.ip;row.updatedAt=nowIso()}
  writeDB(db);broadcast('access-request',{at:nowIso(),id:row.id});res.json({ok:true,message:'Solicitação enviada ao administrador.'});
});
function requireAuth(req,res,next){
  const token=tokenFromReq(req),session=sessions.get(token);
  if(!session)return res.status(401).json({error:'Sessão expirada. Faça login novamente.'});
  const db=readDB(),user=db.users.find(u=>u.id===session.userId&&u.active!==false);
  if(!user){sessions.delete(token);return res.status(401).json({error:'Acesso não autorizado.'})}
  session.lastSeen=nowIso();session.ip=req.ip;session.userAgent=String(req.headers['user-agent']||session.userAgent||'');sessions.set(token,session);
  req.user=user;req.sessionToken=token;req.sessionInfo=session;next();
}
app.use('/api',(req,res,next)=>req.path.startsWith('/public/')?next():requireAuth(req,res,next));
app.use('/api',(req,res,next)=>{
  const path0=req.path;
  // Rotas básicas necessárias para toda sessão autenticada.
  if(['/me','/events','/presence','/network-info','/notifications'].some(p=>path0.startsWith(p)))return next();
  // Configurações podem ser lidas por todos para identidade visual; alteração continua admin-only na rota PUT.
  if(path0==='/settings'&&req.method==='GET')return next();
  const map=[
    ['/dashboard','dashboard'],['/briefing','dashboard'],['/personal','dashboard'],['/mindmaps','chat'],['/chat','chat'],['/prospecting','prospecting'],['/routes','routePlanner'],['/spreadsheets','spreadsheet'],['/clients','clients'],['/activities','crm'],['/quotes','quotes'],['/price-history','priceHistory'],['/approvals','approvals'],['/orders','orders'],['/calendar','calendar'],['/calendarEvents','calendar'],['/tasks','tasks'],['/documents','documents'],['/documentTemplates','documents'],['/pdfHistory','documents'],['/clientFiles','filesCenter'],['/itemLibrary','itemLibrary'],['/physicalStock','products'],['/products','products'],['/suppliers','suppliers'],['/finance','finance'],['/invoices','invoices'],['/reports','reports'],['/executive','executive'],['/notifications','notifications'],['/search','search'],['/users','users'],['/settings','settings'],['/integrations','integrations'],['/spot/catalog','quotes'],['/audit','audit'],['/backups','backups'],['/versions','versions'],['/network-info','settings'],['/presence','settings']
  ];
  const hit=map.find(([p])=>path0.startsWith(p));
  if(hit&&!can(req.user,hit[1]))return res.status(403).json({error:'Seu usuário não tem permissão para esta área.'});
  next();
});
function lanIpScore(name,address){
  const n=String(name||'').toLowerCase(),a=String(address||'');
  let score=0;
  if(/^192\.168\./.test(a))score+=50;
  else if(/^10\./.test(a))score+=45;
  else if(/^172\.(1[6-9]|2\d|3[01])\./.test(a))score+=40;
  if(/wi-?fi|wlan|wireless/.test(n))score+=15;
  if(/ethernet|eth\d*/.test(n))score+=12;
  if(/vethernet|wsl|virtual|vmware|virtualbox|docker|hyper-v|tailscale|zerotier|loopback/.test(n))score-=60;
  return score;
}
function localIPv4(){
  const found=[];
  for(const [name,rows] of Object.entries(os.networkInterfaces())){
    for(const row of rows||[]){
      if(row.family==='IPv4'&&!row.internal&&!String(row.address).startsWith('169.254.')){
        found.push({name,address:row.address,score:lanIpScore(name,row.address)});
      }
    }
  }
  return found.sort((a,b)=>b.score-a.score||a.address.localeCompare(b.address)).map(({score,...x})=>x);
}
function requestBaseUrl(req){
  if(PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  if(req){
    const proto=String(req.headers['x-forwarded-proto']||req.protocol||'http').split(',')[0].trim();
    const host=String(req.headers['x-forwarded-host']||req.get('host')||'').split(',')[0].trim();
    if(host) return `${proto}://${host}`;
  }
  const ips=localIPv4();
  return ips.length?`http://${ips[0].address}:${PORT}`:`http://localhost:${PORT}`;
}
function recommendedLanUrl(){ return requestBaseUrl(null); }
app.get('/api/network-info',(req,res)=>{
  const ips=localIPv4(),urls=ips.map(x=>`http://${x.address}:${PORT}`),recommendedUrl=requestBaseUrl(req);
  res.json({mode:PUBLIC_BASE_URL?'cloud':'auto',host:os.hostname(),port:PORT,listenHost:HOST,ips,urls,recommendedUrl,approvalBaseUrl:recommendedUrl,localUrl:`http://localhost:${PORT}`,publicBaseUrl:PUBLIC_BASE_URL||recommendedUrl,sharedDatabase:true});
});
app.get('/api/me',(req,res)=>res.json({...safeUser(req.user),permissions:permissionsFor(req.user)}));

// v16.0.8: um único snapshot para aquecer o cache do navegador. Antes, cada
// troca de sessão disparava muitas requisições /api/<colecao>, cada uma relendo o DB.
app.get('/api/bootstrap',(req,res)=>{
  const db=readDB();
  const permissionByCollection={clients:'clients',suppliers:'suppliers',products:'products',physicalStock:'products',itemLibrary:'itemLibrary',quotes:'quotes',orders:'orders',finance:'finance',invoices:'invoices',users:'users',activities:'crm',calendarEvents:'calendar',documents:'documents',documentTemplates:'documents',pdfHistory:'documents',tasks:'tasks',notifications:'notifications',spreadsheets:'spreadsheet'};
  const hasPerm=perm=>req.user?.role==='Administrador'||(req.user?.permissions||[]).includes('*')||(req.user?.permissions||[]).includes(perm);
  const out={};
  for(const [key,need] of Object.entries(permissionByCollection)){
    if(key==='users'&&!hasPerm('users')){
      out[key]=(db.users||[]).filter(u=>u.active!==false).map(u=>({id:u.id,name:u.name,login:u.login||u.email||'',email:u.email||'',role:u.role||'',availabilityStatus:u.availabilityStatus||'available'}));
      continue;
    }
    if(need&&!hasPerm(need)){out[key]=[];continue}
    if(key==='notifications')out[key]=(db.notifications||[]).filter(n=>!n.userId||n.userId===req.user.id).slice().reverse().slice(0,200);
    else out[key]=Array.isArray(db[key])?db[key]:[];
  }
  res.json(out);
});

// ===== v16.0.5: diagnósticos SEM alteração automática de fotos e códigos =====
app.get('/api/itemLibrary/quality',(req,res)=>{if(req.user.role!=='Administrador')return res.status(403).json({error:'Somente administrador.'});res.json(quality(readDB().itemLibrary))});
app.post('/api/itemLibrary/quality/dedupe',(req,res)=>{if(req.user.role!=='Administrador')return res.status(403).json({error:'Somente administrador.'});const db=readDB();const preview=quality(db.itemLibrary);if(!preview.issues.some(i=>i.type==='duplicate-in-item'))return res.json({itemsChanged:0,imagesRemoved:0});const backup=createBackup('dedupe-imagens');const result=dedupeWithinItem(db.itemLibrary);audit(db,req.user,'CORRIGIR','itemLibrary',0,`Remoção de imagens idênticas no mesmo item; backup ${backup}`);writeDB(db);res.json({...result,backup})});

// ===== v16.0.5: arquivos em disco fora da pasta pública; autorização por conversa =====
const CHAT_UPLOAD_DIR=path.join(DATA_DIR,'chat-uploads');
fs.mkdirSync(CHAT_UPLOAD_DIR,{recursive:true});
const ALLOWED_ATTACHMENTS={
 'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp',
 'application/pdf':'.pdf','text/plain':'.txt','text/csv':'.csv',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'.docx',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'.xlsx'
};
function attachmentSignatureOk(bytes,mime){
 if(mime==='image/png')return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(mime==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(mime==='image/webp')return bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(mime==='application/pdf')return bytes.toString('ascii',0,5)==='%PDF-';
 if(mime.endsWith('wordprocessingml.document')||mime.endsWith('spreadsheetml.sheet'))return bytes.subarray(0,4).equals(Buffer.from([80,75,3,4]));
 if(mime==='text/plain'||mime==='text/csv')return !bytes.includes(0);
 return false;
}
app.post('/api/chat/threads/:id/attachments',(req,res)=>{
 const db=readDB(),t=chatThreadForUser(db,req.params.id,req.user.id);
 if(!t)return res.status(404).json({error:'Conversa não encontrada.'});
 const {name,mime,base64}=req.body||{};
 const type=String(mime||''),extension=ALLOWED_ATTACHMENTS[type],raw=String(base64||'');
 if(!extension||!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)||raw.length>8.1*1024*1024)return res.status(400).json({error:'Formato ou tamanho de arquivo não permitido. Limite: 6 MB.'});
 const bytes=Buffer.from(raw,'base64');
 if(!bytes.length||bytes.length>6*1024*1024||!attachmentSignatureOk(bytes,type))return res.status(400).json({error:'Arquivo inválido ou maior que 6 MB.'});
 const original=path.basename(String(name||'arquivo').replace(/[\\/]/g,'_')).replace(/[\x00-\x1f]/g,'').slice(0,140)||'arquivo';
 const diskName=crypto.randomUUID()+extension;
 try{
  fs.writeFileSync(path.join(CHAT_UPLOAD_DIR,diskName),bytes,{flag:'wx',mode:0o600});
  const row={id:nextId(db,'chatAttachments'),threadId:t.id,uploadedBy:req.user.id,name:original,mime:type,size:bytes.length,diskName,createdAt:nowIso()};
  db.chatAttachments.push(row);audit(db,req.user,'ANEXAR','chatAttachments',row.id,original);writeDB(db);
  res.status(201).json({id:row.id,name:row.name,mime:row.mime,size:row.size});
 }catch(e){try{fs.unlinkSync(path.join(CHAT_UPLOAD_DIR,diskName))}catch{};res.status(500).json({error:'Não foi possível salvar o anexo.'})}
});
app.get('/api/chat/attachments/:id',(req,res)=>{
 const db=readDB(),a=db.chatAttachments.find(x=>x.id===Number(req.params.id));
 if(!a||!chatThreadForUser(db,a.threadId,req.user.id)||!db.chatMessages.some(m=>m.threadId===a.threadId&&m.attachmentId===a.id))return res.status(404).json({error:'Arquivo não encontrado.'});
 const filename=path.join(CHAT_UPLOAD_DIR,path.basename(a.diskName||''));
 if(!fs.existsSync(filename)||!ALLOWED_ATTACHMENTS[a.mime])return res.status(404).json({error:'Arquivo indisponível. Verifique o backup de anexos.'});
 res.setHeader('Content-Type',a.mime);res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
 res.setHeader('Content-Disposition',`attachment; filename="${String(a.name||'arquivo').replace(/["\r\n\\]/g,'_')}"`);
 res.sendFile(filename);
});

// ===== v16.0.5: mapas mentais com isolamento por usuário e compartilhamento explícito =====
function mindMapVisible(map,userId){return map&& (Number(map.ownerId)===Number(userId)||(map.sharedUserIds||[]).map(Number).includes(Number(userId)))}
function mindMapForUser(db,id,userId){const m=db.mindMaps.find(x=>x.id===Number(id));return mindMapVisible(m,userId)?m:null}
function validNodes(value){
 if(!Array.isArray(value)||value.length>160)throw Error('Mapa deve ter no máximo 160 blocos.');
 const ids=new Set();const result=value.map(n=>{
  const id=String(n.id||'');if(!/^[a-zA-Z0-9_-]{1,50}$/.test(id)||ids.has(id))throw Error('ID de bloco inválido ou duplicado.');ids.add(id);
  const x=Number(n.x),y=Number(n.y);if(!Number.isFinite(x)||!Number.isFinite(y))throw Error('Posição de bloco inválida.');
  const w=Number(n.width??178),h=Number(n.height??90);
  if(!Number.isFinite(w)||!Number.isFinite(h))throw Error('Dimensão de bloco inválida.');
  const width=Math.max(140,Math.min(420,Math.round(w))),height=Math.max(80,Math.min(260,Math.round(h)));
  return {id,label:String(n.label||'').trim().slice(0,180),x:Math.max(0,Math.min(3200-width,x)),y:Math.max(0,Math.min(2000-height,y)),width,height,shape:['rounded','rectangle','pill','note'].includes(n.shape)?n.shape:'rounded',parentId:String(n.parentId||'').slice(0,50),color:/^#[0-9a-fA-F]{6}$/.test(n.color||'')?n.color:'#eee6ff',notes:String(n.notes||'').slice(0,1500),status:['idea','doing','done'].includes(n.status)?n.status:'idea',dueDate:/^\d{4}-\d{2}-\d{2}$/.test(n.dueDate||'')?n.dueDate:'',assignedUserId:Number(n.assignedUserId)||0};
 });
 if(result.some(n=>n.parentId&&(!ids.has(n.parentId)||n.parentId===n.id)))throw Error('Conexão hierárquica inválida.');
 return result;
}
function validMindEdges(value,nodes){
 if(value===undefined||value===null)return [];
 if(!Array.isArray(value)||value.length>320)throw Error('O mapa permite até 320 conexões adicionais.');
 const nodesById=new Map(nodes.map(n=>[n.id,n])),unique=new Set();
 return value.map((edge,i)=>{
  const from=String(edge?.from||''),to=String(edge?.to||'');
  if(!nodesById.has(from)||!nodesById.has(to)||from===to)throw Error('Conexão entre blocos inválida.');
  const pair=[from,to].sort().join('::');
  if(unique.has(pair))throw Error('Conexão adicional duplicada.');unique.add(pair);
  const id=String(edge?.id||`link${i}`);
  if(!/^[a-zA-Z0-9_-]{1,50}$/.test(id))throw Error('Identificador de conexão inválido.');
  return {id,from,to,label:String(edge?.label||'').trim().slice(0,90)};
 });
}
app.get('/api/mindmaps',(req,res)=>{const db=readDB();res.json(db.mindMaps.filter(m=>mindMapVisible(m,req.user.id)).map(({nodes,...m})=>({...m,nodeCount:nodes?.length||0})).sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt))))});
app.post('/api/mindmaps',(req,res)=>{const db=readDB(),title=String(req.body?.title||'Novo mapa').trim().slice(0,120);if(!title)return res.status(400).json({error:'Informe o título.'});let nodes;try{nodes=validNodes(req.body?.nodes||[{id:'central',label:title,x:450,y:210,parentId:'',color:'#e8dcff'}])}catch(e){return res.status(400).json({error:e.message})}let edges;try{edges=validMindEdges(req.body?.edges||[],nodes)}catch(e){return res.status(400).json({error:e.message})}const row={id:nextId(db,'mindMaps'),title,nodes,edges,ownerId:req.user.id,sharedUserIds:[],editUserIds:[],revision:1,createdAt:nowIso(),updatedAt:nowIso()};db.mindMaps.push(row);audit(db,req.user,'CRIAR','mindMaps',row.id,title);writeDB(db);res.status(201).json(row)});
app.get('/api/mindmaps/:id',(req,res)=>{const db=readDB(),m=mindMapForUser(db,req.params.id,req.user.id);if(!m)return res.status(404).json({error:'Mapa não encontrado.'});res.json(m)});
app.put('/api/mindmaps/:id',(req,res)=>{const db=readDB(),m=mindMapForUser(db,req.params.id,req.user.id);if(!m)return res.status(404).json({error:'Mapa não encontrado.'});if(m.ownerId!==req.user.id&&!(m.editUserIds||[]).map(Number).includes(req.user.id))return res.status(403).json({error:'Sem permissão de edição neste mapa.'});if(req.body?.revision!==undefined&&Number(req.body.revision)!==Number(m.revision||1))return res.status(409).json({error:'Este mapa foi alterado por outro colaborador. Reabra-o para evitar sobrescrever as alterações.'});try{const nodes=validNodes(req.body?.nodes),title=String(req.body?.title||'').trim().slice(0,120);if(!title)throw Error('Informe o título.');const edges=validMindEdges(req.body?.edges||[],nodes);snapshotVersion(db,req.user,'mindMaps',m);m.title=title;m.nodes=nodes;m.edges=edges;m.revision=Number(m.revision||1)+1;m.updatedAt=nowIso();audit(db,req.user,'EDITAR','mindMaps',m.id,m.title);writeDB(db);res.json(m)}catch(e){res.status(400).json({error:e.message})}});
app.delete('/api/mindmaps/:id',(req,res)=>{const db=readDB(),m=db.mindMaps.find(x=>x.id===Number(req.params.id));if(!m)return res.status(404).json({error:'Mapa não encontrado.'});if(m.ownerId!==req.user.id)return res.status(403).json({error:'Somente o criador pode excluir.'});snapshotVersion(db,req.user,'mindMaps',m,'EXCLUIR');db.mindMaps=db.mindMaps.filter(x=>x.id!==m.id);audit(db,req.user,'EXCLUIR','mindMaps',m.id,m.title);writeDB(db);res.status(204).end()});
app.post('/api/mindmaps/:id/share',(req,res)=>{
 const db=readDB(),m=mindMapForUser(db,req.params.id,req.user.id),t=chatThreadForUser(db,req.body?.threadId,req.user.id);
 if(!m||!t)return res.status(404).json({error:'Mapa ou conversa não encontrados.'});
 if(m.ownerId!==req.user.id)return res.status(403).json({error:'Somente o criador pode compartilhar este mapa.'});
 m.sharedUserIds=[...new Set([...(m.sharedUserIds||[]),...(t.memberIds||[]).map(Number)].filter(id=>id!==m.ownerId))];if(req.body?.permission==='edit')m.editUserIds=[...new Set([...(m.editUserIds||[]),...(t.memberIds||[]).map(Number)].filter(id=>id!==m.ownerId))];m.updatedAt=nowIso();
 const row={id:nextId(db,'chatMessages'),threadId:t.id,senderId:req.user.id,senderName:req.user.name,text:`Mapa mental compartilhado: ${m.title}`,mindMapId:m.id,createdAt:nowIso()};db.chatMessages.push(row);t.lastMessageAt=row.createdAt;
 for(const id of t.memberIds||[])if(id!==req.user.id)notify(db,{userId:id,title:'Mapa mental compartilhado',message:`${req.user.name}: ${m.title}${req.body?.permission==='edit'?' (pode editar)':''}`,kind:'chat',page:'chat',entityId:t.id});
 audit(db,req.user,'COMPARTILHAR','mindMaps',m.id,`Conversa ${t.id}`);writeDB(db);res.status(201).json({message:row,mapId:m.id});
});

// ===== C4U v14.7 — Chat interno =====
function chatThreadForUser(db,id,userId){return (db.chatThreads||[]).find(t=>t.id===Number(id)&&(t.memberIds||[]).map(Number).includes(Number(userId)))}
function chatThreadView(db,t,userId){
  const msgs=(db.chatMessages||[]).filter(m=>m.threadId===t.id).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
  const last=msgs[msgs.length-1]||null, readAt=t.lastReadBy?.[String(userId)]||'';
  const unread=msgs.filter(m=>m.senderId!==userId&&(!readAt||String(m.createdAt)>String(readAt))).length;
  return {...t,members:(t.memberIds||[]).map(id=>safeUser((db.users||[]).find(u=>u.id===Number(id)))).filter(Boolean),lastMessage:last?{id:last.id,senderId:last.senderId,senderName:last.senderName,text:last.text||'',hasImage:Boolean(last.imageData),hasAttachment:Boolean(last.attachmentId),mindMapId:last.mindMapId||0,createdAt:last.createdAt}:null,unread};
}
app.get('/api/chat/users',(req,res)=>{const db=readDB();res.json((db.users||[]).filter(u=>u.active!==false).map(u=>({id:u.id,name:u.name,login:u.login||u.email||'',email:u.email||'',role:u.role||'',availabilityStatus:u.availabilityStatus||'available'})))});
app.get('/api/chat/threads',(req,res)=>{const db=readDB(),uid=req.user.id;const rows=(db.chatThreads||[]).filter(t=>(t.memberIds||[]).map(Number).includes(uid)).map(t=>chatThreadView(db,t,uid)).sort((a,b)=>String(b.lastMessageAt||b.createdAt||'').localeCompare(String(a.lastMessageAt||a.createdAt||'')));res.json(rows)});
app.post('/api/chat/threads',(req,res)=>{
  const db=readDB(),body=req.body||{},type=body.type==='group'?'group':'direct',others=[...new Set((body.memberIds||[]).map(Number).filter(Boolean))].filter(id=>id!==req.user.id&&db.users.some(u=>u.id===id&&u.active!==false));
  if(type==='direct'&&others.length!==1)return res.status(400).json({error:'Escolha uma pessoa para iniciar a conversa.'});
  if(type==='group'&&others.length<1)return res.status(400).json({error:'Escolha pelo menos mais um membro para o grupo.'});
  const members=[req.user.id,...others].sort((a,b)=>a-b);
  if(type==='direct'){
    const existing=(db.chatThreads||[]).find(t=>t.type==='direct'&&JSON.stringify([...(t.memberIds||[])].map(Number).sort((a,b)=>a-b))===JSON.stringify(members));
    if(existing)return res.json(chatThreadView(db,existing,req.user.id));
  }
  const t={id:nextId(db,'chatThreads'),type,name:type==='group'?String(body.name||'').trim():'',memberIds:members,createdBy:req.user.id,lastReadBy:{[String(req.user.id)]:nowIso()},createdAt:nowIso(),lastMessageAt:nowIso()};
  if(type==='group'&&!t.name)return res.status(400).json({error:'Informe um nome para o grupo.'});
  db.chatThreads.push(t);audit(db,req.user,'CRIAR','chatThreads',t.id,type==='group'?t.name:'Conversa direta');writeDB(db);res.status(201).json(chatThreadView(db,t,req.user.id));
});
app.get('/api/chat/threads/:id/messages',(req,res)=>{const db=readDB(),t=chatThreadForUser(db,req.params.id,req.user.id);if(!t)return res.status(404).json({error:'Conversa não encontrada.'});const rows=(db.chatMessages||[]).filter(m=>m.threadId===t.id).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))).slice(-500);res.json(rows)});
app.post('/api/chat/threads/:id/messages',(req,res)=>{
  const db=readDB(),t=chatThreadForUser(db,req.params.id,req.user.id);if(!t)return res.status(404).json({error:'Conversa não encontrada.'});
  const text=String(req.body.text||'').trim(),imageData=String(req.body.imageData||''),imageName=String(req.body.imageName||'imagem'),attachmentId=Number(req.body.attachmentId||0);
  const attachment=attachmentId?db.chatAttachments.find(a=>a.id===attachmentId&&a.threadId===t.id&&a.uploadedBy===req.user.id):null;
  if(attachmentId&&!attachment)return res.status(403).json({error:'Anexo inválido ou não autorizado.'});
  if(!text&&!imageData&&!attachment)return res.status(400).json({error:'Digite uma mensagem ou escolha um arquivo.'});
  if(text.length>5000)return res.status(400).json({error:'Mensagem muito longa.'});
  if(imageData&&(!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(imageData)||imageData.length>6500000))return res.status(400).json({error:'A imagem precisa ser JPG, PNG ou WEBP e ter tamanho reduzido.'});
  const m={id:nextId(db,'chatMessages'),threadId:t.id,senderId:req.user.id,senderName:req.user.name,text,imageData,imageName,attachmentId:attachment?.id||0,attachment:attachment?{id:attachment.id,name:attachment.name,mime:attachment.mime,size:attachment.size}:null,createdAt:nowIso()};db.chatMessages.push(m);t.lastMessageAt=m.createdAt;t.lastReadBy={...(t.lastReadBy||{}),[String(req.user.id)]:m.createdAt};
  for(const uid of t.memberIds||[])if(uid!==req.user.id){const member=db.users.find(u=>u.id===Number(uid));const mentions=String(text||'').match(/@[\p{L}\p{N}._-]+/gu)||[];const tag=member&&mentions.some(raw=>[member.login,member.name?.split(' ')[0]].filter(Boolean).some(alias=>raw.slice(1).toLowerCase()===String(alias).toLowerCase()));notify(db,{userId:uid,title:tag?`Você foi mencionado por ${req.user.name}`:(t.type==='group'?`Mensagem em ${t.name}`:`Mensagem de ${req.user.name}`),message:text||(attachment?'Arquivo recebido':'Imagem recebida'),kind:tag?'mention':'chat',page:'chat',entityId:t.id});}
  writeDB(db);res.status(201).json(m);
});
app.post('/api/chat/threads/:id/read',(req,res)=>{const db=readDB(),t=chatThreadForUser(db,req.params.id,req.user.id);if(!t)return res.status(404).json({error:'Conversa não encontrada.'});const key=String(req.user.id),lastMessage=String(t.lastMessageAt||''),lastRead=String((t.lastReadBy||{})[key]||'');if(lastMessage&&lastRead<lastMessage){t.lastReadBy={...(t.lastReadBy||{}),[key]:nowIso()};writeDB(db)}res.status(204).end()});


function inboxRecipientState(row,userId){const key=String(userId),state=(row.recipientState||{})[key]||{};return {readAt:state.readAt||'',ackAt:state.ackAt||'',archived:Boolean(state.archived),important:Boolean(state.important)}}
function inboxVisibleTo(row,userId){return Number(row.senderId)===Number(userId)||(row.recipientIds||[]).map(Number).includes(Number(userId))}
function inboxView(db,row,userId){const usersById=new Map((db.users||[]).map(u=>[Number(u.id),safeUser(u)]));return {...row,sender:usersById.get(Number(row.senderId))||{id:row.senderId,name:row.senderName||'Usuário'},recipients:(row.recipientIds||[]).map(id=>usersById.get(Number(id))).filter(Boolean),myState:inboxRecipientState(row,userId)}}
app.get('/api/chat/inbox',(req,res)=>{const db=readDB(),uid=req.user.id,folder=String(req.query.folder||'received');let rows=(db.inboxMessages||[]).filter(x=>inboxVisibleTo(x,uid));if(folder==='received')rows=rows.filter(x=>(x.recipientIds||[]).map(Number).includes(uid)&&!inboxRecipientState(x,uid).archived);else if(folder==='sent')rows=rows.filter(x=>Number(x.senderId)===uid);else if(folder==='important')rows=rows.filter(x=>inboxRecipientState(x,uid).important);else if(folder==='archived')rows=rows.filter(x=>inboxRecipientState(x,uid).archived);rows.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));res.json(rows.map(x=>inboxView(db,x,uid)))})
app.post('/api/chat/inbox',(req,res)=>{const db=readDB(),body=req.body||{},recipientIds=[...new Set((body.recipientIds||[]).map(Number).filter(id=>id&&id!==req.user.id&&db.users.some(u=>u.id===id&&u.active!==false)))],subject=String(body.subject||'').trim(),message=String(body.message||'').trim(),category=String(body.category||'Comunicado').trim(),priority=String(body.priority||'Normal').trim(),imageData=String(body.imageData||''),imageName=String(body.imageName||'imagem');if(!recipientIds.length)return res.status(400).json({error:'Escolha pelo menos um destinatário.'});if(!subject)return res.status(400).json({error:'Informe o assunto.'});if(!message&&!imageData)return res.status(400).json({error:'Escreva a comunicação ou anexe uma imagem.'});if(subject.length>180||message.length>12000)return res.status(400).json({error:'Conteúdo muito longo.'});if(imageData&&(!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(imageData)||imageData.length>6500000))return res.status(400).json({error:'A imagem precisa ser JPG, PNG ou WEBP e ter tamanho reduzido.'});const recipientState={};for(const id of recipientIds)recipientState[String(id)]={readAt:'',ackAt:'',archived:false,important:false};const row={id:nextId(db,'inboxMessages'),senderId:req.user.id,senderName:req.user.name,recipientIds,subject,message,category,priority,requireAck:Boolean(body.requireAck),imageData,imageName,sourceChatMessageId:Number(body.sourceChatMessageId||0)||0,sourceThreadId:Number(body.sourceThreadId||0)||0,relatedType:String(body.relatedType||''),relatedId:Number(body.relatedId||0)||0,recipientState,createdAt:nowIso()};db.inboxMessages.push(row);audit(db,req.user,'CRIAR','inboxMessages',row.id,subject);for(const uid of recipientIds)notify(db,{userId:uid,title:`Caixa de Entrada: ${subject}`,message:`${req.user.name} • ${category}${row.requireAck?' • Requer ciência':''}`,kind:'inbox',page:'chat',entityId:row.id});writeDB(db);res.status(201).json(inboxView(db,row,req.user.id))})
app.get('/api/chat/inbox/:id',(req,res)=>{const db=readDB(),row=(db.inboxMessages||[]).find(x=>x.id===Number(req.params.id)&&inboxVisibleTo(x,req.user.id));if(!row)return res.status(404).json({error:'Comunicação não encontrada.'});if((row.recipientIds||[]).map(Number).includes(req.user.id)){row.recipientState=row.recipientState||{};const key=String(req.user.id);if(!row.recipientState[key]?.readAt){row.recipientState[key]={...(row.recipientState[key]||{}),readAt:nowIso()};writeDB(db)}}res.json(inboxView(db,row,req.user.id))})
app.post('/api/chat/inbox/:id/ack',(req,res)=>{const db=readDB(),row=(db.inboxMessages||[]).find(x=>x.id===Number(req.params.id));if(!row||!(row.recipientIds||[]).map(Number).includes(req.user.id))return res.status(404).json({error:'Comunicação não encontrada.'});row.recipientState=row.recipientState||{};const key=String(req.user.id),at=nowIso();row.recipientState[key]={...(row.recipientState[key]||{}),readAt:row.recipientState[key]?.readAt||at,ackAt:at};audit(db,req.user,'CIÊNCIA','inboxMessages',row.id,row.subject||'');notify(db,{userId:Number(row.senderId),title:'Ciência confirmada',message:`${req.user.name} confirmou ciência: ${row.subject}`,kind:'inbox',page:'chat',entityId:row.id});writeDB(db);res.json(inboxView(db,row,req.user.id))})
app.post('/api/chat/inbox/:id/state',(req,res)=>{const db=readDB(),row=(db.inboxMessages||[]).find(x=>x.id===Number(req.params.id)&&inboxVisibleTo(x,req.user.id));if(!row)return res.status(404).json({error:'Comunicação não encontrada.'});row.recipientState=row.recipientState||{};const key=String(req.user.id),cur=row.recipientState[key]||{};row.recipientState[key]={...cur,...(['archived','important'].reduce((o,k)=>(typeof req.body[k]==='boolean'&&(o[k]=req.body[k]),o),{}))};writeDB(db);res.json(inboxView(db,row,req.user.id))})
app.get('/api/chat/inbox-unread',(req,res)=>{const db=readDB(),uid=req.user.id,n=(db.inboxMessages||[]).filter(x=>(x.recipientIds||[]).map(Number).includes(uid)&&!inboxRecipientState(x,uid).readAt&&!inboxRecipientState(x,uid).archived).length;res.json({unread:n})})

app.post('/api/auth/logout',(req,res)=>{sessions.delete(req.sessionToken);broadcast('presence-change',{at:nowIso()});res.status(204).end()});
app.post('/api/presence/heartbeat',(req,res)=>{const s=sessions.get(req.sessionToken);if(s){s.lastSeen=nowIso();s.machineId=String(req.body.machineId||s.machineId||'');s.deviceName=String(req.body.deviceName||s.deviceName||'Computador');sessions.set(req.sessionToken,s)}const db=readDB();if(checkPersonalReminderNotifications(db,req.user.id))writeDB(db);const snap=presenceSnapshot(db);broadcast('presence-change',{at:nowIso(),machinesOnline:snap.machinesOnline});res.json(snap)});
app.get('/api/presence',(req,res)=>{const db=readDB();res.json(presenceSnapshot(db))});
app.get('/api/events',(req,res)=>{res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('Connection','keep-alive');res.flushHeaders?.();realtimeClients.add(res);res.write(`event: connected\ndata: ${JSON.stringify({ok:true,at:nowIso()})}\n\n`);req.on('close',()=>realtimeClients.delete(res))});

// Percentuais incidem no valor da NF; custo é a fração remanescente do preço final.
function calcQuote(body){
 const discountPercent=Math.min(100,Math.max(0,num(body.discountPercent)));
 const round=v=>Math.round((v+Number.EPSILON)*100)/100;
 const round4=v=>Math.round((v+Number.EPSILON)*10000)/10000;
 const items=(body.items||[]).map(it=>{
  const qty=Math.max(1,num(it.qty)),unitCost=Math.max(0,num(it.unitCost)),legacyPersonalizationUnit=Math.max(0,num(it.personalizationUnit)),legacyMode=it.personalizationTotal===undefined&&it.extraExpenses===undefined&&it.purchaseTaxPercent===undefined;
  const personalizationTotal=it.personalizationTotal!==undefined?Math.max(0,num(it.personalizationTotal)):round(qty*legacyPersonalizationUnit),freight=Math.max(0,num(it.freight)),extraExpenses=Math.max(0,num(it.extraExpenses)),purchaseTaxPercent=Math.max(0,num(it.purchaseTaxPercent)),taxPercent=Math.max(0,num(it.taxPercent??13)),profitMargin=Math.max(0,num(it.profitMargin??30)),commissionMargin=Math.max(0,num(it.commissionMargin??3));
  const share=1-(taxPercent+profitMargin+commissionMargin)/100;
  if(share<=0)throw new Error('A soma de imposto de venda, BV e margem deve ser menor que 100%.');
  if(legacyMode){
   const merchandiseCost=round(qty*unitCost),personalizationCost=round(qty*legacyPersonalizationUnit),baseCost=round(merchandiseCost+personalizationCost+freight),unitPrice=Math.ceil((baseCost/qty/share)*100-1e-9)/100,grossTotal=round(unitPrice*qty),taxValue=round(grossTotal*taxPercent/100),commissionValue=round(grossTotal*commissionMargin/100),profitValue=round(grossTotal-baseCost-taxValue-commissionValue),minimumTotal=round(baseCost/(1-(taxPercent+commissionMargin)/100));
   return {...it,qty,unitCost,personalizationUnit:legacyPersonalizationUnit,freight,taxPercent,profitMargin,commissionMargin,merchandiseCost,personalizationCost,baseCost,taxValue,profitValue,commissionValue,grossTotal,unitPrice,minimumTotal};
  }
  const merchandiseCost=round(qty*unitCost),subtotalCost=round(merchandiseCost+personalizationTotal+freight+extraExpenses),purchaseTaxValue=round(subtotalCost*purchaseTaxPercent/100),baseCost=round(subtotalCost+purchaseTaxValue),unitExact=baseCost/qty/share,unitPrice=round4(unitExact),grossTotal=round(unitExact*qty),taxValue=round(grossTotal*taxPercent/100),commissionValue=round(grossTotal*commissionMargin/100),profitValue=round(grossTotal-baseCost-taxValue-commissionValue),minimumTotal=round(baseCost/(1-(taxPercent+commissionMargin)/100));
  return {...it,qty,unitCost,personalizationUnit:qty?personalizationTotal/qty:0,personalizationTotal,freight,extraExpenses,purchaseTaxPercent,taxPercent,profitMargin,commissionMargin,merchandiseCost,personalizationCost:personalizationTotal,purchaseTaxValue,baseCost,taxValue,profitValue,commissionValue,grossTotal,unitPrice,unitExact,minimumTotal};
 });
 const costTotal=round(items.reduce((s,x)=>s+x.baseCost,0)),grossTotal=round(items.reduce((s,x)=>s+x.grossTotal,0)),discountValue=round(grossTotal*discountPercent/100),total=round(Math.max(0,grossTotal-discountValue));
 const taxTotal=round(items.reduce((s,x)=>s+x.taxPercent*x.grossTotal,0)/100*(grossTotal?total/grossTotal:1));
 const commissionTotal=round(items.reduce((s,x)=>s+x.commissionMargin*x.grossTotal,0)/100*(grossTotal?total/grossTotal:1));
 const estimatedProfit=round(total-costTotal-taxTotal-commissionTotal),profitTotal=estimatedProfit,realMargin=total?estimatedProfit/total*100:0;
 return {items,costTotal,taxTotal,profitTotal,commissionTotal,grossTotal,discountPercent,discountValue,total,estimatedProfit,realMargin};
}
function pricingRequestGuard(req,res,next){if(!['POST','PUT'].includes(req.method)||!Array.isArray(req.body?.items))return next();for(const x of req.body.items){const sum=Number(x.taxPercent??13)+Number(x.profitMargin??30)+Number(x.commissionMargin??3);if(!Number.isFinite(sum)||sum>=100||sum<0)return res.status(400).json({error:'Imposto + comissão + margem devem totalizar entre 0% e menos de 100%.'});}next()}
// Proteção no backend: estoque pertencente a cliente não pode entrar em venda de outro cliente.
function stockOwnershipGuard(req,res,next){
 if(!['POST','PUT'].includes(req.method)||!Array.isArray(req.body?.items))return next();
 const db=readDB(),clientId=Number(req.body.clientId||0),requested=new Map();
 for(const it of req.body.items){
  const stockId=Number(it.physicalStockId||0);if(!stockId)continue;
  const stock=(db.physicalStock||[]).find(x=>x.id===stockId);
  if(!stock)return res.status(400).json({error:'Item de estoque físico não encontrado.'});
  if(Number(stock.ownerClientId||0)&&Number(stock.ownerClientId)!==clientId)return res.status(403).json({error:'Este estoque pertence a outro cliente e não pode ser vendido neste pedido.'});
  requested.set(stockId,(requested.get(stockId)||0)+Math.max(1,Number(it.qty)||1));
  if(requested.get(stockId)>Math.max(0,Number(stock.quantity||0)-Number(stock.reserved||0)))return res.status(409).json({error:'Quantidade solicitada superior ao estoque físico disponível.'});
 }
 next();
}
app.use('/api/quotes',pricingRequestGuard,stockOwnershipGuard);app.use('/api/orders',pricingRequestGuard,stockOwnershipGuard);

function resolveSalesperson(db,body,user){
 const sid=Number(body?.salespersonId||0);if(sid){const byId=(db.users||[]).find(u=>u.id===sid&&u.active!==false);if(byId)return byId}
 const raw=String(body?.salesperson||'').trim();
 if(/^\d+$/.test(raw)){const byId=(db.users||[]).find(u=>u.id===Number(raw)&&u.active!==false);if(byId)return byId}
 const matches=(db.users||[]).filter(u=>u.active!==false&&String(u.name||'').trim().toLowerCase()===raw.toLowerCase());
 if(user&&matches.some(u=>u.id===user.id))return matches.find(u=>u.id===user.id);
 return matches[0]||user||null;
}
// v16.0.7: lançamento vinculado ao pedido; idempotente.
function addFinanceForOrder(db,order){
  const existing=(db.finance||[]).find(f=>Number(f.orderId)===Number(order.id)&&f.type==='income');
  if(existing)return existing;
  const row={id:nextId(db,'finance'),type:'income',orderId:order.id,quoteId:Number(order.quoteId||0),clientId:Number(order.clientId||0),description:`Recebimento do pedido ${order.number}`,category:'Pedidos',amount:Math.max(0,Number(order.total)||0),dueDate:order.paymentDueDate||'',status:'pending',createdAt:nowIso()};
  db.finance.push(row);
  return row;
}
function createOrderFromQuote(db,quote,user){const existing=db.orders.find(o=>o.quoteId===quote.id);if(existing)return existing;const id=nextId(db,'orders');const order={id,number:`PED-${String(id).padStart(5,'0')}`,quoteId:quote.id,clientId:quote.clientId,clientSnapshot:quote.clientSnapshot||{},salesperson:quote.salesperson||user?.name||'',salespersonId:quote.salespersonId||user?.id||0,paymentData:quote.paymentData||'',paymentDueDate:quote.paymentDueDate||'',deliveryDeadline:quote.deliveryDeadline||'',status:'pending_payment',productionStage:'awaiting_payment',items:quote.items||[],costTotal:quote.costTotal||0,taxTotal:quote.taxTotal||0,commissionTotal:quote.commissionTotal||0,total:quote.total||0,notes:quote.notes||'',files:quote.files||[],createdAt:new Date().toISOString()};db.orders.push(order);quote.status='approved';quote.convertedOrderId=id;addFinanceForOrder(db,order);audit(db,user,'CRIAR','orders',id,`A partir de ${quote.number}`);return order}

app.get('/api/cnpj/:cnpj',async(req,res)=>{const cnpj=String(req.params.cnpj||'').replace(/\D/g,'');if(!/^\d{14}$/.test(cnpj))return res.status(400).json({error:'Informe um CNPJ válido com 14 dígitos.'});try{const response=await fetch(`https://publica.cnpj.ws/cnpj/${cnpj}`,{headers:{Accept:'application/json','User-Agent':'C4U-SIST/6.0'},signal:AbortSignal.timeout(12000)});if(response.status===404)return res.status(404).json({error:'CNPJ não encontrado.'});if(response.status===429)return res.status(429).json({error:'Limite de consultas atingido. Aguarde um minuto.'});if(!response.ok)return res.status(502).json({error:'Serviço de CNPJ indisponível no momento.'});const company=await response.json(),est=company.estabelecimento||{},ie=(est.inscricoes_estaduais||[]).find(x=>x.ativo)||(est.inscricoes_estaduais||[])[0]||{};res.json({cnpj:est.cnpj||cnpj,razaoSocial:company.razao_social||'',nomeFantasia:est.nome_fantasia||'',ie:ie.inscricao_estadual||'',phone:[est.ddd1,est.telefone1].filter(Boolean).join(' '),email:est.email||'',address:[est.tipo_logradouro,est.logradouro].filter(Boolean).join(' '),addressNumber:est.numero||'',addressComplement:est.complemento||'',district:est.bairro||'',zipCode:est.cep||'',city:est.cidade?.nome||'',state:est.estado?.sigla||''})}catch(e){res.status(502).json({error:'Não foi possível consultar o CNPJ. Verifique a internet.'})}});

// Importação idempotente de planilhas, sem substituir o banco ativo nem revelar clientes externos.
function workbookBuffer(req){const raw=String(req.body?.fileBase64||'');if(!/^[A-Za-z0-9+/=]+$/.test(raw)||raw.length>16*1024*1024)throw Error('Arquivo XLSX inválido ou maior que 12 MB.');return Buffer.from(raw,'base64')}
app.post('/api/clients/import',(req,res)=>{if(req.user.role!=='Administrador')return res.status(403).json({error:'Importação restrita ao administrador.'});try{const rows=xlsxClientRows(workbookBuffer(req)),db=readDB(),result=importClients(db,rows);audit(db,req.user,'IMPORTAR','clients',0,JSON.stringify(result));writeDB(db);res.json(result)}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/itemLibrary/import',(req,res)=>res.status(410).json({error:'Importação da planilha de produtos desativada. Utilize a integração do fornecedor para evitar conflitos de origem. Importação de CLIENTES e módulo Planilhas permanecem disponíveis.'}));
// Planilha de produtos: limpeza ADMINISTRATIVA em duas etapas, sem remover catálogo SPOT,
// pedidos, orçamentos, estoque físico ou o módulo de planilhas gerais.
let sheetCleanupStage=null;
app.get('/api/itemLibrary/spreadsheet-cleanup/preview',(req,res)=>{
 if(req.user.role!=='Administrador')return res.status(403).json({error:'Somente administrador.'});
 const db=readDB(),plan=planSpreadsheetCleanup(db);
 const token=crypto.randomBytes(24).toString('hex');
 sheetCleanupStage={token,userId:req.user.id,digest:crypto.createHash('sha256').update(JSON.stringify(db)).digest('hex'),expires:Date.now()+15*60*1000};
 const {deleteIds,archiveIds,...safe}=plan;
 res.json({...safe,token,expiresInMinutes:15,needsConfirmation:'LIMPAR PLANILHA'});
});
app.post('/api/itemLibrary/spreadsheet-cleanup/execute',(req,res)=>{
 if(req.user.role!=='Administrador')return res.status(403).json({error:'Somente administrador.'});
 if(req.body?.confirmation!=='LIMPAR PLANILHA')return res.status(400).json({error:'Digite LIMPAR PLANILHA para confirmar.'});
 const stage=sheetCleanupStage,token=String(req.body?.token||'');
 if(!stage||!token||stage.token!==token||stage.userId!==req.user.id||Date.now()>stage.expires)return res.status(409).json({error:'Prévia inválida ou expirada. Gere outra prévia.'});
 const db=readDB(),digest=crypto.createHash('sha256').update(JSON.stringify(db)).digest('hex');
 if(digest!==stage.digest){sheetCleanupStage=null;return res.status(409).json({error:'Banco alterado desde a prévia. Gere outra antes de limpar.'});}
 const plan=planSpreadsheetCleanup(db);
 if(!plan.candidates){sheetCleanupStage=null;return res.json({deleted:0,archived:0,warning:'Nenhum item ativo da planilha identificado.'});}
 let backup;
 try{backup=createBackup('antes-limpeza-planilha-produtos')}catch{return res.status(500).json({error:'Falha ao criar backup. Nada foi apagado.'})}
 try{
  const result=applySpreadsheetCleanup(db,plan);
  audit(db,req.user,'LIMPAR','itemLibrary',0,`Origem planilha de produtos; excluídos ${result.deleted}; arquivados ${result.archived}; backup ${backup}`);
  writeDB(db);sheetCleanupStage=null;
  return res.json({...result,backup,warning:'Itens vinculados ou editados foram arquivados, não destruídos. Outros catálogos e registros históricos não foram alterados.'});
 }catch(e){sheetCleanupStage=null;return res.status(500).json({error:'Falha durante limpeza; confira o backup antes de tentar novamente.'})}
});
// Estoque físico: proprietário é cliente cadastrado ou Geral. Estoque do fornecedor não é saldo próprio.
function stockFields(db,body,old={}){const b=body||{},qty=Number(b.quantity??old.quantity??0),reserved=Number(b.reserved??old.reserved??0),ownerClientId=Number(b.ownerClientId||0),libraryItemId=Number(b.libraryItemId||0);if(!Number.isFinite(qty)||qty<0||!Number.isFinite(reserved)||reserved<0||reserved>qty)throw Error('Saldo/reserva inválidos: reserva não pode superar a quantidade física.');if(ownerClientId&&!db.clients.some(c=>c.id===ownerClientId))throw Error('Cliente proprietário não encontrado.');if(libraryItemId&&!db.itemLibrary.some(p=>p.id===libraryItemId))throw Error('Item da biblioteca não encontrado.');const images=Array.isArray(b.images)?b.images.filter(x=>typeof x==='string'&&(/^(data:image\/(png|jpeg|webp);base64,|https:\/\/)/i.test(x))).slice(0,5):(old.images||[]);return {...old,name:String(b.name??old.name??'').trim().slice(0,220),code:String(b.code??old.code??'').trim().slice(0,120),description:String(b.description??old.description??'').slice(0,7000),quantity:qty,reserved,available:qty-reserved,ownerClientId,libraryItemId,cost:Math.max(0,Number(b.cost??old.cost??0)||0),price:Math.max(0,Number(b.price??old.price??0)||0),location:String(b.location??old.location??'').slice(0,180),notes:String(b.notes??old.notes??'').slice(0,2000),images};}
app.get('/api/physicalStock',(req,res)=>res.json(readDB().physicalStock));
app.post('/api/physicalStock',(req,res)=>{const db=readDB();try{const row={...stockFields(db,req.body),id:nextId(db,'physicalStock'),createdAt:nowIso()};if(!row.name)throw Error('Informe o nome do item.');db.physicalStock.push(row);audit(db,req.user,'CRIAR','physicalStock',row.id,row.name);writeDB(db);res.status(201).json(row)}catch(e){res.status(400).json({error:e.message})}});
app.put('/api/physicalStock/:id',(req,res)=>{const db=readDB(),row=db.physicalStock.find(x=>x.id===Number(req.params.id));if(!row)return res.status(404).json({error:'Estoque não encontrado.'});try{snapshotVersion(db,req.user,'physicalStock',row);const next=stockFields(db,req.body,row);if(!next.name)throw Error('Informe o nome do item.');Object.assign(row,next,{id:row.id,updatedAt:nowIso()});audit(db,req.user,'EDITAR','physicalStock',row.id,row.name);writeDB(db);res.json(row)}catch(e){res.status(400).json({error:e.message})}});
app.delete('/api/physicalStock/:id',(req,res)=>{const db=readDB(),id=Number(req.params.id),row=db.physicalStock.find(x=>x.id===id);if(!row)return res.status(404).json({error:'Estoque não encontrado.'});if(Number(row.reserved)>0)return res.status(409).json({error:'Não é permitido excluir item com saldo reservado.'});db.physicalStock=db.physicalStock.filter(x=>x.id!==id);audit(db,req.user,'EXCLUIR','physicalStock',id,row.name);writeDB(db);res.status(204).end()});
function genericCrud(collection){app.get(`/api/${collection}`,(req,res)=>{const db=readDB();let data=db[collection];const q=String(req.query.q||'').toLowerCase();if(q)data=data.filter(x=>JSON.stringify(x).toLowerCase().includes(q));res.json(data)});app.post(`/api/${collection}`,(req,res)=>{const db=readDB(),x={...req.body,id:nextId(db,collection),createdAt:new Date().toISOString()};db[collection].push(x);audit(db,req.user,'CRIAR',collection,x.id);if(collection==='tasks'&&x.assignedUserId)notify(db,{userId:Number(x.assignedUserId),title:'Nova tarefa',message:`${req.user.name} atribuiu: ${x.title||'Tarefa'}`,page:'tasks',entityId:x.id});writeDB(db);res.status(201).json(x)});app.put(`/api/${collection}/:id`,(req,res)=>{const db=readDB(),i=db[collection].findIndex(x=>x.id===Number(req.params.id));if(i<0)return res.status(404).json({error:'Registro não encontrado.'});snapshotVersion(db,req.user,collection,db[collection][i]);db[collection][i]={...db[collection][i],...req.body,id:Number(req.params.id),updatedAt:nowIso(),updatedBy:req.user.name};audit(db,req.user,'EDITAR',collection,Number(req.params.id));writeDB(db);res.json(db[collection][i])});app.delete(`/api/${collection}/:id`,(req,res)=>{const db=readDB(),id=Number(req.params.id),old=db[collection].find(x=>x.id===id);if(!old)return res.status(404).json({error:'Registro não encontrado.'});db[collection]=db[collection].filter(x=>x.id!==id);audit(db,req.user,'EXCLUIR',collection,id,old.name||old.number||old.description||'');writeDB(db);res.status(204).end()})}
app.use('/api/calendarEvents',(req,res,next)=>{if(['POST','PUT','PATCH'].includes(req.method)&&Number(req.body?.chatThreadId||0)&&!chatThreadForUser(readDB(),req.body.chatThreadId,req.user.id))return res.status(403).json({error:'Você não participa da conversa vinculada ao evento.'});next()});
['clients','suppliers','products','finance','activities','calendarEvents','documents','itemLibrary','documentTemplates','pdfHistory','tasks','spreadsheets','clientFiles'].forEach(genericCrud);

// usuários: somente administrador altera equipe e senhas
app.get('/api/users',(req,res)=>{const db=readDB();res.json(db.users.filter(u=>u.active!==false).map(u=>({...safeUser(u),effectivePermissions:permissionsFor(u)})))});
app.post('/api/users',(req,res)=>{
  if(req.user.role!=='Administrador')return res.status(403).json({error:'Somente administrador.'});
  const db=readDB(),login=String(req.body.login||'').trim(),email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||'');
  if(!login)return res.status(400).json({error:'Informe um login.'});
  if(password.length<6)return res.status(400).json({error:'A senha precisa ter pelo menos 6 caracteres.'});
  if(db.users.some(u=>String(u.login||'').toLowerCase()===login.toLowerCase()))return res.status(409).json({error:'Este login já está em uso.'});
  if(email&&db.users.some(u=>String(u.email||'').toLowerCase()===email))return res.status(409).json({error:'Este e-mail já está em uso.'});
  const hp=hashPassword(password),u={...req.body,login,email,id:nextId(db,'users'),createdAt:nowIso(),passwordSalt:hp.salt,passwordHash:hp.hash};delete u.password;db.users.push(u);audit(db,req.user,'CRIAR','users',u.id);writeDB(db);res.status(201).json(safeUser(u));
});
app.put('/api/users/:id',(req,res)=>{
  if(req.user.role!=='Administrador'&&req.user.id!==Number(req.params.id))return res.status(403).json({error:'Sem permissão.'});
  const db=readDB(),i=db.users.findIndex(x=>x.id===Number(req.params.id));if(i<0)return res.status(404).json({error:'Usuário não encontrado.'});
  let body={...req.body};
  if(req.user.role!=='Administrador'){
    // Usuário comum nunca pode promover a própria conta, liberar módulos ou reativar acesso.
    const allowed={};if(typeof body.name==='string')allowed.name=body.name;if(typeof body.password==='string')allowed.password=body.password;body=allowed;
  }
  const login=String(body.login||db.users[i].login||'').trim(),email=String(body.email||db.users[i].email||'').trim().toLowerCase();
  if(db.users.some((u,idx)=>idx!==i&&String(u.login||'').toLowerCase()===login.toLowerCase()))return res.status(409).json({error:'Este login já está em uso.'});
  if(email&&db.users.some((u,idx)=>idx!==i&&String(u.email||'').toLowerCase()===email))return res.status(409).json({error:'Este e-mail já está em uso.'});
  const password=String(body.password||'');delete body.password;delete body.passwordHash;delete body.passwordSalt;
  db.users[i]={...db.users[i],...body,login,email,id:Number(req.params.id)};
  if(password){if(password.length<6)return res.status(400).json({error:'A senha precisa ter pelo menos 6 caracteres.'});const hp=hashPassword(password);db.users[i].passwordSalt=hp.salt;db.users[i].passwordHash=hp.hash}
  audit(db,req.user,'EDITAR','users',Number(req.params.id));writeDB(db);res.json(safeUser(db.users[i]));
});
app.delete('/api/users/:id',(req,res)=>{
  if(req.user.role!=='Administrador')return res.status(403).json({error:'Somente administrador.'});
  const id=Number(req.params.id);if(id===req.user.id)return res.status(400).json({error:'Você não pode excluir o usuário que está usando agora.'});
  const db=readDB(),u=db.users.find(x=>x.id===id);if(!u)return res.status(404).json({error:'Usuário não encontrado.'});
  db.users=db.users.filter(x=>x.id!==id);db.trustedDevices=db.trustedDevices.filter(d=>Number(d.userId)!==id);db.accessRequests=db.accessRequests.filter(r=>Number(r.approvedUserId)!==id);
  for(const [token,sess] of sessions)if(sess.userId===id)sessions.delete(token);audit(db,req.user,'EXCLUIR','users',id,u.name||u.login||'');writeDB(db);broadcast('presence-change',{at:nowIso()});res.status(204).end();
});
app.get('/api/access-requests',(req,res)=>{if(req.user.role!=='Administrador')return res.status(403).json({error:'Somente administrador.'});res.json(readDB().accessRequests.slice().reverse())});
app.post('/api/access-requests/:id/approve',(req,res)=>{
  if(req.user.role!=='Administrador')return res.status(403).json({error:'Somente administrador.'});const db=readDB(),r=db.accessRequests.find(x=>x.id===Number(req.params.id));if(!r)return res.status(404).json({error:'Solicitação não encontrada.'});const user=db.users.find(u=>u.id===Number(req.body.userId)&&u.active!==false);if(!user)return res.status(400).json({error:'Selecione um usuário ativo.'});
  let d=db.trustedDevices.find(x=>x.machineId===r.machineId);if(!d){d={id:nextId(db,'trustedDevices'),machineId:r.machineId,createdAt:nowIso()};db.trustedDevices.push(d)}Object.assign(d,{deviceName:r.deviceName||'Computador',userId:user.id,active:true,approvedBy:req.user.name,approvedAt:nowIso(),lastIp:r.ip||''});r.status='approved';r.approvedUserId=user.id;r.approvedAt=nowIso();audit(db,req.user,'LIBERAR SEM LOGIN','trustedDevices',d.id,`${d.deviceName} → ${user.name}`);writeDB(db);broadcast('access-approved',{machineId:r.machineId,at:nowIso()});res.json(d);
});
app.delete('/api/access-requests/:id',(req,res)=>{if(req.user.role!=='Administrador')return res.status(403).json({error:'Somente administrador.'});const db=readDB();db.accessRequests=db.accessRequests.filter(x=>x.id!==Number(req.params.id));writeDB(db);res.status(204).end()});
app.get('/api/trusted-devices',(req,res)=>{if(req.user.role!=='Administrador')return res.status(403).json({error:'Somente administrador.'});const db=readDB();res.json(db.trustedDevices.map(d=>({...d,userName:db.users.find(u=>u.id===Number(d.userId))?.name||'Usuário removido'})).slice().reverse())});
app.delete('/api/trusted-devices/:id',(req,res)=>{if(req.user.role!=='Administrador')return res.status(403).json({error:'Somente administrador.'});const db=readDB(),id=Number(req.params.id),d=db.trustedDevices.find(x=>x.id===id);if(!d)return res.status(404).json({error:'Computador não encontrado.'});db.trustedDevices=db.trustedDevices.filter(x=>x.id!==id);for(const [token,sess] of sessions)if(sess.trustedDeviceId===id)sessions.delete(token);audit(db,req.user,'REVOGAR SEM LOGIN','trustedDevices',id,d.deviceName||d.machineId);writeDB(db);broadcast('presence-change',{at:nowIso()});res.status(204).end()});

app.get('/api/audit',(req,res)=>{if(req.user.role!=='Administrador')return res.status(403).json({error:'Somente administrador.'});const db=readDB();res.json(db.audit.slice().reverse().slice(0,500))});
app.get('/api/versions/:collection/:id',(req,res)=>{const permByCollection={quotes:'quotes',orders:'orders',clients:'clients',suppliers:'suppliers',products:'products',finance:'finance',invoices:'invoices',activities:'crm',calendarEvents:'calendar',documents:'documents',itemLibrary:'itemLibrary',documentTemplates:'documents',tasks:'tasks',spreadsheets:'spreadsheet',clientFiles:'filesCenter'};const need=permByCollection[req.params.collection];if(!need||!can(req.user,need))return res.status(403).json({error:'Sem permissão para consultar este histórico.'});const db=readDB();res.json(db.recordVersions.filter(v=>v.collection===req.params.collection&&v.recordId===Number(req.params.id)).slice().reverse())});
app.post('/api/versions/:id/restore',(req,res)=>{if(req.user.role!=='Administrador')return res.status(403).json({error:'Somente administrador.'});const db=readDB(),v=db.recordVersions.find(x=>x.id===Number(req.params.id));if(!v||!Array.isArray(db[v.collection]))return res.status(404).json({error:'Versão não encontrada.'});const i=db[v.collection].findIndex(x=>x.id===v.recordId);if(i<0)return res.status(404).json({error:'Registro atual não encontrado.'});snapshotVersion(db,req.user,v.collection,db[v.collection][i],'ANTES DE RESTAURAR');db[v.collection][i]={...v.snapshot,id:v.recordId,restoredAt:nowIso(),restoredBy:req.user.name};audit(db,req.user,'RESTAURAR',v.collection,v.recordId,`Versão ${v.id}`);writeDB(db);res.json(db[v.collection][i])});
app.get('/api/notifications',(req,res)=>{const db=readDB();res.json(db.notifications.filter(n=>!n.userId||n.userId===req.user.id).slice().reverse().slice(0,200))});
app.put('/api/notifications/:id/read',(req,res)=>{const db=readDB(),n=db.notifications.find(x=>x.id===Number(req.params.id)&&(!x.userId||x.userId===req.user.id));if(!n)return res.status(404).json({error:'Notificação não encontrada.'});n.read=true;writeDB(db);res.json(n)});
app.post('/api/notifications/read-all',(req,res)=>{const db=readDB();db.notifications.forEach(n=>{if(!n.userId||n.userId===req.user.id)n.read=true});writeDB(db);res.json({ok:true})});
app.get('/api/backups',(req,res)=>{if(req.user.role!=='Administrador')return res.status(403).json({error:'Somente administrador.'});ensureDailyBackup();const rows=fs.readdirSync(backupDir()).filter(x=>x.endsWith('.json')).sort().reverse().map(name=>{const st=fs.statSync(path.join(backupDir(),name));return {name,size:st.size,createdAt:st.mtime.toISOString()}});res.json(rows)});
app.post('/api/backups',(req,res)=>{if(req.user.role!=='Administrador')return res.status(403).json({error:'Somente administrador.'});const name=createBackup('manual'),db=readDB();audit(db,req.user,'BACKUP','database',0,name);writeDB(db);res.json({name})});
app.post('/api/backups/restore',(req,res)=>{if(req.user.role!=='Administrador')return res.status(403).json({error:'Somente administrador.'});const name=path.basename(String(req.body.name||'')),src=path.join(backupDir(),name);if(!name||!fs.existsSync(src))return res.status(404).json({error:'Backup não encontrado.'});createBackup('antes-restauracao');fs.copyFileSync(src,DB_PATH);broadcast('data-change',{at:nowIso(),restore:true});res.json({ok:true})});
app.post('/api/sessions/:prefix/end',(req,res)=>{if(req.user.role!=='Administrador')return res.status(403).json({error:'Somente administrador.'});const prefix=String(req.params.prefix);for(const [token] of sessions)if(token.startsWith(prefix))sessions.delete(token);broadcast('presence-change',{at:nowIso()});res.json({ok:true})});
app.get('/api/settings',(req,res)=>{const settings=readDB().settings;const xbz={...(settings.xbz||{})};delete xbz.token;delete xbz.authHeader;return res.json({...settings,xbz});});
app.put('/api/settings',(req,res)=>{if(req.user.role!=='Administrador')return res.status(403).json({error:'Somente o administrador pode alterar configurações gerais.'});const db=readDB();db.settings={...db.settings,...req.body};audit(db,req.user,'EDITAR','settings',0);writeDB(db);res.json(db.settings)});

app.get('/api/quotes',(req,res)=>res.json(readDB().quotes));
app.post('/api/quotes',(req,res)=>{if(req.body.launchOrder&&!can(req.user,'orders'))return res.status(403).json({error:'Seu usuário não pode gerar pedidos.'});const db=readDB(),calc=calcQuote(req.body),id=nextId(db,'quotes');const seller=resolveSalesperson(db,req.body,req.user);const q={id,number:`ORC-${String(id).padStart(5,'0')}`,clientId:Number(req.body.clientId)||0,clientSnapshot:req.body.clientSnapshot||{},salesperson:seller?.name||req.user.name,salespersonId:seller?.id||req.user.id,paymentData:req.body.paymentData||'',paymentDueDate:req.body.paymentDueDate||'',validUntil:req.body.validUntil||'',deliveryDeadline:req.body.deliveryDeadline||'',status:req.body.status||'quotation',notes:req.body.notes||'',files:req.body.files||[],...calc,createdAt:new Date().toISOString()};db.quotes.push(q);audit(db,req.user,'CRIAR','quotes',id,q.number);let order=null;if(req.body.launchOrder)order=createOrderFromQuote(db,q,req.user);writeDB(db);res.status(201).json({quote:q,order})});
app.put('/api/quotes/:id',(req,res)=>{if(req.body.launchOrder&&!can(req.user,'orders'))return res.status(403).json({error:'Seu usuário não pode gerar pedidos.'});const db=readDB(),i=db.quotes.findIndex(x=>x.id===Number(req.params.id));if(i<0)return res.status(404).json({error:'Orçamento não encontrado.'});snapshotVersion(db,req.user,'quotes',db.quotes[i]);const calc=calcQuote(req.body),seller=resolveSalesperson(db,req.body,req.user);db.quotes[i]={...db.quotes[i],...req.body,...calc,salesperson:seller?.name||db.quotes[i].salesperson||req.user.name,salespersonId:seller?.id||db.quotes[i].salespersonId||req.user.id,id:Number(req.params.id)};audit(db,req.user,'EDITAR','quotes',Number(req.params.id));let order=null;if(req.body.launchOrder)order=createOrderFromQuote(db,db.quotes[i],req.user);writeDB(db);res.json({quote:db.quotes[i],order})});
app.delete('/api/quotes/:id',(req,res)=>{const db=readDB(),id=Number(req.params.id),q=db.quotes.find(x=>x.id===id);if(!q)return res.status(404).json({error:'Orçamento não encontrado.'});db.quotes=db.quotes.filter(x=>x.id!==id);audit(db,req.user,'EXCLUIR','quotes',id,q.number);writeDB(db);res.status(204).end()});
app.post('/api/quotes/:id/convert',(req,res)=>{if(!can(req.user,'orders'))return res.status(403).json({error:'Seu usuário não pode gerar pedidos.'});const db=readDB(),q=db.quotes.find(x=>x.id===Number(req.params.id));if(!q)return res.status(404).json({error:'Orçamento não encontrado.'});const convertingStock=new Map();for(const it of q.items||[]){const stock=(db.physicalStock||[]).find(x=>x.id===Number(it.physicalStockId||0));if(!it.physicalStockId)continue;convertingStock.set(Number(it.physicalStockId),(convertingStock.get(Number(it.physicalStockId))||0)+Number(it.qty||0));if(!stock)return res.status(409).json({error:'O produto em estoque físico não existe mais.'});if(Number(stock.ownerClientId||0)&&Number(stock.ownerClientId)!==Number(q.clientId||0))return res.status(403).json({error:'O estoque físico pertence a outro cliente.'});if(convertingStock.get(Number(it.physicalStockId))>Number(stock.available||0))return res.status(409).json({error:'Estoque físico insuficiente para converter o orçamento.'});}const order=createOrderFromQuote(db,q,req.user);writeDB(db);res.status(201).json(order)});
app.put('/api/quotes/:id/status',(req,res)=>{const db=readDB(),q=db.quotes.find(x=>x.id===Number(req.params.id));if(!q)return res.status(404).json({error:'Orçamento não encontrado.'});snapshotVersion(db,req.user,'quotes',q,'MOVER PIPELINE');q.status=req.body.status||q.status;q.pipelineMovedAt=nowIso();q.pipelineMovedBy=req.user.name;audit(db,req.user,'STATUS','quotes',q.id,q.status);notify(db,{title:'Pipeline atualizado',message:`${req.user.name} moveu ${q.number} para ${q.status}`,page:'pipeline',entityId:q.id});writeDB(db);res.json(q)});

app.get('/api/orders',(req,res)=>res.json(readDB().orders));
app.post('/api/orders',(req,res)=>{const db=readDB(),id=nextId(db,'orders'),body=req.body,calc=calcQuote(body),seller=resolveSalesperson(db,body,req.user);const o={id,number:`PED-${String(id).padStart(5,'0')}`,clientId:Number(body.clientId)||0,clientSnapshot:body.clientSnapshot||{},salesperson:seller?.name||req.user.name,salespersonId:seller?.id||req.user.id,paymentData:body.paymentData||'',paymentDueDate:body.paymentDueDate||'',deliveryDeadline:body.deliveryDeadline||'',status:body.status||'pending_payment',productionStage:body.productionStage||'awaiting_payment',notes:body.notes||'',files:body.files||[],...calc,createdAt:new Date().toISOString()};db.orders.push(o);addFinanceForOrder(db,o);audit(db,req.user,'CRIAR','orders',id,o.number);writeDB(db);res.status(201).json(o)});
app.put('/api/orders/:id',(req,res)=>{const db=readDB(),i=db.orders.findIndex(x=>x.id===Number(req.params.id));if(i<0)return res.status(404).json({error:'Pedido não encontrado.'});db.orders[i]={...db.orders[i],...req.body,id:Number(req.params.id)};audit(db,req.user,'EDITAR','orders',Number(req.params.id));writeDB(db);res.json(db.orders[i])});
app.delete('/api/orders/:id',(req,res)=>{const db=readDB(),id=Number(req.params.id),o=db.orders.find(x=>x.id===id);if(!o)return res.status(404).json({error:'Pedido não encontrado.'});db.orders=db.orders.filter(x=>x.id!==id);db.finance=db.finance.filter(x=>x.orderId!==id);db.invoices=db.invoices.filter(x=>x.orderId!==id);audit(db,req.user,'EXCLUIR','orders',id,o.number);writeDB(db);res.status(204).end()});

app.get('/api/invoices',(req,res)=>res.json(readDB().invoices));

app.post('/api/invoices',(req,res)=>{const db=readDB(),id=nextId(db,'invoices'),b=req.body||{};const inv={id,number:`PN-${String(id).padStart(5,'0')}`,orderId:Number(b.orderId)||0,quoteId:Number(b.quoteId)||0,clientId:Number(b.clientId)||0,clientSnapshot:b.clientSnapshot||{},salesperson:b.salesperson||req.user.name,items:Array.isArray(b.items)?b.items:[],subtotal:num(b.subtotal),discount:num(b.discount),taxes:num(b.taxes),freight:num(b.freight),total:num(b.total),status:b.status||'draft',nature:b.nature||'Pré-Nota comercial interna',paymentData:b.paymentData||'',paymentDueDate:b.paymentDueDate||'',deliveryDeadline:b.deliveryDeadline||'',deliveryAddress:b.deliveryAddress||'',notes:b.notes||'',createdAt:new Date().toISOString()};db.invoices.push(inv);audit(db,req.user,'CRIAR','invoices',id,inv.number);writeDB(db);res.status(201).json(inv)});
app.post('/api/invoices/:id/duplicate',(req,res)=>{const db=readDB(),src=db.invoices.find(x=>x.id===Number(req.params.id));if(!src)return res.status(404).json({error:'Pré-Nota não encontrada.'});const id=nextId(db,'invoices');const copy={...src,...req.body,id,number:`PN-${String(id).padStart(5,'0')}`,status:'draft',createdAt:new Date().toISOString(),duplicatedFromId:src.id};db.invoices.push(copy);audit(db,req.user,'DUPLICAR','invoices',id,`${src.number} → ${copy.number}`);writeDB(db);res.status(201).json(copy)});
app.post('/api/itemLibrary/:id/duplicate',(req,res)=>{const db=readDB(),src=db.itemLibrary.find(x=>x.id===Number(req.params.id));if(!src)return res.status(404).json({error:'Item não encontrado.'});const id=nextId(db,'itemLibrary');const copy={...src,id,name:`${src.name||'Item'} - Cópia`,internalCode:'',createdAt:new Date().toISOString(),duplicatedFromId:src.id};db.itemLibrary.push(copy);audit(db,req.user,'DUPLICAR','itemLibrary',id,src.name||'');writeDB(db);res.status(201).json(copy)});
app.post('/api/pdfHistory/version',(req,res)=>{const db=readDB(),b=req.body||{};if(!['quote','invoice'].includes(b.type))return res.status(400).json({error:'Tipo de documento inválido.'});const sourceId=Number(b.sourceId)||0;if(!sourceId)return res.status(400).json({error:'Documento de origem não informado.'});const versions=db.pdfHistory.filter(x=>x.type===b.type&&x.sourceId===sourceId);const id=nextId(db,'pdfHistory');const row={id,type:b.type,sourceId,sourceNumber:b.sourceNumber||'',version:versions.reduce((m,x)=>Math.max(m,Number(x.version)||0),0)+1,templateId:Number(b.templateId)||0,templateName:b.templateName||'Padrão',html:String(b.html||''),snapshot:b.snapshot||{},createdAt:new Date().toISOString(),createdBy:req.user.name};db.pdfHistory.push(row);audit(db,req.user,'GERAR PDF',b.type,sourceId,`${row.sourceNumber} v${row.version}`);writeDB(db);res.status(201).json(row)});
app.post('/api/invoices/from-order/:id',(req,res)=>{const db=readDB(),order=db.orders.find(x=>x.id===Number(req.params.id));if(!order)return res.status(404).json({error:'Pedido não encontrado.'});const existing=db.invoices.find(x=>x.orderId===order.id);if(existing)return res.json(existing);const id=nextId(db,'invoices');const inv={id,number:`PN-${String(id).padStart(5,'0')}`,orderId:order.id,quoteId:order.quoteId||0,clientId:order.clientId,clientSnapshot:order.clientSnapshot||{},salesperson:order.salesperson||'',items:order.items||[],subtotal:order.total||0,discount:0,taxes:0,freight:0,total:order.total||0,status:'draft',nature:'Pré-Nota comercial interna',paymentData:order.paymentData||'',paymentDueDate:order.paymentDueDate||'',deliveryDeadline:order.deliveryDeadline||'',deliveryAddress:[order.clientSnapshot?.address,order.clientSnapshot?.addressNumber,order.clientSnapshot?.district,order.clientSnapshot?.city,order.clientSnapshot?.state].filter(Boolean).join(', '),notes:'',createdAt:new Date().toISOString()};db.invoices.push(inv);audit(db,req.user,'CRIAR','invoices',id,inv.number);writeDB(db);res.status(201).json(inv)});
app.put('/api/invoices/:id',(req,res)=>{const db=readDB(),i=db.invoices.findIndex(x=>x.id===Number(req.params.id));if(i<0)return res.status(404).json({error:'Documento não encontrado.'});db.invoices[i]={...db.invoices[i],...req.body,id:Number(req.params.id)};audit(db,req.user,'EDITAR','invoices',Number(req.params.id));writeDB(db);res.json(db.invoices[i])});
app.delete('/api/invoices/:id',(req,res)=>{const db=readDB(),id=Number(req.params.id),x=db.invoices.find(v=>v.id===id);if(!x)return res.status(404).json({error:'Documento não encontrado.'});db.invoices=db.invoices.filter(v=>v.id!==id);audit(db,req.user,'EXCLUIR','invoices',id,x.number);writeDB(db);res.status(204).end()});


// ===== C4U v15.2 TESTE — Prospecção compartilhada + Follow-up de clientes compradores =====
function splitCityState(v=''){const p=String(v||'').split('/');return {city:(p[0]||'').trim(),state:(p[1]||'').trim().toUpperCase()}}
function prospectingLeadSeller(db,lead){const u=(db.users||[]).find(x=>x.id===Number(lead.sellerId));return u?{id:u.id,name:u.name,email:u.email||u.login||''}:{id:Number(lead.sellerId||0),name:lead.sellerNameSnapshot||'',email:''}}
app.get('/api/prospecting/leads',(req,res)=>{const db=readDB();res.json((db.prospectingLeads||[]).slice().sort((a,b)=>String(b.createdDate||b.createdAt||'').localeCompare(String(a.createdDate||a.createdAt||''))).map(x=>({...x,seller:prospectingLeadSeller(db,x)}))) });
app.post('/api/prospecting/leads',(req,res)=>{const db=readDB(),b=req.body||{},seller=(db.users||[]).find(u=>u.id===Number(b.sellerId)&&u.active!==false)||req.user;const row={id:nextId(db,'prospectingLeads'),sellerId:seller.id,sellerNameSnapshot:seller.name,createdDate:String(b.createdDate||today()).slice(0,10),companyName:String(b.companyName||'').trim(),segment:String(b.segment||'').trim(),cityState:String(b.cityState||'').trim(),website:String(b.website||'').trim(),successContact:String(b.successContact||'').trim(),leadOrigin:String(b.leadOrigin||'').trim(),responsibleName:String(b.responsibleName||'').trim(),phone:String(b.phone||'').trim(),email:String(b.email||'').trim(),status:String(b.status||'new'),nextFollowUp:String(b.nextFollowUp||''),notes:String(b.notes||''),clientId:Number(b.clientId||0),createdAt:nowIso(),updatedAt:nowIso(),updatedBy:req.user.name};if(!row.companyName)return res.status(400).json({error:'Informe o nome da empresa.'});db.prospectingLeads.push(row);audit(db,req.user,'CRIAR','prospectingLeads',row.id,row.companyName);writeDB(db);res.status(201).json({...row,seller:prospectingLeadSeller(db,row)})});
app.put('/api/prospecting/leads/:id',(req,res)=>{const db=readDB(),row=db.prospectingLeads.find(x=>x.id===Number(req.params.id));if(!row)return res.status(404).json({error:'Lead não encontrado.'});snapshotVersion(db,req.user,'prospectingLeads',row);const b=req.body||{};Object.assign(row,b,{id:row.id,updatedAt:nowIso(),updatedBy:req.user.name});if(b.sellerId){const u=db.users.find(x=>x.id===Number(b.sellerId));if(u)row.sellerNameSnapshot=u.name}audit(db,req.user,'EDITAR','prospectingLeads',row.id,row.companyName);writeDB(db);res.json({...row,seller:prospectingLeadSeller(db,row)})});
app.delete('/api/prospecting/leads/:id',(req,res)=>{const db=readDB(),id=Number(req.params.id),row=db.prospectingLeads.find(x=>x.id===id);if(!row)return res.status(404).json({error:'Lead não encontrado.'});db.prospectingLeads=db.prospectingLeads.filter(x=>x.id!==id);audit(db,req.user,'EXCLUIR','prospectingLeads',id,row.companyName);writeDB(db);res.status(204).end()});
app.post('/api/prospecting/leads/:id/convert',(req,res)=>{const db=readDB(),lead=db.prospectingLeads.find(x=>x.id===Number(req.params.id));if(!lead)return res.status(404).json({error:'Lead não encontrado.'});let client=lead.clientId?db.clients.find(c=>c.id===Number(lead.clientId)):null;if(!client){const sameEmail=lead.email&&(db.clients||[]).find(c=>String(c.email||'').toLowerCase()===String(lead.email).toLowerCase());client=sameEmail||null}if(!client){const cs=splitCityState(lead.cityState);client={id:nextId(db,'clients'),name:lead.responsibleName||lead.companyName,company:lead.companyName,phone:lead.phone||'',email:lead.email||'',city:cs.city,state:cs.state,source:lead.leadOrigin||'Prospecção',assignedSellerId:Number(lead.sellerId||0),website:lead.website||'',notes:lead.notes||'',createdAt:nowIso()};db.clients.push(client);audit(db,req.user,'CRIAR','clients',client.id,`Convertido da Prospecção: ${lead.companyName}`)}lead.clientId=client.id;lead.status='converted';lead.convertedAt=nowIso();lead.updatedAt=nowIso();audit(db,req.user,'CONVERTER','prospectingLeads',lead.id,`Cliente #${client.id}`);writeDB(db);res.json({lead,client})});
app.get('/api/prospecting/follow-up',(req,res)=>{const db=readDB(),validOrders=(db.orders||[]).filter(o=>String(o.status||'')!=='cancelled'&&String(o.productionStage||'')!=='cancelled'),ids=[...new Set(validOrders.map(o=>Number(o.clientId)).filter(Boolean))],rows=[];for(const clientId of ids){const client=db.clients.find(c=>c.id===clientId);if(!client)continue;const orders=validOrders.filter(o=>Number(o.clientId)===clientId).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))),last=orders[0],meta=(db.customerFollowUps||[]).find(x=>Number(x.clientId)===clientId)||{},sellerId=Number(meta.sellerId||last?.salespersonId||client.assignedSellerId||0),seller=(db.users||[]).find(u=>u.id===sellerId);rows.push({clientId,sellerId,sellerName:seller?.name||last?.salesperson||'',lastContactDate:meta.lastContactDate||'',lastReturnDate:meta.lastReturnDate||'',companyName:client.company||client.name||'',leadOrigin:meta.leadOrigin||client.source||'',lastOrderDate:String(last?.createdAt||'').slice(0,10),lastOrder:last?.number||'',lastOrderId:last?.id||0,responsibleName:meta.responsibleName||client.name||'',contact:meta.contact||client.phone||client.email||'',nextFollowUp:meta.nextFollowUp||'',status:meta.status||'active',notes:meta.notes||''})}rows.sort((a,b)=>String(a.companyName).localeCompare(String(b.companyName),'pt-BR'));res.json(rows)});
app.put('/api/prospecting/follow-up/:clientId',(req,res)=>{const db=readDB(),clientId=Number(req.params.clientId);if(!db.clients.some(c=>c.id===clientId))return res.status(404).json({error:'Cliente não encontrado.'});let row=(db.customerFollowUps||[]).find(x=>Number(x.clientId)===clientId);if(!row){row={id:nextId(db,'customerFollowUps'),clientId,createdAt:nowIso()};db.customerFollowUps.push(row)}Object.assign(row,req.body||{},{id:row.id,clientId,updatedAt:nowIso(),updatedBy:req.user.name});audit(db,req.user,'EDITAR','customerFollowUps',row.id,`Cliente #${clientId}`);writeDB(db);res.json(row)});
app.get('/api/prospecting/lists',(req,res)=>res.json(readDB().settings.prospectingLists||DEFAULT_SETTINGS.prospectingLists));
app.put('/api/prospecting/lists',(req,res)=>{if(req.user.role!=='Administrador')return res.status(403).json({error:'Somente administradores podem alterar as listas padrão.'});const db=readDB(),clean=a=>Array.isArray(a)?a.map(x=>String(x||'').trim()).filter(Boolean).slice(0,100):[];db.settings.prospectingLists={contactChannels:clean(req.body.contactChannels),leadOrigins:clean(req.body.leadOrigins),segments:clean(req.body.segments)};audit(db,req.user,'EDITAR','settings',0,'Listas da Prospecção');writeDB(db);res.json(db.settings.prospectingLists)});

// ===== C4U v15.2 TESTE — Roteiro operacional, calendário e notificações =====
function routePlanView(db,p){return {...p,items:(p.items||[]).slice().sort((a,b)=>(Number(a.position)||0)-(Number(b.position)||0)).map(i=>({...i,sellerName:(db.users||[]).find(u=>u.id===Number(i.sellerId))?.name||i.sellerNameSnapshot||''}))}}
app.get('/api/routes',(req,res)=>{const db=readDB();res.json((db.routePlans||[]).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).map(p=>routePlanView(db,p)))});
app.post('/api/routes',(req,res)=>{const db=readDB(),b=req.body||{},date=String(b.date||today()).slice(0,10);let existing=(db.routePlans||[]).find(p=>p.date===date);if(existing)return res.json(routePlanView(db,existing));const row={id:nextId(db,'routePlans'),date,driver:String(b.driver||''),generalNotes:String(b.generalNotes||''),status:'planned',items:[],createdAt:nowIso(),createdBy:req.user.name,updatedAt:nowIso()};db.routePlans.push(row);audit(db,req.user,'CRIAR','routePlans',row.id,date);writeDB(db);res.status(201).json(routePlanView(db,row))});
app.put('/api/routes/:id',(req,res)=>{const db=readDB(),row=db.routePlans.find(x=>x.id===Number(req.params.id));if(!row)return res.status(404).json({error:'Roteiro não encontrado.'});snapshotVersion(db,req.user,'routePlans',row);const oldIds=new Set((row.items||[]).map(i=>Number(i.id)));const incoming=Array.isArray(req.body.items)?req.body.items:(row.items||[]);const items=incoming.map((raw,idx)=>{const i={...raw};if(!Number(i.id))i.id=nextId(db,'routeItems');i.position=idx+1;i.type=i.type==='pickup'?'pickup':'delivery';i.status=['pending','in_progress','completed'].includes(i.status)?i.status:'pending';i.sellerId=Number(i.sellerId||0);if(i.sellerId){const u=db.users.find(x=>x.id===i.sellerId);if(u)i.sellerNameSnapshot=u.name}i.updatedAt=nowIso();if(!i.createdAt)i.createdAt=nowIso();return i});Object.assign(row,req.body,{id:row.id,items,updatedAt:nowIso(),updatedBy:req.user.name});row.status=items.length&&items.every(i=>i.status==='completed')?'completed':items.some(i=>i.status==='in_progress'||i.status==='completed')?'in_progress':'planned';for(const i of items){if(!oldIds.has(Number(i.id))&&i.sellerId)notify(db,{userId:i.sellerId,title:`Roteiro ${dmyServer(row.date)}`,message:`${i.type==='pickup'?'Retirada':'Entrega'}: ${i.company||i.title||'Novo compromisso'}`,kind:'route',page:'routePlanner',entityId:row.id})}audit(db,req.user,'EDITAR','routePlans',row.id,row.date);writeDB(db);res.json(routePlanView(db,row))});
app.delete('/api/routes/:id',(req,res)=>{const db=readDB(),id=Number(req.params.id),row=db.routePlans.find(x=>x.id===id);if(!row)return res.status(404).json({error:'Roteiro não encontrado.'});db.routePlans=db.routePlans.filter(x=>x.id!==id);audit(db,req.user,'EXCLUIR','routePlans',id,row.date);writeDB(db);res.status(204).end()});
function dmyServer(v){if(!v)return '';const [y,m,d]=String(v).slice(0,10).split('-');return `${d}/${m}/${y}`}

app.get('/api/dashboard',(req,res)=>{
  const db=readDB(), now=new Date(), ym=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const prevDate=new Date(now.getFullYear(),now.getMonth()-1,1), prevYm=`${prevDate.getFullYear()}-${String(prevDate.getMonth()+1).padStart(2,'0')}`;
  let orders=(db.orders||[]), quotes=(db.quotes||[]);
  if(req.user.role==='Vendedor'){
    orders=orders.filter(x=>Number(x.salespersonId)===Number(req.user.id)||x.salesperson===req.user.name);
    quotes=quotes.filter(x=>Number(x.salespersonId)===Number(req.user.id)||x.salesperson===req.user.name);
  }
  const activeOrder=o=>!['delivered','cancelled'].includes(String(o.productionStage||o.status||''));
  const monthOrders=orders.filter(o=>String(o.createdAt||'').startsWith(ym)), prevOrders=orders.filter(o=>String(o.createdAt||'').startsWith(prevYm));
  const monthQuotes=quotes.filter(q=>String(q.createdAt||'').startsWith(ym)), prevQuotes=quotes.filter(q=>String(q.createdAt||'').startsWith(prevYm));
  const sales=monthOrders.reduce((sum,o)=>sum+num(o.total),0), prevSales=prevOrders.reduce((sum,o)=>sum+num(o.total),0);
  const profit=monthOrders.reduce((sum,o)=>sum+Math.max(0,num(o.total)-num(o.costTotal)-num(o.taxTotal)-num(o.commissionTotal)),0);
  const approved=monthQuotes.filter(q=>q.status==='approved').length, prevApproved=prevQuotes.filter(q=>q.status==='approved').length;
  const conversion=monthQuotes.length?approved/monthQuotes.length*100:0, prevConversion=prevQuotes.length?prevApproved/prevQuotes.length*100:0;
  const openOrders=orders.filter(activeOrder), forecast=openOrders.reduce((sum,o)=>sum+num(o.total),0);
  const upcomingDeliveries=orders.filter(o=>activeOrder(o)&&o.deliveryDeadline&&String(o.deliveryDeadline)>=today()).sort((a,b)=>String(a.deliveryDeadline).localeCompare(String(b.deliveryDeadline))).slice(0,12);
  const alerts=[];
  for(const q of quotes){if(['quotation','sent','negotiation'].includes(q.status)){const days=Math.floor((Date.now()-new Date(q.createdAt).getTime())/86400000);if(days>=3)alerts.push({text:`${q.number} está há ${days} dias sem fechamento.`})}}
  const routeToday=(db.routePlans||[]).find(p=>p.date===today())||null, routeTodayItems=routeToday?.items||[];
  const upcomingRoutes=(db.routePlans||[]).filter(p=>p.date>today()).sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(0,5).map(p=>({id:p.id,date:p.date,total:(p.items||[]).length,pending:(p.items||[]).filter(i=>i.status!=='completed').length}));
  const agenda=can(req.user,'calendar')?calendarItems(db,ym).filter(i=>i.date===today()).slice(0,10):[];
  const recentOrders=orders.slice().sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||''))).slice(0,7).map(o=>({id:o.id,number:o.number,client:o.clientSnapshot?.company||o.clientSnapshot?.name||db.clients.find(c=>c.id===Number(o.clientId))?.company||db.clients.find(c=>c.id===Number(o.clientId))?.name||'Cliente',salesperson:o.salesperson||'',deliveryDeadline:o.deliveryDeadline||'',total:num(o.total),status:o.productionStage||o.status||''}));
  const auditRows=(db.audit||[]).filter(a=>req.user.role==='Administrador'||Number(a.userId)===Number(req.user.id)).slice().reverse().slice(0,8).map(a=>({id:a.id,userName:a.userName||'Sistema',action:a.action||'',entity:a.entity||'',detail:a.detail||'',createdAt:a.createdAt||''}));
  let messages=[];
  if(can(req.user,'chat')){
    const uid=Number(req.user.id);
    const threads=(db.chatThreads||[]).filter(t=>(t.memberIds||[]).map(Number).includes(uid)).map(t=>chatThreadView(db,t,uid)).filter(t=>Number(t.unread||0)>0);
    messages=threads.map(t=>{const other=(t.members||[]).find(u=>Number(u.id)!==uid);return {kind:'chat',id:t.id,title:t.type==='group'?(t.name||'Grupo'):(other?.name||'Conversa'),preview:t.lastMessage?.text||'Imagem recebida',createdAt:t.lastMessage?.createdAt||t.lastMessageAt||'',unread:Number(t.unread||0)}});
    const inbox=(db.inboxMessages||[]).filter(x=>(x.recipientIds||[]).map(Number).includes(uid)&&!inboxRecipientState(x,uid).readAt&&!inboxRecipientState(x,uid).archived).map(x=>({kind:'inbox',id:x.id,title:x.subject||'Caixa de Entrada',preview:`${x.senderName||'Usuário'} • ${x.message||x.category||''}`,createdAt:x.createdAt||'',unread:1}));
    messages=[...messages,...inbox].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,6);
  }
  const pct=(cur,prev)=>prev?((cur-prev)/Math.abs(prev))*100:(cur?100:0);
  res.json({
    sales,profit,quotes:monthQuotes.length,approved,conversion,avgTicket:monthOrders.length?sales/monthOrders.length:0,
    orders:openOrders.length,clients:(db.clients||[]).length,suppliers:(db.suppliers||[]).length,forecast,
    upcomingDeliveries:upcomingDeliveries.length,alerts:alerts.slice(0,12),agenda,recentOrders,activity:auditRows,messages,
    trends:{quotes:pct(monthQuotes.length,prevQuotes.length),orders:pct(monthOrders.length,prevOrders.length),sales:pct(sales,prevSales),conversion:conversion-prevConversion},
    routeToday:routeToday?{id:routeToday.id,date:routeToday.date,total:routeTodayItems.length,completed:routeTodayItems.filter(i=>i.status==='completed').length,inProgress:routeTodayItems.filter(i=>i.status==='in_progress').length,pending:routeTodayItems.filter(i=>i.status==='pending').length}:null,
    upcomingRoutes
  });
});

app.get('/api/reports/prospecting',(req,res)=>{const db=readDB(),from=String(req.query.from||'0000-01-01'),to=String(req.query.to||'9999-12-31'),filterId=Number(req.query.sellerId||0),admin=req.user.role==='Administrador',leads=db.prospectingLeads.filter(l=>{const d=String(l.createdDate||l.createdAt||'').slice(0,10),uid=Number(l.sellerId||0);return d>=from&&d<=to&&(admin?(!filterId||filterId===uid):uid===req.user.id)}),statuses={},origins={},segments={},sellers={},today=today();let followupsDue=0,overdue=0,converted=0,contacted=0;for(const l of leads){const status=String(l.status||'new'),origin=String(l.leadOrigin||'Não informada'),segment=String(l.segment||'Não informado'),sid=Number(l.sellerId)||0,name=db.users.find(u=>u.id===sid)?.name||l.sellerNameSnapshot||'Não atribuído';statuses[status]=(statuses[status]||0)+1;origins[origin]=(origins[origin]||0)+1;segments[segment]=(segments[segment]||0)+1;if(!sellers[sid])sellers[sid]={userId:sid,name,total:0,converted:0,contacted:0,overdue:0};const row=sellers[sid];row.total++;if(status==='converted'||l.clientId){converted++;row.converted++}if(l.successContact||['contacted','qualified','negotiation','converted'].includes(status)){contacted++;row.contacted++}if(l.nextFollowUp){followupsDue++;if(l.nextFollowUp<today&&!['converted','lost'].includes(status)){overdue++;row.overdue++}}}const followups=db.customerFollowUps.filter(f=>admin?(!filterId||Number(f.sellerId)===filterId):Number(f.sellerId)===req.user.id),followupOverdue=followups.filter(f=>f.nextFollowUp&&f.nextFollowUp<today&&f.status!=='closed').length;res.json({total:leads.length,converted,contacted,followupsDue,overdue,followupOverdue,conversion:leads.length?converted/leads.length*100:0,statuses,origins,segments,sellers:Object.values(sellers).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')),leads:leads.map(l=>({id:l.id,companyName:l.companyName,status:l.status,leadOrigin:l.leadOrigin,segment:l.segment,sellerName:db.users.find(u=>u.id===Number(l.sellerId))?.name||l.sellerNameSnapshot||'',createdDate:l.createdDate,nextFollowUp:l.nextFollowUp,clientId:l.clientId})).slice(0,2500)});});
app.get('/api/reports',(req,res)=>{const db=readDB(),from=req.query.from||'0000-01-01',to=req.query.to||'9999-12-31',sellerId=Number(req.query.sellerId||0);const inRange=x=>{const d=String(x.createdAt||'').slice(0,10);return d>=from&&d<=to};let users=db.users.filter(u=>u.active!==false);if(req.user.role!=='Administrador')users=users.filter(u=>u.id===req.user.id);else if(sellerId)users=users.filter(u=>u.id===sellerId);const rows=users.map(u=>{const quotes=db.quotes.filter(q=>inRange(q)&&(q.salespersonId===u.id||q.salesperson===u.name)),orders=db.orders.filter(o=>inRange(o)&&(o.salespersonId===u.id||o.salesperson===u.name)),activities=db.activities.filter(a=>inRange(a)&&(a.userId===u.id||a.salespersonId===u.id||a.userName===u.name)),sales=orders.reduce((s,o)=>s+num(o.total),0),commission=orders.reduce((s,o)=>s+num(o.commissionTotal),0),approved=quotes.filter(q=>q.status==='approved').length,rejected=quotes.filter(q=>q.status==='rejected').length;return {userId:u.id,name:u.name,role:u.role,quotes:quotes.length,approved,rejected,conversion:quotes.length?approved/quotes.length*100:0,orders:orders.length,sales,avgTicket:orders.length?sales/orders.length:0,commission,activities:activities.length}});const bySource={};for(const c of db.clients){const k=c.source||'Não informado';bySource[k]=(bySource[k]||0)+1}const recentActivities=db.activities.filter(inRange).slice().reverse().slice(0,100);res.json({rows,bySource,recentActivities,totalSales:rows.reduce((s,r)=>s+r.sales,0),totalQuotes:rows.reduce((s,r)=>s+r.quotes,0),totalActivities:rows.reduce((s,r)=>s+r.activities,0)})});

app.get('/api/audit',(req,res)=>{if(req.user.role!=='Administrador')return res.status(403).json({error:'Somente administrador.'});res.json(readDB().audit.slice().reverse().slice(0,300))});



// C4U v14.9 — inteligência comercial, aprovações, dossiê, arquivos e painel executivo
function normalizeText(v){return String(v||'').trim().toLowerCase()}
function itemLabel(i={}){return String(i.productName||i.name||i.description||i.itemName||'Item').trim()}
function itemUnitCost(i={}){return num(i.unitCost||i.cost||i.costPrice||i.purchasePrice||0)}
function itemUnitPrice(i={}){return num(i.unitPrice||i.salePrice||((num(i.grossTotal)||num(i.total))&&num(i.qty)?(num(i.grossTotal||i.total)/num(i.qty)):0))}
function itemSupplier(i={},db){return i.supplierName||i.supplier||((db.suppliers||[]).find(s=>s.id===Number(i.supplierId))?.name)||''}

app.get('/api/price-history',(req,res)=>{
  const db=readDB(), q=normalizeText(req.query.q), clientId=Number(req.query.clientId||0), rows=[];
  for(const order of db.orders||[]){
    if(clientId&&Number(order.clientId)!==clientId)continue;
    for(const i of order.items||[]){const name=itemLabel(i);if(q&&!normalizeText(name).includes(q))continue;rows.push({source:'Pedido',sourceId:order.id,number:order.number||'',date:order.createdAt||'',clientId:order.clientId||0,client:order.clientSnapshot?.company||order.clientSnapshot?.name||'',item:name,qty:num(i.qty),unitCost:itemUnitCost(i),unitPrice:itemUnitPrice(i),supplier:itemSupplier(i,db),salesperson:order.salesperson||''})}
  }
  for(const quote of db.quotes||[]){
    if(clientId&&Number(quote.clientId)!==clientId)continue;
    for(const i of quote.items||[]){const name=itemLabel(i);if(q&&!normalizeText(name).includes(q))continue;rows.push({source:'Orçamento',sourceId:quote.id,number:quote.number||'',date:quote.createdAt||'',clientId:quote.clientId||0,client:quote.clientSnapshot?.company||quote.clientSnapshot?.name||'',item:name,qty:num(i.qty),unitCost:itemUnitCost(i),unitPrice:itemUnitPrice(i),supplier:itemSupplier(i,db),salesperson:quote.salesperson||''})}
  }
  rows.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const groups={};for(const r of rows){const k=normalizeText(r.item);if(!groups[k])groups[k]={item:r.item,records:0,lastCost:0,lastSale:0,minCost:Infinity,maxCost:0,avgSale:0,lastSupplier:'',lastDate:'',sumSale:0,sales:0};const g=groups[k];g.records++;if(r.unitCost){g.lastCost=g.lastCost||r.unitCost;g.minCost=Math.min(g.minCost,r.unitCost);g.maxCost=Math.max(g.maxCost,r.unitCost)}if(r.unitPrice){g.lastSale=g.lastSale||r.unitPrice;g.sumSale+=r.unitPrice;g.sales++}if(!g.lastSupplier&&r.supplier)g.lastSupplier=r.supplier;if(!g.lastDate)g.lastDate=r.date}
  const summary=Object.values(groups).map(g=>({...g,minCost:Number.isFinite(g.minCost)?g.minCost:0,avgSale:g.sales?g.sumSale/g.sales:0}));
  res.json({rows:rows.slice(0,800),summary});
});

app.get('/api/clients/:id/dossier',(req,res)=>{
  const db=readDB(), id=Number(req.params.id), client=db.clients.find(x=>x.id===id);if(!client)return res.status(404).json({error:'Cliente não encontrado.'});
  const quotes=(db.quotes||[]).filter(x=>Number(x.clientId)===id),orders=(db.orders||[]).filter(x=>Number(x.clientId)===id),activities=(db.activities||[]).filter(x=>Number(x.clientId)===id),files=(db.clientFiles||[]).filter(x=>Number(x.clientId)===id).map(({data,...f})=>f),communications=(db.inboxMessages||[]).filter(x=>inboxVisibleTo(x,req.user.id)&&((x.relatedType==='client'&&Number(x.relatedId)===id)||(x.relatedType==='order'&&orders.some(o=>o.id===Number(x.relatedId)))||(x.relatedType==='quote'&&quotes.some(q=>q.id===Number(x.relatedId))))),revenue=orders.reduce((s,o)=>s+num(o.total),0);
  const timeline=[];for(const q of quotes)timeline.push({date:q.createdAt,type:'quote',title:`Orçamento ${q.number||'#'+q.id}`,detail:`${q.status||''} • ${num(q.total).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}`,id:q.id});for(const o of orders)timeline.push({date:o.createdAt,type:'order',title:`Pedido ${o.number||'#'+o.id}`,detail:`${o.productionStage||o.status||''} • ${num(o.total).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}`,id:o.id});for(const a of activities)timeline.push({date:a.createdAt||a.date,type:'activity',title:a.title||a.type||'Atividade',detail:a.notes||a.description||'',id:a.id});for(const c of communications)timeline.push({date:c.createdAt,type:'communication',title:c.subject||'Comunicação',detail:c.category||'',id:c.id});for(const f of files)timeline.push({date:f.createdAt,type:'file',title:`Arquivo: ${f.name||'Anexo'}`,detail:f.category||'',id:f.id});timeline.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  res.json({client,quotes,orders,activities,files,communications,timeline,revenue,orderCount:orders.length,quoteCount:quotes.length,avgTicket:orders.length?revenue/orders.length:0,lastPurchase:orders.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))[0]?.createdAt||''});
});

app.get('/api/clientFiles/metadata',(req,res)=>{const db=readDB();res.json((db.clientFiles||[]).map(({data,...f})=>f).slice().reverse())});
app.post('/api/clientFiles/upload',(req,res)=>{const db=readDB(),b=req.body||{},data=String(b.data||'');if(!Number(b.clientId)&&!Number(b.orderId)&&!Number(b.quoteId))return res.status(400).json({error:'Vincule o arquivo a um cliente, pedido ou orçamento.'});if(!data.startsWith('data:')||data.length>12000000)return res.status(400).json({error:'Arquivo inválido ou muito grande. Limite aproximado: 8 MB.'});const row={id:nextId(db,'clientFiles'),clientId:Number(b.clientId||0),orderId:Number(b.orderId||0),quoteId:Number(b.quoteId||0),name:String(b.name||'arquivo'),category:String(b.category||'Outros'),mimeType:String(b.mimeType||''),data,version:Number(b.version||1),status:String(b.status||''),createdAt:nowIso(),createdBy:req.user.name};db.clientFiles.push(row);audit(db,req.user,'ANEXAR','clientFiles',row.id,row.name);writeDB(db);res.status(201).json(row)});
app.get('/api/clientFiles/:id/download',(req,res)=>{const db=readDB(),f=(db.clientFiles||[]).find(x=>x.id===Number(req.params.id));if(!f)return res.status(404).json({error:'Arquivo não encontrado.'});res.json(f)});

app.post('/api/approvals',(req,res)=>{const db=readDB(),b=req.body||{},quote=db.quotes.find(x=>x.id===Number(b.quoteId));if(!quote)return res.status(404).json({error:'Orçamento não encontrado.'});const token=crypto.randomBytes(18).toString('hex');const row={id:nextId(db,'approvalRequests'),token,quoteId:quote.id,clientId:quote.clientId||0,title:String(b.title||`Aprovação ${quote.number}`),message:String(b.message||''),layoutImage:String(b.layoutImage||''),status:'pending',createdAt:nowIso(),createdBy:req.user.name,approvedAt:'',requestedChangeAt:'',clientName:'',clientNote:''};db.approvalRequests.push(row);audit(db,req.user,'CRIAR','approvalRequests',row.id,quote.number);writeDB(db);res.status(201).json({...row,approvalUrl:`/aprovacao/${token}`,shareUrl:`${requestBaseUrl(req)}/aprovacao/${token}`})});
app.get('/api/approvals',(req,res)=>{const db=readDB();res.json((db.approvalRequests||[]).slice().reverse().map(a=>({...a,approvalUrl:`/aprovacao/${a.token}`,shareUrl:`${requestBaseUrl(req)}/aprovacao/${a.token}`})))});
app.get('/api/public/approval/:token',(req,res)=>{const db=readDB(),a=(db.approvalRequests||[]).find(x=>x.token===req.params.token);if(!a)return res.status(404).json({error:'Aprovação não encontrada.'});const q=db.quotes.find(x=>x.id===a.quoteId);if(!q)return res.status(404).json({error:'Orçamento não encontrado.'});res.json({approval:{id:a.id,title:a.title,message:a.message,status:a.status,layoutImage:a.layoutImage,approvedAt:a.approvedAt,requestedChangeAt:a.requestedChangeAt},quote:{number:q.number,client:q.clientSnapshot?.company||q.clientSnapshot?.name||'',items:q.items||[],total:q.total,paymentData:q.paymentData||'',deliveryDeadline:q.deliveryDeadline||'',notes:q.notes||''},company:{name:db.settings.companyName||'Toca dos Brindes',logo:db.settings.companyLogo||''}})});
app.post('/api/public/approval/:token/respond',(req,res)=>{const db=readDB(),a=(db.approvalRequests||[]).find(x=>x.token===req.params.token);if(!a)return res.status(404).json({error:'Aprovação não encontrada.'});if(a.status!=='pending')return res.status(409).json({error:'Esta aprovação já foi respondida.'});const action=req.body?.action;if(!['approved','changes'].includes(action))return res.status(400).json({error:'Resposta inválida.'});a.status=action;a.clientName=String(req.body?.clientName||'').trim();a.clientNote=String(req.body?.note||'').trim();if(action==='approved')a.approvedAt=nowIso();else a.requestedChangeAt=nowIso();const q=db.quotes.find(x=>x.id===a.quoteId);if(q&&action==='approved')q.status='approved';notify(db,{userId:(db.users||[]).find(u=>u.name===q?.salesperson)?.id||0,title:action==='approved'?'Aprovação recebida':'Alteração solicitada',message:`${q?.number||'Orçamento'} • ${a.clientName||'Cliente'}`,kind:'approval',page:'approvals',entityId:a.id});writeDB(db);res.json({ok:true,status:a.status})});
app.get('/aprovacao/:token',(req,res)=>res.sendFile(path.join(__dirname,'public','approval.html')));

app.get('/api/executive',(req,res)=>{if(req.user.role!=='Administrador')return res.status(403).json({error:'Painel executivo disponível para administradores.'});const db=readDB(),now=new Date(),ym=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`,prev=new Date(now.getFullYear(),now.getMonth()-1,1),pym=`${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}`;const calc=(prefix)=>{const orders=(db.orders||[]).filter(o=>String(o.createdAt||'').startsWith(prefix)),quotes=(db.quotes||[]).filter(q=>String(q.createdAt||'').startsWith(prefix)),sales=orders.reduce((s,o)=>s+num(o.total),0),profit=orders.reduce((s,o)=>s+Math.max(0,num(o.total)-num(o.costTotal)-num(o.taxTotal)-num(o.commissionTotal)),0);return {orders:orders.length,quotes:quotes.length,sales,profit,margin:sales?profit/sales*100:0,conversion:quotes.length?quotes.filter(q=>q.status==='approved').length/quotes.length*100:0,avgTicket:orders.length?sales/orders.length:0}};const current=calc(ym),previous=calc(pym);const sellers=(db.users||[]).filter(u=>u.role==='Vendedor'||u.role==='Administrador').map(u=>{const orders=(db.orders||[]).filter(o=>String(o.createdAt||'').startsWith(ym)&&(Number(o.salespersonId)===u.id||o.salesperson===u.name));return {name:u.name,sales:orders.reduce((s,o)=>s+num(o.total),0),orders:orders.length}}).sort((a,b)=>b.sales-a.sales);const clients={};for(const o of (db.orders||[]).filter(o=>String(o.createdAt||'').startsWith(ym))){const n=o.clientSnapshot?.company||o.clientSnapshot?.name||'Cliente';clients[n]=(clients[n]||0)+num(o.total)};const topClients=Object.entries(clients).map(([name,sales])=>({name,sales})).sort((a,b)=>b.sales-a.sales).slice(0,8);const products={};for(const o of (db.orders||[]).filter(o=>String(o.createdAt||'').startsWith(ym)))for(const i of o.items||[]){const n=itemLabel(i);products[n]=(products[n]||0)+num(i.qty)};const topProducts=Object.entries(products).map(([name,qty])=>({name,qty})).sort((a,b)=>b.qty-a.qty).slice(0,8);res.json({current,previous,sellers,topClients,topProducts,openQuotes:(db.quotes||[]).filter(q=>['quotation','sent','negotiation'].includes(q.status)).reduce((s,q)=>s+num(q.total),0),production:(db.orders||[]).filter(o=>!['delivered','cancelled'].includes(o.productionStage||o.status)).length,newClients:(db.clients||[]).filter(c=>String(c.createdAt||'').startsWith(ym)).length})});

// XBZ: antigo conector editável/Bearer foi desativado; endpoint e credenciais protegidos no módulo isolado.
// Ásia Import: conector de consulta isolado; credenciais em arquivos privados ou ambiente.
// Só Marcas: FASE 1, apenas leitura. Credenciais exclusivamente em arquivos locais 600.
// Não há importação, sincronização, alteração de orçamento ou pedido nesta fase.
function somarcasAdmin(req,res,next){
 if(req.user.role!=='Administrador')return res.status(403).json({error:'Integração Só Marcas restrita ao administrador.'});
 next();
}
app.get('/api/integrations/somarcas/status',somarcasAdmin,(req,res)=>{
 try{res.json(somarcasConnector.status())}catch{res.status(503).json({error:'Verifique os arquivos privados das credenciais Só Marcas.'})}
});
app.post('/api/integrations/somarcas/preview',somarcasAdmin,async(req,res)=>{
 try{res.json(await somarcasConnector.preview())}
 catch(e){res.status(502).json({error:e.message})}
});

// SÓ MARCAS FASE 2: apenas GET no fornecedor. Prévia em memória, commit administrativo
// com backup local e coleção independente. Não expõe credenciais ou envia pedidos externos.
let somarcasStage=null;
let somarcasPreparing=false;
const SOMARCAS_STAGE_TTL=25*60*1000;
app.get('/api/integrations/somarcas/catalog/info',somarcasAdmin,(req,res)=>{
 const db=readDB();res.json({count:(db.somarcasCatalog||[]).filter(x=>x.source==='Só Marcas'&&!x.missingFromLatestFeed).length,lastImport:db.settings.somarcasLastCatalogSync||'',ordersToSupplier:false,autoSync:false});
});
app.post('/api/integrations/somarcas/catalog/prepare',somarcasAdmin,async(req,res)=>{
 if(somarcasPreparing)return res.status(409).json({error:'Consulta Só Marcas em andamento.'});
 somarcasPreparing=true;
 try{
  const response=await somarcasConnector.catalog();
  if(response.invalid||response.rawCount!==response.data.length)throw Error(`API Só Marcas retornou ${response.invalid} registro(s) incompleto(s); prévia bloqueada.`);
  const db=readDB(),stage=prepareSomarcasCatalog(response.data,db.somarcasCatalog||[],db.itemLibrary||[]);
  const id=crypto.randomBytes(18).toString('hex');
  const preview={stageId:id,expiresAt:new Date(Date.now()+SOMARCAS_STAGE_TTL).toISOString(),summary:stage.summary,sample:stage.sample,overlaps:stage.overlaps,mode:'Prévia: sem alteração de dados; preços informativos.'};
  somarcasStage={id,userId:req.user.id,expiresAt:Date.now()+SOMARCAS_STAGE_TTL,stage};
  res.json(preview);
 }catch(e){somarcasStage=null;res.status(409).json({error:e.message,issues:e.issues||[]})}finally{somarcasPreparing=false}
});
app.post('/api/integrations/somarcas/catalog/import',somarcasAdmin,(req,res)=>{
 if(somarcasPreparing)return res.status(409).json({error:'Aguarde a prévia Só Marcas.'});
 if(!somarcasStage||somarcasStage.id!==req.body?.stageId||somarcasStage.userId!==req.user.id||Date.now()>somarcasStage.expiresAt)
  return res.status(409).json({error:'Prévia expirada ou de outro administrador; gere outra prévia.'});
 if(req.body?.confirmation!=='IMPORTAR SO MARCAS')return res.status(400).json({error:'Confirme digitando IMPORTAR SO MARCAS.'});
 try{
  const db=readDB();
  if(hashSomarcasCatalog(db.somarcasCatalog||[])!==somarcasStage.stage.dbHash)return res.status(409).json({error:'Catálogo alterado; gere outra prévia.'});
  const backup=createBackup('antes-importacao-somarcas');
  const summary=commitSomarcasCatalog(db,somarcasStage.stage);
  audit(db,req.user,'IMPORTAR','somarcasCatalog',0,`Só Marcas para orçamentos: ${summary.new} novos, ${summary.update} atualizados; backup ${backup}`);
  writeDB(db);somarcasStage=null;
  res.json({ok:true,backup,summary,message:'Só Marcas importada somente para orçamentos. Nenhum pedido enviado ao fornecedor.'});
 }catch(e){res.status(409).json({error:e.message})}
});

// SPOT / Stricker: ETAPA 1. Somente consulta, sem alterações no catálogo ou pedidos.
// Toda chamada exige login e função Administrador. A credencial nunca é devolvida à interface.
function spotAdmin(req,res,next){if(req.user.role!=='Administrador')return res.status(403).json({error:'Integração SPOT restrita ao administrador.'});next();}
app.get('/api/integrations/spot/status',spotAdmin,(req,res)=>{
 try{res.json(spotConnector.status())}catch(e){res.status(503).json({error:e.message})}
});
app.post('/api/integrations/spot/test',spotAdmin,async(req,res)=>{
 try{res.json(await spotConnector.check())}catch(e){res.status(502).json({error:e.message})}
});
app.post('/api/integrations/spot/preview',spotAdmin,async(req,res)=>{
 const feed=String(req.body?.feed||'');
 try{res.json(await spotConnector.preview(feed))}catch(e){res.status(502).json({error:e.message})}
});


// SPOT FASE 2: quote-only catalog. No supplier purchase/order endpoints are implemented.
// A staging snapshot lives only in process memory. An explicit administrator confirmation is
// required to import, and each import makes a database backup first.
let spotStage=null;
let spotStageBusy=false;
const SPOT_STAGE_TTL=25*60*1000;
app.post('/api/integrations/spot/catalog/prepare',spotAdmin,async(req,res)=>{
 if(spotStageBusy||spotSyncRuntime.busy)return res.status(409).json({error:'Uma conferência ou sincronização SPOT já está em andamento.'});
 if(spotStage && Date.now()<spotStage.expiresAt && spotStage.userId===req.user.id)
   return res.json(spotStage.preview);
 spotStageBusy=true;
 try{
  const feeds={};
  for(const name of FEED_NAMES)feeds[name]=await spotConnector.feed(name);
  const db=readDB();
  const stage=normalizeFeeds(feeds,db.spotCatalog||[],db.itemLibrary||[]);
  const id=crypto.randomBytes(18).toString('hex');
  const preview={stageId:id,expiresAt:new Date(Date.now()+SPOT_STAGE_TTL).toISOString(),summary:stage.summary,sample:stage.sample,issues:stage.issues,overlaps:stage.overlaps,changes:stage.changes,mode:'prévia; nenhum dado alterado'};
  spotStage={id,userId:req.user.id,expiresAt:Date.now()+SPOT_STAGE_TTL,stage,preview};
  res.json(preview);
 }catch(e){res.status(502).json({error:e.message})}finally{spotStageBusy=false}
});
app.post('/api/integrations/spot/catalog/import',spotAdmin,(req,res)=>{
 if(spotSyncRuntime.busy)return res.status(409).json({error:'Aguarde a sincronização SPOT antes de importar.'});
 if(!spotStage||spotStage.id!==req.body?.stageId||spotStage.userId!==req.user.id||Date.now()>spotStage.expiresAt)
   return res.status(409).json({error:'Prévia inexistente ou expirada; consulte novamente antes de importar.'});
 if(req.body?.confirmation!=='IMPORTAR SPOT')return res.status(400).json({error:'Confirmação explícita necessária: IMPORTAR SPOT.'});
 try{
  const db=readDB();
  if(hashCatalog(db.spotCatalog||[])!==spotStage.stage.dbHash)return res.status(409).json({error:'Catálogo alterado; prepare nova prévia.'});
  const backup=createBackup('antes-importacao-spot');
  const summary=importStage(db,spotStage.stage);
  audit(db,req.user,'IMPORTAR','spotCatalog',0,`SPOT somente orçamentos: ${summary.new} novos, ${summary.update} atualizados; backup ${backup}`);
  writeDB(db);spotStage=null;
  res.json({ok:true,backup,summary,message:'Catálogo SPOT importado em coleção separada. Nenhum pedido enviado ao fornecedor. Custos seguem a tabela recebida da SPOT.'});
 }catch(e){res.status(409).json({error:e.message})}
});

// SPOT FASE 3: schedules are owned by the backend process, NEVER by a browser session.
// Only existing SPOT catalog is modified; saved quotes/orders, itemLibrary and physicalStock stay untouched.
const spotSyncRuntime={busy:false,mode:''};
async function runSpotSync(mode){
 if(mode!=='stock'&&mode!=='catalog')throw Error('Tipo de sincronização SPOT inválido.');
 if(spotSyncRuntime.busy||spotStageBusy||(spotStage&&Date.now()<spotStage.expiresAt))throw Error('Uma prévia/importação ou sincronização SPOT está em andamento. Aguarde.');
 if(!readDB().spotCatalog.some(x=>x.source==='SPOT'))throw Error('Importe e valide o catálogo SPOT manualmente antes de iniciar a sincronização.');
 if(!spotConnector.configured())throw Error('Chave SPOT não configurada no servidor.');
 spotSyncRuntime.busy=true;spotSyncRuntime.mode=mode;
 const at=nowIso();
 try{
  const feeds={};
  // All supplier requests remain on the GET-only allowlist of spot-connector.js.
  for(const name of (mode==='catalog'?FEED_NAMES:['stocks']))feeds[name]=await spotConnector.feed(name);
  // Refresh DB only AFTER all network awaits, to preserve concurrent user edits/quotes.
  const db=readDB();
  let stage=null;
  if(mode==='catalog')stage=buildCatalogStage(feeds,db,at);
  const backup=createBackup(`antes-spot-auto-${mode}`);
  const summary=mode==='catalog'?applyCatalogStage(db,stage,at):applyStockFeed(db,feeds.stocks,at);
  const prior=db.settings.spotSync||{};
  db.settings.spotSync={...prior,lastAttempt:at,lastSuccess:at,lastMode:mode,lastError:'',lastSummary:{...summary,backup}};
  audit(db,{id:0,name:'Sistema SPOT'},'SINCRONIZAR','spotCatalog',0,`SPOT ${mode}; backup ${backup}; ${summary.updated??summary.update??0} alterados; somente orçamentos`);
  writeDB(db);
  return {ok:true,backup,summary,mode,ordersToSupplier:false};
 }catch(error){
  // Keep the last valid catalog; only persist a harmless administrative error status.
  const safe=String(error?.message||'Falha na sincronização SPOT.').slice(0,220).replace(/(?:accesskey|token|secret)\s*[:=]\s*\S+/gi,'[credencial oculta]');
  try{const db=readDB();db.settings.spotSync={...(db.settings.spotSync||{}),lastAttempt:at,lastError:safe,lastFailedMode:mode};writeDB(db)}catch{}
  throw Error(safe);
 }finally{spotSyncRuntime.busy=false;spotSyncRuntime.mode=''}
}
app.get('/api/integrations/spot/sync/status',spotAdmin,(req,res)=>{
 try{res.json({...syncStatus(readDB(),Date.now(),spotSyncRuntime),configured:spotConnector.configured()})}
 catch(e){res.status(503).json({error:'Não foi possível consultar o estado de sincronização SPOT.'})}
});
app.post('/api/integrations/spot/sync/run',spotAdmin,async(req,res)=>{
 const mode=String(req.body?.mode||'');
 if(!['stock','catalog'].includes(mode))return res.status(400).json({error:'Escolha stock ou catalog.'});
 try{res.json(await runSpotSync(mode))}catch(e){res.status(409).json({error:e.message})}
});
async function spotAutoTick(){
 if(spotSyncRuntime.busy||spotStageBusy||(spotStage&&Date.now()<spotStage.expiresAt))return;
 try{
  const db=readDB(),state=syncStatus(db,Date.now(),spotSyncRuntime);
  if(!state.enabled||!spotConnector.configured())return;
  const lastAttempt=Date.parse(db.settings?.spotSync?.lastAttempt||'');
  // Failures retry no faster than hourly; manual administrator action is independent.
  if(db.settings?.spotSync?.lastError&&Number.isFinite(lastAttempt)&&Date.now()-lastAttempt<60*60*1000)return;
  const mode=due(state.lastCatalog,CATALOG_INTERVAL_MS)?'catalog':due(state.lastStock,STOCK_INTERVAL_MS)?'stock':'';
  if(mode)await runSpotSync(mode);
 }catch(e){console.warn('SPOT sync: falha; catálogo anterior mantido. Consulte o painel administrativo.');}
}

app.get('/api/integrations/spot/catalog/info',spotAdmin,(req,res)=>{
 const db=readDB();res.json({count:(db.spotCatalog||[]).filter(x=>x.source==='SPOT').length,lastSync:db.settings.spotLastCatalogSync||'',priceValidated:false,ordersToSupplier:false});
});
// Single read-only catalog for library, budget picker and any authorized supplier source.
const unifiedSearchCache=new Map();
function cachedUnifiedSearch(db,query,limit,offset,options){
  const key=JSON.stringify([query,limit,Number(offset)||0,options?.supplier||'',options?.category||'',options?.subcategory||'']);
  const hit=unifiedSearchCache.get(key),now=Date.now();
  if(hit&&now-hit.at<15000)return hit.value;
  const value=searchUnified(db,query,limit,offset,options);
  unifiedSearchCache.set(key,{at:now,value});
  if(unifiedSearchCache.size>120){const first=unifiedSearchCache.keys().next().value;unifiedSearchCache.delete(first)}
  return value;
}
app.get('/api/catalog/unified',(req,res)=>{
 if(!['itemLibrary','quotes','products'].some(permission=>can(req.user,permission)))return res.status(403).json({error:'Sem acesso à biblioteca de produtos.'});
 const query=String(req.query.q||'').slice(0,120),limit=Number(req.query.limit)||80;
 res.json(cachedUnifiedSearch(readDB(),query,limit,req.query.offset,{supplier:req.query.supplier,category:req.query.category,subcategory:req.query.subcategory}));
});
app.get('/api/spot/catalog',(req,res)=>{
 if(!can(req.user,'quotes'))return res.status(403).json({error:'Acesso ao catálogo SPOT exige permissão de orçamentos.'});
 const q=String(req.query.q||'').slice(0,120);
 if(q.trim().length<2)return res.json({items:[],message:'Digite ao menos dois caracteres para buscar produtos SPOT.'});
 const db=readDB(),items=searchCatalog(db.spotCatalog||[],q,35);
 res.json({items:items.map(x=>({sku:x.sku,reference:x.reference,name:x.name,description:x.description,color:x.colorName,images:x.images,imageKind:x.imageKind,stock:x.supplierStock,lastSupplierSync:x.lastSupplierSync,price:x.price})),totalShown:items.length,pricesUnverified:true,ordersToSupplier:false});
});

// ÁSIA IMPORT: prévia integral + confirmação administrativa; nunca dispara compras.
function asiaAdmin(req,res,next){if(req.user.role!=='Administrador')return res.status(403).json({error:'Integração Ásia restrita ao administrador.'});next()}
let asiaStage=null,asiaPreparing=false;
const ASIA_STAGE_TTL=25*60*1000;
app.get('/api/integrations/asia/status',asiaAdmin,(req,res)=>{
 try{const db=readDB();res.json({...asiaConnector.status(),count:(db.asiaCatalog||[]).filter(x=>x.source==='Ásia Import'&&!x.missingFromLatestFeed).length,lastSync:db.settings.asiaLastSync||'',legacyPreserved:true})}
 catch{res.status(503).json({error:'Confira permissões dos arquivos privados das credenciais Ásia.'})}
});
app.post('/api/integrations/asia/test',asiaAdmin,async(req,res)=>{
 try{res.json(await asiaConnector.test())}catch(e){res.status(502).json({error:e.message})}
});
app.post('/api/integrations/asia/catalog/prepare',asiaAdmin,async(req,res)=>{
 if(asiaPreparing)return res.status(409).json({error:'Consulta Ásia já em andamento.'});
 asiaPreparing=true;
 try{
  const result=await asiaConnector.catalog(),db=readDB(),stage=prepareAsiaCatalog(result.data,db.asiaCatalog||[],db.itemLibrary||[]);
  const id=crypto.randomBytes(18).toString('hex');
  asiaStage={id,userId:req.user.id,expiresAt:Date.now()+ASIA_STAGE_TTL,stage};
  res.json({stageId:id,expiresAt:new Date(asiaStage.expiresAt).toISOString(),summary:stage.summary,sample:stage.sample,mode:'Prévia: banco preservado, sem pedidos de compra.'});
 }catch(e){asiaStage=null;res.status(409).json({error:e.message,issues:e.issues||[]})}finally{asiaPreparing=false}
});
app.post('/api/integrations/asia/catalog/import',asiaAdmin,(req,res)=>{
 if(asiaPreparing)return res.status(409).json({error:'Aguarde a prévia Ásia.'});
 if(!asiaStage||asiaStage.id!==req.body?.stageId||asiaStage.userId!==req.user.id||Date.now()>asiaStage.expiresAt)return res.status(409).json({error:'Prévia expirada ou pertence a outro administrador. Gere novamente.'});
 if(req.body?.confirmation!=='IMPORTAR ASIA')return res.status(400).json({error:'Digite IMPORTAR ASIA para confirmar.'});
 try{
  const db=readDB();if(hashAsiaCatalog(db.asiaCatalog||[])!==asiaStage.stage.dbHash)return res.status(409).json({error:'Catálogo Ásia modificado desde a prévia. Gere novamente.'});
  const backup=createBackup('antes-importacao-asia');
  const summary=commitAsiaCatalog(db,asiaStage.stage);
  audit(db,req.user,'IMPORTAR','asiaCatalog',0,`Ásia: ${summary.imported} SKUs, somente orçamentos; backup ${backup}`);
  writeDB(db);asiaStage=null;
  res.json({ok:true,backup,summary,message:'Catálogo Ásia importado para consultas e orçamentos; nenhuma compra enviada.'});
 }catch(e){res.status(409).json({error:e.message})}
});
// XBZ: somente GET do fornecedor, cache persistente no diretório privado, 12 h e limite preventivo.
function xbzAdmin(req,res,next){if(req.user.role!=='Administrador')return res.status(403).json({error:'Integração XBZ restrita ao administrador.'});next()}
let xbzStage=null,xbzBusy=false;
const XBZ_STAGE_TTL=25*60*1000;
function xbzStatus(){const db=readDB();return {...xbzConnector.status(),imported:(db.xbzCatalog||[]).filter(x=>x.source==='XBZ'&&!x.missingFromLatestFeed).length,lastSuccess:db.settings.xbzSync?.lastSuccess||'',lastError:db.settings.xbzSync?.lastError||'',lastSummary:db.settings.xbzSync?.lastSummary||null,autoEnabled:db.settings.xbzSync?.enabled===true,busy:xbzBusy};}
app.get('/api/integrations/xbz/status',xbzAdmin,(req,res)=>{try{res.json(xbzStatus())}catch{res.status(503).json({error:'Falha ao ler arquivos privados da XBZ.'})}});
app.post('/api/integrations/xbz/test',xbzAdmin,async(req,res)=>{
 if(xbzBusy)return res.status(409).json({error:'Sincronização XBZ em andamento.'});
 xbzBusy=true;
 try{const data=await xbzConnector.get({allowFetch:true});res.json({ok:true,total:data.products.length,fromCache:!!data.fromCache,fetchedAt:data.fetchedAt,requestsToday:xbzConnector.status().requestsToday,ordersToSupplier:false})}
 catch(e){res.status(409).json({error:e.message})}finally{xbzBusy=false}
});
app.post('/api/integrations/xbz/catalog/prepare',xbzAdmin,async(req,res)=>{
 if(xbzBusy)return res.status(409).json({error:'Consulta XBZ em andamento.'});
 xbzBusy=true;
 try{
  const data=await xbzConnector.get({allowFetch:true}),db=readDB();
  const stage=prepareXbzCatalog(data.products,db.xbzCatalog||[],db.itemLibrary||[]);
  const id=crypto.randomBytes(18).toString('hex');xbzStage={id,userId:req.user.id,expiresAt:Date.now()+XBZ_STAGE_TTL,stage,cacheHash:data.hash};
  res.json({stageId:id,expiresAt:new Date(xbzStage.expiresAt).toISOString(),summary:stage.summary,sample:stage.sample,fromCache:!!data.fromCache,fetchedAt:data.fetchedAt,message:'Somente prévia. Banco e históricos inalterados.'});
 }catch(e){xbzStage=null;res.status(409).json({error:e.message,issues:e.issues||[]})}finally{xbzBusy=false}
});
app.post('/api/integrations/xbz/catalog/import',xbzAdmin,(req,res)=>{
 if(xbzBusy)return res.status(409).json({error:'XBZ em consulta ou sincronização.'});
 if(!xbzStage||xbzStage.id!==req.body?.stageId||xbzStage.userId!==req.user.id||Date.now()>xbzStage.expiresAt)return res.status(409).json({error:'Prévia XBZ expirada; gere novamente.'});
 if(req.body?.confirmation!=='IMPORTAR XBZ')return res.status(400).json({error:'Digite IMPORTAR XBZ para confirmar.'});
 try{
  const db=readDB();if(hashXbzCatalog(db.xbzCatalog||[])!==xbzStage.stage.dbHash)return res.status(409).json({error:'Catálogo XBZ mudou desde a prévia.'});
  const cached=xbzConnector.cache();if(!cached||cached.hash!==xbzStage.cacheHash)return res.status(409).json({error:'Cache XBZ mudou desde a prévia. Gere novamente.'});
  const backup=createBackup('antes-importacao-xbz');const summary=commitXbzCatalog(db,xbzStage.stage);
  audit(db,req.user,'IMPORTAR','xbzCatalog',0,`XBZ ${summary.imported} referências; backup ${backup}; somente orçamentos`);
  writeDB(db);xbzStage=null;res.json({ok:true,summary,backup,ordersToSupplier:false});
 }catch(e){res.status(409).json({error:e.message})}
});
async function runXbzAuto(){
 if(process.env.XBZ_SETUP_MODE==='1')return;
 if(xbzBusy||xbzStage&&Date.now()<xbzStage.expiresAt)return;
 const state=readDB(),sync=state.settings.xbzSync||{},previous=(state.xbzCatalog||[]).filter(x=>x.source==='XBZ');
 if(!sync.enabled||!previous.length||!xbzConnector.configured())return;
 if(Date.now()-Date.parse(sync.lastSuccess||'')<XBZ_INTERVAL_MS)return;
 const attempt=Date.parse(sync.lastAttempt||'');if(Number.isFinite(attempt)&&Date.now()-attempt<XBZ_INTERVAL_MS)return;
 xbzBusy=true;
 try{
  const data=await xbzConnector.get({allowFetch:true}),db=readDB(),stage=prepareXbzCatalog(data.products,db.xbzCatalog||[],db.itemLibrary||[]);
  const backup=createBackup('antes-sync-xbz'),summary=commitXbzCatalog(db,stage);
  db.settings.xbzSync={...db.settings.xbzSync,lastAttempt:nowIso(),lastError:'',lastSummary:{...summary,backup,fromCache:!!data.fromCache}};
  audit(db,{id:0,name:'Sistema XBZ'},'SINCRONIZAR','xbzCatalog',0,`XBZ ${summary.imported} itens; backup ${backup}; nenhuma compra`);writeDB(db);
 }catch(e){try{const db=readDB();db.settings.xbzSync={...(db.settings.xbzSync||{}),lastAttempt:nowIso(),lastError:String(e.message).slice(0,190)};writeDB(db)}catch{};console.warn('XBZ: sincronização não concluída; catálogo anterior mantido. Consulte o painel administrativo.')}
 finally{xbzBusy=false}
}
app.post('/api/integrations/xbz/sync/run',xbzAdmin,async(req,res)=>{
 if(process.env.XBZ_SETUP_MODE==='1')return res.status(409).json({error:'XBZ em configuracao: sincronizacao desativada.'});
 if(xbzBusy)return res.status(409).json({error:'XBZ ocupada.'});
 if(!readDB().settings.xbzSync?.enabled)return res.status(409).json({error:'Importe a XBZ antes de ativar sincronização.'});
 const cached=xbzConnector.cache();if(cached&&Date.now()-Date.parse(cached.fetchedAt)<XBZ_INTERVAL_MS)return res.status(409).json({error:'Última consulta XBZ ainda tem menos de 12 h. Use o cache atual.'});
 await runXbzAuto();const state=xbzStatus();if(state.lastError)return res.status(409).json({error:state.lastError});res.json({ok:true,...state});
});


// Mapas e Rotas removidos desta versão. Dados antigos em deliveryRoutes são preservados no db.json.


function calendarItems(db,month){
  const prefix=/^\d{4}-\d{2}$/.test(month||'')?month:new Date().toISOString().slice(0,7), items=[];
  const add=(date,type,title,subtitle,source,sourceId,extra={})=>{if(date&&String(date).slice(0,7)===prefix)items.push({date:String(date).slice(0,10),type,title,subtitle:subtitle||'',source,sourceId,...extra})};
  for(const o of db.orders||[]){add(o.deliveryDeadline,'delivery',`Entrega ${o.number}`,o.clientSnapshot?.company||o.clientSnapshot?.name||'Cliente','order',o.id,{status:o.productionStage||o.status});add(o.paymentDueDate,'payment',`Pagamento ${o.number}`,o.clientSnapshot?.company||o.clientSnapshot?.name||'Cliente','order',o.id)}
  for(const q of db.quotes||[]){add(q.validUntil,'deadline',`Validade ${q.number}`,q.clientSnapshot?.company||q.clientSnapshot?.name||'Cliente','quote',q.id);add(q.deliveryDeadline,'deadline',`Prazo ${q.number}`,q.clientSnapshot?.company||q.clientSnapshot?.name||'Cliente','quote',q.id)}
  for(const f of db.finance||[])add(f.dueDate,'finance',f.description||'Financeiro',`${f.type==='expense'?'Despesa':'Receita'} • ${Number(f.amount||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}`,'finance',f.id,{status:f.status});
  for(const a of db.activities||[]){const dt=a.scheduledDate||a.nextActionDate;if(dt)add(dt,'activity',a.type||'Atividade',a.notes||a.nextAction||'', 'activity',a.id,{clientId:a.clientId})}
  for(const e of db.calendarEvents||[])add(e.date,e.type||'other',e.title||'Compromisso',e.notes||'', 'calendarEvent',e.id,{time:e.time||'',clientId:e.clientId||0,orderId:e.orderId||0,status:e.status||'pending'});
  for(const p of db.routePlans||[])for(const i of p.items||[]){const kind=i.type==='pickup'?'pickup':'delivery',verb=kind==='pickup'?'Retirada':'Entrega';add(p.date,kind,`${verb} • ${i.company||i.title||'Roteiro'}`,[i.address,i.attention?`A/C: ${i.attention}`:'',i.notes].filter(Boolean).join(' • '),'routePlan',p.id,{time:i.time||'',routeItemId:i.id,status:i.status||'pending',clientId:i.clientId||0,orderId:i.orderId||0})}
  return items.sort((a,b)=>(a.date+(a.time||'')).localeCompare(b.date+(b.time||'')));
}
app.get('/api/calendar',(req,res)=>{const db=readDB();res.json({month:req.query.month||new Date().toISOString().slice(0,7),items:calendarItems(db,req.query.month)})});

app.get('/api/search',(req,res)=>{
  const db=readDB(),q=String(req.query.q||'').trim().toLowerCase();if(q.length<2)return res.json([]);
  const results=[],push=(kind,id,title,subtitle,page)=>{if(results.length<40)results.push({kind,id,title,subtitle,page})};
  const has=x=>String(x??'').toLowerCase().includes(q);
  for(const c of db.clients||[])if([c.name,c.company,c.document,c.phone,c.email].some(has))push('client',c.id,c.name||c.company||'Cliente',[c.company,c.document,c.phone].filter(Boolean).join(' • '),'clients');
  for(const s of db.suppliers||[])if([s.name,s.document,s.contact,s.phone].some(has))push('supplier',s.id,s.name||'Fornecedor',[s.contact,s.phone].filter(Boolean).join(' • '),'suppliers');
  for(const p of db.products||[])if([p.name,p.sku,p.supplierCode,p.category].some(has))push('product',p.id,p.name||'Produto',[p.sku,p.supplierCode].filter(Boolean).join(' • '),'products');
  for(const p of db.itemLibrary||[])if(p.active!==false&&[p.name,p.internalCode,p.category,p.subcategory,p.material,p.colors,p.commercialDescription,p.technicalDescription].some(has))push('libraryItem',p.id,p.name||'Item da Biblioteca',[p.internalCode,p.category,p.subcategory].filter(Boolean).join(' • '),'itemLibrary');
  for(const x of db.quotes||[])if([x.number,x.clientSnapshot?.company,x.clientSnapshot?.name,x.salesperson,x.notes].some(has))push('quote',x.id,x.number||'Orçamento',x.clientSnapshot?.company||x.clientSnapshot?.name||'','quotes');
  for(const x of db.orders||[])if([x.number,x.clientSnapshot?.company,x.clientSnapshot?.name,x.salesperson,x.notes].some(has))push('order',x.id,x.number||'Pedido',x.clientSnapshot?.company||x.clientSnapshot?.name||'','orders');
  for(const x of db.invoices||[])if([x.number,x.clientSnapshot?.company,x.clientSnapshot?.name,x.nature,x.notes].some(has))push('invoice',x.id,x.number||'Pré-Nota',x.clientSnapshot?.company||x.clientSnapshot?.name||'','invoices');
  for(const x of db.finance||[])if([x.description,x.category,x.status].some(has))push('finance',x.id,x.description||'Financeiro',x.category||'','finance');
  for(const x of db.activities||[])if([x.type,x.notes,x.nextAction].some(has))push('activity',x.id,x.type||'Atividade',x.notes||x.nextAction||'','crm');
  for(const x of db.documents||[])if([x.title,x.category,x.fileName,x.notes].some(has))push('document',x.id,x.title||x.fileName||'Documento',[x.category,x.fileName].filter(Boolean).join(' • '),'documents');
  for(const x of db.tasks||[])if([x.title,x.notes,x.status,x.priority].some(has))push('task',x.id,x.title||'Tarefa',[x.status,x.priority].filter(Boolean).join(' • '),'tasks');
  for(const x of db.prospectingLeads||[])if([x.companyName,x.segment,x.cityState,x.leadOrigin,x.responsibleName,x.phone,x.email].some(has))push('lead',x.id,x.companyName||'Lead',[x.segment,x.cityState,x.leadOrigin].filter(Boolean).join(' • '),'prospecting');
  for(const p of db.routePlans||[])for(const i of p.items||[])if([i.title,i.company,i.address,i.attention,i.notes].some(has))push('route',p.id,`${i.type==='pickup'?'Retirada':'Entrega'} • ${i.company||i.title||'Roteiro'}`,dmyServer(p.date),'routePlanner');
  res.json(results);
});


app.post('/api/documentTemplates/:id/default',(req,res)=>{const db=readDB(),t=db.documentTemplates.find(x=>x.id===Number(req.params.id));if(!t)return res.status(404).json({error:'Modelo não encontrado.'});for(const x of db.documentTemplates)if(x.type===t.type)x.isDefault=x.id===t.id;audit(db,req.user,'DEFINIR PADRÃO','documentTemplates',t.id,t.name||'');writeDB(db);res.json(t)});

// ===== v16.0.6: conta pessoal, dados particulares e briefing =====
// Todos os endpoints exigem sessão; userId vem EXCLUSIVAMENTE do token autenticado.
const own=(row,req)=>Number(row.userId)===Number(req.user.id);
const cleanText=(x,max=250)=>String(x??'').trim().slice(0,max);
const availabilityValues=['available','busy','meeting','away'];
app.get('/api/me/profile',(req,res)=>res.json({...safeUser(req.user),permissions:permissionsFor(req.user)}));
app.put('/api/me/profile',(req,res)=>{
 const db=readDB(),u=db.users.find(x=>x.id===req.user.id);if(!u)return res.status(404).json({error:'Conta não encontrada.'});
 const b=req.body||{},name=cleanText(b.name,100),email=cleanText(b.email,200).toLowerCase();
 if(!name||!/^\S+@\S+\.\S+$/.test(email))return res.status(400).json({error:'Informe nome e e-mail válido.'});
 if(db.users.some(x=>x.id!==u.id&&String(x.email||'').trim().toLowerCase()===email))return res.status(409).json({error:'E-mail em uso.'});
 const newPass=String(b.newPassword||'');
 if(newPass&&(!verifyPassword(String(b.currentPassword||''),u)||newPass.length<8))return res.status(400).json({error:'Informe a senha atual correta e uma nova senha com pelo menos 8 caracteres.'});
 let photo=u.photoData||'';
 if(b.removePhoto===true)photo='';
 if(typeof b.photoData==='string'&&b.photoData){
  const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(b.photoData);
  if(!match||b.photoData.length>400000)return res.status(400).json({error:'Foto inválida. Envie PNG, JPG ou WebP de até 280 KB.'});
  const image=Buffer.from(match[2],'base64');
  const png=image.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
  const jpg=image[0]===0xff&&image[1]===0xd8&&image[2]===0xff;
  const webp=image.toString('ascii',0,4)==='RIFF'&&image.toString('ascii',8,12)==='WEBP';
  if(image.length>280000||!((match[1]==='png'&&png)||(match[1]==='jpeg'&&jpg)||(match[1]==='webp'&&webp)))return res.status(400).json({error:'Foto inválida ou muito grande.'});
  photo=b.photoData;
 }
 u.name=name;u.email=email;u.photoData=photo;
 if(availabilityValues.includes(b.availabilityStatus))u.availabilityStatus=b.availabilityStatus;
 u.preferences={...(u.preferences||{}),irisAutoOpen:b.irisAutoOpen!==false};
 if(newPass){const hp=hashPassword(newPass);u.passwordSalt=hp.salt;u.passwordHash=hp.hash;for(const [token,session] of sessions){if(session.userId===u.id&&token!==req.sessionToken)sessions.delete(token)}}
 audit(db,req.user,'EDITAR','users',u.id,'Meu perfil');writeDB(db);res.json({...safeUser(u),permissions:permissionsFor(u)});
});
const personalConfig={notes:{collection:'personalNotes',text:'content',limit:12000},reminders:{collection:'personalReminders',text:'detail',limit:2000}};
for(const [type,cfg] of Object.entries(personalConfig)){
 const root='/api/personal/'+type;
 app.get(root,(req,res)=>{const db=readDB();res.json(db[cfg.collection].filter(x=>own(x,req)).sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt))))});
 app.post(root,(req,res)=>{const db=readDB(),title=cleanText(req.body?.title,180);if(!title)return res.status(400).json({error:'Informe um título.'});
 const row={id:nextId(db,cfg.collection),userId:req.user.id,title,[cfg.text]:cleanText(req.body?.[cfg.text],cfg.limit),createdAt:nowIso(),updatedAt:nowIso()};
 if(type==='reminders'){const due=String(req.body?.dueAt||'');if(due&&!Number.isFinite(Date.parse(due)))return res.status(400).json({error:'Data inválida.'});row.dueAt=due;row.done=false}
 db[cfg.collection].push(row);writeDB(db);res.status(201).json(row)});
 app.put(root+'/:id',(req,res)=>{const db=readDB(),row=db[cfg.collection].find(x=>x.id===Number(req.params.id)&&own(x,req));if(!row)return res.status(404).json({error:'Registro não encontrado.'});const title=cleanText(req.body?.title,180);if(!title)return res.status(400).json({error:'Informe um título.'});row.title=title;row[cfg.text]=cleanText(req.body?.[cfg.text],cfg.limit);if(type==='reminders'){const due=String(req.body?.dueAt||'');if(due&&!Number.isFinite(Date.parse(due)))return res.status(400).json({error:'Data inválida.'});if(row.dueAt!==due||row.done!== (req.body?.done===true))row.notifiedAt='';row.dueAt=due;row.done=req.body?.done===true}row.updatedAt=nowIso();writeDB(db);res.json(row)});
 app.delete(root+'/:id',(req,res)=>{const db=readDB(),before=db[cfg.collection].length;db[cfg.collection]=db[cfg.collection].filter(x=>!(x.id===Number(req.params.id)&&own(x,req)));if(before===db[cfg.collection].length)return res.status(404).json({error:'Registro não encontrado.'});writeDB(db);res.status(204).end()});
}
const favoriteTypes={client:['clients','clients'],quote:['quotes','quotes'],order:['orders','orders'],product:['itemLibrary','itemLibrary'],map:['mindMaps','chat'],chat:['chatThreads','chat']};
app.get('/api/personal/favorites',(req,res)=>res.json(readDB().personalFavorites.filter(x=>own(x,req))));
app.post('/api/personal/favorites',(req,res)=>{const cfg=favoriteTypes[req.body?.type],id=Number(req.body?.entityId);if(!cfg||!Number.isSafeInteger(id)||id<=0||!can(req.user,cfg[1]))return res.status(400).json({error:'Favorito inválido ou sem permissão.'});const db=readDB();let item=db[cfg[0]].find(x=>x.id===id);if(req.body.type==='map')item=mindMapForUser(db,id,req.user.id);if(req.body.type==='chat')item=chatThreadForUser(db,id,req.user.id);if(!item)return res.status(404).json({error:'Registro indisponível.'});let row=db.personalFavorites.find(x=>own(x,req)&&x.type===req.body.type&&x.entityId===id);if(!row){row={id:nextId(db,'personalFavorites'),userId:req.user.id,type:req.body.type,entityId:id,createdAt:nowIso()};db.personalFavorites.push(row);writeDB(db)}res.json(row)});
app.delete('/api/personal/favorites/:id',(req,res)=>{const db=readDB(),before=db.personalFavorites.length;db.personalFavorites=db.personalFavorites.filter(x=>!(x.id===Number(req.params.id)&&own(x,req)));if(before===db.personalFavorites.length)return res.status(404).json({error:'Favorito não encontrado.'});writeDB(db);res.status(204).end()});
app.get('/api/briefing',(req,res)=>{
 const db=readDB(),uid=req.user.id,day=businessLocalParts().slice(0,10),allowed=p=>can(req.user,p);
 const threadRows=allowed('chat')?db.chatThreads.filter(t=>(t.memberIds||[]).map(Number).includes(uid)&&String(t.lastMessageAt||'')>String((t.lastReadBy||{})[String(uid)]||'')):[];
 const inbox=allowed('chat')?db.inboxMessages.filter(x=>(x.recipientIds||[]).map(Number).includes(uid)&&!inboxRecipientState(x,uid).readAt&&!inboxRecipientState(x,uid).archived):[];
 const mine=q=>Number(q.salespersonId||0)===uid||(!q.salespersonId&&String(q.salesperson||'')===req.user.name);
 const quotes=allowed('quotes')?db.quotes.filter(q=>mine(q)&&['quotation','sent','negotiation'].includes(q.status)):[];
 const changes=allowed('approvals')?db.approvalRequests.filter(a=>a.status==='changes'&&mine(db.quotes.find(q=>q.id===a.quoteId)||{})):[];
 const tasks=allowed('tasks')?db.tasks.filter(t=>Number(t.assignedUserId)===uid&&!['done','completed','concluida','concluído','cancelled'].includes(String(t.status||'').toLowerCase())):[];
 const follow=allowed('prospecting')?db.prospectingLeads.filter(l=>Number(l.sellerId)===uid&&l.nextFollowUp&&String(l.nextFollowUp).slice(0,10)<=day&&!['converted','lost','done','cancelled'].includes(String(l.status||''))):[];
 const purchased=allowed('prospecting')?db.customerFollowUps.filter(f=>Number(f.sellerId)===uid&&f.nextFollowUp&&String(f.nextFollowUp).slice(0,10)<=day&&!['done','completed','cancelled'].includes(String(f.status||''))):[];
 const reminders=db.personalReminders.filter(r=>own(r,req)&&!r.done&&r.dueAt&&String(r.dueAt).slice(0,10)<=day);
 const orders=allowed('orders')?db.orders.filter(o=>mine(o)&&!['delivered','cancelled'].includes(String(o.productionStage||o.status||''))&&o.deliveryDeadline&&String(o.deliveryDeadline).slice(0,10)<=day):[];
 const notifications=db.notifications.filter(n=>Number(n.userId)===uid&&!n.read);
 const events=allowed('calendar')?db.calendarEvents.filter(e=>Number(e.userId||e.assignedUserId||e.createdById||0)===uid&&String(e.date||e.startDate||'').slice(0,10)===day):[];
 res.json({date:day,counts:{messages:threadRows.reduce((n,t)=>n+db.chatMessages.filter(m=>m.threadId===t.id&&m.senderId!==uid&&String(m.createdAt||'')>String((t.lastReadBy||{})[String(uid)]||'')).length,0),conversations:threadRows.length,inbox:inbox.length,followups:follow.length+purchased.length,quotes:quotes.length,changes:changes.length,tasks:tasks.length,reminders:reminders.length,orders:orders.length,notifications:notifications.length,events:events.length},items:{followups:[...follow,...purchased].slice(0,6).map(x=>({id:x.id||x.clientId,title:x.companyName||'Cliente',date:x.nextFollowUp})),reminders:reminders.slice(0,6).map(x=>({id:x.id,title:x.title,date:x.dueAt})),changes:changes.slice(0,5).map(x=>({id:x.id,title:x.title||'Alteração solicitada'}))}});
});
app.get('/api/briefing/endday',(req,res)=>{
 const db=readDB(),uid=req.user.id,day=businessLocalParts().slice(0,10),tomorrow=businessLocalParts(1).slice(0,10),ownSeller=x=>Number(x.salespersonId||x.sellerId||x.assignedSellerId||0)===uid;
 const myTasks=can(req.user,'tasks')?db.tasks.filter(x=>Number(x.assignedUserId||0)===uid):[];
 const myQuotes=can(req.user,'quotes')?db.quotes.filter(ownSeller):[];
 const myOrders=can(req.user,'orders')?db.orders.filter(ownSeller):[];
 const myReminders=db.personalReminders.filter(x=>Number(x.userId)===uid);
 const myEvents=can(req.user,'calendar')?db.calendarEvents.filter(x=>Number(x.userId||x.assignedUserId||x.createdById||0)===uid):[];
 const complete=['done','completed','concluido','concluído','delivered'];const doneToday=(x)=>complete.includes(String(x.status||x.productionStage||'').toLowerCase())&&String(x.updatedAt||x.deliveredAt||'').slice(0,10)===day;
 res.json({date:day,tomorrow,completedTasks:myTasks.filter(doneToday).length,completedOrders:myOrders.filter(doneToday).length,quotesCreated:myQuotes.filter(x=>String(x.createdAt||'').slice(0,10)===day).length,pendingTasks:myTasks.filter(x=>!complete.includes(String(x.status||'').toLowerCase())).length,pendingReminders:myReminders.filter(x=>!x.done).length,tomorrowEvents:myEvents.filter(x=>String(x.date||x.startDate||'').slice(0,10)===tomorrow).length});
});
app.get('/api/mindmaps/:id/comments',(req,res)=>{const db=readDB(),m=mindMapForUser(db,req.params.id,req.user.id);if(!m)return res.status(404).json({error:'Mapa não encontrado.'});res.json(db.mindMapComments.filter(x=>x.mapId===m.id).map(x=>({...x,author:db.users.find(u=>u.id===x.userId)?.name||'Usuário'})))});
app.post('/api/mindmaps/:id/comments',(req,res)=>{const db=readDB(),m=mindMapForUser(db,req.params.id,req.user.id),text=cleanText(req.body?.text,1200);if(!m)return res.status(404).json({error:'Mapa não encontrado.'});if(!text)return res.status(400).json({error:'Escreva um comentário.'});const row={id:nextId(db,'mindMapComments'),mapId:m.id,userId:req.user.id,nodeId:cleanText(req.body?.nodeId,50),text,createdAt:nowIso()};db.mindMapComments.push(row);for(const id of new Set([m.ownerId,...m.sharedUserIds]))if(id!==req.user.id)notify(db,{userId:id,title:'Novo comentário no mapa',message:`${req.user.name}: ${m.title}`,page:'mindMaps',entityId:m.id});writeDB(db);res.status(201).json(row)});
app.delete('/api/mindmaps/:id/comments/:commentId',(req,res)=>{const db=readDB(),m=mindMapForUser(db,req.params.id,req.user.id);if(!m)return res.status(404).json({error:'Mapa não encontrado.'});const i=db.mindMapComments.findIndex(x=>x.mapId===m.id&&x.id===Number(req.params.commentId)&&x.userId===req.user.id);if(i<0)return res.status(404).json({error:'Comentário não encontrado.'});db.mindMapComments.splice(i,1);writeDB(db);res.status(204).end()});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
ensureDailyBackup();
// One job per backend process; scheduler runs only with a pre-imported catalog and server-side secret.
const spotTimer=setInterval(()=>{spotAutoTick().catch(()=>{})},5*60*1000);spotTimer.unref?.();
const spotStartupTimer=setTimeout(()=>{spotAutoTick().catch(()=>{})},90*1000);spotStartupTimer.unref?.();
const xbzTimer=setInterval(()=>{runXbzAuto().catch(()=>{})},5*60*1000);xbzTimer.unref?.();
const xbzStartupTimer=setTimeout(()=>{runXbzAuto().catch(()=>{})},120*1000);xbzStartupTimer.unref?.();
app.listen(PORT,HOST,()=>{
  console.log(`\nC4U APP v16.0.7 + SPOT FASE 3 HOMOLOGAÇÃO`);
  console.log(`Neste computador: http://localhost:${PORT}`);
  if(PUBLIC_BASE_URL) console.log(`Endereço público: ${PUBLIC_BASE_URL}`);
  const ips=localIPv4();
  if(ips.length){
    console.log('\nAcesso por outros computadores na mesma rede:');
    ips.forEach(x=>console.log(`  http://${x.address}:${PORT}  (${x.name})`));
  } else {
    console.log('\nNenhum IPv4 de rede local foi detectado.');
  }
  console.log('\nMantenha esta janela aberta enquanto a equipe estiver usando o C4U.\n');
});
