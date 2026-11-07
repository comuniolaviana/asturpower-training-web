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


// Per-minute view is computed only from actual measured, timestamped records.
// It never creates a value for a missing minute or assumes 1 Hz recording.
export const MINUTE_METRICS=[
  {key:'heartRate',label:'Pulso',unit:'lpm'},
  {key:'power',label:'Potencia',unit:'W'},
  {key:'cadence',label:'Cadencia',unit:'rpm'},
];
export function measuredMinutes(records,startTime=null){
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
  for(const {key} of MINUTE_METRICS){
   const v=record[key];if(typeof v!=='number'||!Number.isFinite(v)||v<0)continue;
   const field=bin.values[key]??{sum:0,count:0};
   field.sum+=v;field.count++;bin.values[key]=field;
  }
 }
 return [...bins.values()].sort((a,b)=>a.minute-b.minute).map(bin=>{
  const row={minute:bin.minute,records:bin.records,counts:{}};
  for(const {key} of MINUTE_METRICS){
   const value=bin.values[key];row[key]=value?value.sum/value.count:null;row.counts[key]=value?.count||0;
  }
  return row;
 });
}
