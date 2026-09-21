'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const files=['public/app.js','public/c4u-personal-1606.js','public/approval.html'];
for(const file of files){
  const text=read(file);
  assert(!/(?<![\w.])(?:window\.)?(?:confirm|prompt|alert)\s*\(/.test(text),`${file} ainda usa diálogo nativo`);
}
const app=read('public/app.js');
for(const fn of ['removeMindMapNode','mindMapLinkNodes','spreadsheetDeleteRow'])assert(app.includes(`async function ${fn}(`),`${fn} deve aguardar diálogo`);
assert(app.includes('await C4UDialog.ask('),'ligações devem usar caixa interna');
assert(app.includes('if(!await C4UDialog.confirm('),'ações perigosas devem parar ao cancelar');
assert(app.includes('if(!await C4UDialog.confirm(`Confirmar limpeza de'),'limpeza precisa de confirmação interna');
const html=read('public/index.html'),approval=read('public/approval.html');
assert(html.indexOf('/c4u-dialogs.js')<html.indexOf('/app.js'),'modal deve carregar antes do C4U');
assert(approval.indexOf('/c4u-dialogs.js')<approval.indexOf('async function respond('),'modal deve carregar antes da página pública');
assert(approval.includes('await C4UDialog.notice('),'alertas públicos devem ser internos');
assert(read('public/c4u-dialogs.css').includes('.c4u-dialog-overlay'));
class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.events={};this.isConnected=false;this.className='';this.value='';this.textContent='';this.attributes={};this.id='';}
  append(...children){for(const c of children){c.parent=this;c.isConnected=true;this.children.push(c)}}
  remove(){if(this.parent){this.parent.children=this.parent.children.filter(x=>x!==this);this.parent=null}this.isConnected=false}
  setAttribute(key,val){this.attributes[key]=val}
  addEventListener(name,fn){(this.events[name]??=[]).push(fn)}
  focus(){document.activeElement=this}
  select(){this.selected=true}
  querySelectorAll(){const all=[];const visit=n=>{for(const c of n.children){if(['button','input'].includes(c.tagName))all.push(c);visit(c)}};visit(this);return all}
  get classList(){return {contains:name=>this.className.split(' ').includes(name)}}
  click(){for(const fn of this.events.click||[])fn({target:this})}
}
const document={body:new Element('body'),activeElement:null,events:{},createElement:t=>new Element(t),addEventListener(name,fn){this.events[name]=fn},removeEventListener(name,fn){if(this.events[name]===fn)delete this.events[name]}};
document.body.isConnected=true;const prior=new Element('button');prior.isConnected=true;prior.focus();
const context={window:{},document,navigator:{clipboard:{writeText:async()=>{}}},HTMLTextAreaElement:class{},Promise,console};
vm.runInNewContext(read('public/c4u-dialogs.js'),context);
const dialog=context.window.C4UDialog;
async function shown(){for(let i=0;i<5&&!document.body.children.length;i++)await Promise.resolve();assert(document.body.children.length===1,'modal interno deve aparecer');return document.body.children[0]}
async function test(){
 let result=dialog.confirm('Excluir bloco?');let backdrop=await shown();assert(backdrop.children[0].attributes['aria-modal']==='true');
 assert(backdrop.children[0].children[1].textContent==='Excluir bloco?');
 backdrop.children[0].querySelectorAll()[0].click();assert.equal(await result,false);assert.equal(document.body.children.length,0);assert.equal(document.activeElement,prior);
 result=dialog.confirm('Confirmar limpeza?');backdrop=await shown();backdrop.children[0].querySelectorAll().at(-1).click();assert.equal(await result,true);
 result=dialog.ask('Rótulo da ligação (opcional):','TESTE');backdrop=await shown();let input=backdrop.children[0].querySelectorAll().find(x=>x.tagName==='input');
 assert.equal(input.value,'TESTE');input.value='Conexão';backdrop.children[0].querySelectorAll().at(-1).click();assert.equal(await result,'Conexão');
 result=dialog.ask('Copie o link:','https://example.test',{copy:true});backdrop=await shown();
 assert(backdrop.children[0].querySelectorAll().some(x=>x.textContent==='Copiar'));
 document.events.keydown({key:'Escape',target:backdrop,preventDefault(){},stopPropagation(){}});assert.equal(await result,null);
 result=dialog.notice('Informe seu nome');backdrop=await shown();backdrop.children[0].querySelectorAll().at(-1).click();assert.equal(await result,true);
 result=dialog.confirm('<img src=x onerror=alert(1)>');backdrop=await shown();assert.equal(backdrop.children[0].children[1].textContent,'<img src=x onerror=alert(1)>');
 backdrop.children[0].querySelectorAll()[0].click();assert.equal(await result,false);
 console.log('C4U_DIALOGOS_TESTES_OK: sem popups nativos, cancelamento, confirmação, texto, cópia, Escape, foco e página de aprovação.');
}
test().catch(err=>{console.error(err);process.exitCode=1});
