// Deliberate per-coach permission for derived FIT sport metrics only.
// The owner-only Garmin ZIP, raw FIT data, file names, GPS and private catalog
// remain inaccessible to coaches.
export async function listActiveCoaches(client,athleteId){
 const auth=await client.auth.getUser();
 if(auth.error||auth.data?.user?.id!==athleteId)throw new Error('La sesión del deportista ha cambiado.');
 const [links,shares]=await Promise.all([
  client.from('coach_athletes').select('coach_id').eq('athlete_id',athleteId).eq('status','active'),
  client.from('athlete_coach_fit_sharing').select('coach_id,consented_at,series_enabled').eq('athlete_id',athleteId)
 ]);
 if(links.error||shares.error)throw new Error('No se pudieron consultar los permisos de tus entrenadores.');
 const ids=(links.data||[]).map(x=>x.coach_id);
 if(!ids.length)return [];
 const names=await client.from('profiles').select('user_id,display_name').in('user_id',ids);
 if(names.error)throw new Error('No se pudieron consultar los nombres de entrenadores.');
 const byId=new Map((names.data||[]).map(p=>[p.user_id,p.display_name]));
 const approved=new Map((shares.data||[]).map(s=>[s.coach_id,s.consented_at]));
 return ids.map(id=>({coach_id:id,name:byId.get(id)||'Entrenador vinculado',shared:approved.has(id),consented_at:approved.get(id)||null,series_enabled:(shares.data||[]).find(s=>s.coach_id===id)?.series_enabled===true}));
}
export async function setCoachSeriesSharing(client,athleteId,coachId,enabled){
 const auth=await client.auth.getUser();
 if(auth.error||auth.data?.user?.id!==athleteId)throw new Error('La sesión del deportista ha cambiado.');
 const result=await client.from('athlete_coach_fit_sharing').update({series_enabled:enabled===true}).eq('athlete_id',athleteId).eq('coach_id',coachId).select('series_enabled').single();
 if(result.error||!result.data)throw new Error('No se pudo actualizar el permiso de las curvas deportivas.');
}
export async function setCoachFitSharing(client,athleteId,coachId,share){
 const auth=await client.auth.getUser();
 if(auth.error||auth.data?.user?.id!==athleteId)throw new Error('La sesión del deportista ha cambiado.');
 const links=await client.from('coach_athletes').select('coach_id').eq('athlete_id',athleteId).eq('coach_id',coachId).eq('status','active').limit(1);
 if(links.error||links.data?.length!==1)throw new Error('No existe una vinculación activa con este entrenador.');
 const query=client.from('athlete_coach_fit_sharing');
 if(share){
  const result=await query.insert({athlete_id:athleteId,coach_id:coachId});
  if(result.error&&result.error.code!=='23505')throw new Error('No se pudo habilitar el acceso deportivo.');
 }else{
  const result=await query.delete().eq('athlete_id',athleteId).eq('coach_id',coachId);
  if(result.error)throw new Error('No se pudo revocar el acceso deportivo.');
 }
}
export function mountCoachFitSharing({root,client,athleteId}){
 const doc=root.ownerDocument,create=(tag,txt,cls)=>{const e=doc.createElement(tag);if(txt!==undefined)e.textContent=txt;if(cls)e.className=cls;return e;};
 const wrap=create('section',undefined,'garmin-fit-sharing');
 wrap.append(create('h4','Compartir análisis deportivos con tu entrenador'),
  create('p','Una vinculación activa permite al entrenador consultar tu perfil deportivo, resúmenes de actividades y planificación. Aquí decides, por separado, si también compartes análisis y curvas detalladas. El ZIP completo, los archivos FIT y el GPS permanecen privados. Puedes retirar estos permisos o desvincular al entrenador.'));
 const status=create('p','','garmin-note');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const list=create('div');wrap.append(status,list);root.append(wrap);
 let closed=false,busy=false;
 const live=()=>!closed&&wrap.isConnected;
 async function reload(){
  if(busy||!live())return;
  status.textContent='Consultando entrenadores activos y permisos…';
  try{
   const coaches=await listActiveCoaches(client,athleteId);
   if(!live())return;list.replaceChildren();
   if(!coaches.length){status.textContent='No tienes ningún entrenador vinculado activo.';return;}
   status.textContent='El acceso a datos detallados es voluntario y revocable.';
   for(const coach of coaches){
    const row=create('div',undefined,'garmin-fit-share-row'),label=create('label'),box=create('input'),name=create('span');
    row.append(create('strong',coach.name));
    box.type='checkbox';box.checked=coach.shared;name.textContent='Compartir análisis de rendimiento (NP, IF, TSS y evolución)';label.append(box,name);
    row.append(label);list.append(row);
    const seriesLabel=create('label'),seriesBox=create('input');seriesBox.type='checkbox';seriesBox.checked=coach.series_enabled;seriesBox.disabled=!coach.shared;
    seriesLabel.append(seriesBox,create('span','Compartir también curvas, vueltas y registros deportivos por actividad. No incluye GPS ni el archivo completo de la cuenta.'));row.append(seriesLabel);
    seriesBox.addEventListener('change',async()=>{
     if(busy){seriesBox.checked=!seriesBox.checked;return;}busy=true;seriesBox.disabled=true;
     try{await setCoachSeriesSharing(client,athleteId,coach.coach_id,seriesBox.checked);if(live())status.textContent=seriesBox.checked?'Curvas deportivas autorizadas para este entrenador.':'Permiso de curvas retirado.';}
     catch(error){seriesBox.checked=!seriesBox.checked;if(live())status.textContent=error.message;}
     finally{busy=false;seriesBox.disabled=!box.checked;}
    });
    box.addEventListener('change',async()=>{
     if(busy){box.checked=!box.checked;return;}
     const desired=box.checked;busy=true;box.disabled=true;
     status.textContent=desired?'Autorizando acceso a análisis deportivos…':'Revocando acceso a análisis deportivos…';
     try{await setCoachFitSharing(client,athleteId,coach.coach_id,desired);
      if(live()){seriesBox.disabled=!desired;if(!desired)seriesBox.checked=false;status.textContent=desired?'Permiso deportivo activado para este entrenador.':'Permiso deportivo retirado. El entrenador ya no puede consultar tus métricas FIT.';}
     }catch(error){box.checked=!desired;if(live())status.textContent=error.message;}
     finally{busy=false;box.disabled=false;}
    });
   }
  }catch(error){if(live())status.textContent=error.message;}
 }
 void reload();return ()=>{closed=true;};
}
