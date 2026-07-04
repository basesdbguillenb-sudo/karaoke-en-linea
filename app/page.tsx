'use client';

import { useEffect, useState } from 'react';
import YouTube from 'react-youtube';
import { supabase } from '../lib/supabaseClient';

type Cancion = {
  id: string;
  sala_id: string;
  youtube_url: string;
  titulo: string;
  cantante: string;
  estado: 'en_espera' | 'reproduciendo' | 'completada';
  creado_en: string;
};

const extraerYouTubeId = (url: string) => {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
};

export const obtenerTituloYouTube = async (url: string) => {
  try {
     const res = await fetch(`https://noembed.com/embed?dataType=json&url=${url}`);
     const data = await res.json();
     return data.title || 'Pista de YouTube';
  } catch (error) {
     return 'Pista de YouTube';
  }
};

export default function TvScreen() {
  const [salaId, setSalaId] = useState<string | null>(null);
  const [codigoSala] = useState<string>('KARAOKE-HOME');
  const [cola, setCola] = useState<Cancion[]>([]);
  const [cancionActual, setCancionActual] = useState<Cancion | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [haInteractuado, setHaInteractuado] = useState(false);
  const [puntaje, setPuntaje] = useState<number | null>(null);

  useEffect(() => {
    setIsClient(true);
    inicializarSala();
  }, []);

  useEffect(() => {
    if (!salaId) return;
    cargarCola();
    const channel = supabase
      .channel('cambios_cola')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lista_reproduccion', filter: `sala_id=eq.${salaId}` },
        () => cargarCola()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [salaId]);

  const inicializarSala = async () => {
    const { data } = await supabase.from('salas').select('*').eq('codigo_sala', codigoSala).single();
    if (!data) {
      const { data: nuevaSala } = await supabase.from('salas').insert([{ codigo_sala: codigoSala }]).select().single();
      if (nuevaSala) setSalaId(nuevaSala.id);
    } else {
      setSalaId(data.id);
    }
  };

  const cargarCola = async () => {
    if (!salaId) return;
    const { data } = await supabase.from('lista_reproduccion').select('*').eq('sala_id', salaId).order('creado_en', { ascending: true });
    if (data) {
      const pendientes = data.filter((c) => c.estado === 'en_espera');
      const actual = data.find((c) => c.estado === 'reproduciendo');
      setCola(pendientes);
      
      if (actual) {
         setCancionActual(actual);
      } else if (pendientes.length > 0 && !actual) {
         reproducirSiguiente(pendientes[0]);
      } else {
         setCancionActual(null);
      }
    }
  };

  const reproducirSiguiente = async (cancion: Cancion) => {
    await supabase.from('lista_reproduccion').update({ estado: 'reproduciendo' }).eq('id', cancion.id);
  };

  const procesarFinDeCancion = () => {
    const scoreAleatorio = Math.floor(Math.random() * 26) + 75;
    setPuntaje(scoreAleatorio);

    setTimeout(async () => {
      setPuntaje(null);
      if (cancionActual) {
        setCancionActual(null); 
        await supabase.from('lista_reproduccion').update({ estado: 'completada' }).eq('id', cancionActual.id);
      }
    }, 5000);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const url = e.dataTransfer.getData('text/plain');
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
       const tituloReal = await obtenerTituloYouTube(url);
       await supabase.from('lista_reproduccion').insert([{ 
         sala_id: salaId, 
         youtube_url: url, 
         titulo: tituloReal, 
         cantante: 'El DJ Local',
         estado: 'en_espera' 
       }]);
    } else {
       alert("Por favor arrastra un enlace válido de YouTube.");
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); };

  if (!isClient) return null;

  if (!haInteractuado) {
    return (
      <div className="flex h-screen w-full bg-gray-950 items-center justify-center flex-col text-white">
        <h1 className="text-5xl font-black text-purple-500 mb-8 tracking-widest">KARAOKE SESSIONS</h1>
        <button 
          onClick={() => setHaInteractuado(true)} 
          className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-4 px-10 rounded-full text-2xl shadow-[0_0_30px_rgba(147,51,234,0.6)] transition-all transform hover:scale-105"
        >
          🎵 Iniciar Pantalla Principal
        </button>
      </div>
    );
  }

  const youtubeOpts = {
    height: '100%',
    width: '100%',
    playerVars: { autoplay: 1, controls: 1 },
  };

  return (
    <div className="flex h-screen bg-gray-900 text-white font-sans" onDrop={handleDrop} onDragOver={handleDragOver}>
      <div className="flex-1 flex flex-col p-6">
        <div className="flex justify-between items-center mb-6 bg-gray-800 p-4 rounded-xl border border-gray-700">
          <h1 className="text-3xl font-bold tracking-wider text-purple-400">KARAOKE SESSIONS</h1>
          <div className="bg-purple-600 px-6 py-2 rounded-lg text-xl font-mono font-bold shadow-[0_0_15px_rgba(147,51,234,0.5)]">
            CÓDIGO: {codigoSala}
          </div>
        </div>
        
        <div className="flex-1 bg-black rounded-xl overflow-hidden shadow-2xl relative border border-gray-800 flex items-center justify-center">
          
          {puntaje !== null ? (
            <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-indigo-900 to-purple-900 flex flex-col items-center justify-center z-50 animate-pulse">
              <h2 className="text-5xl font-bold text-white mb-6">¡CANCIÓN TERMINADA!</h2>
              <p className="text-3xl text-purple-300 mb-8">Tu puntaje final es:</p>
              <div className="text-[150px] font-black text-yellow-400 drop-shadow-[0_0_40px_rgba(250,204,21,0.8)]">
                {puntaje}
              </div>
              <p className="mt-8 text-xl text-gray-300">Preparando la siguiente pista...</p>
            </div>
          ) : 
          
          cancionActual && extraerYouTubeId(cancionActual.youtube_url) ? (
            <>
              {/* CARTEL FLOTANTE DEL CANTANTE ACTUAL */}
              <div className="absolute top-6 left-1/2 transform -translate-x-1/2 z-40 bg-purple-900/90 border-2 border-purple-400 px-8 py-3 rounded-full shadow-[0_0_30px_rgba(147,51,234,0.7)] text-center backdrop-blur-sm pointer-events-none">
                 <p className="text-purple-200 text-sm font-bold uppercase tracking-widest mb-1">Turno de la Estrella</p>
                 <p className="text-white text-3xl font-black">🎤 {cancionActual.cantante || 'Invitado'}</p>
              </div>

              <YouTube
                videoId={extraerYouTubeId(cancionActual.youtube_url) as string}
                opts={youtubeOpts}
                onEnd={procesarFinDeCancion}
                className="absolute top-0 left-0 w-full h-full"
                iframeClassName="w-full h-full"
              />
              
              <button 
                onClick={procesarFinDeCancion}
                className="absolute bottom-10 right-10 bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-6 rounded-full shadow-[0_0_15px_rgba(220,38,38,0.7)] transition-all hover:scale-110 z-40 text-lg flex items-center gap-2"
              >
                ⏭ Saltar Pista
              </button>
            </>
          ) : (
            <div className="text-center text-gray-500 flex flex-col items-center p-8 border-2 border-dashed border-gray-700 rounded-xl w-3/4">
               <div className="text-7xl mb-4 animate-bounce">🎤</div>
               <p className="text-3xl font-semibold mb-4 text-gray-300">Pantalla de Karaoke Activa</p>
               <p className="text-xl">Usa el DJ Remote en tu celular para enviar canciones y anunciar a los cantantes.</p>
            </div>
          )}
        </div>
      </div>

      <div className="w-[400px] bg-gray-800 border-l border-gray-700 p-6 flex flex-col shadow-2xl z-10">
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-2 border-b border-gray-700 pb-4">
          Cola de Reproducción
        </h2>
        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
           {cancionActual && (
              <div className="p-4 bg-purple-900/60 border-2 border-purple-500 rounded-xl shadow-lg relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 bg-purple-400 h-full"></div>
                <p className="text-xs text-purple-300 font-bold mb-1 tracking-widest uppercase">Cantando Ahora</p>
                <p className="font-black text-xl text-yellow-400 mb-1">🎤 {cancionActual.cantante || 'Invitado'}</p>
                <p className="font-medium text-sm leading-tight text-white line-clamp-2">{cancionActual.titulo}</p>
              </div>
           )}
           {cola.map((cancion, index) => (
             <div key={cancion.id} className="p-4 bg-gray-700/50 rounded-xl flex items-center gap-4 border border-gray-600 transition-all hover:bg-gray-600">
                <span className="text-purple-400 font-black text-xl w-6 text-center">{index + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-yellow-400 text-sm mb-1 truncate">🎤 {cancion.cantante || 'Invitado'}</p>
                  <p className="font-medium text-xs text-gray-300 line-clamp-2">{cancion.titulo}</p>
                </div>
             </div>
           ))}
           {cola.length === 0 && !cancionActual && (
             <div className="mt-10 p-6 bg-gray-700/30 rounded-xl border border-gray-600 text-center">
                <p className="text-gray-400 font-medium">No hay cantantes en espera.</p>
             </div>
           )}
        </div>
      </div>
    </div>
  );
}