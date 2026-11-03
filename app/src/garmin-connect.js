// Garmin Connect: interfaz del deportista. Los secretos se gestionan exclusivamente en Netlify Functions.
const el=(tag,cls,content)=>{
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(content!==undefined)node.textContent=String(content);
  return node;
};
function note(parent,message){
  const status=el('p','garmin-note',message);
  status.setAttribute('role','status');
  parent.append(status);
  return status;
}
async function request(client,path,method='GET'){
  const session=await client.auth.getSession();
  const token=session.data?.session?.access_token;
  if(!token)throw new Error('Inicia sesión de nuevo para conectar Garmin.');
  const response=await fetch('/.netlify/functions/'+path,{
    method,cache:'no-store',credentials:'same-origin',
    headers:{Authorization:'Bearer '+token},
  });
  let body=null;
  try{body=await response.json();}catch{}
  if(!response.ok){
    if(response.status===503)throw new Error('La conexión Garmin todavía no está habilitada.');
    throw new Error('No se pudo completar la operación de Garmin.');
  }
  return body||{};
}
export async function mountGarminPanel({root,client,user,role}){
  if(!root||!client||!user?.id)return;
  root.replaceChildren();
  const wrap=el('section','garmin-module');
  wrap.append(el('h2','','Garmin Connect'));
  wrap.append(el('p','','AsturPower puede planificar entrenamientos; la integración oficial con Garmin se está preparando para sincronizarlos y recibir actividades.'));
  const details=el('div','garmin-overview');
  details.append(el('p','','Envío: Training API · Acceso autorizado por Garmin. Pendiente de prueba real con un dispositivo compatible.'));
  details.append(el('p','','Recepción: Activity API · Pendiente de activar las notificaciones y probar la llegada de actividades.'));
  details.append(el('p','','Histórico anterior a la conexión: no incluido en Garmin Starter; requiere otra vía autorizada.'));
  wrap.append(details);
  const status=note(wrap,'Comprobando disponibilidad de la conexión…');
  root.append(wrap);
  if(role!=='athlete'){
    status.textContent='La conexión la autoriza cada deportista desde su propia cuenta. Un entrenador no puede introducir sus claves Garmin.';
    return;
  }
  let result;
  try{result=await request(client,'garmin-status');}
  catch(error){if(root.isConnected)status.textContent=error.message;return;}
  if(!root.isConnected)return;
  if(!result.configured){
    status.textContent='Garmin está aprobado para AsturPower, pero todavía faltan configurar las credenciales del servidor y la dirección de retorno.';
    return;
  }
  if(result.connected){
    status.textContent='Cuenta Garmin conectada a AsturPower.';
    const p=Array.isArray(result.permissions)?result.permissions:[];
    const perms=el('p','garmin-permissions','Permisos concedidos: '+(p.length?p.join(', '):'pendientes de comprobar'));
    wrap.append(perms);
    if(!p.includes('WORKOUT_IMPORT'))wrap.append(el('p','garmin-warning','No se ha concedido permiso para recibir entrenamientos en Garmin.'));
    if(!p.includes('ACTIVITY_EXPORT'))wrap.append(el('p','garmin-warning','No se ha concedido permiso para compartir actividades.'));
    wrap.append(el('p','garmin-warning','La cuenta está vinculada, pero el envío y la recepción automáticos siguen pendientes de pruebas.'));
    const disconnect=el('button','button','Desconectar Garmin');
    disconnect.type='button';
    disconnect.addEventListener('click',async()=>{
      if(!window.confirm('¿Desconectar Garmin Connect de AsturPower? Se revocará el acceso y se eliminarán las credenciales guardadas.'))return;
      disconnect.disabled=true;
      status.textContent='Revocando autorización de Garmin…';
      try{
        const response=await request(client,'garmin-disconnect','POST');
        if(!response.disconnected)throw new Error('No se pudo desconectar Garmin.');
        await mountGarminPanel({root,client,user,role});
      }catch(error){
        status.textContent=error.message||'No se pudo desconectar Garmin. Inténtalo de nuevo.';
        disconnect.disabled=false;
      }
    });
    wrap.append(disconnect);
    return;
  }
  status.textContent='Conexión disponible: debes autorizar personalmente qué datos compartes con AsturPower.';
  const policy=el('p','garmin-privacy');
  const policyLink=el('a','', 'Información sobre privacidad y datos de Garmin');
  policyLink.href='https://asturpower-training.netlify.app/privacidad-garmin.html';
  policyLink.target='_blank';policyLink.rel='noopener noreferrer';
  policy.append(policyLink);wrap.append(policy);
  const consent=el('label','garmin-optin');
  const checkbox=el('input');checkbox.type='checkbox';
  consent.append(checkbox,el('span','','Acepto voluntariamente conectar mi cuenta Garmin y autorizo el tratamiento de los datos deportivos que seleccione en Garmin Connect, incluidos datos fisiológicos como la frecuencia cardíaca si están disponibles, para el seguimiento de mi entrenamiento por AsturPower y mi entrenador autorizado. He leído la información de privacidad y puedo retirar la autorización.'));
  const start=el('button','button primary','Conectar Garmin Connect');
  start.type='button';start.disabled=true;
  checkbox.addEventListener('change',()=>{start.disabled=!checkbox.checked;});
  start.addEventListener('click',async()=>{
    start.disabled=true;
    status.textContent='Abriendo la autorización oficial de Garmin…';
    try{
      const body=await request(client,'garmin-start','POST');
      const url=new URL(body.authorization_url);
      if(url.protocol!=='https:'||url.origin!=='https://connect.garmin.com'||url.pathname!=='/oauth2Confirm')
        throw new Error('La dirección de autorización Garmin no es válida.');
      window.location.assign(url.toString());
    }catch(error){
      status.textContent=error.message||'No se ha podido iniciar la conexión.';
      start.disabled=!checkbox.checked;
    }
  });
  wrap.append(consent,start);
}
