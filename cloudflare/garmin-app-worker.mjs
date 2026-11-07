import {resumeEffortRecords} from '../netlify/lib/effort-records-scheduler.mjs';
// Isolated full staging adapter; private modules require explicit activation.
import { createGarminStartHandler, createGarminStatusHandler, createGarminCallbackHandler,
  createGarminDisconnectHandler, garminConfigurationIssues } from '../netlify/lib/garmin-oauth-service.mjs';
import { createGarminWorkoutHandler } from '../netlify/lib/garmin-training-service.mjs';
import { createTeamHandler } from '../netlify/lib/team-service.mjs';
import { resolvePublicConfig } from '../netlify/functions/public-config.mjs';
import { createWorker as createReceiver } from './garmin-worker.mjs';

const APP_ORIGIN='https://asturpower-garmin-dev.asturpower-training.workers.dev';
const SUPABASE_URL='https://drnefgxdrultneeodtsy.supabase.co';
const HEADERS={
  'Cache-Control':'no-store, max-age=0','Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
  'X-Robots-Tag':'noindex, nofollow',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; worker-src 'self'; manifest-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://drnefgxdrultneeodtsy.supabase.co; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const json=(body,status)=>Response.json(body,{status});
// Fixed categories only: never return a value, prefix, suffix, length or exception.
function configurationProblem(value){
  if(value===undefined||value===null||value==='')return 'missing';
  if(typeof value!=='string')return 'invalid_binding_type';
  if(/[*\u2022\u25cf]/.test(value))return 'masked_value';
  if(value.trim()!==value)return 'surrounding_whitespace';
  return 'invalid_format';
}
function protect(response){
  const headers=new Headers(response.headers);
  for(const [name,value] of Object.entries(HEADERS))headers.set(name,value);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

export function createAppWorker(dependencies={}){
  const receiver=createReceiver(dependencies);
  return {
    async fetch(request,env,context){
      const url=new URL(request.url);
      // Never derive the callback/landing origin from Host or forwarding headers.
      if(url.origin!==APP_ORIGIN)return protect(json({error:'invalid_origin'},421));
      try{
        if(url.pathname==='/health'){
          if(request.method!=='GET')return protect(json({error:'method_not_allowed'},405));
          const issues=garminConfigurationIssues(env,APP_ORIGIN);
          if(env.SUPABASE_URL!==SUPABASE_URL&&!issues.includes('SUPABASE_URL'))issues.push('SUPABASE_URL');
          return protect(json({service:'asturpower-garmin-app',
            enabled:env.ASTURPOWER_GARMIN_ACTIVITY_ENABLED==='true',
            configuration_format_ready:issues.length===0,configuration_invalid_fields:issues,
            configuration_problem_types:Object.fromEntries(issues.map(name=>[name,configurationProblem(env[name])])),
            diagnostic_version:2},200));
        }
        if(url.pathname==='/garmin/activities'){
          if(env.SUPABASE_URL!==SUPABASE_URL)return protect(json({error:'app_not_configured'},503));
          return protect(await receiver.fetch(request,env));
        }
        if(url.pathname.startsWith('/.netlify/functions/')){
          if(env.SUPABASE_URL!==SUPABASE_URL)return protect(json({error:'app_not_configured'},503));
          const options={...dependencies,env,redirectOrigin:APP_ORIGIN};
          const routes={
            'garmin-start':createGarminStartHandler,'garmin-status':createGarminStatusHandler,
            'garmin-callback':createGarminCallbackHandler,'garmin-disconnect':createGarminDisconnectHandler,
            'garmin-workout':createGarminWorkoutHandler,'team':createTeamHandler,
          };
          const route=url.pathname.slice('/.netlify/functions/'.length);
          if(route==='public-config'){
            if(request.method!=='GET')return protect(json({error:'method_not_allowed'},405));
            const config=resolvePublicConfig(env);
            return protect(json(config||{error:'app_not_configured'},config?200:503));
          }
          // Server processing is scheduled, never exposed as an unauthenticated route.
          if(!Object.hasOwn(routes,route))return protect(json({error:'not_found'},404));
          return protect(await routes[route](options)(request));
        }
        if(!['GET','HEAD'].includes(request.method))return protect(json({error:'method_not_allowed'},405));
        if(!env.ASSETS?.fetch)return protect(json({error:'app_not_configured'},503));
        const response=await env.ASSETS.fetch(request);
        if(response.status!==404||url.pathname.startsWith('/assets/')||url.pathname.includes('.'))return protect(response);
        // SPA fallback is limited to page requests; API/asset failures retain their status.
        const index=new URL('/index.html',APP_ORIGIN);
        return protect(await env.ASSETS.fetch(new Request(index,{method:request.method})));
      }catch{
        // No exception message, request URL, OAuth parameter or binding is logged or returned.
        return protect(json({error:'temporarily_unavailable'},503));
      }
    },
    async scheduled(event,env,context){
      if(env.SUPABASE_URL!==SUPABASE_URL)return;
      if(env.ASTURPOWER_APP_ENABLED==='true')context.waitUntil(resumeEffortRecords({env,createClientFn:dependencies.createClientFn}));
      return receiver.scheduled(event,env,context);
    },
  };
}
export default createAppWorker();
