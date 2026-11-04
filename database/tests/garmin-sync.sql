-- Run with the Garmin synchronization schema installed, in an isolated transaction.
-- All accounts, relationships, workouts and activities below are disposable fixtures.
BEGIN;
CREATE TEMP TABLE garmin_assertions(n integer);
INSERT INTO garmin_assertions VALUES(0);
CREATE FUNCTION pg_temp.garmin_expect(ok boolean,label text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Garmin regression: %',label; END IF;
  UPDATE garmin_assertions SET n=n+1;
END; $$;

INSERT INTO auth.users(id,aud,role,email) VALUES
 ('c9999999-0000-4000-8000-000000000001','authenticated','authenticated','coach-a-garmin@example.invalid'),
 ('c9999999-0000-4000-8000-000000000002','authenticated','authenticated','coach-b-garmin@example.invalid'),
 ('a9999999-0000-4000-8000-000000000001','authenticated','authenticated','athlete-a-garmin@example.invalid'),
 ('a9999999-0000-4000-8000-000000000002','authenticated','authenticated','athlete-b-garmin@example.invalid');
INSERT INTO public.profiles(user_id,display_name) VALUES
 ('c9999999-0000-4000-8000-000000000001','Ficticio A'),('c9999999-0000-4000-8000-000000000002','Ficticio B'),
 ('a9999999-0000-4000-8000-000000000001','Ciclista ficticio A'),('a9999999-0000-4000-8000-000000000002','Ciclista ficticio B');
INSERT INTO public.user_roles(user_id,role) VALUES
 ('c9999999-0000-4000-8000-000000000001','coach'),('c9999999-0000-4000-8000-000000000002','coach'),
 ('a9999999-0000-4000-8000-000000000001','athlete'),('a9999999-0000-4000-8000-000000000002','athlete');
INSERT INTO public.coach_athletes(coach_id,athlete_id,status) VALUES
 ('c9999999-0000-4000-8000-000000000001','a9999999-0000-4000-8000-000000000001','active'),
 ('c9999999-0000-4000-8000-000000000002','a9999999-0000-4000-8000-000000000002','active');
INSERT INTO public.garmin_connections(athlete_id,garmin_user_id,access_token_ciphertext,refresh_token_ciphertext,
 access_expires_at,refresh_expires_at,permissions,connected_at) VALUES
 ('a9999999-0000-4000-8000-000000000001','regression-garmin-a','fixture.encrypted.value','fixture.encrypted.value',now()+interval '1 hour',now()+interval '1 day',ARRAY['ACTIVITY_EXPORT','WORKOUT_IMPORT'],now()-interval '1 day'),
 ('a9999999-0000-4000-8000-000000000002','regression-garmin-b','fixture.encrypted.value','fixture.encrypted.value',now()+interval '1 hour',now()+interval '1 day',ARRAY['ACTIVITY_EXPORT','WORKOUT_IMPORT'],now()-interval '1 day');

SELECT pg_temp.garmin_expect(NOT has_table_privilege('authenticated','public.planned_workouts','TRUNCATE'),'no truncate bypass');
SELECT pg_temp.garmin_expect(NOT has_table_privilege('authenticated','public.garmin_webhook_inbox','SELECT'),'inbox private');
SELECT pg_temp.garmin_expect(NOT has_table_privilege('anon','public.garmin_connections','SELECT'),'tokens private anon');
SELECT pg_temp.garmin_expect(NOT has_table_privilege('authenticated','public.garmin_connections','SELECT'),'tokens private athlete/coach');
SELECT pg_temp.garmin_expect(NOT has_function_privilege('authenticated','public.reserve_garmin_call(uuid,boolean)','EXECUTE'),'quota server only');
SELECT pg_temp.garmin_expect(NOT has_function_privilege('anon','public.upsert_garmin_activity(jsonb,timestamptz)','EXECUTE'),'import server only');
SELECT pg_temp.garmin_expect((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN
 ('public.garmin_sync_locks'::regclass,'public.garmin_api_requests'::regclass,'public.garmin_workout_exports'::regclass,
 'public.garmin_webhook_inbox'::regclass,'public.garmin_activity_versions'::regclass)),'all new tables RLS');
GRANT SELECT,UPDATE ON garmin_assertions TO authenticated;
SELECT set_config('request.jwt.claim.sub','c9999999-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.planned_workouts(id,coach_id,athlete_id,scheduled_date,sport,title,duration_minutes)
 VALUES('d9999999-0000-4000-8000-000000000001','c9999999-0000-4000-8000-000000000001',
 'a9999999-0000-4000-8000-000000000001','2026-11-05','cycling','Calendario ficticio',30);
SELECT pg_temp.garmin_expect(EXISTS(SELECT 1 FROM public.planned_workouts WHERE id='d9999999-0000-4000-8000-000000000001'),'calendar insert still works');
UPDATE public.planned_workouts SET duration_minutes=45 WHERE id='d9999999-0000-4000-8000-000000000001';
SELECT pg_temp.garmin_expect((SELECT duration_minutes=45 FROM public.planned_workouts WHERE id='d9999999-0000-4000-8000-000000000001'),'calendar update still works');
DELETE FROM public.planned_workouts WHERE id='d9999999-0000-4000-8000-000000000001';
SELECT pg_temp.garmin_expect(NOT EXISTS(SELECT 1 FROM public.planned_workouts WHERE id='d9999999-0000-4000-8000-000000000001'),'calendar delete still works');
RESET ROLE;

SELECT pg_temp.garmin_expect(public.claim_garmin_lock('fixture','d9999999-0000-4000-8000-000000000001',120),'first lease');
SELECT pg_temp.garmin_expect(NOT public.claim_garmin_lock('fixture','d9999999-0000-4000-8000-000000000002',120),'second lease blocked');
SELECT public.release_garmin_lock('fixture','d9999999-0000-4000-8000-000000000002');
SELECT pg_temp.garmin_expect(EXISTS(SELECT 1 FROM public.garmin_sync_locks WHERE key='fixture'),'wrong owner cannot release');
SELECT public.release_garmin_lock('fixture','d9999999-0000-4000-8000-000000000001');
SELECT pg_temp.garmin_expect(NOT EXISTS(SELECT 1 FROM public.garmin_sync_locks WHERE key='fixture'),'correct owner releases');

DO $$DECLARE i integer; r jsonb; BEGIN
 FOR i IN 1..100 LOOP
  r=public.reserve_garmin_call('a9999999-0000-4000-8000-000000000001',true);
  IF (r->>'allowed')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'app quota too early'; END IF;
 END LOOP;
 PERFORM pg_temp.garmin_expect((public.reserve_garmin_call('a9999999-0000-4000-8000-000000000001',false)->>'allowed')::boolean=false,'100 app calls includes OAuth');
END $$;
DELETE FROM public.garmin_api_requests WHERE athlete_id='a9999999-0000-4000-8000-000000000001';
INSERT INTO public.garmin_api_requests(athlete_id,oauth,requested_at)
 SELECT 'a9999999-0000-4000-8000-000000000001',false,now()-interval '2 minutes' FROM generate_series(1,200);
SELECT pg_temp.garmin_expect((public.reserve_garmin_call('a9999999-0000-4000-8000-000000000001',false)->>'allowed')::boolean=false,'200 user calls per day');
SELECT pg_temp.garmin_expect((public.reserve_garmin_call('a9999999-0000-4000-8000-000000000001',true)->>'allowed')::boolean=true,'OAuth excluded from user daily count');
SELECT pg_temp.garmin_expect((public.reserve_garmin_call('a9999999-0000-4000-8000-000000000002',false)->>'allowed')::boolean=true,'second athlete has independent daily quota');

INSERT INTO public.garmin_webhook_inbox(id,payload_ciphertext) VALUES(repeat('a',64),'fixture.encrypted.value');
SELECT pg_temp.garmin_expect((SELECT count(*)=1 FROM public.claim_garmin_inbox(5)),'claim durable inbox');
SELECT pg_temp.garmin_expect((SELECT count(*)=0 FROM public.claim_garmin_inbox(5)),'in-progress delivery not reclaimed early');
SELECT pg_temp.garmin_expect((SELECT attempts=1 FROM public.garmin_webhook_inbox WHERE id=repeat('a',64)),'attempt count');

SELECT public.upsert_garmin_activity(jsonb_build_object('athlete_id','a9999999-0000-4000-8000-000000000001',
 'external_id','regression-activity','started_at','2026-11-04T10:00:00Z','sport','cycling','title','Ficticia A',
 'duration_seconds',600,'distance_meters',0,'avg_heart_rate',120),now());
SELECT public.upsert_garmin_activity(jsonb_build_object('athlete_id','a9999999-0000-4000-8000-000000000001',
 'external_id','regression-activity','started_at','2026-11-04T10:00:00Z','sport','cycling','title','Ficticia A',
 'duration_seconds',600),now());
SELECT public.upsert_garmin_activity(jsonb_build_object('athlete_id','a9999999-0000-4000-8000-000000000002',
 'external_id','regression-activity','started_at','2026-11-04T10:00:00Z','sport','cycling','title','Ficticia B',
 'duration_seconds',900),now());
SELECT pg_temp.garmin_expect((SELECT count(*)=2 FROM public.activities WHERE external_id='regression-activity'),'dedup per athlete');
SELECT pg_temp.garmin_expect((SELECT distance_meters=0 AND avg_heart_rate=120 FROM public.activities
 WHERE athlete_id='a9999999-0000-4000-8000-000000000001' AND external_id='regression-activity'),'null retry preserves metrics and zero');

GRANT SELECT,UPDATE ON garmin_assertions TO authenticated;
SELECT set_config('request.jwt.claim.sub','c9999999-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.garmin_expect((SELECT count(*)=1 FROM public.activities WHERE external_id='regression-activity'),'coach A sees only linked athlete');
SELECT pg_temp.garmin_expect(NOT EXISTS(SELECT 1 FROM public.activities WHERE athlete_id='a9999999-0000-4000-8000-000000000002'),'coach A cannot see athlete B');
DO $$ BEGIN
 BEGIN PERFORM public.claim_garmin_inbox(5); RAISE EXCEPTION 'client executed privileged inbox';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO public.activities(athlete_id,source,external_id,started_at,sport,title,duration_seconds)
 VALUES('a9999999-0000-4000-8000-000000000001','garmin_api','forged',now(),'cycling','forged',60);
 RAISE EXCEPTION 'client forged Garmin data'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','a9999999-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.garmin_expect((SELECT count(*)=1 FROM public.activities WHERE external_id='regression-activity'),'athlete B sees only own');
RESET ROLE;
UPDATE public.coach_athletes SET status='revoked' WHERE coach_id='c9999999-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','c9999999-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.garmin_expect(NOT EXISTS(SELECT 1 FROM public.activities WHERE external_id='regression-activity'),'revoked coach loses activity access');
RESET ROLE;

SELECT public.apply_garmin_permissions('regression-garmin-a',ARRAY[]::text[],500);
SELECT public.apply_garmin_permissions('regression-garmin-a',ARRAY['ACTIVITY_EXPORT'],400);
SELECT public.apply_garmin_permissions('regression-garmin-a',ARRAY['ACTIVITY_EXPORT'],500);
SELECT pg_temp.garmin_expect((SELECT permissions=ARRAY[]::text[] FROM public.garmin_connections WHERE garmin_user_id='regression-garmin-a'),'old permission update cannot restore consent');
SELECT public.upsert_garmin_activity(jsonb_build_object('athlete_id','a9999999-0000-4000-8000-000000000001',
 'external_id','after-revocation','started_at','2026-11-04T10:00:00Z','sport','cycling','title','Ficticia revocada','duration_seconds',600),now());
SELECT pg_temp.garmin_expect(NOT EXISTS(SELECT 1 FROM public.activities WHERE external_id='after-revocation'),'permission withdrawal stops import atomically');
SET LOCAL ROLE service_role;
SELECT public.claim_garmin_lock('service-fixture','d9999999-0000-4000-8000-000000000001',30);
SELECT public.release_garmin_lock('service-fixture','d9999999-0000-4000-8000-000000000001');
SELECT public.apply_garmin_permissions('regression-garmin-b',ARRAY['ACTIVITY_EXPORT','WORKOUT_IMPORT'],600);
SELECT public.upsert_garmin_activity(jsonb_build_object('athlete_id','a9999999-0000-4000-8000-000000000002',
 'external_id','service-role-activity','started_at','2026-11-04T10:00:00Z','sport','cycling','title','Servicio ficticio','duration_seconds',600),now());
RESET ROLE;
SELECT pg_temp.garmin_expect(EXISTS(SELECT 1 FROM public.activities WHERE external_id='service-role-activity'),'server role can import with its actual grants');
SELECT jsonb_build_object('sql_assertions_passed',(SELECT n FROM garmin_assertions),'additional_denial_checks',2);
ROLLBACK;
