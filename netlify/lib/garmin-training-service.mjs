import { randomUUID } from 'node:crypto';
import { authenticateActor } from './team-service.mjs';
import { resolvePublicConfig } from '../functions/public-config.mjs';
import { encryptedSecret, decryptedSecret } from './garmin-oauth-service.mjs';
import { createGarminRepository } from './garmin-repository.mjs';
import { withGarminLease } from './garmin-lock.mjs';
export { withGarminLease } from './garmin-lock.mjs';
import { GARMIN, GarminError, demand, uuid, positiveId, digest, json, failure, boundedJson,
  toGarminWorkout, createGarminTransport } from './garmin-protocol.mjs';

export async function usableAccessToken(connection,env,repo,call){
  demand(connection,'garmin_not_connected',409);
  const id=connection.athlete_id;
  if(Date.parse(connection.access_expires_at)>Date.now()+120000)
    return decryptedSecret(connection.access_token_ciphertext,env.GARMIN_TOKEN_ENCRYPTION_KEY,'access:'+id);
  demand(Date.parse(connection.refresh_expires_at)>Date.now()+120000,'garmin_reauthorization_required',409);
  const refresh=decryptedSecret(connection.refresh_token_ciphertext,env.GARMIN_TOKEN_ENCRYPTION_KEY,'refresh:'+id);
  const token=await call(GARMIN.token,{method:'POST',oauth:true,athleteId:id,
    headers:{Authorization:'Basic '+Buffer.from(env.GARMIN_CLIENT_ID+':'+env.GARMIN_CLIENT_SECRET).toString('base64')},
    body:new URLSearchParams({grant_type:'refresh_token',refresh_token:refresh}).toString()});
  demand(typeof token?.access_token==='string'&&token.access_token.length>0&&token.access_token.length<20000
    &&typeof token.refresh_token==='string'&&token.refresh_token.length>0&&token.refresh_token.length<20000
    &&Number.isFinite(Number(token.expires_in))&&Number(token.expires_in)>600
    &&Number.isFinite(Number(token.refresh_token_expires_in))&&Number(token.refresh_token_expires_in)>600,
    'invalid_garmin_token_response');
  await repo.tokens(id,connection.refresh_token_ciphertext,{
    access_token_ciphertext:encryptedSecret(token.access_token,env.GARMIN_TOKEN_ENCRYPTION_KEY,'access:'+id),
    refresh_token_ciphertext:encryptedSecret(token.refresh_token,env.GARMIN_TOKEN_ENCRYPTION_KEY,'refresh:'+id),
    access_expires_at:new Date(Date.now()+(Math.min(Number(token.expires_in),604800)-600)*1000).toISOString(),
    refresh_expires_at:new Date(Date.now()+(Math.min(Number(token.refresh_token_expires_in),8640000)-600)*1000).toISOString(),
    updated_at:new Date().toISOString(),
  });
  return token.access_token;
}
async function findSchedule(call,token,athleteId,date,workoutId){
  const url=new URL('https://apis.garmin.com/training-api/schedule');
  url.searchParams.set('startDate',date);url.searchParams.set('endDate',date);
  const records=await call(url.toString(),{token,athleteId});
  demand(Array.isArray(records),'invalid_garmin_response');
  return records.find(row=>row.workoutId===workoutId&&row.date===date&&positiveId(row.scheduleId));
}
export async function sendPlannedWorkout({repo,env,actor,workoutId,fetcher=fetch}){
  const workout=await repo.workout(workoutId);
  // Return the same code for missing and inaccessible workouts.
  demand(workout&&((actor.roles.includes('athlete')&&actor.id===workout.athlete_id)
    ||(actor.roles.includes('coach')&&actor.id===workout.coach_id
      &&await repo.activeLink(actor.id,workout.athlete_id))),'workout_not_available',404);
  demand(workout.status==='planned','workout_not_planned',409);
  const payload=toGarminWorkout(workout),hash=digest(JSON.stringify({payload,date:workout.scheduled_date}));
  return withGarminLease(repo,workout.athlete_id,async()=>{
    // Re-read authorization after acquiring a durable lock.
    if(actor.id!==workout.athlete_id)demand(await repo.activeLink(actor.id,workout.athlete_id),'workout_not_available',404);
    const current=await repo.workout(workoutId);
    demand(current&&current.athlete_id===workout.athlete_id&&current.coach_id===workout.coach_id
      &&current.status==='planned'&&digest(JSON.stringify({payload:toGarminWorkout(current),date:current.scheduled_date}))===hash,
      'workout_changed',409);
    const connection=await repo.connection(workout.athlete_id);
    demand(connection?.permissions?.includes('WORKOUT_IMPORT'),'workout_permission_required',403);
    const call=createGarminTransport({fetcher,reserve:(id,oauth)=>repo.reserve(id,oauth)});
    const token=await usableAccessToken(connection,env,repo,call);
    const permissionCheckStarted=Math.floor(Date.now()/1000);
    const access=await call(GARMIN.permissions,{token,athleteId:workout.athlete_id});
    demand(Array.isArray(access?.permissions)&&access.permissions.every(p=>typeof p==='string'&&/^[A-Z_]{2,60}$/.test(p)),
      'invalid_garmin_permissions');
    await repo.permissions(connection.garmin_user_id,access.permissions,permissionCheckStarted);
    demand(access.permissions.includes('WORKOUT_IMPORT'),'workout_permission_required',403);
    const effective=await repo.connection(workout.athlete_id);
    demand(effective?.garmin_user_id===connection.garmin_user_id&&effective.permissions?.includes('WORKOUT_IMPORT'),
      'workout_permission_required',403);
    let job=await repo.exportJob(workoutId);
    if(job){
      demand(job.content_hash===hash&&job.athlete_id===workout.athlete_id&&job.coach_id===workout.coach_id,'exported_workout_changed',409);
      if(job.status==='scheduled')return {status:'scheduled',already_sent:true,device_sync_confirmed:false};
      demand(job.status!=='cancelled','garmin_not_connected',409);
      if(job.retry_at&&Date.parse(job.retry_at)>Date.now())throw new GarminError('garmin_rate_limited',429,
        {retryAfter:Math.max(1,Math.ceil((Date.parse(job.retry_at)-Date.now())/1000))});
      // An ambiguous creation must be reconciled manually; never blindly duplicate a POST.
      demand(job.status!=='creating'&&!(job.status==='uncertain'&&!positiveId(job.remote_workout_id)),
        'garmin_export_requires_review',409);
    }else job=await repo.createExport({id:randomUUID(),planned_workout_id:workoutId,athlete_id:workout.athlete_id,
      coach_id:workout.coach_id,content_hash:hash,status:'prepared',scheduled_date:workout.scheduled_date});
    let remote=job.remote_workout_id;
    const ambiguousSchedule=['scheduling','uncertain'].includes(job.status);
    try{
      if(!positiveId(remote)){
        await repo.saveExport(job.id,{status:'creating',last_error:null,retry_at:null});
        const created=await call(GARMIN.createWorkout,{method:'POST',token,athleteId:workout.athlete_id,body:payload});
        if(!positiveId(created?.workoutId))throw new GarminError('invalid_workout_receipt',503,{uncertain:true});
        remote=created.workoutId;
        // Persist the provider ID before any attempt to schedule it.
        await repo.saveExport(job.id,{status:'workout_created',remote_workout_id:remote});
      }
      let scheduled=await findSchedule(call,token,workout.athlete_id,workout.scheduled_date,remote);
      if(!scheduled){
        demand(!ambiguousSchedule,'garmin_export_requires_review',409);
        await repo.saveExport(job.id,{status:'scheduling'});
        const receipt=await call(GARMIN.schedules,{method:'POST',token,athleteId:workout.athlete_id,
          body:{workoutId:remote,date:workout.scheduled_date}});
        if(receipt?.workoutId===remote&&receipt.date===workout.scheduled_date&&positiveId(receipt.scheduleId))scheduled=receipt;
        else scheduled=await findSchedule(call,token,workout.athlete_id,workout.scheduled_date,remote);
        if(!scheduled)throw new GarminError('schedule_not_confirmed',503,{uncertain:true});
      }
      await repo.saveExport(job.id,{status:'scheduled',remote_schedule_id:scheduled.scheduleId,last_error:null,retry_at:null});
      return {status:'scheduled',already_sent:false,device_sync_confirmed:false};
    }catch(error){
      // 429 is a definite rejection; it can be retried later. Network/5xx POSTs are ambiguous.
      const uncertain=ambiguousSchedule||error.uncertain||!(error instanceof GarminError);
      await repo.saveExport(job.id,{status:uncertain?'uncertain':positiveId(remote)?'workout_created':'prepared',
        last_error:error instanceof GarminError?error.code:'storage_unavailable',
        retry_at:error.retryAfter?new Date(Date.now()+error.retryAfter*1000).toISOString():null}).catch(()=>{});
      throw error;
    }
  });
}
export function createGarminWorkoutHandler({env=process.env,verify=authenticateActor,repositoryFactory=createGarminRepository,fetcher=fetch}={}){
  return async request=>{
    try{
      demand(request.method==='POST','method_not_allowed',405);
      const config=resolvePublicConfig(env);
      demand(config&&env.ASTURPOWER_GARMIN_ENABLED==='true'&&env.ASTURPOWER_GARMIN_TRAINING_ENABLED==='true',
        'garmin_training_not_enabled',503);
      demand((!request.headers.get('origin')||request.headers.get('origin')===new URL(request.url).origin)
        &&request.headers.get('sec-fetch-site')!=='cross-site','access_denied',403);
      const bearer=/^Bearer ([A-Za-z0-9._-]{10,20000})$/.exec(request.headers.get('authorization')||'');
      demand(bearer,'sign_in_required',401);
      const actor=await verify(bearer[1],config);
      demand(uuid(actor?.id)&&Array.isArray(actor.roles),'access_denied',403);
      const body=await boundedJson(request);
      demand(body&&Object.keys(body).length===1&&uuid(body.workout_id));
      const result=await sendPlannedWorkout({repo:repositoryFactory(env),env,actor,workoutId:body.workout_id,fetcher});
      return json(result);
    }catch(error){return failure(error);}
  };
}
