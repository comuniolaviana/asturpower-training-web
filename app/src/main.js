import { createClient } from '@supabase/supabase-js';
import { mountApp, showUnavailable } from './ui.js';
import './style.css';
import './garmin-connect.css';
import './garmin-original.css';
import './planning.css';

const root = document.querySelector('#app');
try {
  const response = await fetch('/.netlify/functions/public-config', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error('Unavailable');
  const config = await response.json();
  if (!config.supabaseUrl || !config.publishableKey?.startsWith('sb_publishable_')) throw new Error('Invalid configuration');
  const client = createClient(config.supabaseUrl, config.publishableKey, {
    auth: {
      storage: window.sessionStorage,
      storageKey: 'asturpower-dev-auth',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  });
  mountApp(root, client);
} catch { showUnavailable(root); }

