import { createClient } from '@supabase/supabase-js';
import { mountApp } from './ui.js';
import {bootstrapApp} from './app-bootstrap.js';
import './style.css';
import './garmin-connect.css';
import './garmin-original.css';
import './planning.css';
import './performance.css';
import './pmc.css';
import {mountInstallApp} from './pwa.js';
import './pwa.css';
import './athlete-hub.css';
import './effort-records.css';

mountInstallApp();

bootstrapApp({root:document.querySelector('#app'),createClient,mountApp});

