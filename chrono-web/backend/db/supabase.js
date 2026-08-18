import { createClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';

if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
  console.warn("⚠️ Supabase credentials missing. DB features will fail.");
}

export const supabase = createClient(
  config.SUPABASE_URL || 'https://placeholder.supabase.co',
  config.SUPABASE_ANON_KEY || 'placeholder'
);
