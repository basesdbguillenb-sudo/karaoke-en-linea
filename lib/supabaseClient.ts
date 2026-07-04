import { createClient } from '@supabase/supabase-js';

// Usamos el operador || para darle un "valor de mentira" al compilador de Vercel.
// De esta forma, el proceso de 'build' no colapsa, y en producción usará las llaves reales.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bypass-build.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'bypass-build-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);