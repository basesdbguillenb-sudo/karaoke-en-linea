'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Cancion = {
  id: string;
  youtube_url: string;
  titulo: string;
  estado: 'en_espera' | 'reproduciendo' | 'completada';
  puntuacion: number | null;
};

export default function RemoteControl() {
  const [salaId, setSalaId] = useState<string | null>(null);
  const [codigoSala] = useState<string>('KARAOKE-HOME');
  const [nuevaUrl, setNuevaUrl] = useState('');
  const [cola, setCola] = useState<Cancion[]>([]);
  const [cancionActual, setCancionActual] = useState<Cancion | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    inicializarSala();
  }, []);

  useEffect(() => {
    if (!salaId) return;
    cargarCola();

    const channel = supabase
      .channel('cambios_remoto')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lista_reproduccion', filter: `sala_id=eq.${salaId}` },
        () => cargarCola()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [salaId]);

  const inicializarSala = async () => {
    const { data } = await supabase
      .from('salas')
      .select('id')
      .eq('codigo_sala', codigoSala)
      .single();
    if (data) setSalaId(data.id);
  };

  const cargarCola = async () => {
    if (!salaId) return;
    const { data } = await supabase
      .from('lista_reproduccion')
      .select('*')
      .eq('sala_id', salaId)
      .order('creado_en', { ascending: true });

    if (data) {
      setCola(data.filter((c) => c.estado === 'en_espera'));
      setCancionActual(data.find((c) => c.estado === 'reproduciendo') || null);
    }
  };

  const agregarCancion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevaUrl || !salaId) return;
    
    setEnviando(true);
    await supabase.from('lista_reproduccion').insert([{
      sala_id: salaId,
      youtube_url: nuevaUrl,
      titulo: 'Pista de YouTube (Desde Celular)',
      estado: 'en_espera'
    }]);
    
    setNuevaUrl('');
    setEnviando(false);
    cargarCola();
  };

  const calificar = async (puntos: number) => {
    if (!cancionActual) return;
    await supabase
      .from('lista_reproduccion')
      .update({ puntuacion: puntos })
      .eq('id', cancionActual.id);
    alert(`¡Calificaste con ${puntos} estrellas!`);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans p-4 flex flex-col">
      <div className="bg-purple-900 rounded-2xl p-4 shadow-lg mb-6 text-center border-2 border-purple-500">
        <h1 className="text-xl font-bold tracking-widest uppercase">Control Remoto</h1>
        <p className="text-sm text-purple-300">Sala: {codigoSala}</p>
      </div>

      {cancionActual ? (
        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-5 mb-6 shadow-xl">
          <p className="text-xs text-purple-400 font-bold mb-1 uppercase text-center">Cantando Ahora</p>
          <p className="font-bold text-center text-lg mb-4 truncate">{cancionActual.titulo}</p>
          
          <p className="text-center text-sm text-gray-400 mb-2">Califica a este cantante:</p>
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((estrella) => (
              <button 
                key={estrella}
                onClick={() => calificar(estrella)}
                className="text-3xl hover:scale-110 active:scale-95 transition-transform"
              >
                ⭐
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6 text-center shadow-xl">
          <p className="text-gray-400">Nadie está cantando ahora mismo.</p>
        </div>
      )}

      <form onSubmit={agregarCancion} className="mb-6">
        <label className="block text-sm font-semibold mb-2 text-gray-300">Añadir Canción (URL de YouTube)</label>
        <div className="flex gap-2">
          <input 
            type="url" 
            placeholder="Pega el link aquí..." 
            value={nuevaUrl}
            onChange={(e) => setNuevaUrl(e.target.value)}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500"
            required
          />
          <button 
            type="submit" 
            disabled={enviando}
            className="bg-purple-600 hover:bg-purple-500 font-bold px-6 py-3 rounded-xl transition-colors disabled:bg-gray-600"
          >
            {enviando ? '...' : '+'}
          </button>
        </div>
      </form>

      <div className="flex-1">
        <h2 className="text-lg font-bold mb-4 border-b border-gray-800 pb-2">En Cola ({cola.length})</h2>
        <div className="space-y-3">
          {cola.map((cancion, index) => (
            <div key={cancion.id} className="bg-gray-800 p-4 rounded-xl flex items-center gap-3 shadow">
              <span className="text-purple-400 font-black">{index + 1}</span>
              <p className="font-medium truncate text-gray-200 text-sm">{cancion.titulo}</p>
            </div>
          ))}
          {cola.length === 0 && (
            <p className="text-gray-500 text-center text-sm mt-4">La cola está vacía.</p>
          )}
        </div>
      </div>
    </div>
  );
}