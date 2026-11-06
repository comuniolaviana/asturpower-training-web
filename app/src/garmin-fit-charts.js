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
