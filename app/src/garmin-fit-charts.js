// FIT raw records remain in the worker. These bounded point sets are VISUAL ONLY.
// Never replace or store the original time series with a downsampled graph.
export const CHART_METRICS=[
 {key:'power',label:'Potencia',unit:'W'},
 {key:'heartRate',label:'Frecuencia cardíaca',unit:'lpm'},
 {key:'cadence',label:'Cadencia',unit:'rpm'},
 {key:'speed',label:'Velocidad',unit:'m/s'},
 {key:'enhancedSpeed',label:'Velocidad mejorada',unit:'m/s'},
 {key:'altitude',label:'Altitud',unit:'m'},
 {key:'enhancedAltitude',label:'Altitud mejorada',unit:'m'},
 {key:'distance',label:'Distancia acumulada',unit:'m'},
];
export function chartPreview(records,maxBins=450){
 if(!Array.isArray(records)||!Number.isSafeInteger(maxBins)||maxBins<20||maxBins>2000)return [];
 const stride=Math.max(1,Math.ceil(records.length/maxBins)),out=[];
 for(const metric of CHART_METRICS){
  const points=[];let observed=0;
  for(let from=0;from<records.length;from+=stride){
   let min=null,max=null;
   for(let at=from;at<Math.min(records.length,from+stride);at++){
    const v=records[at]?.[metric.key];
    if(typeof v!=='number'||!Number.isFinite(v))continue;
    observed++;
    if(!min||v<min.value)min={index:at,value:v};
    if(!max||v>max.value)max={index:at,value:v};
   }
   if(min&&max){if(min.index<=max.index){points.push(min);if(max.index!==min.index)points.push(max);}
    else {points.push(max,min);}}
  }
  if(observed)out.push({...metric,observed,total:records.length,points});
 }
 return out;
}


