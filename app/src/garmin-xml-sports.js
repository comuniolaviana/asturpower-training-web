// TCX/GPX fallback: retain measured sport fields; never synthesize watts or GPS.
const elements=(node,name)=>[...node.getElementsByTagName('*')].filter(e=>e.localName===name);
const text=(node,name)=>elements(node,name)[0]?.textContent?.trim();
const number=(node,name)=>{const raw=text(node,name);return raw!==undefined&&raw!==''&&Number.isFinite(Number(raw))?Number(raw):null;};
export function decodeSportXml(bytes,kind,Parser=globalThis.DOMParser){
 if(typeof Parser!=='function'||bytes.length>8*1024*1024)throw new Error('XML deportivo fuera del límite de lectura.');
 const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 if(/<!DOCTYPE|<!ENTITY/i.test(source))throw new Error('XML con declaraciones no admitidas.');
 const xml=new Parser().parseFromString(source,'application/xml');
 if(elements(xml,'parsererror').length)throw new Error('XML deportivo no válido.');
 let points=[],session={},laps=[];
 if(kind==='TCX'){
  const activities=elements(xml,'Activity');if(activities.length!==1)return {messages:{sessionMesgs:[]}};
  const a=activities[0],sport=String(a.getAttribute('Sport')||'').toLowerCase();
  session.sport=sport.includes('bik')?'cycling':sport.includes('run')?'running':sport.includes('swim')?'swimming':'other';
  points=elements(a,'Trackpoint').map(p=>{
   const r={timestamp:new Date(text(p,'Time'))};
   for(const [key,name] of [['power','Watts'],['cadence','Cadence'],['speed','Speed'],['altitude','AltitudeMeters'],['distance','DistanceMeters']]){const v=number(p,name);if(v!==null)r[key]=v;}
   const hr=elements(p,'HeartRateBpm')[0];if(hr){const value=number(hr,'Value');if(value!==null)r.heartRate=value;}return r;
  });
  laps=elements(a,'Lap').map(l=>{
   const lap={startTime:new Date(l.getAttribute('StartTime')),totalTimerTime:number(l,'TotalTimeSeconds'),totalDistance:number(l,'DistanceMeters')};
   for(const [key,name] of [['maxSpeed','MaximumSpeed'],['totalCalories','Calories'],['avgCadence','Cadence']]){const v=number(l,name);if(v!==null)lap[key]=v;}
   for(const [key,name] of [['avgHeartRate','AverageHeartRateBpm'],['maxHeartRate','MaximumHeartRateBpm']]){const block=elements(l,name)[0],v=block?number(block,'Value'):null;if(v!==null)lap[key]=v;}
   return lap;
  });
  session.startTime=new Date(text(a,'Id')||points[0]?.timestamp);
  const timers=laps.map(l=>l.totalTimerTime).filter(v=>v!==null),distances=laps.map(l=>l.totalDistance).filter(v=>v!==null);
  session.totalTimerTime=timers.length?timers.reduce((a,b)=>a+b,0):null;
  if(distances.length)session.totalDistance=distances.reduce((a,b)=>a+b,0);
 }else if(kind==='GPX'){
  const tracks=elements(xml,'trk');if(tracks.length!==1)return {messages:{sessionMesgs:[]}};
  const t=tracks[0],type=String(text(t,'type')||'').toLowerCase();session.sport=type.includes('cycl')||type.includes('bik')?'cycling':type.includes('run')?'running':type.includes('walk')?'walking':'other';
  points=elements(t,'trkpt').map(p=>{const r={timestamp:new Date(text(p,'time'))};
   for(const [key,name] of [['power','power'],['heartRate','hr'],['cadence','cad'],['altitude','ele'],['speed','speed']]){const v=number(p,name);if(v!==null)r[key]=v;}return r;});
  session.startTime=points[0]?.timestamp;
 }else throw new Error('Formato deportivo XML no admitido.');
 const dated=points.filter(p=>Number.isFinite(p.timestamp?.getTime()));
 if(!Number.isFinite(session.startTime?.getTime()))session.startTime=dated[0]?.timestamp;
 if(session.totalTimerTime===null||session.totalTimerTime===undefined)session.totalTimerTime=dated.length>1?(dated.at(-1).timestamp-dated[0].timestamp)/1000:0;
 return {messages:{sessionMesgs:[session],recordMesgs:points,lapMesgs:laps},warningCount:0};
}
