import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { authenticateActor } from './team-service.mjs';
import { resolvePublicConfig } from '../functions/public-config.mjs';
import { boundedJson, GarminError } from './garmin-protocol.mjs';
import { withGarminLease } from './garmin-lock.mjs';
import { createGarminRepository } from './garmin-repository.mjs';

// Garmin Connect Developer Program — OAuth2 PKCE 2.0 (official partner specification).
// Never log authorization codes, state, access tokens, refresh tokens, secrets, or URLs with query strings.
const AUTHORIZATION_URL = 'https://connect.garmin.com/oauth2Confirm';
const TOKEN_URL = 'https://diauth.garmin.com/di-oauth2-service/oauth/token';
const USER_ID_URL = 'https://apis.garmin.com/partner-gateway/rest/user/id';
const PERMISSIONS_URL = 'https://apis.garmin.com/partner-gateway/rest/user/permissions';
const HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const json = (body,status=200)=>new Response(JSON.stringify(body),{
  status, headers:{...HEADERS,'Content-Type':'application/json; charset=utf-8'},
});
const sha256 = value=>createHash('sha256').update(value,'utf8').digest('hex');
const base64url = bytes=>Buffer.from(bytes).toString('base64url');
const CONSENT_VERSION='garmin-2026-11-04';
const syncEnabled=env=>env.ASTURPOWER_GARMIN_TRAINING_ENABLED==='true'||env.ASTURPOWER_GARMIN_ACTIVITY_ENABLED==='true';
async function reserve(service,env,athleteId,oauth=false){
  if(!syncEnabled(env))return;
  const result=await service.rpc('reserve_garmin_call',{p_athlete_id:athleteId,p_oauth:oauth});
  if(result.error||!result.data?.allowed)throw new Error('garmin_quota_unavailable');
}
export const createPkce = ()=>{
  const verifier=base64url(randomBytes(32)); // 43 chars, RFC 7636-valid verifier.
  const challenge=base64url(createHash('sha256').update(verifier).digest());
  return {verifier,challenge,state:base64url(randomBytes(32))};
};
export function encryptedSecret(value, keyText, context){
  const key=Buffer.from(keyText||'','base64url');
  if(key.length!==32)throw new Error('encryption_key_not_configured');
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(context,'utf8'));
  const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return [base64url(iv),base64url(cipher.getAuthTag()),base64url(data)].join('.');
}
export function decryptedSecret(value,keyText,context){
  const key=Buffer.from(keyText||'','base64url');
  if(key.length!==32)throw new Error('encryption_key_not_configured');
  const parts=String(value||'').split('.');
  if(parts.length!==3)throw new Error('invalid_ciphertext');
  const iv=Buffer.from(parts[0],'base64url');
  const tag=Buffer.from(parts[1],'base64url');
  if(iv.length!==12||tag.length!==16)throw new Error('invalid_ciphertext');
  const decipher=createDecipheriv('aes-256-gcm',key,iv);
  decipher.setAAD(Buffer.from(context,'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(parts[2],'base64url')),decipher.final()]).toString('utf8');
}
const NETLIFY_ORIGIN='https://asturpower-training-dev.netlify.app';
// Only explicit server-side adapters can select the reviewed staging origin.
const OAUTH_ORIGINS=new Set([NETLIFY_ORIGIN,'https://asturpower-garmin-dev.asturpower-training.workers.dev']);
const configuration = (env,redirectOrigin=NETLIFY_ORIGIN)=>{
  const config=resolvePublicConfig(env,{requireEnabled:false});
  const url=env.GARMIN_REDIRECT_URI;
  let redirect;
  try{redirect=new URL(url);}catch{return null;}
  if(!config
    ||!/^sb_secret_[A-Za-z0-9_-]+$/.test(env.SUPABASE_SECRET_KEY||'')
    ||!/^[-a-zA-Z0-9_]{8,128}$/.test(env.GARMIN_CLIENT_ID||'')
    ||!env.GARMIN_CLIENT_SECRET||env.GARMIN_CLIENT_SECRET.length<8
    ||Buffer.from(env.GARMIN_TOKEN_ENCRYPTION_KEY||'','base64url').length!==32
    ||!OAUTH_ORIGINS.has(redirectOrigin)||redirect.origin!==redirectOrigin
    ||redirect.pathname!=='/.netlify/functions/garmin-callback'
    ||redirect.search||redirect.hash||redirect.username||redirect.password) return null;
  return {config,redirect_uri:redirect.toString()};
};
// Syntax only: no provider call, credentials returned, or module activation.
export const isGarminConfigurationReady=(env,redirectOrigin=NETLIFY_ORIGIN)=>Boolean(configuration(env,redirectOrigin));
const validConfiguration=(env,redirectOrigin=NETLIFY_ORIGIN)=>
  env.ASTURPOWER_APP_ENABLED==='true'&&env.ASTURPOWER_GARMIN_ENABLED==='true'
    ?configuration(env,redirectOrigin):null;
const createService=(settings,env,createClientFn=createClient)=>
  createClientFn(settings.config.supabaseUrl,env.SUPABASE_SECRET_KEY,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  });
async function requireAthlete(request,settings,verify=authenticateActor){
  const requestOrigin=new URL(request.url).origin;
  const fromOrigin=request.headers.get('origin');
  if((fromOrigin&&fromOrigin!==requestOrigin)||request.headers.get('sec-fetch-site')==='cross-site')return null;
  const match=/^Bearer ([A-Za-z0-9._-]{10,20000})$/.exec(request.headers.get('authorization')||'');
  if(!match)return null;
  const actor=await verify(match[1],settings.config);
  if(!actor?.roles?.includes('athlete'))return null;
  return actor;
}
const check=(result)=>{
  if(result.error)throw new Error('database_unavailable');
  return result.data;
};
async function responseJson(response){
  if(!response.ok)throw new Error('garmin_request_failed');
  const body=await response.json();
  if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('invalid_garmin_response');
  return body;
}
async function garminGet(url,token,fetcher=fetch){
  const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(8000),headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});
  return responseJson(response);
}
function landing(status,redirectOrigin=NETLIFY_ORIGIN){
  const url=new URL(OAUTH_ORIGINS.has(redirectOrigin)?redirectOrigin:NETLIFY_ORIGIN);
  url.searchParams.set('garmin',status);
  return new Response(null,{status:303,headers:{...HEADERS,Location:url.toString()}});
}
export function createGarminStartHandler({env=process.env,verify=authenticateActor,createClientFn=createClient,redirectOrigin=NETLIFY_ORIGIN}={}){
  return async request=>{
    if(request.method!=='POST')return json({error:'method_not_allowed'},405);
    const settings=validConfiguration(env,redirectOrigin);
    if(!settings)return json({error:'garmin_not_configured'},503);
    try{
      const actor=await requireAthlete(request,settings,verify);
      if(!actor)return json({error:'not_authorized'},403);
      const consent=await boundedJson(request);
      if(!consent||Object.keys(consent).length!==1||consent.consent!==true)return json({error:'consent_required'},400);
      const service=createService(settings,env,createClientFn);
      const {verifier,challenge,state}=createPkce();
      const stateHash=sha256(state);
      check(await service.from('garmin_oauth_states').insert({
        state_hash:stateHash,athlete_id:actor.id,
        verifier_ciphertext:encryptedSecret(verifier,env.GARMIN_TOKEN_ENCRYPTION_KEY,'pkce:'+stateHash+':'+CONSENT_VERSION),
        redirect_uri:settings.redirect_uri,
        ...(syncEnabled(env)?{consent_version:CONSENT_VERSION}:{}),
        expires_at:new Date(Date.now()+10*60*1000).toISOString(),
      }));
      const url=new URL(AUTHORIZATION_URL);
      url.searchParams.set('response_type','code');
      url.searchParams.set('client_id',env.GARMIN_CLIENT_ID);
      url.searchParams.set('code_challenge',challenge);
      url.searchParams.set('code_challenge_method','S256');
      url.searchParams.set('redirect_uri',settings.redirect_uri);
      url.searchParams.set('state',state);
      return json({authorization_url:url.toString()});
    }catch(error){return error instanceof GarminError?json({error:error.code},error.status):json({error:'garmin_start_failed'},503);}
  };
}
export function createGarminStatusHandler({env=process.env,verify=authenticateActor,createClientFn=createClient,redirectOrigin=NETLIFY_ORIGIN}={}){
  return async request=>{
    if(request.method!=='GET')return json({error:'method_not_allowed'},405);
    const settings=validConfiguration(env,redirectOrigin);
    if(!settings)return json({configured:false,connected:false});
    try{
      const actor=await requireAthlete(request,settings,verify);
      if(!actor)return json({error:'not_authorized'},403);
      const service=createService(settings,env,createClientFn);
      const linked=check(await service.from('garmin_connections')
        .select('garmin_user_id,permissions,connected_at,access_expires_at')
        .eq('athlete_id',actor.id).maybeSingle());
      return json({configured:true,connected:!!linked,
        permissions:linked?.permissions||[],connected_at:linked?.connected_at||null,
        training_enabled:env.ASTURPOWER_GARMIN_TRAINING_ENABLED==='true',
        activity_enabled:env.ASTURPOWER_GARMIN_ACTIVITY_ENABLED==='true'});
    }catch{return json({error:'temporarily_unavailable'},503);}
  };
}
export function createGarminCallbackHandler({env=process.env,createClientFn=createClient,fetcher=fetch,redirectOrigin=NETLIFY_ORIGIN}={}){
  const finishLanding=status=>landing(status,redirectOrigin);
  return async request=>{
    if(request.method!=='GET')return new Response('Método no permitido',{status:405,headers:{...HEADERS,Allow:'GET'}});
    const settings=validConfiguration(env,redirectOrigin);
    if(!settings)return finishLanding('not_ready');
    const url=new URL(request.url);
    if(url.origin!==new URL(settings.redirect_uri).origin||url.pathname!==new URL(settings.redirect_uri).pathname)
      return finishLanding('failed');
    const state=url.searchParams.get('state');
    const code=url.searchParams.get('code');
    if(!state||!/^[-_A-Za-z0-9]{43}$/.test(state)||url.searchParams.getAll('state').length!==1
      ||url.searchParams.getAll('code').length>1)return finishLanding('cancelled');
    try{
      const service=createService(settings,env,createClientFn);
      const stateHash=sha256(state);
      // Mark consumed before exchanging code. Two concurrent callbacks cannot redeem the same state.
      const stored=check(await service.from('garmin_oauth_states')
        .update({used_at:new Date().toISOString()})
        .eq('state_hash',stateHash).is('used_at',null)
        .gt('expires_at',new Date().toISOString())
        .select('athlete_id,verifier_ciphertext,redirect_uri'+(syncEnabled(env)?',consent_version':'')).maybeSingle());
      if(!stored||stored.redirect_uri!==settings.redirect_uri)return finishLanding('expired');
      if(url.searchParams.has('error')||!code||code.length>2048)return finishLanding('cancelled');
      if(syncEnabled(env)&&stored.consent_version!==CONSENT_VERSION)return finishLanding('failed');
      const finish=async()=>{
      const verifier=decryptedSecret(stored.verifier_ciphertext,env.GARMIN_TOKEN_ENCRYPTION_KEY,'pkce:'+stateHash+':'+CONSENT_VERSION);
      const credentials=Buffer.from(env.GARMIN_CLIENT_ID+':'+env.GARMIN_CLIENT_SECRET).toString('base64');
      const body=new URLSearchParams({grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:settings.redirect_uri});
      const tokenResponse=await fetcher(TOKEN_URL,{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{Authorization:'Basic '+credentials,'Content-Type':'application/x-www-form-urlencoded'},
        body:body.toString(),
      });
      const token=await responseJson(tokenResponse);
      if(typeof token.access_token!=='string'||typeof token.refresh_token!=='string'
        ||!Number.isFinite(Number(token.expires_in))||!Number.isFinite(Number(token.refresh_token_expires_in)))
        return finishLanding('failed');
      await reserve(service,env,stored.athlete_id);
      await reserve(service,env,stored.athlete_id);
      const [identity,access]=await Promise.all([
        garminGet(USER_ID_URL,token.access_token,fetcher),
        garminGet(PERMISSIONS_URL,token.access_token,fetcher),
      ]);
      if(typeof identity.userId!=='string'||!/^[-a-zA-Z0-9_]{4,128}$/.test(identity.userId)
        ||!Array.isArray(access.permissions))return finishLanding('failed');
      const permissions=access.permissions.filter(p=>typeof p==='string'&&/^[A-Z_]{2,60}$/.test(p));
      const now=Date.now();
      // Garmin recommends subtracting at least 600 seconds from expiry.
      const accessSeconds=Math.max(0,Math.min(Number(token.expires_in),86400*7)-600);
      const refreshSeconds=Math.max(0,Math.min(Number(token.refresh_token_expires_in),86400*100)-600);
      if(accessSeconds<=0||refreshSeconds<=0)return finishLanding('failed');
      check(await service.from('garmin_connections').upsert({
        athlete_id:stored.athlete_id,garmin_user_id:identity.userId,
        access_token_ciphertext:encryptedSecret(token.access_token,env.GARMIN_TOKEN_ENCRYPTION_KEY,'access:'+stored.athlete_id),
        refresh_token_ciphertext:encryptedSecret(token.refresh_token,env.GARMIN_TOKEN_ENCRYPTION_KEY,'refresh:'+stored.athlete_id),
        access_expires_at:new Date(now+accessSeconds*1000).toISOString(),
        refresh_expires_at:new Date(now+refreshSeconds*1000).toISOString(),
        permissions,updated_at:new Date(now).toISOString(),
        connected_at:new Date(now).toISOString(),
        ...(syncEnabled(env)?{consent_version:CONSENT_VERSION,permissions_changed_at:Math.floor(now/1000)}:{}),
      },{onConflict:'athlete_id'}));
      return finishLanding('connected');
      };
      await reserve(service,env,stored.athlete_id,true);
      return syncEnabled(env)?await withGarminLease(createGarminRepository(env,createClientFn),stored.athlete_id,finish):await finish();
    }catch{return finishLanding('failed');}
  };
}

