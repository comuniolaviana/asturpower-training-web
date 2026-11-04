// Actual PostgreSQL engine in WebAssembly. No hosted credentials or external requests.
import { PGlite } from '@electric-sql/pglite';
import { readFile,readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const db=new PGlite();
try{
  await db.exec(await read('tests/fixtures/garmin-auth-scaffold.sql'));
  await db.exec(await read('database/esquema-inicial-aplicado.sql'));
  await db.exec(await read('database/cambio-multirrol-aplicado.sql'));
  await db.exec(await read('tests/fixtures/garmin-sport-schema.sql'));
  const preflight=await read('database/tests/garmin-preflight.sql');
  assert.equal((await db.query(preflight)).rows[0].ready_for_first_application,true);
  // Schema drift must block readiness, without using hosted data or credentials.
  for(const change of [
    'ALTER TABLE public.activities ALTER COLUMN title TYPE varchar',
    'ALTER TABLE public.garmin_connections DISABLE ROW LEVEL SECURITY',
    'GRANT SELECT ON public.garmin_connections TO anon',
    'CREATE FUNCTION public.claim_garmin_lock() RETURNS boolean LANGUAGE sql AS $$SELECT true$$',
  ]){
    await db.exec('BEGIN; '+change+';');
    assert.equal((await db.query(preflight)).rows[0].ready_for_first_application,false);
    await db.exec('ROLLBACK;');
  }
  assert.equal((await db.query(preflight)).rows[0].ready_for_first_application,true);
  const migrations=(await readdir(new URL('supabase/migrations/',root))).filter(f=>f.endsWith('_garmin_sync.sql'));
  assert.equal(migrations.length,1,'one canonical synchronization migration');
  await db.exec(await read('supabase/migrations/'+migrations[0]));
  assert.equal((await db.query(preflight)).rows[0].ready_for_first_application,false,'first-apply check blocks already applied migrations');
  const results=await db.exec(await read('database/tests/garmin-sync.sql'));
  const assertions=results.flatMap(r=>r.rows||[]).find(r=>r.jsonb_build_object)?.jsonb_build_object;
  assert.ok(assertions?.sql_assertions_passed>=25);
  const after=await db.query(`SELECT (SELECT count(*)::int FROM auth.users) AS users,
    (SELECT count(*)::int FROM public.activities) AS activities,
    (SELECT count(*)::int FROM public.garmin_connections) AS connections,
    (SELECT count(*)::int FROM public.garmin_webhook_inbox) AS deliveries`);
  assert.deepEqual(after.rows[0],{users:0,activities:0,connections:0,deliveries:0});
  console.log(JSON.stringify({engine:'PostgreSQL/PGlite',preflight_scenarios:5,...assertions,afterRollback:after.rows[0]},null,2));
}finally{await db.close();}
