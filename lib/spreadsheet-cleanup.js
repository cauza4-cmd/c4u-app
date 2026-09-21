'use strict';
/** Exclusively targets records proven by their exact source marker to originate from the product spreadsheet.
 * No file deletion, supplier deletion, order mutation, or API requests. */
const SOURCE='Asia Import - planilha';
const SCAN_COLLECTIONS=['quotes','orders','invoices','finance','physicalStock','documents','tasks','approvalRequests','clientFiles','spreadsheets'];
function referencedIds(db){
 const refs=new Map();
 function mark(id,where){const n=Number(id);if(!Number.isSafeInteger(n)||n<=0)return;let a=refs.get(n);if(!a){a=new Set();refs.set(n,a)}a.add(where)}
 function scan(obj,where,depth=0){
  if(!obj||typeof obj!=='object'||depth>12)return;
  if(Array.isArray(obj)){for(const x of obj)scan(x,where,depth+1);return}
  for(const [k,v] of Object.entries(obj)){
   if(k==='libraryItemId'||k==='itemLibraryId')mark(v,where);
   else if(k==='librarySnapshot'&&v&&typeof v==='object')mark(v.id,where);
   if(v&&typeof v==='object')scan(v,where,depth+1);
  }
 }
 for(const k of SCAN_COLLECTIONS)for(const record of db[k]||[])scan(record,k);
 return refs;
}
function planSpreadsheetCleanup(db){
 const refs=referencedIds(db),candidates=(db.itemLibrary||[]).filter(x=>x.source===SOURCE&&x.active!==false);
 const remove=[],archive=[];
 for(const x of candidates){
  const links=[...(refs.get(Number(x.id))||[])],changed=Boolean(x.updatedBy||x.updatedAt||x.supplierPriceUpdatedAt||x.duplicatedFromId);
  const summary={id:x.id,code:String(x.internalCode||x.supplierCode||'').slice(0,90),name:String(x.name||'').slice(0,130),reason:links.length?`Vinculado a ${links.join(', ')}`:changed?'Alterado ou atualizado após a importação':''};
  (links.length||changed?archive:remove).push(summary);
 }
 const inactive=(db.itemLibrary||[]).filter(x=>x.source===SOURCE&&x.active===false).length;
 return {source:SOURCE,candidates:candidates.length,deleteCount:remove.length,archiveCount:archive.length,alreadyInactive:inactive,
  samples:[...remove.slice(0,8).map(x=>({...x,action:'excluir'})),...archive.slice(0,8).map(x=>({...x,action:'arquivar'}))],
  deleteIds:remove.map(x=>x.id),archiveIds:archive.map(x=>x.id),
  warning:'Somente itens com origem exata Asia Import - planilha. Registros referenciados ou editados ficam inativos/arquivados para preservar histórico; outros fornecedores, estoque físico, planilhas gerais, orçamentos e pedidos são preservados.'};
}
function applySpreadsheetCleanup(db,plan,at=new Date().toISOString()){
 const remove=new Set(plan.deleteIds.map(Number)),archive=new Set(plan.archiveIds.map(Number));
 let deleted=0,archived=0;
 db.itemLibrary=(db.itemLibrary||[]).filter(x=>{
  if(x.source!==SOURCE)return true;
  if(remove.has(Number(x.id))){deleted++;return false}
  if(archive.has(Number(x.id))){x.active=false;x.spreadsheetArchivedAt=at;x.spreadsheetArchiveReason='Limpeza controlada de planilha';archived++}
  return true;
 });
 return {deleted,archived,source:SOURCE,ordersToSupplier:false};
}
module.exports={SOURCE,planSpreadsheetCleanup,applySpreadsheetCleanup,referencedIds};