/**
 * Revoca la autorización en Garmin, como exige la especificación oficial del
 * Developer Program, y elimina la copia local de los tokens. Solo deportistas
 * autenticados pueden desconectar su propia cuenta.
 */
export function createGarminDisconnectHandler({env=process.env,verify=authenticateActor,createClientFn=createClient,fetcher=fetch,redirectOrigin=NETLIFY_ORIGIN}={}){
  return async request=>{
    if(request.method!=='POST')return json({error:'method_not_allowed'},405);
    const settings=validConfiguration(env,redirectOrigin);
    if(!settings)return json({error:'garmin_not_configured'},503);
    try{
      const actor=await requireAthlete(request,settings,verify);
      if(!actor)return json({error:'not_authorized'},403);
      const service=createService(settings,env,createClientFn);
      const disconnect=async()=>{
      const connection=check(await service.from('garmin_connections')
        .select('access_token_ciphertext,refresh_token_ciphertext,access_expires_at,refresh_expires_at')
        .eq('athlete_id',actor.id).maybeSingle());
      if(!connection)return json({disconnected:true});
      let access=decryptedSecret(connection.access_token_ciphertext,env.GARMIN_TOKEN_ENCRYPTION_KEY,'access:'+actor.id);
      if(new Date(connection.access_expires_at).getTime()<Date.now()+120000){
        if(new Date(connection.refresh_expires_at).getTime()<Date.now()+120000)return json({error:'reauthorization_required'},409);
        const refresh=decryptedSecret(connection.refresh_token_ciphertext,env.GARMIN_TOKEN_ENCRYPTION_KEY,'refresh:'+actor.id);
        const credentials=Buffer.from(env.GARMIN_CLIENT_ID+':'+env.GARMIN_CLIENT_SECRET).toString('base64');
        await reserve(service,env,actor.id,true);
        const token=await responseJson(await fetcher(TOKEN_URL,{
          method:'POST',
          redirect:'error',signal:AbortSignal.timeout(8000),
          headers:{Authorization:'Basic '+credentials,'Content-Type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({grant_type:'refresh_token',refresh_token:refresh}).toString(),
        }));
        if(typeof token.access_token!=='string'||typeof token.refresh_token!=='string'
          ||!Number.isFinite(Number(token.expires_in))||!Number.isFinite(Number(token.refresh_token_expires_in))
          ||Number(token.expires_in)<=600||Number(token.refresh_token_expires_in)<=600)throw new Error('invalid_refresh_response');
        access=token.access_token;
        const now=Date.now();
        // Actualizar el token rotado para que un fallo temporal no impida reintentar la desconexión.
        check(await service.from('garmin_connections').update({
          access_token_ciphertext:encryptedSecret(token.access_token,env.GARMIN_TOKEN_ENCRYPTION_KEY,'access:'+actor.id),
          refresh_token_ciphertext:encryptedSecret(token.refresh_token,env.GARMIN_TOKEN_ENCRYPTION_KEY,'refresh:'+actor.id),
          access_expires_at:new Date(now+(Number(token.expires_in)-600)*1000).toISOString(),
          refresh_expires_at:new Date(now+(Number(token.refresh_token_expires_in)-600)*1000).toISOString(),
          updated_at:new Date().toISOString(),
        }).eq('athlete_id',actor.id));
      }
      await reserve(service,env,actor.id);
      const revoked=await fetcher('https://apis.garmin.com/partner-gateway/rest/user/registration',{
        method:'DELETE',redirect:'error',signal:AbortSignal.timeout(8000),headers:{Authorization:'Bearer '+access,Accept:'application/json'},
      });
      if(!revoked.ok)throw new Error('garmin_revocation_failed');
      check(await service.from('garmin_connections').delete().eq('athlete_id',actor.id));
      return json({disconnected:true});
      };
      return syncEnabled(env)?await withGarminLease(createGarminRepository(env,createClientFn),actor.id,disconnect):await disconnect();
    }catch{
      return json({error:'garmin_disconnect_failed'},503);
    }
  };
}

