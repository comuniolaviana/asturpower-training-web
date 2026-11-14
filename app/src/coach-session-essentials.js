// Resumen de una sesión para el entrenador. No inventa medidas que falten
// y mantiene diferenciados los datos originales Garmin y los recalculados.
const num=(value,min=0)=>{
 if(value===null||value===undefined||typeof value==='boolean'||String(value).trim()==='')return null;
 const n=Number(value);
 return Number.isFinite(n)&&n>=min?n:null;
};
const from={garmin_recorded:'Registrado por Garmin',garmin_session_ftp:'FTP registrado en Garmin',
 garmin_session_calculated:'Calculado desde Garmin',historical_ftp:'FTP histórico confirmado'};
const item=(key,label,value,unit,source)=>({key,label,value,unit,source:value===null?'Dato no disponible':source});

export function coachSessionEssentials({activity={},metric=null,physiology=null,series=null}={}){
 const session=series?.sessions?.[0]||{};
 const ftp=num(physiology?.ftp,1),deviceFtp=num(metric?.device_ftp_watts,1)??num(session.thresholdPower,1);
 const deviceIf=num(metric?.device_intensity_factor)??num(session.intensityFactor);
 const deviceTss=num(metric?.device_tss)??num(session.trainingStressScore);
 const derivedIf=num(metric?.intensity_factor),derivedTss=num(metric?.tss);
 const np=num(metric?.normalized_power_watts)??num(session.normalizedPower);
 const npSource=metric?.normalized_power_watts!==null&&metric?.normalized_power_watts!==undefined
  ?metric?.np_method==='device'?'Registrado por Garmin':metric?.np_method==='records_1s'?'Calculado desde muestras FIT':'Fuente NP no determinada'
  :'Registrado en la sesión Garmin';
 const entries=[
  item('ftp','FTP confirmado',ftp,'W',physiology?.effective_date?'Vigente desde '+physiology.effective_date:'FTP indicado en la ficha'),
  item('ftpGarmin','FTP de Garmin',deviceFtp,'W','Dato de esta sesión, no sustituye al FTP confirmado'),
  item('np','Potencia normalizada (NP)',np,'W',npSource),
  item('if','Factor de intensidad (IF)',derivedIf??deviceIf,'',derivedIf!==null?(from[metric?.if_source]||'Origen de cálculo no indicado'):'Registrado por Garmin'),
  item('tss','Carga de entrenamiento (TSS)',derivedTss??deviceTss,'',derivedTss!==null?(from[metric?.tss_source]||'Origen de cálculo no indicado'):'Registrado por Garmin'),
  item('kj','Trabajo mecánico',num(session.totalWork)===null?null:num(session.totalWork)/1000,'kJ','Trabajo registrado en el archivo FIT'),
  item('cadence','Cadencia media',num(session.avgCadence),'rpm','Registrada en la sesión Garmin'),
  item('heartRate','Frecuencia cardíaca media',num(activity?.avg_heart_rate,1)??num(session.avgHeartRate,1),'lpm','Resumen de la actividad'),
  item('avgPower','Potencia media',num(activity?.avg_power_watts)??num(session.avgPower),'W','Resumen de la actividad')
 ];
 const deviation=derivedTss!==null&&deviceTss!==null&&Math.abs(derivedTss-deviceTss)>Math.max(5,deviceTss*0.05)
  ?'El TSS calculado difiere del TSS registrado por Garmin. Revisa el FTP vigente, la duración y el origen del cálculo; no se ha cambiado ninguno.':null;
 return {entries,originalGarmin:{ftp:deviceFtp,if:deviceIf,tss:deviceTss},deviation};
}
