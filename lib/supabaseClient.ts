import { createClient } from '@supabase/supabase-js';

// Usamos el operador || para darle un "valor de mentira" al compilador de Vercel.
// De esta forma, el proceso de 'build' no colapsa, y en producción usará las llaves reales.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bypass-build.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4c3BnYnJpcmVuaGp5YXB0Y2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxMTE4MjksImV4cCI6MjA5ODY4NzgyOX0.-wXRm2vyG3Q_2sAAw6PQ1mBvNHpAtHjiwvtaDIWaNjE';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);