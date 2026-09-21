'use strict';
// Audit only: never guess replacement photos or change historical item/variation IDs.
const crypto=require('crypto');
const SUFFIX_COLORS={AZ:'azul',PT:'preto',PR:'preto',VM:'vermelho',VD:'verde',BR:'branco',BC:'branco',AM:'amarelo',RS:'rosa',RX:'roxo',LR:'laranja',CZ:'cinza',MR:'marrom',VN:'vinho',CR:'cristal',DO:'dourado',PL:'prata'};
const normalize=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const code=v=>normalize(v).replace(/\s+/g,'');
function rank(item,query,{expanded=false}={}){
 const q=normalize(query);if(!q)return 1;
 const c=code(item.internalCode||item.code||item.sku),s=code(item.supplierCode),parent=code(item.parentCode),n=normalize(item.name);
 const qc=code(q);
 if(c&&c===qc)return 110;
 if(s&&s===qc)return 105;
 if(parent&&parent===qc)return 100;
 if(c&&c.startsWith(qc))return 95;
 if(s&&s.startsWith(qc))return 92;
 if(parent&&parent.startsWith(qc))return 88;
 if(n===q)return 90;
 if(n.startsWith(q))return 80;
 if(n.split(/[^a-z0-9]+/).some(w=>w.startsWith(q)))return 70;
 if(n.includes(q))return 60;
 // Description/categories are opt-in, never implicit in product lookup.
 if(expanded&&[item.commercialDescription,item.technicalDescription,item.description,item.category].some(v=>normalize(v).includes(q)))return 10;
 return 0;
}
function searchItems(items,query,opts={}){return items.map((item,i)=>({item,i,score:rank(item,query,opts)})).filter(x=>x.score).sort((a,b)=>b.score-a.score||a.i-b.i).map(x=>x.item)}
function dedupeWithinItem(items){let changed=0,removed=0;for(const item of items){if(!Array.isArray(item.images)||item.images.length<2)continue;const unique=[...new Set(item.images)];if(unique.length!==item.images.length){removed+=item.images.length-unique.length;item.images=unique;changed++}}return {itemsChanged:changed,imagesRemoved:removed}}
function quality(items){
 const issues=[],codes=new Map(),images=new Map();
 for(const item of items){
  const id=Number(item.id),itemCode=String(item.internalCode||item.code||'').trim(),norm=code(itemCode),photos=Array.isArray(item.images)?item.images:[],seen=new Set();
  const colorSuffix=itemCode.match(/[-_ ]([A-Za-z]{2})$/)?.[1]?.toUpperCase();const variantColor=SUFFIX_COLORS[colorSuffix]||'';
  if(!itemCode)issues.push({type:'missing-code',itemId:id,code:itemCode,name:item.name||'',detail:'Sem código principal.'});
  if(norm){if(!codes.has(norm))codes.set(norm,[]);codes.get(norm).push(item)}
  photos.forEach((src,index)=>{if(typeof src!=='string'||!src)return;
   const hash=crypto.createHash('sha256').update(src).digest('hex');
   if(seen.has(hash))issues.push({type:'duplicate-in-item',itemId:id,code:itemCode,name:item.name||'',detail:`Imagem ${index+1} repetida no mesmo item.`});
   seen.add(hash);
   if(!images.has(hash))images.set(hash,[]);images.get(hash).push({itemId:id,code:itemCode,name:item.name||'',colors:Array.isArray(item.colors)?item.colors.join(', '):String(item.colors||item.color||variantColor||'')});
  });
 }
 for(const [k,rows] of codes)if(rows.length>1)issues.push({type:'duplicate-code',code:rows[0].internalCode||rows[0].code||k,itemId:rows[0].id,name:rows[0].name||'',detail:`Mesmo código em ${rows.length} registros: ${rows.map(x=>x.id).join(', ')}`});
 for(const entries of images.values()){
  const unique=[...new Map(entries.map(x=>[x.itemId,x])).values()];if(unique.length<2)continue;
  const colorValues=[...new Set(unique.map(x=>normalize(x.colors)).filter(Boolean))];
  if(colorValues.length>1)issues.push({type:'shared-photo-different-colors',itemId:unique[0].itemId,code:unique[0].code,name:unique[0].name,detail:`Mesma foto em itens com cores distintas: ${unique.slice(0,8).map(x=>`${x.code||x.itemId} (${x.colors})`).join(' / ')}${unique.length>8?'…':''}`});
 }
 return {total:items.length,count:issues.length,issues:issues.slice(0,1500),truncated:issues.length>1500,readOnly:true};
}
module.exports={normalize,rank,searchItems,quality,dedupeWithinItem};
