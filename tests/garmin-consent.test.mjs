import test from 'node:test';
import assert from 'node:assert/strict';
import {createGarminStartHandler,createGarminCallbackHandler} from '../netlify/lib/garmin-oauth-service.mjs';
import {garminFixture,IDs} from './garmin-fixture.mjs';
function setup({fetcher}={}){
  const env={...garminFixture().env,ASTURPOWER_GARMIN_TRAINING_ENABLED:'false',ASTURPOWER_GARMIN_ACTIVITY_ENABLED:'false'};
  let stored=null,used=false,queries=0,providerCalls=0;
  const client=()=>({
    from(table){
      assert.equal(table,'garmin_oauth_states');queries++;
      return {
        async insert(row){stored=row;return {error:null};},
        update(){return {
          eq(){return this;},is(){return this;},gt(){return this;},select(){return this;},
          async maybeSingle(){
            if(used)return {data:null,error:null};
            used=true;return {data:stored,error:null};
          },
        };},
      };
    },
  });
  const start=createGarminStartHandler({env,verify:async()=>({id:IDs.athlete,roles:['athlete']}),createClientFn:client});
  const callback=createGarminCallbackHandler({env,createClientFn:client,fetcher:async(...args)=>{
    providerCalls++;if(fetcher)return fetcher(...args);throw new Error('must not call provider');
  }});
  const request=body=>new Request('https://asturpower-training-dev.netlify.app/.netlify/functions/garmin-start',{
    method:'POST',headers:{Authorization:'Bearer simulated-session','Content-Type':'application/json'},body:JSON.stringify(body)});
  return {env,start,callback,request,get queries(){return queries;},get used(){return used;},get providerCalls(){return providerCalls;}};
}
for(const body of [{consent:false},{},{consent:true,athlete_id:IDs.otherAthlete}])test('OAuth requires explicit own consent in the server body: '+JSON.stringify(body),async()=>{
  const f=setup(),response=await f.start(f.request(body));assert.equal(response.status,400);assert.equal(f.queries,0);
});
for(const status of [400,401,403,429,503])test('callback reports only an allowlisted token HTTP category: '+status,async()=>{
  const f=setup({fetcher:async()=>({ok:false,status,json(){throw new Error('Must not read private provider error body');}})});
  const authorization=new URL((await (await f.start(f.request({consent:true}))).json()).authorization_url);
  const url=new URL(f.env.GARMIN_REDIRECT_URI);
  url.searchParams.set('state',authorization.searchParams.get('state'));url.searchParams.set('code','private-fixture-code');
  const response=await f.callback(new Request(url));
  const landing=new URL(response.headers.get('location'));
  assert.equal(landing.searchParams.get('garmin'),'failed');
  assert.equal(landing.searchParams.get('issue'),[400,401,403,429].includes(status)?'token_http_'+status:'token_http_other');
  assert.deepEqual([...landing.searchParams.keys()],['garmin','issue']);
  assert.doesNotMatch(landing.toString(),/private-fixture|simulated-secret|code_verifier|state=/);
  assert.equal(f.used,true);assert.equal(f.providerCalls,1);
  const repeated=await f.callback(new Request(url));
  assert.equal(new URL(repeated.headers.get('location')).searchParams.get('garmin'),'expired');
  assert.equal(f.providerCalls,1);
});
test('malformed consent payload returns a client error and stores no OAuth state',async()=>{
  const f=setup(),request=f.request({consent:true});
  const malformed=new Request(request.url,{method:'POST',headers:request.headers,body:'{bad json'});
  assert.equal((await f.start(malformed)).status,400);assert.equal(f.queries,0);
});
test('denial consumes a valid state, does not contact Garmin and cannot be replayed',async()=>{
  const f=setup(),start=await f.start(f.request({consent:true}));
  const authorization=new URL((await start.json()).authorization_url);
  const url=new URL(f.env.GARMIN_REDIRECT_URI);url.searchParams.set('state',authorization.searchParams.get('state'));url.searchParams.set('error','access_denied');
  const first=await f.callback(new Request(url));assert.equal(new URL(first.headers.get('Location')).searchParams.get('garmin'),'cancelled');
  assert.equal(f.used,true);assert.equal(f.providerCalls,0);
  const repeated=await f.callback(new Request(url));assert.equal(new URL(repeated.headers.get('Location')).searchParams.get('garmin'),'expired');
});
test('callback rejects a wrong host and duplicated state before exchanging any code',async()=>{
  const f=setup(),authorization=new URL((await (await f.start(f.request({consent:true}))).json()).authorization_url);
  const state=authorization.searchParams.get('state');
  await f.callback(new Request('https://attacker.example/.netlify/functions/garmin-callback?code=simulated&state='+state));
  await f.callback(new Request(f.env.GARMIN_REDIRECT_URI+'?code=simulated&state='+state+'&state='+state));
  assert.equal(f.used,false);assert.equal(f.providerCalls,0);
});
