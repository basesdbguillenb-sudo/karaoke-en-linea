'use client';

import React, { useEffect, useState, useRef, memo, useCallback } from 'react';
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

// REPRODUCTOR PERSISTENTE ANTIBLOQUEO
const ReproductorNativo = memo(({ videoId, onEnd, visible }: { videoId: string | null, onEnd: () => void, visible: boolean }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  
  const onEndRef = useRef(onEnd);
  const videoIdRef = useRef(videoId);
  const visibleRef = useRef(visible);

  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  useEffect(() => {
    videoIdRef.current = videoId;
    visibleRef.current = visible;
  }, [videoId, visible]);

  // INICIALIZACIÓN SUBTERRÁNEA: Se crea oculto desde el principio
  useEffect(() => {
    if (!containerRef.current) return;
    if (playerRef.current) return; 
    
    containerRef.current.innerHTML = '';
    
    const playerId = `yt-player-persistent`;
    const playerDiv = document.createElement('div');
    playerDiv.id = playerId;
    playerDiv.className = "w-full h-full absolute top-0 left-0";
    containerRef.current.appendChild(playerDiv);

    const initPlayer = () => {
      playerRef.current = new (window as any).YT.Player(playerId, {
        playerVars: {
          autoplay: 1,
          controls: 1,
          fs: 1,
          rel: 0,
          mute: 0,
          origin: typeof window !== 'undefined' ? window.location.origin : '*'
        },
        events: {
          onReady: (event: any) => {
            if (videoIdRef.current && visibleRef.current) {
              event.target.loadVideoById(videoIdRef.current);
            }
          },
          onStateChange: (event: any) => {
            if (event.data === 0) { 
              onEndRef.current();
            }
          }
        }
      });
    };

    if ((window as any).YT && (window as any).YT.Player) {
      initPlayer();
    } else {
      const listener = () => initPlayer();
      window.addEventListener('YouTubeAPIReady', listener);
      
      if (!(window as any).onYouTubeIframeAPIReady) {
        (window as any).onYouTubeIframeAPIReady = () => {
          window.dispatchEvent(new Event('YouTubeAPIReady'));
        };
        
        const scriptId = 'youtube-iframe-api-script';
        if (!document.getElementById(scriptId)) {
          const tag = document.createElement('script');
          tag.id = scriptId;
          tag.src = 'https://www.youtube.com/iframe_api';
          const firstScriptTag = document.getElementsByTagName('script')[0];
          if (firstScriptTag && firstScriptTag.parentNode) {
             firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
          } else {
             document.head.appendChild(tag);
          }
        }
      }
    }
  }, []); 

  // MOTOR DE AUTOPLAY INFINITO (Inyección de Play)
  useEffect(() => {
    if (playerRef.current && playerRef.current.loadVideoById) {
      if (visible && videoId) {
        // Cargamos la canción
        playerRef.current.loadVideoById(videoId);
        
        // Forzamos el PLAY 150ms después para anular el bloqueo del navegador
        const playTimer = setTimeout(() => {
          if (playerRef.current && playerRef.current.playVideo) {
            playerRef.current.playVideo();
          }
        }, 150);
        return () => clearTimeout(playTimer);

      } else if (!visible) {
        // TÁCTICA MAESTRA: Usamos pauseVideo() en vez de stopVideo() para mantener el permiso vivo
        if (playerRef.current.pauseVideo) {
          playerRef.current.pauseVideo();
        }
      }
    }
  }, [videoId, visible]);

  return (
    <div className={`fixed top-0 left-0 w-screen h-screen z-[9999] bg-black transition-opacity duration-500 ${visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        <div ref={containerRef} className="w-full h-full relative pointer-events-auto" />
        <button 
          onClick={() => onEndRef.current()}
          className="absolute bottom-10 right-10 bg-red-600 hover:bg-red-500 text-white font-bold py-4 px-8 rounded-full shadow-[0_0_20px_rgba(220,38,38,0.9)] transition-all hover:scale-110 z-[10000] text-xl flex items-center gap-2 backdrop-blur-sm pointer-events-auto"
        >
          ⏭ Saltar Pista
        </button>
    </div>
  );
});
ReproductorNativo.displayName = 'ReproductorNativo';

export default function TvScreen() {
  const [salaId, setSalaId] = useState<string | null>(null);
  const [codigoSala] = useState<string>('KARAOKE-HOME');
  const [cola, setCola] = useState<Cancion[]>([]);
  const [cancionActual, setCancionActual] = useState<Cancion | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [haInteractuado, setHaInteractuado] = useState(false);
  
  const [fase, setFase] = useState<'espera' | 'anunciando' | 'cantando' | 'calificando'>('espera');
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

  useEffect(() => {
    let timer: NodeJS.Timeout;

    if (fase === 'anunciando') {
      timer = setTimeout(() => setFase('cantando'), 5000);
    } else if (fase === 'calificando') {
      timer = setTimeout(async () => {
        setFase('espera');
        if (cancionActual) {
          await supabase.from('lista_reproduccion').update({ estado: 'completada' }).eq('id', cancionActual.id);
        }
      }, 5000);
    }

    return () => clearTimeout(timer);
  }, [fase, cancionActual]);

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
         setFase(prev => prev === 'espera' ? 'anunciando' : prev);
      } else if (pendientes.length > 0 && !actual) {
         reproducirSiguiente(pendientes[0]);
      } else {
         setCancionActual(null);
         setFase('espera');
      }
    }
  };

  const reproducirSiguiente = async (cancion: Cancion) => {
    await supabase.from('lista_reproduccion').update({ estado: 'reproduciendo' }).eq('id', cancion.id);
  };

  const procesarFinDeCancion = useCallback(() => {
    const scoreAleatorio = Math.floor(Math.random() * 26) + 75;
    setPuntaje(scoreAleatorio);
    setFase('calificando');
  }, []);

  const iniciarPantallaCompleta = () => {
    setHaInteractuado(true);
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {
        console.warn('El navegador bloqueó la pantalla completa automática.');
      });
    }
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
         cantante: 'DJ Local',
         estado: 'en_espera' 
       }]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); };

  if (!isClient) return null;

  const ytVideoId = cancionActual ? extraerYouTubeId(cancionActual.youtube_url) : null;

  return (
    <>
      {/* OVERLAY INICIAL (Desbloquea el documento para el Autoplay al hacer clic) */}
      {!haInteractuado && (
        <div className="fixed top-0 left-0 w-screen h-screen bg-gray-950 flex items-center justify-center flex-col text-white z-[999999]">
          <h1 className="text-5xl font-black text-purple-500 mb-8 tracking-widest text-center px-4">KARAOKE SESSIONS</h1>
          <button 
            onClick={iniciarPantallaCompleta} 
            className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-5 px-12 rounded-full text-2xl shadow-[0_0_40px_rgba(147,51,234,0.8)] transition-all transform hover:scale-110"
          >
            🎵 Iniciar Pantalla Principal
          </button>
        </div>
      )}

      {/* APLICACIÓN PRINCIPAL Y REPRODUCTOR PERSISTENTE */}
      <div className="flex h-screen bg-gray-900 text-white font-sans overflow-hidden" onDrop={handleDrop} onDragOver={handleDragOver}>
        
        {/* Siempre renderizado para estar listo, pero oculto si no es su turno */}
        <ReproductorNativo 
          videoId={ytVideoId} 
          onEnd={procesarFinDeCancion} 
          visible={fase === 'cantando'}
        />

        <div className="flex-1 flex flex-col p-6 transition-all duration-700 ease-in-out relative">
          <div className="flex justify-between items-center mb-6 bg-gray-800 p-4 rounded-xl border border-gray-700">
            <h1 className="text-3xl font-bold tracking-wider text-purple-400">KARAOKE SESSIONS</h1>
            <div className="bg-purple-600 px-6 py-2 rounded-lg text-xl font-mono font-bold shadow-[0_0_15px_rgba(147,51,234,0.5)]">
              CÓDIGO: {codigoSala}
            </div>
          </div>
          
          <div className={`flex-1 bg-black rounded-xl overflow-hidden shadow-2xl relative border border-gray-800 flex items-center justify-center`}>
            
            {/* FASE 1: ANUNCIO */}
            {fase === 'anunciando' && cancionActual && (
              <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-indigo-900 via-purple-900 to-black flex flex-col items-center justify-center z-50 animate-in zoom-in-95 duration-500">
                <h2 className="text-5xl md:text-7xl font-bold text-purple-300 mb-6 tracking-widest uppercase text-center px-4">¡PREPÁRATE!</h2>
                <p className="text-3xl text-gray-300 mb-4">Es el turno de:</p>
                <div className="text-6xl md:text-[100px] leading-tight font-black text-white mb-10 drop-shadow-[0_0_30px_rgba(255,255,255,0.7)] text-center px-4">
                  🎤 {cancionActual.cantante}
                </div>
                <p className="text-2xl text-gray-400">Interpretando:</p>
                <p className="text-4xl md:text-5xl text-yellow-400 font-bold mt-4 text-center px-10">{cancionActual.titulo}</p>
              </div>
            )}

            {/* FASE 3: CALIFICANDO */}
            {fase === 'calificando' && puntaje !== null && (
              <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-indigo-900 to-purple-900 flex flex-col items-center justify-center z-50">
                <h2 className="text-5xl md:text-7xl font-bold text-white mb-6 text-center">¡CANCIÓN TERMINADA!</h2>
                <p className="text-3xl text-purple-300 mb-8 text-center px-4">Puntaje para {cancionActual?.cantante}:</p>
                <div className="text-[120px] md:text-[180px] font-black text-yellow-400 drop-shadow-[0_0_40px_rgba(250,204,21,0.8)] animate-bounce">
                  {puntaje}
                </div>
                <p className="mt-8 text-2xl text-gray-300 animate-pulse text-center">Preparando la siguiente pista...</p>
              </div>
            )}

            {/* FASE 0: ESPERA (IDLE) */}
            {fase === 'espera' && (
              <div className="text-center text-gray-500 flex flex-col items-center p-8 border-2 border-dashed border-gray-700 rounded-xl w-3/4">
                 <div className="text-7xl mb-4 animate-bounce">🎤</div>
                 <p className="text-4xl font-semibold mb-4 text-gray-300">La pista de Karaoke está libre</p>
                 <p className="text-2xl">Pide una canción desde el DJ Remote en tu celular.</p>
              </div>
            )}
          </div>
        </div>

        {/* BARRA LATERAL (COLA DE REPRODUCCIÓN) */}
        <div className="w-[400px] bg-gray-800 border-l border-gray-700 p-6 flex flex-col shadow-2xl z-10">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2 border-b border-gray-700 pb-4">
            Cola de Reproducción
          </h2>
          <div className="flex-1 overflow-y-auto space-y-4 pr-2">
             {cancionActual && fase !== 'espera' && (
                <div className="p-4 bg-purple-900/60 border-2 border-purple-500 rounded-xl shadow-lg relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 bg-purple-400 h-full"></div>
                  <p className="text-xs text-purple-300 font-bold mb-1 tracking-widest uppercase">
                    {fase === 'anunciando' ? 'Siguiente en cantar' : 'Calificando a'}
                  </p>
                  <p className="font-black text-xl text-yellow-400 mb-1">🎤 {cancionActual.cantante}</p>
                  <p className="font-medium text-sm leading-tight text-white line-clamp-2">{cancionActual.titulo}</p>
                </div>
             )}
             {cola.map((cancion, index) => (
               <div key={cancion.id} className="p-4 bg-gray-700/50 rounded-xl flex items-center gap-4 border border-gray-600 transition-all">
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
    </>
  );
}