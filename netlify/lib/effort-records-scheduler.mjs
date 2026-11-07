import {createClient} from '@supabase/supabase-js';
export async function resumeEffortRecords({env,createClientFn=createClient}){
 if(env.ASTURPOWER_APP_ENABLED!=='true'||env.SUPABASE_URL!=='https://drnefgxdrultneeodtsy.supabase.co'||!env.SUPABASE_SECRET_KEY?.startsWith('sb_secret_'))return;
 try{const db=createClientFn(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,options={})=>fetch(url,{...options,signal:AbortSignal.timeout(5000)})}});await db.rpc('dispatch_pending_effort_jobs');}catch{/* Persisted jobs resume at the following scheduled run. */}
}
