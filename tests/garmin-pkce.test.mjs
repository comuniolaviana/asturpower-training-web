import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import {
  createPkce, encryptedSecret, decryptedSecret,
  createGarminStartHandler, createGarminStatusHandler, createGarminCallbackHandler
} from '../netlify/lib/garmin-oauth-service.mjs';

test('Garmin PKCE verifier and SHA256 code challenge',()=>{
  const flow=createPkce();
  assert.equal(flow.verifier.length,43);
  assert.equal(flow.state.length,43);
  assert.equal(flow.challenge,createHash('sha256').update(flow.verifier).digest('base64url'));
});
test('Garmin token encryption is authenticated and context dependent',()=>{
  const key=randomBytes(32).toString('base64url');
  const sealed=encryptedSecret('example-value',key,'context-a');
  assert.equal(decryptedSecret(sealed,key,'context-a'),'example-value');
  assert.throws(()=>decryptedSecret(sealed,key,'context-b'));
});
test('unconfigured Garmin start fails closed',async()=>{
  const h=createGarminStartHandler({env:{ASTURPOWER_GARMIN_ENABLED:'false'}});
  const response=await h(new Request('https://example.org/.netlify/functions/garmin-start',{method:'POST'}));
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,'garmin_not_configured');
});
test('unconfigured Garmin status does not pretend a connection',async()=>{
  const h=createGarminStatusHandler({env:{}});
  const response=await h(new Request('https://example.org/.netlify/functions/garmin-status'));
  assert.deepEqual(await response.json(),{configured:false,connected:false});
});
test('unconfigured callback never exposes OAuth code',async()=>{
  const h=createGarminCallbackHandler({env:{}});
  const response=await h(new Request('https://example.org/.netlify/functions/garmin-callback?code=should_not_echo&state=should_not_echo'));
  assert.equal(response.status,303);
  assert.doesNotMatch(response.headers.get('location'),/should_not_echo/);
});

test('Garmin OAuth completo simulado: autorización, canje, permisos y vinculación cifrada',async()=>{
  const now=Date.now();
  const env={
    ASTURPOWER_APP_ENABLED:'true',ASTURPOWER_GARMIN_ENABLED:'true',
    SUPABASE_URL:'https://drnefgxdrultneeodtsy.supabase.co',
    SUPABASE_PUBLISHABLE_KEY:'sb_publishable_abcdefghijklmnopqrst',
    SUPABASE_SECRET_KEY:'sb_secret_abcdefghijklmnopqrst',
    GARMIN_CLIENT_ID:'123e4567-e89b-42d3-a456-426614174000',
    GARMIN_CLIENT_SECRET:'never-commit-real-credentials',
    GARMIN_REDIRECT_URI:'https://asturpower-training-dev.netlify.app/.netlify/functions/garmin-callback',
    GARMIN_TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64url'),
  };
  const athleteId='a0000000-0000-4000-8000-000000000001';
  let pending=null,connection=null,spent=false,garminCalls=[];
  const makeClient=()=>({
    from(table){
      if(table==='garmin_oauth_states'){
        return {
          async insert(record){pending=record;return {data:null,error:null};},
          update(patch){
            const filters=[];
            return {
              eq(k,v){filters.push([k,v]);return this;},
              is(k,v){filters.push([k,v]);return this;},
              gt(k,v){filters.push([k,v]);return this;},
              select(){return this;},
              async maybeSingle(){
                const eligible=!spent && pending &&
                  filters.every(([k,v])=>k==='expires_at'?pending[k]>v:v===null?pending[k]==null:pending[k]===v);
                if(!eligible)return {data:null,error:null};
                spent=true;
                return {data:{athlete_id:athleteId,verifier_ciphertext:pending.verifier_ciphertext,redirect_uri:pending.redirect_uri,consent_version:pending.consent_version},error:null};
              }
            };
          }
        };
      }
      if(table==='garmin_connections'){
        return {
          async upsert(payload){connection=payload;return {data:null,error:null};}
        };
      }
      throw new Error('Tabla inesperada');
    }
  });
  const verify=async()=>({id:athleteId,roles:['athlete']});
  const start=createGarminStartHandler({env,verify,createClientFn:makeClient});
  const startResponse=await start(new Request('https://asturpower-training-dev.netlify.app/.netlify/functions/garmin-start',{
    method:'POST',headers:{Authorization:'Bearer token-de-prueba-seguro','Content-Type':'application/json'},body:JSON.stringify({consent:true})
  }));
  assert.equal(startResponse.status,200);
  const started=await startResponse.json();
  const authorize=new URL(started.authorization_url);
  assert.equal(authorize.hostname,'connect.garmin.com');
  assert.equal(authorize.searchParams.get('code_challenge_method'),'S256');
  const state=authorize.searchParams.get('state');
  assert.equal(state.length,43);
  assert.notEqual(pending.state_hash,state);
  assert.ok(pending.expires_at>new Date(now).toISOString());
  const fetcher=async (url,options)=>{
    garminCalls.push({url,method:options.method||'GET'});
    if(url.includes('/oauth/token')){
      assert.equal(options.method,'POST');
      assert.match(options.body,/grant_type=authorization_code/);
      assert.ok(options.headers.Authorization.startsWith('Basic '));
      return {ok:true,async json(){return {access_token:'token-de-acceso-de-prueba',refresh_token:'token-de-renovacion-de-prueba',expires_in:86400,refresh_token_expires_in:7775998};}};
    }
    if(url.endsWith('/user/id'))return {ok:true,async json(){return {userId:'idGarminDePrueba1234'};}};
    if(url.endsWith('/user/permissions'))return {ok:true,async json(){return {permissions:['ACTIVITY_EXPORT','WORKOUT_IMPORT']};}};
    throw new Error('Endpoint inesperado');
  };
  const callback=createGarminCallbackHandler({env,createClientFn:makeClient,fetcher});
  const url=env.GARMIN_REDIRECT_URI+'?state='+encodeURIComponent(state)+'&code=codigo-test';
  const finish=await callback(new Request(url));
  assert.equal(finish.status,303);
  assert.equal(new URL(finish.headers.get('Location')).searchParams.get('garmin'),'connected');
  assert.equal(connection.athlete_id,athleteId);
  assert.equal(connection.garmin_user_id,'idGarminDePrueba1234');
  assert.deepEqual(connection.permissions,['ACTIVITY_EXPORT','WORKOUT_IMPORT']);
  assert.doesNotMatch(JSON.stringify(connection),/token-de-acceso-de-prueba|token-de-renovacion-de-prueba/);
  assert.equal(decryptedSecret(connection.refresh_token_ciphertext,env.GARMIN_TOKEN_ENCRYPTION_KEY,'refresh:'+athleteId),'token-de-renovacion-de-prueba');
  assert.deepEqual(garminCalls.map(x=>x.method),['POST','GET','GET']);
  const repeat=await callback(new Request(url));
  assert.equal(new URL(repeat.headers.get('Location')).searchParams.get('garmin'),'expired');
  assert.equal(garminCalls.length,3);
});

