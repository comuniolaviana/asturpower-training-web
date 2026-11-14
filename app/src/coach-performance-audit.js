// Auditoría del motor deportivo visible al entrenador. No compara con
// TrainingPeaks sin una referencia aportada por el deportista y no altera datos.
const valid=(v,min=0)=>v!==null&&v!==undefined&&typeof v!=='boolean'&&String(v).trim()!==''&&
 Number.isFinite(Number(v))&&Number(v)>=min;
const differs=(a,b,abs=5,rel=.05)=>Math.abs(a-b)>Math.max(abs,Math.abs(b)*rel);

export function auditCoachActivity({activity={},metric=null,physiology=null,seriesAvailable=false,seriesAllowed=false}={}){
 const cycling=activity.sport==='cycling';
 const issues=[],notes=[];
 let mismatched=false;
 const issue=message=>{if(!issues.includes(message))issues.push(message);};
 if(!metric){
  issue('No hay análisis FIT enlazado de forma verificable a esta actividad.');
 }else{
  if(cycling){
   if(!valid(metric.normalized_power_watts))issue('Falta potencia normalizada (NP) verificable.');
   if(valid(metric.normalized_power_watts)&&valid(metric.duration_seconds,1)&&Number(metric.duration_seconds)<1200)
    notes.push('Precaución: la NP en esfuerzos de menos de 20 minutos tiene limitaciones para representar la carga fisiológica; no usarla aisladamente para evaluar rendimiento.');
   if(!valid(metric.intensity_factor))issue('Falta factor de intensidad (IF).');
   if(!valid(metric.tss))issue('Falta carga TSS: no debe contabilizarse como descanso.');
   if(valid(metric.tss)&&!valid(physiology?.ftp,1)&&metric.tss_source!=='historical_ftp')
    notes.push('TSS disponible de Garmin o calculado a partir de datos Garmin, pero sin FTP histórico confirmado por el entrenador.');
   if(valid(metric.tss)&&metric.tss_source==='historical_ftp'&&!valid(physiology?.ftp,1))
    issue('El TSS indica FTP histórico, pero no se encuentra su versión fechada.');
   const tss=valid(metric.tss)?Number(metric.tss):null,garmin=valid(metric.device_tss)?Number(metric.device_tss):null;
   if(tss!==null&&garmin!==null&&metric.tss_source!=='garmin_recorded'&&differs(tss,garmin)){
    mismatched=true;
    issue('TSS calculado y TSS original de Garmin difieren significativamente: comprobar FTP, duración y método.');
   }
   const np=valid(metric.normalized_power_watts)?Number(metric.normalized_power_watts):null;
   const ftp=valid(physiology?.ftp,1)?Number(physiology.ftp):null;
   const ifValue=valid(metric.intensity_factor)?Number(metric.intensity_factor):null;
   if(np!==null&&ftp!==null&&ifValue!==null&&metric.if_source==='historical_ftp'&&Math.abs(np/ftp-ifValue)>.02){
    mismatched=true;
    issue('IF calculado y NP/FTP histórico no coinciden: revisar los datos.');
   }
   const duration=valid(metric.duration_seconds,1)?Number(metric.duration_seconds):null;
   if(duration!==null&&ifValue!==null&&tss!==null&&metric.if_source===metric.tss_source&&
    ['historical_ftp','garmin_session_calculated'].includes(metric.tss_source)&&
    differs(tss,duration/3600*ifValue**2*100)){
    mismatched=true;
    issue('El TSS no concuerda con la duración y el IF usados para calcularlo.');
   }
  }else if(!valid(metric.tss))notes.push('Esta modalidad aún no tiene un método de carga validado; no se atribuye TSS automáticamente.');
  if(seriesAllowed&&!seriesAvailable)issue('Faltan las series deportivas compartibles para comprobar las curvas y los intervalos.');
 }
 if(seriesAllowed&&!metric&&!seriesAvailable)notes.push('Las curvas no pueden verificarse hasta enlazar el FIT.');
 if(!seriesAllowed)notes.push('Las curvas requieren permiso específico del deportista; no se consideran un fallo técnico.');
 const status=mismatched?'revisar':issues.length?'incompleta':'base_disponible';
 const label=status==='revisar'?'Revisar discrepancias':status==='incompleta'?'Datos pendientes':'Base disponible';
 return {status,label,issues,notes,hasTss:valid(metric?.tss),hasNp:valid(metric?.normalized_power_watts),
  // Disponibilidad interna, NO certificación de coincidencia con TrainingPeaks.
  comparableWithTrainingPeaks:false};
}
