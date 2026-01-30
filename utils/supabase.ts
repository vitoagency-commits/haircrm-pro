import { createClient } from '@supabase/supabase-js'

// Recupera le chiavi dalle variabili d'ambiente di Vite
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Controllo di sicurezza
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('⚠️ ATTENZIONE: Mancano le chiavi di Supabase! Controlla il file .env o le impostazioni di Vercel.')
}

// Crea ed esporta il client Supabase
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
