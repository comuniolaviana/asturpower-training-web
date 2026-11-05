import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const A='a7777777-0000-4000-8000-000000000001',B='a7777777-0000-4000-8000-000000000002',C='c7777777-0000-4000-8000-000000000001',D='c7777777-0000-4000-8000-000000000002',ADMIN='d7777777-0000-4000-8000-000000000001';
test('physiology RLS isolates coaches, author identity, revocation and immutable dated snapshots',async()=>{
 const db=new PGlite();
 try{
  for(const file of ['tests/fixtures/garmin-auth-scaffold.sql','database/esquema-inicial-aplicado.sql','database/cambio-multirrol-aplicado.sql','supabase/migrations/20261105202528_coach_performance_tools.sql'])await db.exec(await read(file));
  for(const [id,role] of [[A,'athlete'],[B,'athlete'],[C,'coach'],[D,'coach'],[ADMIN,'admin']]){
   await db.query('insert into auth.users(id) values($1)',[id]);await db.query('insert into public.profiles(user_id,display_name) values($1,$2)',[id,'Fixture '+role]);await db.query('insert into public.user_roles(user_id,role) values($1,$2)',[id,role]);
  }
  await db.query("insert into public.coach_athletes(coach_id,athlete_id,status) values($1,$2,'active'),($3,$4,'pending')",[C,A,D,B]);
  const as=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
  const insert=(athlete=A,ftp=250,author=C)=>db.query("insert into public.athlete_physiology(athlete_id,sport,effective_date,ftp,created_by) values($1,'cycling','2026-11-05',$2,$3) returning id",[athlete,ftp,author]);
  await as(C);await insert();await insert(A,260);assert.equal((await db.query('select count(*)::int n from public.athlete_physiology')).rows[0].n,2);
  await assert.rejects(insert(B),/row-level security/);await assert.rejects(insert(A,250,D),/row-level security/);
  await assert.rejects(db.query("update public.athlete_physiology set ftp=300"),/permission denied/);await assert.rejects(db.query('delete from public.athlete_physiology'),/permission denied/);
  await assert.rejects(db.query("insert into public.athlete_physiology(athlete_id,sport,effective_date,ftp,created_at) values($1,'cycling','2026-11-05',250,'2000-01-01')",[A]),/permission denied/);
  for(const bounds of [[55,55],[75,55],[null,55],[],[55,301]])await assert.rejects(db.query("insert into public.athlete_physiology(athlete_id,sport,effective_date,power_zone_bounds) values($1,'cycling','2026-11-05',$2)",[A,bounds]),/check constraint/);
  await assert.rejects(insert(A,'NaN'),/check constraint/);
  await assert.rejects(db.query("insert into public.athlete_physiology(athlete_id,sport,effective_date,lthr,hr_max) values($1,'cycling','2026-11-05',190,180)",[A]),/check constraint/);
  for(const id of [B,D,ADMIN]){await as(id);assert.equal((await db.query('select count(*)::int n from public.athlete_physiology')).rows[0].n,0);await assert.rejects(insert(A,200,id),/row-level security/);}
  await as(D);await assert.rejects(insert(B,200,D),/row-level security/);
  await as(A);assert.equal((await db.query('select count(*)::int n from public.athlete_physiology')).rows[0].n,2);await insert(A,275,A);
  await db.exec('reset role');await db.query("update public.coach_athletes set status='revoked' where coach_id=$1 and athlete_id=$2",[C,A]);
  await as(C);assert.equal((await db.query('select count(*)::int n from public.athlete_physiology')).rows[0].n,0);await assert.rejects(insert(),/row-level security/);
  await as(A);assert.equal((await db.query('select count(*)::int n from public.athlete_physiology')).rows[0].n,3);
  await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from public.athlete_physiology'),/permission denied/);
 }finally{await db.close();}
});
