import { randomBytes } from 'node:crypto';
import { encryptedSecret } from '../netlify/lib/garmin-oauth-service.mjs';
import { GARMIN } from '../netlify/lib/garmin-protocol.mjs';

export const IDs={coach:'c0000000-0000-4000-8000-000000000001',otherCoach:'c0000000-0000-4000-8000-000000000002',
  athlete:'a0000000-0000-4000-8000-000000000001',otherAthlete:'a0000000-0000-4000-8000-000000000002',
  workout:'d0000000-0000-4000-8000-000000000001'};
export function garminFixture(options={}){
  const env={ASTURPOWER_APP_ENABLED:'true',ASTURPOWER_GARMIN_ENABLED:'true',
    ASTURPOWER_GARMIN_TRAINING_ENABLED:'true',ASTURPOWER_GARMIN_ACTIVITY_ENABLED:'true',
    SUPABASE_URL:'https://drnefgxdrultneeodtsy.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_simulated',
    SUPABASE_SECRET_KEY:'sb_secret_simulated',GARMIN_CLIENT_ID:'simulated-client',GARMIN_CLIENT_SECRET:'simulated-secret',
    GARMIN_REDIRECT_URI:'https://asturpower-training-dev.netlify.app/.netlify/functions/garmin-callback',
    GARMIN_TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64url')};
  const workout={id:IDs.workout,coach_id:IDs.coach,athlete_id:IDs.athlete,title:'Prueba simulada de ciclismo',
    sport:'cycling',status:'planned',scheduled_date:'2026-11-05',coach_notes:'Datos ficticios',steps:[
      {phase:'warmup',target_type:'free',duration_seconds:600,low:null,high:null},
      {phase:'work',target_type:'ftp_pct',duration_seconds:1200,low:80,high:90},
      {phase:'cooldown',target_type:'free',duration_seconds:300,low:null,high:null}]};
  const connections=new Map();
  for(const [athlete_id,garmin_user_id] of [[IDs.athlete,'garmin-simulated-1'],[IDs.otherAthlete,'garmin-simulated-2']]){
    connections.set(athlete_id,{athlete_id,garmin_user_id,permissions:['WORKOUT_IMPORT','ACTIVITY_EXPORT'],
      connected_at:'2026-11-01T00:00:00Z',permissions_changed_at:0,
      access_token_ciphertext:encryptedSecret('simulated-access',env.GARMIN_TOKEN_ENCRYPTION_KEY,'access:'+athlete_id),
      refresh_token_ciphertext:encryptedSecret('simulated-refresh',env.GARMIN_TOKEN_ENCRYPTION_KEY,'refresh:'+athlete_id),
      access_expires_at:new Date(Date.now()+3600000).toISOString(),refresh_expires_at:new Date(Date.now()+86400000).toISOString()});
  }
  const locks=new Map(),jobs=new Map(),inbox=new Map(),activities=new Map(),calls=[],reserved=[],remoteSchedules=[];
  let linked=true,remoteWorkoutCount=0,remoteScheduleCount=0;
  const repo={
    async lease(key,owner){if(locks.has(key))return false;locks.set(key,owner);return true;},
    async release(key,owner){if(locks.get(key)===owner)locks.delete(key);},
    async reserve(id,oauth){reserved.push({id,oauth});},
    async workout(id){return id===workout.id?structuredClone(workout):null;},
    async activeLink(coach,athlete){return linked&&coach===IDs.coach&&athlete===IDs.athlete;},
    async connection(id){return structuredClone(connections.get(id)||null);},
    async byGarminId(id){return structuredClone([...connections.values()].find(c=>c.garmin_user_id===id)||null);},
    async tokens(id,previous,patch){if(connections.get(id).refresh_token_ciphertext!==previous)throw new Error('CAS conflict');Object.assign(connections.get(id),patch);},
    async permissions(id,permissions,changedAt){const row=[...connections.values()].find(c=>c.garmin_user_id===id);
      if(row&&row.permissions_changed_at<=changedAt)Object.assign(row,{
        permissions:row.permissions_changed_at===changedAt?permissions.filter(p=>row.permissions.includes(p)):permissions,
        permissions_changed_at:changedAt});},
    async deregister(id){for(const [key,row] of connections)if(row.garmin_user_id===id)connections.delete(key);},
    async exportJob(id){return structuredClone(jobs.get(id)||null);},
    async createExport(record){if(jobs.has(record.planned_workout_id))throw new Error('Duplicate job');jobs.set(record.planned_workout_id,{...record});return structuredClone(record);},
    async saveExport(id,patch){const row=[...jobs.values()].find(j=>j.id===id);if(!row)throw new Error('Missing job');Object.assign(row,patch);},
    async enqueue(record){if(!inbox.has(record.id))inbox.set(record.id,{...record});},
    async claimInbox(){return [...inbox.values()].filter(r=>r.status==='pending').slice(0,5).map(r=>{r.status='processing';r.attempts++;return {...r};});},
    async progressInbox(id,cursor){inbox.get(id).cursor=cursor;},
    async deferInbox(record,cursor){Object.assign(inbox.get(record.id),{cursor,status:'pending',attempts:0});},
    async finishInbox(id){Object.assign(inbox.get(id),{status:'done',payload_ciphertext:null});},
    async failInbox(record,code){Object.assign(inbox.get(record.id),{status:record.attempts>=5?'failed':'pending',last_error:code});},
    async importActivity(record,receivedAt){
      const key=record.athlete_id+':'+record.external_id,old=activities.get(key);
      if(old&&old.receivedAt>receivedAt)return;
      const merged={...record,receivedAt};
      for(const k of ['distance_meters','elevation_gain_meters','avg_heart_rate'])if(merged[k]===null&&old)merged[k]=old[k];
      activities.set(key,merged);
    },
  };
  const fetcher=async(url,request)=>{
    calls.push({url,method:request.method,body:request.body?new URL(url).pathname.includes('/oauth/')?'[redacted]':JSON.parse(request.body):null});
    if(options.intercept){const response=await options.intercept(url,request,{remoteSchedules});if(response)return response;}
    if(url===GARMIN.permissions)return Response.json({permissions:options.permissions||['WORKOUT_IMPORT','ACTIVITY_EXPORT']});
    if(url===GARMIN.token)return Response.json({access_token:'simulated-access-rotated',refresh_token:'simulated-refresh-rotated',expires_in:86400,refresh_token_expires_in:7775998});
    if(url===GARMIN.createWorkout){remoteWorkoutCount++;return Response.json({workoutId:987650+remoteWorkoutCount});}
    if(url===GARMIN.schedules){
      remoteScheduleCount++;const row={...JSON.parse(request.body),scheduleId:555000+remoteScheduleCount};remoteSchedules.push(row);
      return options.schedule204?new Response(null,{status:204}):Response.json(row);
    }
    if(url.startsWith('https://apis.garmin.com/training-api/schedule?'))return Response.json(remoteSchedules);
    throw new Error('Network forbidden in fixture');
  };
  return {env,repo,workout,connections,jobs,inbox,activities,calls,reserved,fetcher,
    actor:{id:IDs.coach,roles:['coach']},unlink(){linked=false;},
    get sent(){return {workouts:remoteWorkoutCount,schedules:remoteScheduleCount};}};
}
export const activityBody=(userId='garmin-simulated-1',activityId='123456789')=>({activities:[{
  userId,activityId,summaryId:activityId,activityType:'CYCLING',activityName:'Actividad simulada',
  startTimeInSeconds:1793692800,durationInSeconds:2100,distanceInMeters:0,averageHeartRateInBeatsPerMinute:135,
  startingLatitudeInDegree:43,samples:[{latitudeInDegree:43,longitudeInDegree:-5}],userAccessToken:'simulated-do-not-store',
}]});
