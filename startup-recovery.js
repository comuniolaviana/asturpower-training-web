// Keep a way back when a module fails before the application can render its own UI.
// Never replace an app that has started, clear storage, or reload an active operation.
(() => {
 const root=document.querySelector('#app');
 const pending=()=>Boolean(root?.querySelector('[data-boot-placeholder]'));
 let timer;
 function recover(){
  if(!pending())return;
  clearTimeout(timer);
  removeEventListener('error',onError,true);
  const main=document.createElement('main');main.className='loading-screen';
  const title=document.createElement('h1');title.textContent='No hemos podido abrir AsturPower';
  const note=document.createElement('p');note.textContent='La aplicación no ha terminado de cargar. Puedes abrir de nuevo la versión actual. Tus datos siguen guardados.';
  const link=document.createElement('a');link.className='button primary';link.textContent='Reabrir aplicación';link.href='/?recuperar='+Date.now();
  main.append(title,note,link);root.replaceChildren(main);
 }
 function onError(event){if(event.target?.tagName==='SCRIPT'||event.error)recover();}
 addEventListener('error',onError,true);
 timer=setTimeout(recover,18000);
 const observer=new MutationObserver(()=>{if(!pending()){clearTimeout(timer);removeEventListener('error',onError,true);observer.disconnect();}});
 if(root)observer.observe(root,{childList:true,subtree:true});
})();
