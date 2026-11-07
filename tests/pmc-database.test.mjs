import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
test('planned load is additive, optional, bounded and preserves existing workout isolation',async()=>{
 const db=new PGlite();
 try{
  for(const file of ['tests/fixtures/garmin-auth-scaffold.sql','database/esquema-inicial-aplicado.sql','database/cambio-multirrol-aplicado.sql','tests/fixtures/garmin-sport-schema.sql'])await db.exec(await readFile(new URL('../'+file,import.meta.url),'utf8'));
  const before=(await db.query("select policyname,qual,with_check from pg_policies where tablename='planned_workouts' order by policyname")).rows;
  await db.exec(await readFile(new URL('../supabase/migrations/20261107150134_coach_pmc_planned_load.sql',import.meta.url),'utf8'));
  const A='a7777777-0000-4000-8000-000000000001',C='c7777777-0000-4000-8000-000000000001',D='c7777777-0000-4000-8000-000000000002';
  for(const [id,role] of [[A,'athlete'],[C,'coach'],[D,'coach']]){await db.query('insert into auth.users(id) values($1)',[id]);await db.query('insert into public.profiles(user_id,display_name) values($1,$2)',[id,'Prueba']);await db.query('insert into public.user_roles(user_id,role) values($1,$2)',[id,role]);}
  await db.query("insert into public.coach_athletes(coach_id,athlete_id,status) values($1,$2,'active')",[C,A]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[C]);await db.exec('set role authenticated');
  const insert=load=>db.query("insert into planned_workouts(coach_id,athlete_id,scheduled_date,sport,title,duration_minutes,estimated_tss) values($1,$2,'2026-11-08','cycling','Prueba',60,$3) returning estimated_tss",[C,A,load]);
  assert.equal((await insert(null)).rows[0].estimated_tss,null);assert.equal(Number((await insert(0)).rows[0].estimated_tss),0);assert.equal(Number((await insert(65.5)).rows[0].estimated_tss),65.5);
  for(const load of [-1,5001,'NaN','Infinity'])await assert.rejects(insert(load),/check constraint|numeric field overflow/);
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[D]);await db.exec('set role authenticated');
  assert.equal((await db.query('select count(*)::int n from planned_workouts')).rows[0].n,0);await assert.rejects(insert(50),/row-level security/);
  await db.exec('reset role');assert.deepEqual((await db.query("select policyname,qual,with_check from pg_policies where tablename='planned_workouts' order by policyname")).rows,before);
 }finally{await db.close();}
});
