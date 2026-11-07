import test from 'node:test';
import assert from 'node:assert/strict';
import { createTeamHandler, createTeamRepository } from '../netlify/lib/team-service.mjs';
import { normalizeInvitationCode, generateInvitationCode, hashInvitationCode } from '../netlify/lib/team-invitations.mjs';
import { renderTeamManagement } from '../app/src/team-ui.js';

const coach = '41111111-1111-4111-8111-111111111111';
const athlete = '52222222-2222-4222-8222-222222222222';
const env = {
  ASTURPOWER_APP_ENABLED:'true', ASTURPOWER_TEAM_ENABLED:'true',
  SUPABASE_URL:'https://fixture.supabase.co',
  SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',
  SUPABASE_SECRET_KEY:'sb_secret_fixture',
};
const code='f'.repeat(32);
function harness(roles,id) {
  const calls=[];
  const handler=createTeamHandler({env,
    authenticate:async()=>({roles,id}),
    repositoryFactory:()=>({
      createInvitation:async who=>{calls.push(['create',who]);return {code,expiresAt:'2026-11-14T18:00:00Z'};},
      redeemInvitation:async (who,invite)=>{calls.push(['redeem',who,invite]);return {coachName:'Entrenador de prueba'};},
    }),
  });
  const send = async body=> {
    const r=await handler(new Request('https://app.example.test/.netlify/functions/team',{
      method:'POST',headers:{Authorization:'Bearer synthetic_test_token','Content-Type':'application/json'},
      body:JSON.stringify(body),
    }));
    return {status:r.status,body:await r.json()};
  };
  return {send,calls};
}

test('codigo criptografico de un solo uso con normalizacion y hash',async()=>{
  const a=generateInvitationCode(),b=generateInvitationCode();
  assert.match(a,/^[a-f0-9]{32}$/);
  assert.notEqual(a,b);
  assert.equal(normalizeInvitationCode('  '+a.toUpperCase()+' '),a);
  assert.equal(normalizeInvitationCode('../wrong'),null);
  assert.match(await hashInvitationCode(a),/^[a-f0-9]{64}$/);
  assert.equal(await hashInvitationCode(a),await hashInvitationCode(a.toUpperCase()));
});

test('solo coach autenticado crea invitacion asignada a su propia identidad',async()=>{
  const own=harness(['coach'],coach);
  assert.equal((await own.send({action:'create_invite'})).status,200);
  assert.deepEqual(own.calls,[['create',coach]]);
  for(const roles of [['athlete'],['admin']]){
    const denied=harness(roles,athlete);
    assert.equal((await denied.send({action:'create_invite'})).status,403);
    assert.equal(denied.calls.length,0);
  }
  assert.equal((await own.send({action:'create_invite',coachId:athlete})).status,400);
});

test('solo el deportista autenticado puede aceptar su codigo con consentimiento',async()=>{
  const self=harness(['athlete'],athlete);
  assert.equal((await self.send({action:'redeem_invite',code,consent:false})).status,400);
  assert.equal((await self.send({action:'redeem_invite',code:'bad',consent:true})).status,400);
  assert.equal((await self.send({action:'redeem_invite',code,athleteId:coach,consent:true})).status,400);
  assert.equal(self.calls.length,0);
  const accepted=await self.send({action:'redeem_invite',code,consent:true});
  assert.equal(accepted.status,200);
  assert.deepEqual(self.calls,[['redeem',athlete,code]]);
  assert.equal(accepted.body.coachName,'Entrenador de prueba');
  const denied=harness(['coach'],coach);
  assert.equal((await denied.send({action:'redeem_invite',code,consent:true})).status,403);
  assert.equal(denied.calls.length,0);
});

test('doble rol respeta que invitar es del entrenador y aceptar de la identidad atleta',async()=>{
  const t=harness(['coach','athlete'],coach);
  assert.equal((await t.send({action:'create_invite'})).status,200);
  assert.equal((await t.send({action:'redeem_invite',code,consent:true})).status,200);
  assert.deepEqual(t.calls,[['create',coach],['redeem',coach,code]]);
});

test('repositorio nunca almacena codigo en claro ni hace inserciones de vinculo desde navegador',async()=>{
  const calls=[];
  const service={rpc:async (name,args)=>{calls.push([name,args]);return {data:name==='create_coach_invitation'?'2026-11-14T18:00:00Z':'Entrenador',error:null};}};
  const repo=createTeamRepository({supabaseUrl:env.SUPABASE_URL},'sb_secret_test',()=>service);
  const generated=await repo.createInvitation(coach);
  assert.match(generated.code,/^[a-f0-9]{32}$/);
  assert.equal(calls[0][0],'create_coach_invitation');
  assert.notEqual(calls[0][1].p_hash,generated.code);
  assert.match(calls[0][1].p_hash,/^[a-f0-9]{64}$/);
  await repo.redeemInvitation(athlete,generated.code);
  assert.deepEqual(calls[1],[ 'redeem_coach_invitation',{
    p_athlete_id:athlete,p_hash:calls[0][1].p_hash,
  }]);
});

test('pantallas: invitacion para entrenador y canje con consentimiento del atleta',()=>{
  const empty={people:[],links:[],page:0,moreLinks:false,morePeople:false};
  const coachHtml=renderTeamManagement({role:'coach',team:empty},{inviteCode:code});
  assert.ok(coachHtml.includes('data-team-form="create_invite"'));
  assert.ok(coachHtml.includes('data-invite-copy'));
  assert.ok(!coachHtml.includes('data-team-form="redeem_invite"'));
  const athleteHtml=renderTeamManagement({role:'athlete',team:empty});
  assert.ok(athleteHtml.includes('data-team-form="redeem_invite"'));
  assert.ok(athleteHtml.includes('name="consent" required'));
  assert.ok(!athleteHtml.includes('data-team-form="create_invite"'));
});
