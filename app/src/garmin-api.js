const messages={
  garmin_training_not_enabled:'El envío a Garmin está preparado, pero todavía no se ha activado.',
  workout_permission_required:'El deportista debe conectar Garmin y conceder permiso para recibir entrenamientos.',
  garmin_not_connected:'El deportista todavía no tiene Garmin conectado.',
  garmin_reauthorization_required:'El deportista debe volver a autorizar su conexión Garmin.',
  garmin_rate_limited:'Garmin ha limitado las peticiones. Espera antes de volver a intentarlo.',
  garmin_export_requires_review:'El resultado del envío es incierto. Hay que comprobarlo antes de repetirlo para evitar duplicados.',
  exported_workout_changed:'Este entrenamiento ya fue enviado con otra versión. Su actualización en Garmin requiere revisión.',
  sport_not_supported:'El envío inicial admite entrenamientos estructurados de ciclismo y carrera.',
  target_not_supported:'Este objetivo no es compatible con el deporte seleccionado para Garmin.',
  structured_steps_required:'Añade bloques estructurados al entrenamiento antes de enviarlo a Garmin.',
};
export async function publishWorkoutToGarmin(client,workoutId,fetcher=fetch){
  const session=await client.auth.getSession(),token=session.data?.session?.access_token;
  if(!token)throw new Error('Inicia sesión de nuevo.');
  const response=await fetcher('/.netlify/functions/garmin-workout',{
    method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({workout_id:workoutId}),
  });
  let body;try{body=await response.json();}catch{}
  if(!response.ok)throw new Error(messages[body?.error]||'No se pudo confirmar el envío a Garmin.');
  if(body?.status!=='scheduled'||body.device_sync_confirmed!==false)throw new Error('No se pudo confirmar la programación en Garmin Connect.');
  return 'Programado en Garmin Connect. Sincroniza tu dispositivo compatible para recibirlo.';
}

export async function loadGarminActivities(client,athleteId){
  const result=await client.from('activities').select('id,title,started_at,sport,duration_seconds,distance_meters')
    .eq('athlete_id',athleteId).in('source',['garmin_api','garmin_export']).order('started_at',{ascending:false}).limit(10);
  if(result.error)throw new Error('No se pudieron consultar las actividades sincronizadas.');
  return Array.isArray(result.data)?result.data:[];
}