// Selectable measurements must be explicitly supported sport-only fields.
// Raw GPS, identifiers and private FIT messages never belong in coach overlays.
// Cumulative distance uses the last measured sample of the minute, not an
// arithmetic average of an odometer. Other fields are sampled averages.
export const OVERLAY_METRICS=[
 {key:'heartRate',label:'Pulso',unit:'lpm',min:0},
 {key:'power',label:'Potencia',unit:'W',min:0},
 {key:'cadence',label:'Cadencia',unit:'rpm',min:0},
 {key:'speed',label:'Velocidad',unit:'m/s',min:0},
 {key:'enhancedSpeed',label:'Velocidad mejorada',unit:'m/s',min:0},
 {key:'distance',label:'Distancia acumulada',unit:'m',min:0,aggregation:'last'},
 {key:'altitude',label:'Altitud',unit:'m'},
 {key:'enhancedAltitude',label:'Altitud mejorada',unit:'m'},
 {key:'grade',label:'Pendiente',unit:'%'},
 {key:'temperature',label:'Temperatura',unit:'°C'},
 {key:'respirationRate',label:'Frecuencia respiratoria',unit:'rpm',min:0},
 {key:'verticalSpeed',label:'Velocidad vertical',unit:'m/s'},
 {key:'verticalOscillation',label:'Oscilación vertical',unit:'mm',min:0},
 {key:'stanceTime',label:'Tiempo de contacto',unit:'ms',min:0},
 {key:'stanceTimePercent',label:'Contacto del paso',unit:'%',min:0},
 {key:'verticalRatio',label:'Ratio vertical',unit:'%',min:0},
 {key:'stepLength',label:'Longitud de zancada',unit:'mm',min:0},
 {key:'leftRightBalance',label:'Balance izquierda/derecha',unit:'%',min:0},
 {key:'leftTorqueEffectiveness',label:'Efectividad par izquierdo',unit:'%',min:0},
 {key:'rightTorqueEffectiveness',label:'Efectividad par derecho',unit:'%',min:0},
 {key:'leftPedalSmoothness',label:'Suavidad pedaleo izquierdo',unit:'%',min:0},
 {key:'rightPedalSmoothness',label:'Suavidad pedaleo derecho',unit:'%',min:0},
 {key:'combinedPedalSmoothness',label:'Suavidad pedaleo',unit:'%',min:0},
 {key:'fractionalCadence',label:'Cadencia fraccional',unit:'rpm',min:0},
 {key:'calories',label:'Calorías acumuladas',unit:'kcal',min:0,aggregation:'last'},
];
// Per-minute view is computed only from actual measured, timestamped records.
// It never creates a value for a missing minute or assumes 1 Hz recording.
export const MINUTE_METRICS=[
  {key:'heartRate',label:'Pulso',unit:'lpm'},
  {key:'power',label:'Potencia',unit:'W'},
  {key:'cadence',label:'Cadencia',unit:'rpm'},
];
export function measuredMinutes(records,startTime=null,metrics=MINUTE_METRICS){
 if(!Array.isArray(metrics)||metrics.length>OVERLAY_METRICS.length||metrics.some(metric=>!OVERLAY_METRICS.some(m=>m.key===metric.key)))return [];
 if(!Array.isArray(records)||records.length>250000)return [];
 const parse=value=>value instanceof Date?value.getTime():typeof value==='string'?Date.parse(value):NaN;
 const dated=records.map(r=>({record:r,time:parse(r?.timestamp)}))
  .filter(item=>Number.isFinite(item.time)).sort((a,b)=>a.time-b.time);
 if(!dated.length)return [];
 const requested=parse(startTime),first=Number.isFinite(requested)&&requested<=dated[0].time?requested:dated[0].time;
 const bins=new Map();
 for(const {record,time} of dated){
  const minute=Math.floor((time-first)/60000);
  if(minute<0||minute>2880)continue;
  if(!bins.has(minute))bins.set(minute,{minute,records:0,values:{}});
  const bin=bins.get(minute);bin.records++;
  for(const metric of metrics){
   const {key}=metric,v=record[key];
   if(typeof v!=='number'||!Number.isFinite(v)||(typeof metric.min==='number'&&v<metric.min))continue;
   const field=bin.values[key]??{sum:0,count:0,last:null,lastAt:-Infinity};
   field.sum+=v;field.count++;
   if(time>=field.lastAt){field.last=v;field.lastAt=time;}
   bin.values[key]=field;
  }
 }
 return [...bins.values()].sort((a,b)=>a.minute-b.minute).map(bin=>{
  const row={minute:bin.minute,records:bin.records,counts:{}};
  for(const metric of metrics){
   const {key}=metric,value=bin.values[key];
   row[key]=value?(metric.aggregation==='last'?value.last:value.sum/value.count):null;
   row.counts[key]=value?.count||0;
  }
  return row;
 });
}


// Exact samples inside one selected elapsed minute (0..59.999 seconds).
// No interpolation, time resampling, GPS, or filling absent sensors.
// This is the drilldown beneath the existing minute averages.
export function measuredMinuteSamples(records,startTime=null,minute=0,metrics=OVERLAY_METRICS){
 if(!Array.isArray(records)||records.length>250000||!Number.isSafeInteger(minute)||minute<0||minute>2880||
  !Array.isArray(metrics)||metrics.length>OVERLAY_METRICS.length)return [];
 const allowed=new Map(OVERLAY_METRICS.map(m=>[m.key,m]));
 if(metrics.some(m=>!m||!allowed.has(m.key)))return [];
 const chosen=metrics.map(m=>allowed.get(m.key));
 const parse=value=>value instanceof Date?value.getTime():typeof value==='string'?Date.parse(value):NaN;
 let earliest=Infinity;
 for(const record of records){
  const time=parse(record?.timestamp);if(Number.isFinite(time)&&time<earliest)earliest=time;
 }
 if(!Number.isFinite(earliest))return [];
 const requested=parse(startTime);
 const first=Number.isFinite(requested)&&requested<=earliest?requested:earliest;
 const start=first+minute*60000,end=start+60000,out=[];
 for(const record of records){
  const time=parse(record?.timestamp);if(!Number.isFinite(time)||time<start||time>=end)continue;
  const values={};
  for(const metric of chosen){
   const v=record?.[metric.key];
   values[metric.key]=typeof v==='number'&&Number.isFinite(v)&&(metric.min===undefined||v>=metric.min)?v:null;
  }
  out.push({timestamp:new Date(time).toISOString(),second:Number(((time-start)/1000).toFixed(3)),values});
 }
 return out.sort((a,b)=>a.second-b.second);
}
