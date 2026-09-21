'use strict';
/** Isola XBZ da biblioteca manual, pedidos, estoque físico e históricos financeiros. */
const crypto=require('node:crypto');
const SOURCE='XBZ';
const str=(v,max=400)=>String(v??'').trim().slice(0,max);
const pick=(o,keys)=>{if(!o||typeof o!=='object')return undefined;for(const k of keys)if(o[k]!==undefined&&o[k]!==null)return o[k];return undefined};
function money(v){if(v===null||v===undefined||v==='')return null;let s=String(v).trim().replace(/R\$\s*/gi,'').replace(/\s/g,'');if(s.includes(',')&&s.includes('.'))s=s.replace(/\./g,'').replace(',','.');else if(s.includes(','))s=s.replace(',','.');if(!/^\d+(?:\.\d{1,4})?$/.test(s))return null;const n=Number(s);return Number.isFinite(n)&&n>=0?n:null}
function stock(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isSafeInteger(n)&&n>=0?n:null}
function supplierStockInfo(v){if(v===null||v===undefined||v==='')return {available:null,reported:null,status:'missing'};const n=Number(v);if(!Number.isSafeInteger(n))return {available:null,reported:null,status:'invalid'};return {available:Math.max(0,n),reported:n,status:n<0?'negative':n===0?'zero':'available'}}
function image(v){if(typeof v!=='string'||v.length>2048)return '';try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!/\b(?:token|secret|api_key|password|senha)=/i.test(u.search)?u.href:''}catch{return ''}}
function labels(v){const xs=Array.isArray(v)?v:(v&&typeof v==='object'?Object.values(v):[v]);return xs.map(x=>str(typeof x==='object'?pick(x,['nome','name','descricao','titulo']):x,100)).filter(Boolean).map(x=>x.replace(/&amp;/g,'&'))}
function hashCatalog(rows){return crypto.createHash('sha256').update(JSON.stringify(rows||[])).digest('hex')}
function comparable(x){const {lastSupplierSync,missingFromLatestFeed,...rest}=x;return rest}
function normalizeRows(raw,existing=[],manual=[],at=new Date().toISOString()){
 if(!Array.isArray(raw)||raw.length<1||raw.length>100000)throw Error('Catálogo XBZ vazio ou excessivo: prévia bloqueada.');
 const problems=[],seen=new Set(),items=[],manualKeys=new Set((manual||[]).flatMap(x=>[x.internalCode,x.supplierCode]).filter(Boolean).map(x=>str(x,100).toUpperCase()));let manualOverlaps=0,missingImage=0,missingPrice=0,missingStock=0,negativeStock=0,zeroStock=0,negativeMainStock=0,missingCommercialCode=0,duplicateCommercialCodes=0;const seenCommercial=new Set();
 for(let i=0;i<raw.length;i++){
  const r=raw[i];if(!r||typeof r!=='object'||Array.isArray(r)){problems.push('Registro '+(i+1)+': formato inválido.');continue}
  const code=str(pick(r,['CodigoXbz','codigo','Codigo','CODIGO','sku','SKU','referencia','Referencia','codigoProduto','CodigoProduto','id','Id']),100),name=str(pick(r,['nome','Nome','NOME','titulo','Titulo','descricao','Descricao','description','name']),400),key=code.toUpperCase();
  if(!code||!name||seen.has(key)){problems.push('Registro '+(i+1)+': código/nome ausente ou SKU duplicado.');continue}seen.add(key);
  const commercialCode=str(pick(r,['CodigoAmigavel']),100)||code,variationCode=str(pick(r,['CodigoComposto']),100),productId=str(pick(r,['IdProduto']),100);if(commercialCode===code&&r.CodigoAmigavel==null)missingCommercialCode++;if(seenCommercial.has(commercialCode.toUpperCase()))duplicateCommercialCodes++;seenCommercial.add(commercialCode.toUpperCase());
   const price=money(pick(r,['PrecoVenda','preco','Preco','PRECO','preco_revenda','precoRevenda','PrecoRevenda','valor','Valor','price','Price','custo','Custo']));
  const stockInfo=supplierStockInfo(pick(r,['QuantidadeDisponivel','estoque','Estoque','ESTOQUE','qtd_estoque','quantidadeEstoque','QuantidadeEstoque','quantidade','saldo','Saldo','stock'])),mainStockInfo=supplierStockInfo(pick(r,['QuantidadeDisponivelEstoquePrincipal']));const quantity=stockInfo.available;
  let pics=[pick(r,['ImageLink','imagem','Imagem','url_foto','urlFoto','foto','Foto','image','imageUrl','ImagemProduto','urlImagem'])];const other=pick(r,['imagens','galeria','fotos','Galeria','Fotos']);if(Array.isArray(other))pics.push(...other.map(x=>typeof x==='string'?x:pick(x,['url','imagem','foto','src'])));pics=[...new Set(pics.map(image).filter(Boolean))].slice(0,10);
  const category=labels(pick(r,['WebTipo','categorias','Categorias','categoria','Categoria','grupo','Grupo'])),colors=labels(pick(r,['cores','Cores','cor','Cor']));
  if(price===null)missingPrice++;if(quantity===null)missingStock++;if(stockInfo.status==='negative')negativeStock++;if(stockInfo.status==='zero')zeroStock++;if(mainStockInfo.status==='negative')negativeMainStock++;if(!pics.length)missingImage++;if(manualKeys.has(key)||manualKeys.has(commercialCode.toUpperCase()))manualOverlaps++;
  items.push({source:SOURCE,code,sku:code,internalCode:code,commercialCode,variationCode,productId,name,description:str(pick(r,['descricao','Descricao','description','detalhes']),6000),category:category[0]||'Sem categoria',subcategory:category.slice(1).join(', '),image:pics[0]||'',images:pics,color:colors.join(', '),cost:price,price,supplierStock:quantity,supplierStockReported:stockInfo.reported,supplierStockStatus:stockInfo.status,supplierStockMain:mainStockInfo.available,supplierStockMainReported:mainStockInfo.reported,supplierStockMainStatus:mainStockInfo.status,ncm:str(pick(r,['Ncm','ncm','NCM']),30),active:![false,0,'0','false'].includes(pick(r,['ativo','Ativo','status','Status'])),lastSupplierSync:at,missingFromLatestFeed:false});
 }
 if(problems.length||items.length!==raw.length)throw Object.assign(Error(`XBZ: ${problems.length} produto(s) com código ou formato inválido(s). Importação bloqueada; confira o formato real da API.`),{issues:problems.slice(0,12)});
 const fieldNames=Object.keys(raw[0]||{}).filter(k=>!/token|secret|senha|cnpj|password|key/i.test(k)).slice(0,25).join(', ');
 if(missingPrice===items.length)throw Error('XBZ: nenhum preço reconhecido. Campos da API: '+fieldNames+'. Precisamos ajustar o mapeamento antes de importar.');
 if(missingStock===items.length)throw Error('XBZ: nenhum estoque reconhecido. Campos da API: '+fieldNames+'. Precisamos ajustar o mapeamento antes de importar.');
 const older=new Map((existing||[]).filter(x=>x.source===SOURCE).map(x=>[str(x.code,100).toUpperCase(),x]));let created=0,updated=0,unchanged=0;
 for(const x of items){const old=older.get(x.code.toUpperCase());if(!old)created++;else if(JSON.stringify(comparable(x))===JSON.stringify(comparable(old)))unchanged++;else updated++}
 const missing=(existing||[]).filter(x=>x.source===SOURCE&&!seen.has(str(x.code,100).toUpperCase())).length;
 if(older.size&&missing>older.size*.25)throw Error('XBZ: mais de 25% dos códigos atuais desapareceram. Nenhuma importação automática autorizada.');
 const summary={received:raw.length,items:items.length,new:created,update:updated,unchanged,missingRetained:missing,manualOverlaps,missingImages:missingImage,missingPrices:missingPrice,missingStock,negativeStock,zeroStock,negativeMainStock,missingCommercialCode,duplicateCommercialCodes,active:items.filter(x=>x.active).length,ordersToSupplier:false};
 return {items,summary,sample:items.slice(0,12).map(x=>({code:x.commercialCode,internalCode:x.code,variationCode:x.variationCode,name:x.name,category:x.category,subcategory:x.subcategory,image:x.image,cost:x.cost,supplierStock:x.supplierStock,supplierStockReported:x.supplierStockReported,supplierStockStatus:x.supplierStockStatus,supplierStockMain:x.supplierStockMain,supplierStockMainReported:x.supplierStockMainReported,supplierStockMainStatus:x.supplierStockMainStatus})),dbHash:hashCatalog(existing)};
}
function importStage(db,stage,at=new Date().toISOString()){
 if(hashCatalog(db.xbzCatalog||[])!==stage.dbHash)throw Error('XBZ: catálogo alterado desde a prévia. Gere novamente.');
 if(!stage.items?.length||stage.items.length!==stage.summary?.items)throw Error('XBZ: prévia inconsistente. Importação bloqueada.');
 const seen=new Set(stage.items.map(x=>x.code.toUpperCase())),remaining=(db.xbzCatalog||[]).filter(x=>x.source===SOURCE&&!seen.has(String(x.code).toUpperCase())).map(x=>({...x,missingFromLatestFeed:true}));
 db.xbzCatalog=[...(db.xbzCatalog||[]).filter(x=>x.source!==SOURCE),...stage.items.map(x=>({...x,lastSupplierSync:at,missingFromLatestFeed:false})),...remaining];
 db.settings={...(db.settings||{}),xbzSync:{...(db.settings?.xbzSync||{}),enabled:true,lastSuccess:at,lastError:'',lastSummary:{...stage.summary,imported:stage.items.length}}};
 return {...stage.summary,imported:stage.items.length,retained:remaining.length,total:db.xbzCatalog.length,updatedAt:at};
}
module.exports={SOURCE,normalizeRows,importStage,hashCatalog,money,stock,supplierStockInfo,image,labels};
