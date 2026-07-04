'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';

export default function RemoteControl() {
  // ESTADOS DE SEGURIDAD
  const [isAuth, setIsAuth] = useState(false);
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [usuarioActivo, setUsuarioActivo] = useState('');

  // ESTADOS DEL KARAOKE
  const [salaId, setSalaId] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [cantante, setCantante] = useState('');
  const [nombreCancion, setNombreCancion] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const inicializarSala = async () => {
      const { data } = await supabase.from('salas').select('id').eq('codigo_sala', 'KARAOKE-HOME').single();
      if (data) setSalaId(data.id);
    };
    inicializarSala();
  }, []);

  // SISTEMA DE LOGIN (VALIDA Y REGISTRA EN EL LOG)
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data } = await supabase
      .from('usuarios')
      .select('*')
      .eq('usuario', loginUser.toLowerCase())
      .eq('password', loginPass)
      .single();

    if (data) {
      setIsAuth(true);
      setUsuarioActivo(data.usuario);
      // Registrar evento exitoso
      await supabase.from('log_ingresos').insert([{ usuario: data.usuario, evento: 'INGRESO EXITOSO AL DJ REMOTE' }]);
    } else {
      // Registrar intrusión
      await supabase.from('log_ingresos').insert([{ usuario: loginUser || 'Desconocido', evento: 'INTENTO FALLIDO AL DJ REMOTE' }]);
      alert("Usuario o contraseña incorrectos.");
    }
  };

  const agregarCancion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || !salaId) return;
    setIsSubmitting(true);

    try {
      let tituloFinal = nombreCancion.trim();
      if (!tituloFinal) {
        const res = await fetch(`https://noembed.com/embed?dataType=json&url=${url}`);
        const data = await res.json();
        tituloFinal = data.title || 'Pista de YouTube';
      }

      const cantanteFinal = cantante.trim() || 'Alguien Valiente';

      await supabase.from('lista_reproduccion').insert([{
        sala_id: salaId,
        youtube_url: url,
        titulo: tituloFinal,
        cantante: cantanteFinal,
        estado: 'en_espera'
      }]);
      
      // Registrar evento en la bitácora de que este usuario envió una canción
      await supabase.from('log_ingresos').insert([{ usuario: usuarioActivo, evento: `AÑADIÓ CANCIÓN: ${tituloFinal}` }]);

      setUrl('');
      setCantante('');
      setNombreCancion('');
      alert(`¡La canción fue enviada a la TV! 🎤`);
    } catch (error) {
      alert("Hubo un error al enviar la pista.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // PANTALLA DE LOGIN DEL CONTROL REMOTO
  if (!isAuth) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950 text-white p-4">
        <form onSubmit={handleLogin} className="bg-gray-900 p-8 rounded-xl shadow-[0_0_20px_rgba(147,51,234,0.3)] border border-purple-500/30 w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-black tracking-widest text-white">DJ REMOTE</h1>
            <p className="text-purple-400 font-bold mt-2">Identificación Requerida</p>
          </div>
          <input type="text" placeholder="Usuario" value={loginUser} onChange={(e)=>setLoginUser(e.target.value)} className="w-full mb-4 p-4 bg-black border border-gray-700 rounded-lg text-white" required />
          <input type="password" placeholder="Contraseña" value={loginPass} onChange={(e)=>setLoginPass(e.target.value)} className="w-full mb-8 p-4 bg-black border border-gray-700 rounded-lg text-white" required />
          <button type="submit" className="w-full bg-purple-600 hover:bg-purple-500 font-bold py-4 rounded-xl text-lg shadow-lg">Entrar al Sistema</button>
        </form>
      </div>
    );
  }

  // PANTALLA DEL CONTROL REMOTO ACTIVO
  if (!salaId) return <div className="flex h-screen items-center justify-center bg-gray-950 text-white">Conectando...</div>;

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6 flex flex-col items-center">
      <div className="w-full max-w-md bg-gray-900 rounded-2xl shadow-[0_0_20px_rgba(147,51,234,0.3)] border border-purple-500/30 overflow-hidden">
        <div className="bg-purple-600 p-6 text-center relative">
          <button onClick={() => setIsAuth(false)} className="absolute top-4 right-4 text-xs bg-purple-800 px-3 py-1 rounded font-bold hover:bg-purple-900">Salir</button>
          <h1 className="text-2xl font-black tracking-widest text-white">DJ REMOTE</h1>
          <p className="text-purple-200 text-sm mt-1">Sesión activa como: <span className="font-black text-yellow-300">@{usuarioActivo.toUpperCase()}</span></p>
        </div>

        <form onSubmit={agregarCancion} className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-bold text-purple-400 mb-2">1. Enlace de YouTube</label>
            <input type="text" required value={url} onChange={(e) => setUrl(e.target.value)} className="w-full bg-black border border-gray-700 rounded-lg p-3 text-white focus:border-purple-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-bold text-purple-400 mb-2">2. ¿Quién canta?</label>
            <input type="text" value={cantante} onChange={(e) => setCantante(e.target.value)} className="w-full bg-black border border-gray-700 rounded-lg p-3 text-white focus:border-purple-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-bold text-purple-400 mb-2">3. Nombre Canción (Opcional)</label>
            <input type="text" value={nombreCancion} onChange={(e) => setNombreCancion(e.target.value)} className="w-full bg-black border border-gray-700 rounded-lg p-3 text-white focus:border-purple-500 outline-none" />
          </div>

          <button type="submit" disabled={isSubmitting} className={`w-full font-bold py-4 rounded-xl text-lg shadow-lg ${isSubmitting ? 'bg-gray-600' : 'bg-purple-600 hover:scale-105'}`}>
            {isSubmitting ? 'Enviando...' : '🎵 Enviar a la TV'}
          </button>
        </form>
      </div>
    </div>
  );
}