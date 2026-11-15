-- Temporary, guarded headroom for the existing Supabase Free Storage allowance.
-- Verified input: Free includes 1 GB object storage; this migration caps AsturPower at
-- 900 MiB (943,718,400 bytes), leaving >100 MiB outside our internal budget.
-- It does NOT upgrade the plan, remove any originals, or reprocess expired callbacks.
-- A later paid-capacity migration / R2 architecture is required for multi-athlete history.
--
-- IMPORTANT: This migration must not be deployed until the *actual* project's
-- Storage usage and subscription are confirmed. An SQL guard checks stored bytes,
-- but cannot query the organisation's subscription or its other projects' usage.
DO $garmin_headroom$
DECLARE
  budget CONSTANT bigint := 943718400; -- 900 MiB
  stored_bytes bigint;
  recorded_bytes bigint;
  targets regprocedure[] := ARRAY[
    'asturpower_private.reserve_activity_series(uuid,text,integer)'::regprocedure,
    'asturpower_private.reserve_garmin_original(text,text,bigint,jsonb,boolean)'::regprocedure,
    'public.start_garmin_api_file(uuid,text,text,text,text,timestamptz,jsonb)'::regprocedure
  ];
  before_text text[] := ARRAY[
    'if total+p_bytes>838860800 then',
    'if total+p_byte_size>838860800 then',
    'if used+56623104>838860800 then'
  ];
  after_text text[] := ARRAY[
    'if total+p_bytes>943718400 then',
    'if total+p_byte_size>943718400 then',
    'if used+56623104>943718400 then'
  ];
  definition text;
  idx integer;
BEGIN
  -- The sum of indexed object metadata may exceed the internal manifests.
  -- Consider both; never increase a cap on an already overfull store.
  SELECT coalesce(sum((metadata->>'size')::bigint),0) INTO stored_bytes
  FROM storage.objects
  WHERE metadata->>'size' ~ '^[0-9]{1,15}$';

  SELECT
    coalesce((SELECT sum(byte_size) FROM public.garmin_original_archives),0)
    + coalesce((SELECT sum(byte_size) FROM public.garmin_activity_series),0)
    + coalesce((SELECT sum(reserved_bytes) FROM public.garmin_api_files
                WHERE status IN ('downloading','uploading','stored','processing')),0)
    INTO recorded_bytes;

  IF greatest(stored_bytes,recorded_bytes) > budget THEN
    RAISE EXCEPTION 'garmin_headroom_preflight_storage_exceeds_cap';
  END IF;

  -- Check all three exact target definitions before changing any of them.
  -- Abort the entire migration if earlier work changed their semantics.
  FOR idx IN 1..array_length(targets,1) LOOP
    definition := pg_get_functiondef(targets[idx]);
    IF position(before_text[idx] IN definition)=0
       OR position(after_text[idx] IN definition)>0 THEN
      RAISE EXCEPTION 'garmin_headroom_preflight_definition_changed: %',targets[idx];
    END IF;
  END LOOP;

  FOR idx IN 1..array_length(targets,1) LOOP
    definition := pg_get_functiondef(targets[idx]);
    EXECUTE replace(definition,before_text[idx],after_text[idx]);
  END LOOP;
END
$garmin_headroom$;
