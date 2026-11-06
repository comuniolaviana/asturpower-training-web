// Fictitious sports data for interaction tests and the development-only preview.
export const PERSON='22222222-2222-4222-8222-222222222222',COACH='11111111-1111-4111-8111-111111111111',ACTIVITY='33333333-3333-4333-8333-333333333333';
export function simpleGarminClient({actor=PERSON,denied=false,series=false}={}){
 const calls=[],writes=[];let currentActor=actor;
 const started=new Date();started.setHours(10,0,0,0);
 const activity={id:ACTIVITY,athlete_id:PERSON,title:'Salida de prueba',sport:'cycling',started_at:started.toISOString(),duration_seconds:3600,distance_meters:32000,elevation_gain_meters:370,avg_heart_rate:137,avg_power_watts:180,source:'garmin_export'};
 const tables={activities:[activity],planned_workouts:[],garmin_original_archives:[{owner_id:PERSON,archive_id:'a'.repeat(64),filename:'exportacion_privada.zip',byte_size:332328720,status:'ready'}],garmin_fit_analysis:[],athlete_physiology:[],garmin_activity_series:[],garmin_original_catalog:[],garmin_fit_scan_progress:[],garmin_fit_diagnostics:[],coach_athletes:[{athlete_id:PERSON,coach_id:COACH,status:'active'}],profiles:[{user_id:PERSON,display_name:'Ciclista de prueba'},{user_id:COACH,display_name:'Entrenador de prueba'}],athlete_coach_fit_sharing:[{athlete_id:PERSON,coach_id:COACH,consented_at:'2026-11-01',series_enabled:true}]};
 if(series){tables.garmin_fit_analysis=[{athlete_id:PERSON,activity_id:ACTIVITY,sport:'cycling',fit_started_at:started.toISOString(),duration_seconds:3600,normalized_power_watts:195,power_coverage:1,sample_count:3600}];tables.athlete_physiology=[{athlete_id:PERSON,sport:'cycling',effective_date:'2020-01-01',ftp:240,power_zone_bounds:[55,75,90,105,120],created_at:'2020-01-01T00:00:00Z'}];}
 const client={auth:{getUser:async()=>({data:{user:{id:currentActor}},error:null}),getSession:async()=>({data:{session:{access_token:'synthetic-session'}}})},
 from(table){
  calls.push(table);let filters=[],one=false,count=false,head=false;
  const b={select(_fields,options){count=options?.count==='exact';head=options?.head===true;return b;},eq(k,v){filters.push(r=>r[k]===v);return b;},in(k,values){filters.push(r=>values.includes(r[k]));return b;},gte(k,v){filters.push(r=>r[k]>=v);return b;},lt(k,v){filters.push(r=>r[k]<v);return b;},order(){return b;},limit(){return b;},maybeSingle(){one=true;return b;},single(){one=true;return b;},range(){return b;},insert(){writes.push(table);return b;},update(){writes.push(table);return b;},
   then(resolve){let rows=(tables[table]||[]).filter(r=>filters.every(f=>f(r)));if(denied&&['activities','garmin_fit_analysis','garmin_activity_series'].includes(table))rows=[];return Promise.resolve({data:head?null:one?rows[0]||null:rows,error:null,...(count?{count:rows.length}:{})}).then(resolve);}
  };return b;
 }};
 return {client,tables,calls,writes,activity,setActor:id=>{currentActor=id;}};
}
export async function attachSimpleSeries(fixture){
 const fields=['timestamp','power','heartRate','cadence','distance'];
 const start=Date.parse(fixture.activity.started_at);
 const rows=Array.from({length:180},(_,i)=>[new Date(start+i*1000).toISOString(),160+i%60,125+i%25,80+i%12,i*8]);
 const data={version:1,warningCount:0,fields,rows,sessions:[{totalTimerTime:180,sport:'cycling'}],laps:[{totalTimerTime:180,totalDistance:1440}],events:[]};
 const blob=await new Response(new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
 const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');
 fixture.tables.garmin_activity_series=[{athlete_id:PERSON,activity_id:ACTIVITY,sha256:sha,byte_size:blob.size,status:'ready'}];
 fixture.client.storage={from:()=>({download:async()=>({data:blob,error:null})})};return fixture;
}
