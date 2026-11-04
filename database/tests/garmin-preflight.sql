-- Read-only catalog checks before FIRST application of 20261104115935_garmin_sync.sql.
-- No records, tokens, credentials, DDL or fixture writes. Run only on AsturPower.
WITH expected_columns(table_name,column_name,type_name) AS (VALUES
  ('garmin_connections','athlete_id','uuid'),('garmin_connections','garmin_user_id','text'),
  ('garmin_connections','access_token_ciphertext','text'),('garmin_connections','refresh_token_ciphertext','text'),
  ('garmin_connections','access_expires_at','timestamptz'),('garmin_connections','refresh_expires_at','timestamptz'),
  ('garmin_connections','permissions','_text'),('garmin_connections','connected_at','timestamptz'),
  ('garmin_connections','updated_at','timestamptz'),
  ('garmin_oauth_states','state_hash','text'),('garmin_oauth_states','athlete_id','uuid'),
  ('garmin_oauth_states','verifier_ciphertext','text'),('garmin_oauth_states','redirect_uri','text'),
  ('garmin_oauth_states','expires_at','timestamptz'),('garmin_oauth_states','used_at','timestamptz'),
  ('planned_workouts','id','uuid'),('planned_workouts','coach_id','uuid'),('planned_workouts','athlete_id','uuid'),
  ('planned_workouts','scheduled_date','date'),('planned_workouts','steps','jsonb'),('planned_workouts','status','text'),
  ('activities','id','uuid'),('activities','athlete_id','uuid'),('activities','source','text'),
  ('activities','external_id','text'),('activities','started_at','timestamptz'),('activities','sport','text'),
  ('activities','title','text'),('activities','duration_seconds','int4'),('activities','distance_meters','numeric'),
  ('activities','elevation_gain_meters','numeric'),('activities','avg_heart_rate','int4'),('activities','avg_power_watts','int4')
), checks(name,passed) AS (
  SELECT 'required_column_types',NOT EXISTS (
    SELECT 1 FROM expected_columns e LEFT JOIN information_schema.columns c
      ON c.table_schema='public' AND c.table_name=e.table_name AND c.column_name=e.column_name
    WHERE c.udt_name IS DISTINCT FROM e.type_name)
  UNION ALL SELECT 'required_roles',
    (SELECT count(*)=3 AND bool_and(CASE WHEN rolname='service_role' THEN rolbypassrls ELSE NOT rolbypassrls END)
      FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role'))
  UNION ALL SELECT 'existing_tables_have_rls',
    (SELECT count(*)=7 AND bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN
        ('profiles','user_roles','coach_athletes','planned_workouts','activities','garmin_connections','garmin_oauth_states'))
  UNION ALL SELECT 'oauth_storage_is_server_only',NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN (VALUES ('anon'),('authenticated')) roles(name)
    WHERE n.nspname='public' AND c.relname IN ('garmin_connections','garmin_oauth_states')
      AND has_table_privilege(roles.name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
  UNION ALL SELECT 'server_has_required_table_privileges',
    (SELECT count(*)=4 AND bool_and(has_table_privilege('service_role',c.oid,'SELECT')
      AND has_table_privilege('service_role',c.oid,'INSERT') AND has_table_privilege('service_role',c.oid,'UPDATE')
      AND has_table_privilege('service_role',c.oid,'DELETE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('planned_workouts','activities','garmin_connections','garmin_oauth_states'))
  UNION ALL SELECT 'activity_upsert_key',EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname='activities' AND c.contype='u' AND c.convalidated
      AND pg_get_constraintdef(c.oid)='UNIQUE (athlete_id, source, external_id)')
  UNION ALL SELECT 'foreign_key_targets',
    (SELECT count(*)=2 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE ((n.nspname='public' AND t.relname='planned_workouts') OR (n.nspname='auth' AND t.relname='users'))
        AND c.contype='p' AND pg_get_constraintdef(c.oid)='PRIMARY KEY (id)')
  UNION ALL SELECT 'new_relations_absent',NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN
      ('garmin_sync_locks','garmin_api_requests','garmin_api_requests_id_seq','garmin_workout_exports','garmin_webhook_inbox','garmin_activity_versions'))
  UNION ALL SELECT 'new_columns_absent',NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND
      ((table_name IN ('garmin_connections','garmin_oauth_states') AND column_name='consent_version')
        OR (table_name='garmin_connections' AND column_name='permissions_changed_at')))
  UNION ALL SELECT 'new_function_names_absent',NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN
      ('claim_garmin_lock','release_garmin_lock','reserve_garmin_call','apply_garmin_permissions','claim_garmin_inbox','upsert_garmin_activity'))
)
SELECT bool_and(passed) AS ready_for_first_application,
  jsonb_agg(jsonb_build_object('check',name,'passed',passed) ORDER BY name) AS checks FROM checks;
