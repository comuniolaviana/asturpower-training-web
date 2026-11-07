// Share activity sport measurements, never the account ZIP or location/identity fields.
import {chartPreview} from './garmin-fit-charts.js';
import {mountFitCharts} from './garmin-fit-chart-ui.js';
const BUCKET='garmin-sports-series',MAX=4*1024*1024,MAX_JSON=64*1024*1024;
const SPORT_FIELDS=new Set(('timestamp startTime totalElapsedTime totalTimerTime totalDistance totalCalories totalFatCalories totalCycles totalStrides avgSpeed maxSpeed enhancedAvgSpeed enhancedMaxSpeed avgHeartRate maxHeartRate minHeartRate avgCadence maxCadence avgFractionalCadence maxFractionalCadence totalFractionalCycles avgPower maxPower minPower normalizedPower totalWork totalAscent totalDescent avgAltitude maxAltitude minAltitude enhancedAvgAltitude enhancedMaxAltitude enhancedMinAltitude avgTemperature maxTemperature minTemperature avgGrade maxPosGrade maxNegGrade avgPosGrade avgNegGrade totalMovingTime avgPosVerticalSpeed avgNegVerticalSpeed maxPosVerticalSpeed maxNegVerticalSpeed trainingStressScore intensityFactor thresholdPower avgLeftTorqueEffectiveness avgRightTorqueEffectiveness avgLeftPedalSmoothness avgRightPedalSmoothness avgCombinedPedalSmoothness avgLeftPco avgRightPco avgLeftPowerPhase avgLeftPowerPhasePeak avgRightPowerPhase avgRightPowerPhasePeak avgPowerPosition maxPowerPosition avgCadencePosition maxCadencePosition totalStandingTime standCount avgVerticalOscillation avgStanceTimePercent avgStanceTime avgFractionalCadence avgVerticalRatio avgStanceTimeBalance avgStepLength avgRespirationRate maxRespirationRate timeInPowerZone timeInHrZone timeInCadenceZone timeInSpeedZone power heartRate cadence fractionalCadence speed enhancedSpeed altitude enhancedAltitude distance temperature grade verticalSpeed calories cycleLength cycles verticalOscillation stanceTime stanceTimePercent verticalRatio stanceTimeBalance stepLength leftRightBalance leftTorqueEffectiveness rightTorqueEffectiveness leftPedalSmoothness rightPedalSmoothness combinedPedalSmoothness leftPco rightPco leftPowerPhase leftPowerPhasePeak rightPowerPhase rightPowerPhasePeak respirationRate accumulatedPower totalHemoglobinConc saturatedHemoglobinPercent strokeType zone event eventType trigger lapTrigger intensity sport subSport numLaps numLengths totalLengths totalStrokes totalTrainingEffect totalAnaerobicTrainingEffect exerciseLoad aerobicTrainingEffect anaerobicTrainingEffect avgStrokeDistance swimStroke poolLength poolLengthUnit avgActiveCadence avgVam maxVam avgLapTime bestLapIndex eventGroup messageIndex eventTimestamp filteredBpm fractionalTimestamp time256').split(' '));
const scalar=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
function sportMessage(record){
 const out={};
 for(const [key,value] of Object.entries(record||{})){
  if(!SPORT_FIELDS.has(key))continue;
  if(value instanceof Date&&Number.isFinite(value.getTime()))out[key]=value.toISOString();
  else if(scalar(value)!==null)out[key]=value;
  else if(Array.isArray(value)&&value.length<100&&value.every(v=>scalar(v)!==null))out[key]=value;
  else if(['sport','subSport','event','eventType','trigger','lapTrigger','intensity'].includes(key)&&typeof value==='string'&&value.length<80)out[key]=value;
 }
 return out;
}
export function buildSportSeries(decoded){
 const source=decoded.messages.recordMesgs||[];
 const hasLaps=(decoded.messages.lapMesgs||[]).some(l=>typeof l.totalTimerTime==='number'&&l.totalTimerTime>0&&Number.isFinite(new Date(l.startTime).getTime()));
 if((!source.length&&!hasLaps)||source.length>250000)throw new Error('La actividad requiere revisar el tamaño de sus series. El FIT original se conserva.');
 const records=source.map(sportMessage),fields=[...new Set(records.flatMap(r=>Object.keys(r)))].sort();
 return {version:1,warningCount:decoded.warningCount||0,...(decoded.matchMethod==='tcx_exact_metadata'?{matchMethod:'tcx_exact_metadata'}:{}),fields,rows:records.map(r=>fields.map(k=>r[k]??null)),
  sessions:(decoded.messages.sessionMesgs||[]).map(sportMessage),laps:(decoded.messages.lapMesgs||[]).map(sportMessage),
  events:(decoded.messages.eventMesgs||[]).map(sportMessage)};
}
export async function seriesDigest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function bytesOf(stream,max){
 const reader=stream.getReader(),parts=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw new Error('La serie supera el límite seguro de lectura.');parts.push(value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}return bytes;
}
async function assertUser(client,id){const a=await client.auth.getUser();if(a.error||a.data?.user?.id!==id)throw new Error('La sesión ha cambiado.');}
export async function saveSportSeries(client,ownerId,activityId,decoded){
 await assertUser(client,ownerId);
 const data=buildSportSeries(decoded),json=JSON.stringify(data);
 if(new TextEncoder().encode(json).length>MAX_JSON)throw new Error('La actividad supera el tamaño seguro de series.');
 const bytes=await bytesOf(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip')),MAX),sha=await seriesDigest(bytes);
 const reservation=await client.rpc('reserve_activity_series',{p_activity_id:activityId,p_sha:sha,p_bytes:bytes.length});
 if(reservation.error||typeof reservation.data!=='string')throw new Error('No se pudo reservar espacio para las series deportivas.');
 const storage=client.storage.from(BUCKET),sent=await storage.upload(reservation.data,new Blob([bytes]),{contentType:'application/octet-stream',upsert:false});
 if(sent.error){
  if(![sent.error.statusCode,sent.error.code,sent.error.error].some(v=>['409','23505','Duplicate','ResourceAlreadyExists'].includes(String(v))))throw new Error('No se pudo guardar la serie deportiva. Puedes reanudar.');
  const prior=await storage.download(reservation.data);if(prior.error||!prior.data||await seriesDigest(await prior.data.arrayBuffer())!==sha)throw new Error('La copia deportiva existente no supera la verificación.');
 }
 const finish=await client.rpc('complete_activity_series',{p_activity_id:activityId,p_sha:sha});
 if(finish.error)throw new Error('La serie quedó pendiente de verificar. Puedes reanudar.');
 return {bytes:bytes.length,records:data.rows.length};
}
export async function loadSportSeries(client,userId,athleteId,activityId){
 await assertUser(client,userId);
 const result=await client.from('garmin_activity_series').select('sha256,byte_size,status').eq('athlete_id',athleteId).eq('activity_id',activityId).maybeSingle();
 if(result.error)throw new Error('No se pudo comprobar el permiso sobre las series.');
 const meta=result.data;
 if(!meta||meta.status!=='ready')return null;
 if(!/^[a-f0-9]{64}$/.test(meta.sha256)||meta.byte_size>MAX)throw new Error('Referencia deportiva no válida.');
 const response=await client.storage.from(BUCKET).download(athleteId+'/'+activityId+'/'+meta.sha256+'.gz');
 if(response.error||!response.data)throw new Error('No se pudieron recuperar las series autorizadas.');
 const bytes=new Uint8Array(await response.data.arrayBuffer());
 if(bytes.length!==meta.byte_size||await seriesDigest(bytes)!==meta.sha256)throw new Error('La serie deportiva no supera la verificación de integridad.');
 const raw=await bytesOf(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),MAX_JSON);
 const data=JSON.parse(new TextDecoder().decode(raw));
 if(data.version!==1||!Array.isArray(data.fields)||data.fields.length>1000||!Array.isArray(data.rows)||data.rows.length>250000||data.rows.some(r=>!Array.isArray(r)||r.length!==data.fields.length))throw new Error('Formato deportivo no válido.');
 return data;
}
export function renderSportSeries(root,data,{ftp=null,bounds=null}={}){
 const doc=root.ownerDocument,el=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 root.replaceChildren();
 const records=data.rows.map(row=>Object.fromEntries(data.fields.map((key,i)=>[key,row[i]])));
 root.append(el('p',records.length.toLocaleString('es-ES')+' registros conservados · '+data.fields.length+' campos deportivos · '+(data.laps||[]).length+' vueltas. Los huecos permanecen vacíos; no se rellenan muestras.'));
 if(!records.length)root.append(el('p','Este original conserva datos por vueltas, pero no muestras por segundo. Puedes consultar las vueltas y sus medidas; no hay curvas de pulso ni potencia instantánea.'));
 if(data.warningCount)root.append(el('p','Lectura parcial: el SDK comunicó '+data.warningCount+' avisos. Se muestran los campos interpretados; el FIT original conserva el contenido completo.'));
 if(data.matchMethod==='tcx_exact_metadata')root.append(el('p','El deporte indicado en el TCX difiere del calendario. Se ha vinculado por una coincidencia única de fecha exacta, duración y distancia. Se conserva la etiqueta deportiva original del archivo.'));
 const session=data.sessions?.[0]||{},format=(v,unit='',factor=1)=>typeof v==='number'&&Number.isFinite(v)?(v*factor).toLocaleString('es-ES',{maximumFractionDigits:1})+unit:'—';
 const extra=el('dl');extra.className='ap-activity-metrics';
 for(const [label,value,unit,factor] of [['Tiempo en movimiento',session.totalMovingTime,' min',1/60],['Tiempo transcurrido',session.totalElapsedTime,' min',1/60],['Velocidad media',session.enhancedAvgSpeed??session.avgSpeed,' km/h',3.6],['Velocidad máxima',session.enhancedMaxSpeed??session.maxSpeed,' km/h',3.6],['Pulso máximo',session.maxHeartRate,' lpm',1],['Potencia máxima',session.maxPower,' W',1],['Cadencia media',session.avgCadence,' rpm',1],['Cadencia máxima',session.maxCadence,' rpm',1],['Calorías',session.totalCalories,' kcal',1],['Trabajo',session.totalWork,' kJ',1/1000],['Temperatura media',session.avgTemperature,' °C',1],['Ascenso',session.totalAscent,' m',1],['Descenso',session.totalDescent,' m',1]]){
  if(typeof value!=='number'||!Number.isFinite(value))continue;const box=el('div');box.append(el('dt',label),el('dd',format(value,unit,factor)));extra.append(box);
 }if(extra.childElementCount)root.append(el('h3','Más datos de la sesión'),extra);
 const charts=el('div');if(records.length){root.append(charts);mountFitCharts(charts,chartPreview(records),{records,startTime:data.sessions?.[0]?.startTime});}
 const note=charts.querySelector('.garmin-fit-chart-note');if(note)note.textContent='El dibujo conserva los extremos y simplifica puntos. La tabla contiene todos los registros y marcas de tiempo de las series deportivas compartidas.';
 if(!records.length)root.append(el('p','No se calcula tiempo en zonas: el original no contiene muestras instantáneas.'));
 else if(ftp&&bounds){
  const zones=Array(bounds.length+1).fill(0);let missing=0;
  for(let i=0;i<records.length-1;i++){
   const seconds=(Date.parse(records[i+1].timestamp)-Date.parse(records[i].timestamp))/1000,p=records[i].power;
   // Count only measured one-second intervals; never infer time in recording gaps.
   if(seconds!==1||typeof p!=='number'){missing+=Math.max(0,Number.isFinite(seconds)?seconds:0);continue;}
   const percent=p/ftp*100,z=bounds.findIndex(limit=>percent<=limit);zones[z===-1?bounds.length:z]+=seconds;
  }
  root.append(el('p','Zonas según FTP '+ftp+' W vigente en esa fecha. Tiempo comprobable en intervalos de 1 s: '+zones.map((sec,i)=>'Z'+(i+1)+': '+(sec/60).toFixed(1)+' min').join(' · ')+'. Tiempo sin clasificación fiable: '+(missing/60).toFixed(1)+' min.'));
 }else root.append(el('p','Zonas pendientes: introduce el FTP y los límites de zonas vigentes en la fecha de esta actividad.'));
 const details=el('details'),summary=el('summary','Todos los registros deportivos');details.append(summary);
 const host=el('div');host.className='perf-scroll';details.append(host);root.append(details);let page=0;
 function draw(){
  host.replaceChildren();const table=el('table'),head=el('tr');for(const key of data.fields)head.append(el('th',key));const thead=el('thead');thead.append(head);table.append(thead);const body=el('tbody');
  for(const row of data.rows.slice(page*100,(page+1)*100)){const tr=el('tr');for(const value of row)tr.append(el('td',value===null?'—':Array.isArray(value)?value.join(', '):String(value)));body.append(tr);}table.append(body);host.append(el('p','Registros '+(page*100+1)+'–'+Math.min((page+1)*100,data.rows.length)+' de '+data.rows.length),table);
  for(const [label,delta] of [['Anterior',-1],['Siguiente',1]]){const b=el('button',label);b.type='button';b.className='button secondary';b.disabled=page+delta<0||(page+delta)*100>=data.rows.length;b.addEventListener('click',()=>{page+=delta;draw();});host.append(b);}
 }
 if(records.length)draw();else details.remove();
 if(data.laps?.length){
  const d=el('details'),host=el('div');d.className='activity-laps';host.className='perf-scroll';d.append(el('summary','Vueltas e intervalos ('+data.laps.length+')'),host);root.append(d);let page=0;
  function laps(){
   host.replaceChildren();const table=el('table'),head=el('tr');for(const label of ['Vuelta','Duración','Distancia','Potencia media','NP','Pulso medio','Cadencia'])head.append(el('th',label));const thead=el('thead');thead.append(head);table.append(thead);const body=el('tbody');
   for(const [i,lap] of data.laps.slice(page*40,(page+1)*40).entries()){
    const tr=el('tr');for(const value of [page*40+i+1,format(lap.totalTimerTime,' min',1/60),format(lap.totalDistance,' km',1/1000),format(lap.avgPower,' W'),format(lap.normalizedPower,' W'),format(lap.avgHeartRate,' lpm'),format(lap.avgCadence,' rpm')])tr.append(el('td',value));body.append(tr);
   }table.append(body);host.append(table);
   if(data.laps.length>40)for(const [label,delta] of [['Anterior',-1],['Siguiente',1]]){const b=el('button',label);b.type='button';b.className='button secondary';b.disabled=page+delta<0||(page+delta)*40>=data.laps.length;b.addEventListener('click',()=>{page+=delta;laps();});host.append(b);}
  }d.addEventListener('toggle',()=>{if(d.open&&!host.childElementCount)laps();});
 }
 for(const [key,label] of [['laps','Todos los campos de las vueltas'],['sessions','Todos los campos de la sesión']]){
  const d=el('details');d.append(el('summary',label));const pre=el('pre',JSON.stringify(data[key]||[],null,2));pre.className='perf-scroll';d.append(pre);root.append(d);
 }
}
