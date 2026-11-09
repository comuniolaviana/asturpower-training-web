import { createClient } from '@supabase/supabase-js';
import { resolvePublicConfig } from '../functions/public-config.mjs';
import { GarminError, demand, createGarminTransport } from './garmin-protocol.mjs';
import {receiveGarminFile} from './garmin-file-receiver.mjs';
import {usableAccessToken} from './garmin-training-service.mjs';

const checked=result=>{if(result.error)throw new GarminError('storage_unavailable');return result.data;};
export function createGarminRepository(env,clientFactory=createClient){
  const config=resolvePublicConfig(env);
  demand(config&&/^sb_secret_[A-Za-z0-9_-]+$/.test(env.SUPABASE_SECRET_KEY||''),'garmin_not_configured',503);
  let deadline=Date.now()+50000;
  const db=clientFactory(config.supabaseUrl,env.SUPABASE_SECRET_KEY,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:(url,options={})=>fetch(url,{...options,
      signal:AbortSignal.any([...(options.signal?[options.signal]:[]),
        AbortSignal.timeout(Math.max(1,Math.min(5000,deadline-Date.now())))])})},
  });
  const connections=()=>db.from('garmin_connections');
  return {
    deadline(value){deadline=value;},
    async importFile(event,connection,receivedAt){
      // Resolve/refresh the authorized athlete's OAuth2 token BEFORE a callback
      // can be reserved or consumed. The caller already holds the athlete lease.
      const call=createGarminTransport({reserve:(id,oauth)=>this.reserve(id,oauth)});
      const accessToken=await usableAccessToken(connection,env,this,call);
      return receiveGarminFile({db,event,connection,receivedAt,accessToken});
    },
    async resumeFiles(){checked(await db.rpc('resume_garmin_api_files'));},
    async lease(key,owner){return checked(await db.rpc('claim_garmin_lock',{p_key:key,p_owner:owner,p_ttl_seconds:120}))===true;},
    async release(key,owner){checked(await db.rpc('release_garmin_lock',{p_key:key,p_owner:owner}));},
    async reserve(athleteId,oauth=false){
      const value=checked(await db.rpc('reserve_garmin_call',{p_athlete_id:athleteId,p_oauth:oauth}));
      if(!value?.allowed)throw new GarminError('garmin_rate_limited',429,{retryAfter:value?.retry_after||60});
    },
    async workout(id){return checked(await db.from('planned_workouts').select('*').eq('id',id).maybeSingle());},
    async activeLink(coach,athlete){return !!checked(await db.from('coach_athletes').select('coach_id')
      .eq('coach_id',coach).eq('athlete_id',athlete).eq('status','active').maybeSingle());},
    async connection(id){return checked(await connections().select('*').eq('athlete_id',id).maybeSingle());},
    async byGarminId(id){return checked(await connections().select('*').eq('garmin_user_id',id).maybeSingle());},
    async tokens(id,previous,patch){
      demand(checked(await connections().update(patch).eq('athlete_id',id)
        .eq('refresh_token_ciphertext',previous).select('athlete_id').maybeSingle()),'connection_changed',409);
    },
    async permissions(userId,permissions,changedAt){
      checked(await db.rpc('apply_garmin_permissions',{p_user_id:userId,p_permissions:permissions,p_changed_at:changedAt}));
    },
    async deregister(userId){
      const connection=await this.byGarminId(userId);
      if(!connection)return;
      checked(await db.from('garmin_workout_exports').update({status:'cancelled'})
        .eq('athlete_id',connection.athlete_id).neq('status','scheduled'));
      checked(await connections().delete().eq('garmin_user_id',userId));
    },
    async exportJob(workoutId){return checked(await db.from('garmin_workout_exports').select('*')
      .eq('planned_workout_id',workoutId).maybeSingle());},
    async createExport(record){return checked(await db.from('garmin_workout_exports').insert(record).select('*').single());},
    async saveExport(id,patch){checked(await db.from('garmin_workout_exports').update({...patch,updated_at:new Date().toISOString()}).eq('id',id));},
    async enqueue(record){checked(await db.from('garmin_webhook_inbox').upsert(record,{onConflict:'id',ignoreDuplicates:true}));},
    async claimInbox(){return checked(await db.rpc('claim_garmin_inbox',{p_limit:5}))||[];},
    async progressInbox(id,cursor){checked(await db.from('garmin_webhook_inbox').update({cursor}).eq('id',id));},
    async deferInbox(record,cursor){checked(await db.from('garmin_webhook_inbox').update({status:'pending',cursor,
      attempts:cursor>(record.cursor||0)?0:Math.max(0,record.attempts-1),
      available_at:new Date(Date.now()+1000).toISOString()}).eq('id',record.id));},
    async finishInbox(id){checked(await db.from('garmin_webhook_inbox').update({status:'done',payload_ciphertext:null,last_error:null}).eq('id',id));},
    async failInbox(record,code){checked(await db.from('garmin_webhook_inbox').update({
      status:record.attempts>=5?'failed':'pending',last_error:code,
      available_at:new Date(Date.now()+60000).toISOString(),
    }).eq('id',record.id));},
    async importActivity(record,receivedAt){checked(await db.rpc('upsert_garmin_activity',{p_activity:record,p_received_at:receivedAt}));},
  };
}
