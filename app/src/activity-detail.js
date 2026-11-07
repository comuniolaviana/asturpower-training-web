import {resolveHistoricalTss,ftpForDate,activityCalendarDate,loadSourceLabel} from './garmin-fit-analysis.js';
import {loadSportSeries,renderSportSeries} from './garmin-sports-series.js';
const fmt=(n,unit='',digits=1)=>n===null||n===undefined?'—':Number(n).toLocaleString('es-ES',{maximumFractionDigits:digits})+unit;

export async function loadActivityDetail(client,userId,activityId){
 const auth=await client.auth.getUser();
 if(auth.error||auth.data?.user?.id!==userId)throw new Error('La sesión ha cambiado. Vuelve a entrar.');
 // All reads use the current user's session and RLS, never an administrative key.
 const result=await client.from('activities').select('id,athlete_id,title,sport,started_at,duration_seconds,distance_meters,elevation_gain_meters,avg_heart_rate,avg_power_watts,source').eq('id',activityId).maybeSingle();
 if(result.error||!result.data)throw new Error('Esta actividad no está disponible o ya no tienes permiso para consultarla.');
 const activity=result.data;
 const metricResult=await client.from('garmin_fit_analysis').select('activity_id,sport,fit_started_at,duration_seconds,normalized_power_watts,power_coverage,power_seconds,sample_count,np_method,device_intensity_factor,device_tss,device_ftp_watts').eq('athlete_id',activity.athlete_id).eq('activity_id',activityId).maybeSingle();
 if(metricResult.error)throw new Error('No se han podido consultar los datos deportivos. Inténtalo de nuevo.');
 let metric=null,physiology=[];
 if(metricResult.data){
  const versions=await client.from('athlete_physiology').select('sport,effective_date,ftp,power_zone_bounds,created_at').eq('athlete_id',activity.athlete_id).eq('sport','cycling').order('effective_date',{ascending:false}).limit(500);
  if(versions.error)throw new Error('No se han podido comprobar los umbrales históricos.');
  physiology=versions.data||[];metric=resolveHistoricalTss(metricResult.data,physiology);
 }
 const series=await loadSportSeries(client,userId,activity.athlete_id,activityId);
 const current=await client.auth.getUser();if(current.error||current.data?.user?.id!==userId)throw new Error('La sesión ha cambiado.');
 return {activity,metric,series,historical:ftpForDate(physiology,activityCalendarDate(activity.started_at)),own:activity.athlete_id===userId};
}

export function mountActivityDetail({root,client,userId,activityId}){
 const doc=root.ownerDocument,el=(tag,text,cls)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 let closed=false;root.replaceChildren();const status=el('p','Cargando actividad…','ap-status');status.setAttribute('role','status');root.append(status);
 void loadActivityDetail(client,userId,activityId).then(({activity:a,metric:m,series,historical,own})=>{
  if(closed||!root.isConnected)return;root.replaceChildren();
  const title=el('h2',a.title);title.id='calendar-activity-title';root.append(title,el('p',new Date(a.started_at).toLocaleString('es-ES',{dateStyle:'long',timeStyle:'short'}),'ap-muted'));
  const metrics=el('dl',undefined,'ap-activity-metrics');
  for(const [label,value] of [['Duración',fmt(a.duration_seconds/60,' min')],['Distancia',fmt(a.distance_meters===null?null:a.distance_meters/1000,' km')],['Desnivel',fmt(a.elevation_gain_meters,' m')],['Pulso medio',fmt(a.avg_heart_rate,' lpm')],['Potencia media',fmt(a.avg_power_watts,' W')],['Potencia normalizada',fmt(m?.normalized_power_watts,' W')],['IF',fmt(m?.intensity_factor,'',3)],['TSS',fmt(m?.tss)]]){
   const box=el('div');box.append(el('dt',label),el('dd',value));metrics.append(box);
  }root.append(metrics);
  if(m&&(m.intensity_factor!==null||m.tss!==null))root.append(el('p','IF: '+loadSourceLabel(m.if_source)+' · TSS: '+loadSourceLabel(m.tss_source)+'.','ap-muted'));
  if(m?.device_ftp_watts)root.append(el('p','FTP registrado en esta sesión Garmin: '+fmt(m.device_ftp_watts,' W')+'. No se aplica a otras fechas.','ap-muted'));
  if(m?.device_tss!==null&&m?.device_tss!==undefined&&m.tss_source==='historical_ftp')root.append(el('p','Valores originales de Garmin: IF '+fmt(m.device_intensity_factor,'',3)+' · TSS '+fmt(m.device_tss)+'. El panel principal muestra el recálculo con el FTP histórico confirmado.','ap-muted'));
  if(m&&m.tss===null)root.append(el('p',m.normalized_power_watts===null&&m.device_intensity_factor==null?'TSS pendiente: el original no aporta datos de intensidad suficientes para calcularlo.':'TSS pendiente: se necesita un FTP verificable vigente en la fecha de esta actividad.','ap-muted'));
  if(series){const curves=el('section');root.append(curves);renderSportSeries(curves,series,{ftp:historical?.ftp,bounds:historical?.power_zone_bounds});}
  else root.append(el('p',a.source==='garmin_api'
   ? 'Garmin ha entregado el resumen de esta actividad, pero AsturPower todavía no ha recibido y preparado su FIT detallado. Por eso no hay curvas de pulso, potencia ni cadencia. No se deben inventar valores a partir de las medias.'
   : own?'El resumen ya está disponible. Si faltan curvas, completa la preparación del historial desde Garmin → Importar historial. Algunas actividades no incluyen registros detallados.'
     :'El resumen ya está disponible. Las curvas aparecerán cuando el deportista las haya preparado y autorizado para ti.','ap-muted'));
 }).catch(error=>{if(!closed&&root.isConnected)status.textContent=error.message;});
 return ()=>{closed=true;};
}
