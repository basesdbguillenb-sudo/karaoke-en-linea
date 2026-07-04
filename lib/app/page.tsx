'use client';

import { useEffect, useState } from 'react';
import ReactPlayer from 'react-player/youtube';
import { supabase } from '@/lib/supabaseClient';

type Cancion = {
  id: string;
  sala_id: string;
  youtube_url: string;
  titulo: string;
  estado: 'en_espera' | 'reproduciendo' | 'completada';
  creado_en: string;
};

export default function TvScreen() {
  const [salaId, setSalaId] = useState<string | null>(null);
  const [codigoSala] = useState<string>('KARAOKE-HOME');
  const [cola, setCola] = useState<Cancion[]>([]);
  const [cancionActual, setCancionActual] = useState<Cancion | null>(null);
  const [isClient, setIsClient] = useState(false);

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
        () => {
          cargarCola();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [salaId]);

  const inicializarSala = async () => {
    const { data } = await supabase
      .from('salas')
      .select('*')
      .eq('codigo_sala', codigoSala)
      .single();

    if (!data) {
      const { data: nuevaSala } = await supabase
        .from('salas')
        .insert([{ codigo_sala: codigoSala }])
        .select()
        .single();
      
      if (nuevaSala) setSalaId(nuevaSala.id);
    } else {
      setSalaId(data.id);
    }
  };

  const cargarCola = async () => {
    if (!salaId) return;
    const { data } = await supabase
      .from('lista_reproduccion')
      .select('*')
      .eq('sala_id', salaId)
      .order('creado_en', { ascending: true });

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
    await supabase
      .from('lista_reproduccion')
      .update({ estado: 'reproduciendo' })
      .eq('id', cancion.id);
    setCancionActual(cancion);
    cargarCola();
  };

  const marcarCompletada = async () => {
    if (cancionActual) {
      await supabase
        .from('lista_reproduccion')
        .update({ estado: 'completada' })
        .eq('id', cancionActual.id);
      cargarCola();
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const url = e.dataTransfer.getData('text/plain');
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
       await supabase.from('lista_reproduccion').insert([{
          sala_id: salaId,
          youtube_url: url,
          titulo: 'Pista de YouTube (Enlazada)',
          estado: 'en_espera'
       }]);
       cargarCola();
    } else {
       alert("Por favor arrastra un enlace válido de YouTube.");
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  if (!isClient) return null;

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
          {cancionActual ? (
            <ReactPlayer 
              url={cancionActual.youtube_url} 
              playing 
              controls
              width="100%" 
              height="100%" 
              onEnded={marcarCompletada}
              style={{ position: 'absolute', top: 0, left: 0 }}
            />
          ) : (
            <div className="text-center text-gray-500 flex flex-col items-center p-8 border-2 border-dashed border-gray-700 rounded-xl">
               <div className="text-7xl mb-4">🎤</div>
               <p className="text-2xl font-semibold mb-2">Pantalla de Karaoke Activa</p>
               <p className="text-lg">Arrastra la URL de un video de YouTube aquí mismo para añadirlo a la cola.</p>
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
              <div className="p-4 bg-purple-900/60 border-2 border-purple-500 rounded-xl shadow-lg">
                <p className="text-xs text-purple-300 font-bold mb-2 tracking-widest uppercase">Cantando Ahora</p>
                <p className="font-bold text-lg truncate">{cancionActual.titulo}</p>
              </div>
           )}
           {cola.map((cancion, index) => (
             <div key={cancion.id} className="p-4 bg-gray-700/50 rounded-xl flex items-center gap-4 border border-gray-600 transition-all hover:bg-gray-600">
                <span className="text-purple-400 font-black text-xl w-6 text-center">{index + 1}</span>
                <p className="font-semibold truncate flex-1 text-gray-200">{cancion.titulo}</p>
             </div>
           ))}
           {cola.length === 0 && !cancionActual && (
             <p className="text-gray-500 text-center mt-10 font-medium">No hay canciones en espera</p>
           )}
        </div>
      </div>
    </div>
  );
}