// Self-service Auth API only. No admin key, user ID parameter, or SQL writes.
export function validateAccountEmail(value,confirmation,current) {
  const email=String(value||'').trim().toLowerCase();
  if(email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Escribe un correo válido.');
  if(email!==String(confirmation||'').trim().toLowerCase())throw new Error('Los dos correos no coinciden.');
  if(email===String(current||'').toLowerCase())throw new Error('Ese ya es tu correo actual.');
  return email;
}
export async function requestAccountEmail(client,user,email,confirmation) {
  const next=validateAccountEmail(email,confirmation,user.email);
  const auth=await client.auth.getUser();
  if(auth.error||auth.data?.user?.id!==user.id||auth.data.user.email!==user.email)throw new Error('Tu sesión ha cambiado. Actualiza la página antes de continuar.');
  const result=await client.auth.updateUser({email:next});
  if(result.error){
    if(result.error.status===429||result.error.code==='over_email_send_rate_limit')throw new Error('Demasiados intentos. Espera unos minutos antes de volver a solicitar el cambio.');
    if(result.error.code==='email_address_not_authorized')throw new Error('El servicio de correo de Supabase no permite enviar a esa dirección. Hay que revisar la configuración SMTP del proyecto.');
    if(['email_exists','user_already_exists'].includes(result.error.code))throw new Error('Ese correo ya está asociado a otra cuenta.');
    throw new Error('No se ha podido solicitar el cambio. Comprueba la dirección y vuelve a intentarlo.');
  }
  if(result.data?.user?.id!==user.id)throw new Error('No se ha podido confirmar la solicitud. Actualiza la página.');
  if(result.data.user.email===next)return 'Correo de acceso actualizado. Para tu próxima entrada utiliza el nuevo correo y tu contraseña habitual.';
  return 'Solicitud enviada. Revisa el correo actual y el nuevo, incluida la carpeta de spam, y completa las confirmaciones que indique Supabase. Después vuelve a entrar con el nuevo correo y tu contraseña habitual.';
}
export function mountAccountEmail({root,client,user,notice='',onRequested=()=>{}}) {
  const doc=root.ownerDocument;
  const el=(tag,text)=>{const n=doc.createElement(tag);if(text)n.textContent=text;return n;};
  root.className='panel profile-panel';
  root.append(el('h2','Cambiar mi correo de acceso'),el('p','Este cambio afecta a la cuenta con la que has iniciado sesión. Conserva tu perfil, roles y vinculaciones.'));
  const current=el('p','Correo actual: '+user.email);root.append(current);
  const form=el('form');
  const input=(name,label)=>{const field=el('label',label),n=el('input');n.name=name;n.type='email';n.autocomplete='email';n.required=true;n.maxLength=254;field.append(n);form.append(field);return n;};
  const email=input('new_email','Correo nuevo'),confirm=input('confirm_email','Repite el correo nuevo');
  const help=el('p','Puede ser necesario confirmar el cambio desde ambos buzones. El correo de acceso seguirá siendo el actual hasta completar el proceso.');
  const button=el('button','Solicitar cambio de correo');button.type='submit';button.className='button primary';
  const status=el('p',notice||(user.new_email?'Cambio pendiente de confirmar para: '+user.new_email:''));status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  form.append(help,button,status);root.append(form);
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(button.disabled)return;button.disabled=true;status.textContent='Solicitando cambio…';
    try{
      const message=await requestAccountEmail(client,user,email.value,confirm.value);
      if(!root.isConnected)return;
      status.textContent=message;email.value='';confirm.value='';onRequested(message);
    }catch(error){if(root.isConnected)status.textContent=error.message;}
    finally{button.disabled=false;}
  });
}
