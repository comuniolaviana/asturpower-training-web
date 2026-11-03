import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { authenticateActor } from './team-service.mjs';
import { resolvePublicConfig } from '../functions/public-config.mjs';

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
const validConfiguration = env=>{
  const config=resolvePublicConfig(env);
  const url=env.GARMIN_REDIRECT_URI;
  let redirect;
  try{redirect=new URL(url);}catch{return null;}
  if(env.ASTURPOWER_GARMIN_ENABLED!=='true'||!config
    ||!/^sb_secret_[A-Za-z0-9_-]+$/.test(env.SUPABASE_SECRET_KEY||'')
    ||!/^[-a-zA-Z0-9_]{8,128}$/.test(env.GARMIN_CLIENT_ID||'')
    ||!env.GARMIN_CLIENT_SECRET||env.GARMIN_CLIENT_SECRET.length<8
    ||Buffer.from(env.GARMIN_TOKEN_ENCRYPTION_KEY||'','base64url').length!==32
    ||redirect.origin!=='https://asturpower-training-dev.netlify.app'
    ||redirect.pathname!=='/.netlify/functions/garmin-callback'
    ||redirect.search||redirect.hash||redirect.username||redirect.password) return null;
  return {config,redirect_uri:redirect.toString()};
};
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
  const response=await fetcher(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});
  return responseJson(response);
}
function landing(status){
  const url=new URL('https://asturpower-training-dev.netlify.app/');
  url.searchParams.set('garmin',status);
  return new Response(null,{status:303,headers:{...HEADERS,Location:url.toString()}});
}
export function createGarminStartHandler({env=process.env,verify=authenticateActor,createClientFn=createClient}={}){
  return async request=>{
    if(request.method!=='POST')return json({error:'method_not_allowed'},405);
    const settings=validConfiguration(env);
    if(!settings)return json({error:'garmin_not_configured'},503);
    try{
      const actor=await requireAthlete(request,settings,verify);
      if(!actor)return json({error:'not_authorized'},403);
      const service=createService(settings,env,createClientFn);
      const {verifier,challenge,state}=createPkce();
      const stateHash=sha256(state);
      check(await service.from('garmin_oauth_states').insert({
        state_hash:stateHash,athlete_id:actor.id,
        verifier_ciphertext:encryptedSecret(verifier,env.GARMIN_TOKEN_ENCRYPTION_KEY,'pkce:'+stateHash),
        redirect_uri:settings.redirect_uri,
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
    }catch{return json({error:'garmin_start_failed'},503);}
  };
}
export function createGarminStatusHandler({env=process.env,verify=authenticateActor,createClientFn=createClient}={}){
  return async request=>{
    if(request.method!=='GET')return json({error:'method_not_allowed'},405);
    const settings=validConfiguration(env);
    if(!settings)return json({configured:false,connected:false});
    try{
      const actor=await requireAthlete(request,settings,verify);
      if(!actor)return json({error:'not_authorized'},403);
      const service=createService(settings,env,createClientFn);
      const linked=check(await service.from('garmin_connections')
        .select('garmin_user_id,permissions,connected_at,access_expires_at')
        .eq('athlete_id',actor.id).maybeSingle());
      return json({configured:true,connected:!!linked,
        permissions:linked?.permissions||[],connected_at:linked?.connected_at||null});
    }catch{return json({error:'temporarily_unavailable'},503);}
  };
}
export function createGarminCallbackHandler({env=process.env,createClientFn=createClient,fetcher=fetch}={}){
  return async request=>{
    if(request.method!=='GET')return new Response('Método no permitido',{status:405,headers:{...HEADERS,Allow:'GET'}});
    const settings=validConfiguration(env);
    if(!settings)return landing('not_ready');
    const url=new URL(request.url);
    const state=url.searchParams.get('state');
    const code=url.searchParams.get('code');
    if(!code||!state||!/^[-_A-Za-z0-9]{43}$/.test(state)||code.length>2048)return landing('cancelled');
    try{
      const service=createService(settings,env,createClientFn);
      const stateHash=sha256(state);
      // Mark consumed before exchanging code. Two concurrent callbacks cannot redeem the same state.
      const stored=check(await service.from('garmin_oauth_states')
        .update({used_at:new Date().toISOString()})
        .eq('state_hash',stateHash).is('used_at',null)
        .gt('expires_at',new Date().toISOString())
        .select('athlete_id,verifier_ciphertext,redirect_uri').maybeSingle());
      if(!stored||stored.redirect_uri!==settings.redirect_uri)return landing('expired');
      const verifier=decryptedSecret(stored.verifier_ciphertext,env.GARMIN_TOKEN_ENCRYPTION_KEY,'pkce:'+stateHash);
      const credentials=Buffer.from(env.GARMIN_CLIENT_ID+':'+env.GARMIN_CLIENT_SECRET).toString('base64');
      const body=new URLSearchParams({grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:settings.redirect_uri});
      const tokenResponse=await fetcher(TOKEN_URL,{
        method:'POST',headers:{Authorization:'Basic '+credentials,'Content-Type':'application/x-www-form-urlencoded'},
        body:body.toString(),
      });
      const token=await responseJson(tokenResponse);
      if(typeof token.access_token!=='string'||typeof token.refresh_token!=='string'
        ||!Number.isFinite(Number(token.expires_in))||!Number.isFinite(Number(token.refresh_token_expires_in)))
        return landing('failed');
      const [identity,access]=await Promise.all([
        garminGet(USER_ID_URL,token.access_token,fetcher),
        garminGet(PERMISSIONS_URL,token.access_token,fetcher),
      ]);
      if(typeof identity.userId!=='string'||!/^[-a-zA-Z0-9_]{4,128}$/.test(identity.userId)
        ||!Array.isArray(access.permissions))return landing('failed');
      const permissions=access.permissions.filter(p=>typeof p==='string'&&/^[A-Z_]{2,60}$/.test(p));
      const now=Date.now();
      // Garmin recommends subtracting at least 600 seconds from expiry.
      const accessSeconds=Math.max(0,Math.min(Number(token.expires_in),86400*7)-600);
      const refreshSeconds=Math.max(0,Math.min(Number(token.refresh_token_expires_in),86400*100)-600);
      if(accessSeconds<=0||refreshSeconds<=0)return landing('failed');
      check(await service.from('garmin_connections').upsert({
        athlete_id:stored.athlete_id,garmin_user_id:identity.userId,
        access_token_ciphertext:encryptedSecret(token.access_token,env.GARMIN_TOKEN_ENCRYPTION_KEY,'access:'+stored.athlete_id),
        refresh_token_ciphertext:encryptedSecret(token.refresh_token,env.GARMIN_TOKEN_ENCRYPTION_KEY,'refresh:'+stored.athlete_id),
        access_expires_at:new Date(now+accessSeconds*1000).toISOString(),
        refresh_expires_at:new Date(now+refreshSeconds*1000).toISOString(),
        permissions,updated_at:new Date(now).toISOString(),
      },{onConflict:'athlete_id'}));
      return landing('connected');
    }catch{return landing('failed');}
  };
}
