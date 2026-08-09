import { createClient } from '@supabase/supabase-js'
import { env } from './env.js'

// Service role: bypassa la RLS. Non deve mai lasciare questo processo server-side
// (mai inviato al browser/PWA, mai loggato, mai committato).
export const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false },
})
