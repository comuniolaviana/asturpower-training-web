-- AsturPower only. Additive schema for staged Garmin synchronization.
-- Review/apply as one transaction; does not enable any runtime feature.
BEGIN;

ALTER TABLE public.garmin_oauth_states ADD COLUMN IF NOT EXISTS consent_version text;
ALTER TABLE public.garmin_connections ADD COLUMN IF NOT EXISTS consent_version text;
ALTER TABLE public.garmin_connections ADD COLUMN IF NOT EXISTS permissions_changed_at bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.garmin_sync_locks (
  key text PRIMARY KEY CHECK(length(key) BETWEEN 1 AND 180),
  owner uuid NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS public.garmin_api_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  athlete_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  oauth boolean NOT NULL DEFAULT false,
  requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS garmin_requests_time_idx ON public.garmin_api_requests(requested_at);
CREATE INDEX IF NOT EXISTS garmin_requests_athlete_idx ON public.garmin_api_requests(athlete_id,requested_at);
CREATE TABLE IF NOT EXISTS public.garmin_workout_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  planned_workout_id uuid UNIQUE REFERENCES public.planned_workouts(id) ON DELETE SET NULL,
  athlete_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  coach_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
  scheduled_date date NOT NULL,
  status text NOT NULL CHECK(status IN ('prepared','creating','workout_created','scheduling','scheduled','uncertain','cancelled')),
  remote_workout_id bigint CHECK(remote_workout_id>0),
  remote_schedule_id bigint CHECK(remote_schedule_id>0),
  last_error text CHECK(length(last_error)<=80),
  retry_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS garmin_exports_athlete_idx ON public.garmin_workout_exports(athlete_id);
CREATE INDEX IF NOT EXISTS garmin_exports_coach_idx ON public.garmin_workout_exports(coach_id);
CREATE TABLE IF NOT EXISTS public.garmin_webhook_inbox (
  id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'),
  payload_ciphertext text,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','done','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  cursor integer NOT NULL DEFAULT 0 CHECK(cursor BETWEEN 0 AND 500),
  received_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error text CHECK(length(last_error)<=80)
);
CREATE INDEX IF NOT EXISTS garmin_inbox_pending_idx ON public.garmin_webhook_inbox(status,available_at);
-- Per-activity delivery ordering, private to the integration server.
CREATE TABLE IF NOT EXISTS public.garmin_activity_versions (
  athlete_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  received_at timestamptz NOT NULL,
  PRIMARY KEY(athlete_id,external_id)
);
ALTER TABLE public.garmin_sync_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garmin_api_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garmin_workout_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garmin_webhook_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garmin_activity_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.garmin_sync_locks,public.garmin_api_requests,public.garmin_workout_exports,
  public.garmin_webhook_inbox,public.garmin_activity_versions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.garmin_sync_locks,public.garmin_api_requests,
  public.garmin_workout_exports,public.garmin_webhook_inbox,public.garmin_activity_versions TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.garmin_api_requests_id_seq TO service_role;
REVOKE ALL ON SEQUENCE public.garmin_api_requests_id_seq FROM PUBLIC,anon,authenticated;
-- These privileges bypass/provide capabilities outside ordinary row filtering;
-- none is used by the app's calendar CRUD.
REVOKE TRUNCATE,REFERENCES,TRIGGER ON public.planned_workouts FROM authenticated;

CREATE OR REPLACE FUNCTION public.claim_garmin_lock(p_key text,p_owner uuid,p_ttl_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE claimed uuid;
BEGIN
  IF p_ttl_seconds NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'invalid lease'; END IF;
  INSERT INTO public.garmin_sync_locks(key,owner,expires_at)
    VALUES(p_key,p_owner,now()+make_interval(secs=>p_ttl_seconds))
    ON CONFLICT(key) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at
      WHERE public.garmin_sync_locks.expires_at<=now()
    RETURNING owner INTO claimed;
  RETURN claimed IS NOT NULL;
END; $$;
CREATE OR REPLACE FUNCTION public.release_garmin_lock(p_key text,p_owner uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
  DELETE FROM public.garmin_sync_locks WHERE key=p_key AND owner=p_owner;
$$;
CREATE OR REPLACE FUNCTION public.reserve_garmin_call(p_athlete_id uuid,p_oauth boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE app_count integer; user_count integer; oldest timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('asturpower-garmin-quota',0));
  DELETE FROM public.garmin_api_requests WHERE requested_at<now()-interval '24 hours';
  SELECT count(*),min(requested_at) INTO app_count,oldest FROM public.garmin_api_requests
    WHERE requested_at>now()-interval '60 seconds';
  IF app_count>=100 THEN
    RETURN jsonb_build_object('allowed',false,'retry_after',greatest(1,ceil(extract(epoch FROM oldest+interval '60 seconds'-now()))));
  END IF;
  IF NOT p_oauth THEN
    SELECT count(*),min(requested_at) INTO user_count,oldest FROM public.garmin_api_requests
      WHERE athlete_id=p_athlete_id AND NOT oauth AND requested_at>now()-interval '24 hours';
    IF user_count>=200 THEN
      RETURN jsonb_build_object('allowed',false,'retry_after',greatest(1,ceil(extract(epoch FROM oldest+interval '24 hours'-now()))));
    END IF;
  END IF;
  INSERT INTO public.garmin_api_requests(athlete_id,oauth) VALUES(p_athlete_id,p_oauth);
  RETURN jsonb_build_object('allowed',true);
END; $$;
CREATE OR REPLACE FUNCTION public.apply_garmin_permissions(p_user_id text,p_permissions text[],p_changed_at bigint)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
  -- On equal timestamps keep the intersection: ambiguous ordering cannot restore consent.
  UPDATE public.garmin_connections SET permissions=CASE WHEN permissions_changed_at=p_changed_at
    THEN ARRAY(SELECT unnest(permissions) INTERSECT SELECT unnest(p_permissions)) ELSE p_permissions END,
    permissions_changed_at=p_changed_at,updated_at=now()
    WHERE garmin_user_id=p_user_id AND permissions_changed_at<=p_changed_at;
$$;
CREATE OR REPLACE FUNCTION public.claim_garmin_inbox(p_limit integer)
RETURNS SETOF public.garmin_webhook_inbox LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
  DELETE FROM public.garmin_oauth_states WHERE expires_at<now()-interval '1 day';
  DELETE FROM public.garmin_sync_locks WHERE expires_at<now();
  UPDATE public.garmin_webhook_inbox SET status='failed',payload_ciphertext=NULL,last_error='retention_expired'
    WHERE payload_ciphertext IS NOT NULL AND received_at<now()-interval '7 days';
  DELETE FROM public.garmin_webhook_inbox WHERE status IN ('done','failed') AND received_at<now()-interval '8 days';
  UPDATE public.garmin_webhook_inbox SET status='failed',last_error='attempt_limit'
    WHERE status='processing' AND attempts>=5 AND available_at<=now();
  UPDATE public.garmin_webhook_inbox b SET status='processing',attempts=b.attempts+1,
    available_at=now()+interval '5 minutes'
  WHERE b.id IN (SELECT id FROM public.garmin_webhook_inbox
    WHERE status IN ('pending','processing') AND attempts<5 AND available_at<=now()
    ORDER BY received_at FOR UPDATE SKIP LOCKED LIMIT least(greatest(p_limit,1),5))
  RETURNING b.*;
$$;
CREATE OR REPLACE FUNCTION public.upsert_garmin_activity(p_activity jsonb,p_received_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE athlete uuid := (p_activity->>'athlete_id')::uuid; external text := p_activity->>'external_id';
        accepted text;
BEGIN
  -- Recheck consent atomically with the import. The application also holds an athlete lease.
  IF NOT EXISTS(SELECT 1 FROM public.garmin_connections c
    WHERE c.athlete_id=athlete AND 'ACTIVITY_EXPORT'=ANY(c.permissions) AND c.connected_at<=p_received_at) THEN RETURN; END IF;
  INSERT INTO public.garmin_activity_versions(athlete_id,external_id,received_at)
    VALUES(athlete,external,p_received_at) ON CONFLICT(athlete_id,external_id)
    DO UPDATE SET received_at=excluded.received_at WHERE public.garmin_activity_versions.received_at<=excluded.received_at
    RETURNING external_id INTO accepted;
  IF accepted IS NULL THEN RETURN; END IF;
  INSERT INTO public.activities(athlete_id,source,external_id,started_at,sport,title,duration_seconds,
    distance_meters,elevation_gain_meters,avg_heart_rate,avg_power_watts)
  VALUES(athlete,'garmin_api',external,(p_activity->>'started_at')::timestamptz,p_activity->>'sport',p_activity->>'title',
    (p_activity->>'duration_seconds')::integer,(p_activity->>'distance_meters')::numeric,
    (p_activity->>'elevation_gain_meters')::numeric,(p_activity->>'avg_heart_rate')::integer,NULL)
  ON CONFLICT(athlete_id,source,external_id) DO UPDATE SET started_at=excluded.started_at,sport=excluded.sport,
    title=excluded.title,duration_seconds=excluded.duration_seconds,
    distance_meters=coalesce(excluded.distance_meters,public.activities.distance_meters),
    elevation_gain_meters=coalesce(excluded.elevation_gain_meters,public.activities.elevation_gain_meters),
    avg_heart_rate=coalesce(excluded.avg_heart_rate,public.activities.avg_heart_rate);
END; $$;

REVOKE ALL ON FUNCTION public.claim_garmin_lock(text,uuid,integer),public.release_garmin_lock(text,uuid),
  public.reserve_garmin_call(uuid,boolean),public.apply_garmin_permissions(text,text[],bigint),
  public.claim_garmin_inbox(integer),public.upsert_garmin_activity(jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_garmin_lock(text,uuid,integer),public.release_garmin_lock(text,uuid),
  public.reserve_garmin_call(uuid,boolean),public.apply_garmin_permissions(text,text[],bigint),
  public.claim_garmin_inbox(integer),public.upsert_garmin_activity(jsonb,timestamptz) TO service_role;
COMMENT ON TABLE public.garmin_webhook_inbox IS 'Server-only encrypted inbox. Done payloads erased; failed deliveries require review. No client access.';
COMMIT;
