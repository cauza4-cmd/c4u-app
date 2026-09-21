/* C4U APP: diálogos internos assíncronos, sem confirm/prompt/alert do navegador. */
(function(root){
  'use strict';
  let queue=Promise.resolve();
  function create(tag,className,text){
    const node=document.createElement(tag);
    if(className)node.className=className;
    if(text!==undefined)node.textContent=String(text);
    return node;
  }
  function present({kind,message,initial='',copy=false}){
    return new Promise(resolve=>{
      const focused=document.activeElement;
      const overlay=create('div','c4u-dialog-overlay');
      const panel=create('section','c4u-dialog-panel');
      panel.setAttribute('role',kind==='ask'?'dialog':'alertdialog');
      panel.setAttribute('aria-modal','true');
      const heading=create('h2','c4u-dialog-title',kind==='ask'?'Informação':kind==='notice'?'Atenção':'Confirmação');
      const text=create('p','c4u-dialog-message',message);
      heading.id='c4u-dialog-heading';text.id='c4u-dialog-description';
      panel.setAttribute('aria-labelledby',heading.id);
      panel.setAttribute('aria-describedby',text.id);
      panel.append(heading,text);
      let input=null;
      if(kind==='ask'){
        input=create('input','c4u-dialog-input');input.type='text';input.value=String(initial??'');
        input.setAttribute('aria-label',String(message));input.autocomplete='off';
        panel.append(input);
      }
      const actions=create('div','c4u-dialog-actions');
      const cancel=kind==='notice'?null:create('button','c4u-dialog-button c4u-dialog-cancel','Cancelar');
      if(cancel){cancel.type='button';actions.append(cancel)}
      if(copy&&input){
        const copyButton=create('button','c4u-dialog-button c4u-dialog-copy','Copiar');
        copyButton.type='button';
        copyButton.addEventListener('click',async()=>{
          try{if(!navigator.clipboard?.writeText)throw Error('sem clipboard');await navigator.clipboard.writeText(input.value);copyButton.textContent='Copiado!'}
          catch{input.focus();input.select();copyButton.textContent='Selecione e copie (Ctrl+C)'}
        });
        actions.append(copyButton);
      }
      const ok=create('button','c4u-dialog-button c4u-dialog-accept',kind==='notice'?'Entendi':kind==='ask'?'Confirmar':'Confirmar');
      ok.type='button';actions.append(ok);panel.append(actions);overlay.append(panel);
      let finished=false;
      const close=(value)=>{
        if(finished)return;finished=true;document.removeEventListener('keydown',onKey,true);
        overlay.remove();if(focused&&focused.isConnected&&typeof focused.focus==='function')focused.focus();
        resolve(value);
      };
      const abort=()=>close(kind==='ask'?null:false);
      function onKey(event){
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();abort();return}
        if(event.key==='Enter' && !(event.target instanceof HTMLTextAreaElement)){
          if(event.target===cancel){event.preventDefault();event.stopPropagation();abort();return}
          if(event.target?.classList?.contains('c4u-dialog-copy'))return;
          event.preventDefault();event.stopPropagation();accept();return;
        }
        if(event.key==='Tab'){
          const nodes=[...panel.querySelectorAll('button:not([disabled]),input:not([disabled])')];
          if(!nodes.length)return;
          const first=nodes[0],last=nodes[nodes.length-1];
          if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
          else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
        }
      }
      function accept(){close(kind==='ask'?input.value:true)}
      ok.addEventListener('click',accept);
      cancel?.addEventListener('click',abort);
      overlay.addEventListener('click',event=>{if(event.target===overlay)abort()});
      document.body.append(overlay);
      document.addEventListener('keydown',onKey,true);
      (input||cancel||ok).focus();
      if(input)input.select();
    });
  }
  function enqueue(options){const result=queue.then(()=>present(options));queue=result.then(()=>undefined,()=>undefined);return result}
  root.C4UDialog=Object.freeze({
    confirm:message=>enqueue({kind:'confirm',message}),
    ask:(message,initial='',options={})=>enqueue({kind:'ask',message,initial,copy:options.copy===true}),
    notice:message=>enqueue({kind:'notice',message})
  });
})(window);
