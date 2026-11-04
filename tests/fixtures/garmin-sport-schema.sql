-- Public sport-table metadata read from AsturPower on 2026-11-04. No records.
CREATE TABLE public.activities (id uuid NOT NULL DEFAULT gen_random_uuid(), athlete_id uuid NOT NULL, source text NOT NULL, external_id text NOT NULL, started_at timestamp with time zone NOT NULL, sport text NOT NULL, title text NOT NULL, duration_seconds integer NOT NULL, distance_meters numeric(12,2), elevation_gain_meters numeric(10,2), avg_heart_rate integer, avg_power_watts integer, imported_at timestamp with time zone NOT NULL DEFAULT now(),FOREIGN KEY (athlete_id) REFERENCES auth.users(id) ON DELETE CASCADE,UNIQUE (athlete_id, source, external_id),CHECK (((avg_heart_rate >= 25) AND (avg_heart_rate <= 250))),CHECK (((avg_power_watts >= 0) AND (avg_power_watts <= 3500))),CHECK (((distance_meters >= (0)::numeric) AND (distance_meters <= (10000000)::numeric))),CHECK (((duration_seconds >= 1) AND (duration_seconds <= 172800))),CHECK (((elevation_gain_meters >= (0)::numeric) AND (elevation_gain_meters <= (100000)::numeric))),CHECK (((length(external_id) >= 1) AND (length(external_id) <= 180))),PRIMARY KEY (id),CHECK ((source = ANY (ARRAY['garmin_csv'::text, 'garmin_api'::text]))),CHECK ((sport = ANY (ARRAY['cycling'::text, 'running'::text, 'swimming'::text, 'walking'::text, 'strength'::text, 'other'::text]))),CHECK (((length(title) >= 1) AND (length(title) <= 160))));
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.activities TO service_role;
CREATE TABLE public.garmin_connections (athlete_id uuid NOT NULL, garmin_user_id text NOT NULL, access_token_ciphertext text NOT NULL, refresh_token_ciphertext text NOT NULL, access_expires_at timestamp with time zone NOT NULL, refresh_expires_at timestamp with time zone NOT NULL, permissions text[] NOT NULL DEFAULT '{}'::text[], connected_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now(),FOREIGN KEY (athlete_id) REFERENCES auth.users(id) ON DELETE CASCADE,CHECK (((length(garmin_user_id) >= 4) AND (length(garmin_user_id) <= 128))),UNIQUE (garmin_user_id),PRIMARY KEY (athlete_id));
ALTER TABLE public.garmin_connections ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.garmin_connections TO service_role;
CREATE TABLE public.garmin_oauth_states (state_hash text NOT NULL, athlete_id uuid NOT NULL, verifier_ciphertext text NOT NULL, redirect_uri text NOT NULL, expires_at timestamp with time zone NOT NULL, created_at timestamp with time zone NOT NULL DEFAULT now(), used_at timestamp with time zone,FOREIGN KEY (athlete_id) REFERENCES auth.users(id) ON DELETE CASCADE,PRIMARY KEY (state_hash),CHECK ((state_hash ~ '^[0-9a-f]{64}$'::text)));
ALTER TABLE public.garmin_oauth_states ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.garmin_oauth_states TO service_role;
CREATE TABLE public.planned_workouts (id uuid NOT NULL DEFAULT gen_random_uuid(), coach_id uuid NOT NULL, athlete_id uuid NOT NULL, scheduled_date date NOT NULL, sport text NOT NULL DEFAULT 'cycling'::text, title text NOT NULL, duration_minutes integer NOT NULL, intensity_target text, coach_notes text, status text NOT NULL DEFAULT 'planned'::text, created_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now(), steps jsonb,FOREIGN KEY (coach_id, athlete_id) REFERENCES coach_athletes(coach_id, athlete_id) ON UPDATE RESTRICT ON DELETE RESTRICT,CHECK (((coach_notes IS NULL) OR (char_length(coach_notes) <= 3000))),CHECK (((duration_minutes >= 1) AND (duration_minutes <= 1440))),CHECK (((intensity_target IS NULL) OR (char_length(intensity_target) <= 180))),PRIMARY KEY (id),CHECK ((sport = ANY (ARRAY['cycling'::text, 'running'::text, 'swimming'::text, 'strength'::text, 'other'::text]))),CHECK ((status = ANY (ARRAY['planned'::text, 'completed'::text, 'cancelled'::text]))),CHECK (((steps IS NULL) OR ((jsonb_typeof(steps) = 'array'::text) AND ((jsonb_array_length(steps) >= 1) AND (jsonb_array_length(steps) <= 30)) AND (octet_length((steps)::text) <= 15000)))),CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 160))));
ALTER TABLE public.planned_workouts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.planned_workouts TO service_role;
GRANT ALL ON public.planned_workouts TO authenticated;
GRANT SELECT,INSERT,DELETE ON public.activities TO authenticated;
CREATE POLICY activities_delete_own_csv ON public.activities FOR DELETE TO authenticated USING (((athlete_id = ( SELECT auth.uid() AS uid)) AND (source = 'garmin_csv'::text)));
CREATE POLICY activities_insert_own_csv ON public.activities FOR INSERT TO authenticated WITH CHECK (((athlete_id = ( SELECT auth.uid() AS uid)) AND (source = 'garmin_csv'::text)));
CREATE POLICY activities_read_participants ON public.activities FOR SELECT TO authenticated USING (((athlete_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM coach_athletes ca
  WHERE ((ca.athlete_id = activities.athlete_id) AND (ca.coach_id = ( SELECT auth.uid() AS uid)) AND (ca.status = 'active'::text))))));
CREATE POLICY planned_workouts_delete_active_coach ON public.planned_workouts FOR DELETE TO authenticated USING (((coach_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM coach_athletes ca
  WHERE ((ca.coach_id = planned_workouts.coach_id) AND (ca.athlete_id = planned_workouts.athlete_id) AND (ca.status = 'active'::text))))));
CREATE POLICY planned_workouts_insert_active_coach ON public.planned_workouts FOR INSERT TO authenticated WITH CHECK (((coach_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM coach_athletes ca
  WHERE ((ca.coach_id = planned_workouts.coach_id) AND (ca.athlete_id = planned_workouts.athlete_id) AND (ca.status = 'active'::text))))));
CREATE POLICY planned_workouts_read_participants ON public.planned_workouts FOR SELECT TO authenticated USING (((athlete_id = ( SELECT auth.uid() AS uid)) OR ((coach_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM coach_athletes ca
  WHERE ((ca.coach_id = planned_workouts.coach_id) AND (ca.athlete_id = planned_workouts.athlete_id) AND (ca.status = 'active'::text)))))));
CREATE POLICY planned_workouts_update_active_coach ON public.planned_workouts FOR UPDATE TO authenticated USING (((coach_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM coach_athletes ca
  WHERE ((ca.coach_id = planned_workouts.coach_id) AND (ca.athlete_id = planned_workouts.athlete_id) AND (ca.status = 'active'::text)))))) WITH CHECK (((coach_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM coach_athletes ca
  WHERE ((ca.coach_id = planned_workouts.coach_id) AND (ca.athlete_id = planned_workouts.athlete_id) AND (ca.status = 'active'::text))))));
