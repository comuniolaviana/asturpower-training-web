/* Objetivos explícitos: todavía NO son archivos Garmin ni controlan dispositivos. */
export const STEP_PHASES = Object.freeze({
  warmup:'Calentamiento', work:'Trabajo', recovery:'Recuperación', cooldown:'Vuelta a la calma',
});
export const STEP_TARGETS = Object.freeze({
  free:'Libre / sensaciones', ftp_pct:'Potencia (% FTP)', watts:'Potencia (W)',
  hr_bpm:'Frecuencia cardíaca (ppm)', rpe:'Esfuerzo percibido (RPE)',
});
const RANGES={ftp_pct:[1,200],watts:[1,2500],hr_bpm:[40,240],rpe:[1,10]};
export function validateSteps(raw){
  if(raw==null || (Array.isArray(raw)&&!raw.length))return null;
  if(!Array.isArray(raw) || raw.length>30)throw new Error('Añade entre 1 y 30 bloques.');
  const steps=raw.map((step,index)=>{
    const n=index+1;
    if(!step || typeof step!=='object' || Array.isArray(step))throw new Error('Bloque '+n+' no válido.');
    const phase=String(step.phase||'');
    const target_type=String(step.target_type||'');
    if(!Object.hasOwn(STEP_PHASES,phase))throw new Error('Selecciona el tipo del bloque '+n+'.');
    if(!Object.hasOwn(STEP_TARGETS,target_type))throw new Error('Selecciona el objetivo del bloque '+n+'.');
    const seconds=Number(step.duration_seconds);
    if(!Number.isInteger(seconds)||seconds<30||seconds>21600 || seconds%30!==0)
      throw new Error('La duración del bloque '+n+' debe ser múltiplo de 30 segundos, de 0,5 a 360 min.');
    let low=null,high=null;
    if(target_type!=='free'){
      const bounds=RANGES[target_type];
      if(step.low===''||step.high===''||step.low==null||step.high==null)
        throw new Error('Completa el objetivo mínimo y máximo del bloque '+n+'.');
      low=Number(step.low);high=Number(step.high);
      if(!Number.isInteger(low)||!Number.isInteger(high)||low<bounds[0]||high>bounds[1]||high<low)
        throw new Error('El rango de intensidad del bloque '+n+' no es válido.');
    }
    return {phase,duration_seconds:seconds,target_type,low,high};
  });
  if(stepsTotalSeconds(steps)>86400)throw new Error('La sesión no puede superar 24 horas.');
  return steps;
}
export function stepsTotalSeconds(steps){
  return (steps||[]).reduce((sum,step)=>sum+(Number(step.duration_seconds)||0),0);
}
export function describeStep(step){
  if(!step||typeof step!=='object')return 'Bloque de entrenamiento';
  const phase=STEP_PHASES[step.phase]||'Bloque';
  const seconds=Number(step.duration_seconds)||0;
  const duration=seconds%60===0?seconds/60+' min':(seconds/60).toLocaleString('es-ES',{maximumFractionDigits:1})+' min';
  const target=STEP_TARGETS[step.target_type]||'Libre';
  return phase+' · '+duration+(step.target_type && step.target_type!=='free'?' · '+target+': '+step.low+'–'+step.high:'');
}
