
'use client';

import React, { useEffect, useState, useRef, memo, useCallback } from 'react';

// Motor de conexión dinámico para evitar bloqueos del compilador (Turbopack) con módulos externos
let supabase: any;

const initSupabase = () => {
  if (supabase) return;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://tunombredeproyecto.supabase.co'; 
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'tu-clave-anonima';
  if (typeof window !== 'undefined' && (window as any).supabase) {
    supabase = (window as any).supabase.createClient(supabaseUrl, supabaseKey);
  }
};

type Cancion = {
  id: string;
  sala_id: string;
  youtube_url: string;
  titulo: string;
  cantante: string;
  estado: 'en_espera' | 'reproduciendo' | 'completada';
  creado_en: string;
};

type Cliente = {
  id: string;
  usuario: string;
  password?: string;
  dias_asignados: number;
  tarifa_diaria: number;
  fecha_activacion: string | null;
};

const extraerYouTubeId = (url: string) => {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
};

const obtenerTituloYouTube = async (url: string) => {
  try {
     const res = await fetch(`https://noembed.com/embed?dataType=json&url=${url}`);
     const data = await res.json();
     return data.title || 'Pista de YouTube';
  } catch (error) {
     return 'Pista de YouTube';
  }
};

const calcularHorasRestantes = (fecha_activacion: string | null, dias_asignados: number) => {
  if (!fecha_activacion) return dias_asignados * 24;
  const inicio = new Date(fecha_activacion).getTime();
  const ahora = new Date().getTime();
  const horasTranscurridas = (ahora - inicio) / (1000 * 60 * 60);
  const horasTotales = dias_asignados * 24;
  return Math.max(0, horasTotales - horasTranscurridas);
};

const Toast = ({ message, type, onClose }: { message: string, type: 'success' | 'error' | 'info', onClose: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const bgColors = {
    success: 'bg-green-600',
    error: 'bg-red-600',
    info: 'bg-blue-600'
  };

  return (
    <div className={`fixed top-4 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-xl shadow-2xl z-[10000] font-bold text-white text-center w-11/12 max-w-md animate-in slide-in-from-top-5 fade-in duration-300 ${bgColors[type]}`}>
      {message}
    </div>
  );
};

const ReproductorNativo = memo(({ videoId, onEnd, visible }: { videoId: string | null, onEnd: () => void, visible: boolean }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const onEndRef = useRef(onEnd);
  const videoIdRef = useRef(videoId);
  const visibleRef = useRef(visible);

  useEffect(() => { onEndRef.current = onEnd; }, [onEnd]);
  useEffect(() => {
    videoIdRef.current = videoId;
    visibleRef.current = visible;
  }, [videoId, visible]);

  useEffect(() => {
    if (!containerRef.current || playerRef.current) return; 
    
    containerRef.current.innerHTML = '';
    const playerId = `yt-player-persistent`;
    const playerDiv = document.createElement('div');
    playerDiv.id = playerId;
    playerDiv.className = "w-full h-full absolute top-0 left-0";
    containerRef.current.appendChild(playerDiv);

    const initPlayer = () => {
      playerRef.current = new (window as any).YT.Player(playerId, {
        playerVars: { autoplay: 1, controls: 1, fs: 1, rel: 0, origin: typeof window !== 'undefined' ? window.location.origin : '*' },
        events: {
          onReady: (event: any) => {
            if (videoIdRef.current && visibleRef.current) event.target.loadVideoById(videoIdRef.current);
          },
          onStateChange: (event: any) => {
            if (event.data === 0) onEndRef.current();
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
        (window as any).onYouTubeIframeAPIReady = () => { window.dispatchEvent(new Event('YouTubeAPIReady')); };
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
    }
  }, []); 

  useEffect(() => {
    if (playerRef.current && playerRef.current.loadVideoById) {
      if (visible && videoId) {
        playerRef.current.loadVideoById(videoId); 
      } else if (!visible) {
        playerRef.current.pauseVideo(); 
      }
    }
  }, [videoId, visible]);

  return (
    <div className={`fixed top-0 left-0 w-screen h-screen z-[9999] bg-black transition-opacity duration-500 ${visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        <div ref={containerRef} className="w-full h-full relative" />
        <button 
          onClick={() => onEndRef.current()}
          className="absolute bottom-10 right-10 bg-red-600 hover:bg-red-500 text-white font-bold py-4 px-8 rounded-full shadow-[0_0_20px_rgba(220,38,38,0.9)] transition-all hover:scale-110 z-[10000] text-xl"
        >
          ⏭ Saltar Pista
        </button>
    </div>
  );
});
ReproductorNativo.displayName = 'ReproductorNativo';

function TvScreen({ cliente, onLogout }: { cliente: Cliente, onLogout: () => void }) {
  const [salaId, setSalaId] = useState<string | null>(null);
  const [codigoSala] = useState<string>(cliente.usuario.toUpperCase());
  const [cola, setCola] = useState<Cancion[]>([]);
  const [cancionActual, setCancionActual] = useState<Cancion | null>(null);
  const [haInteractuado, setHaInteractuado] = useState(false);
  const [fase, setFase] = useState<'espera' | 'anunciando' | 'cantando' | 'calificando'>('espera');
  const [puntaje, setPuntaje] = useState<number | null>(null);
  const [horasRestantes, setHorasRestantes] = useState(calcularHorasRestantes(cliente.fecha_activacion, cliente.dias_asignados));

  useEffect(() => {
    const timer = setInterval(() => {
      setHorasRestantes(calcularHorasRestantes(cliente.fecha_activacion, cliente.dias_asignados));
    }, 60000); 
    return () => clearInterval(timer);
  }, [cliente]);

  useEffect(() => {
    let isMounted = true;
    const inicializarSala = async () => {
      const { data: salas } = await supabase.from('salas').select('*').eq('cliente_id', cliente.id).limit(1);
      if (!salas || salas.length === 0) {
        const { data: nuevaSala } = await supabase.from('salas').insert([{ codigo_sala: codigoSala, cliente_id: cliente.id }]).select('*').limit(1);
        if (isMounted && nuevaSala && nuevaSala.length > 0) setSalaId(nuevaSala[0].id);
      } else {
        if (isMounted) setSalaId(salas[0].id);
      }
    };
    inicializarSala();
    return () => { isMounted = false; };
  }, [codigoSala, cliente.id]);

  useEffect(() => {
    if (!salaId) return;
    const cargarCola = async () => {
      const { data } = await supabase.from('lista_reproduccion').select('*').eq('sala_id', salaId).order('creado_en', { ascending: true });
      if (data) {
        const pendientes = data.filter((c: Cancion) => c.estado === 'en_espera');
        const actual = data.find((c: Cancion) => c.estado === 'reproduciendo');
        setCola(pendientes);
        
        if (actual) {
           setCancionActual(actual);
           setFase(prev => prev === 'espera' ? 'anunciando' : prev);
        } else if (pendientes.length > 0 && !actual) {
           await supabase.from('lista_reproduccion').update({ estado: 'reproduciendo' }).eq('id', pendientes[0].id);
        } else {
           setCancionActual(null);
           setFase('espera');
        }
      }
    };
    
    cargarCola();
    const channel = supabase.channel(`sala_${salaId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lista_reproduccion', filter: `sala_id=eq.${salaId}` }, () => cargarCola())
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

  const procesarFinDeCancion = useCallback(() => {
    setPuntaje(Math.floor(Math.random() * 26) + 75);
    setFase('calificando');
  }, []);

  const iniciarPantallaCompleta = () => {
    setHaInteractuado(true);
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => console.warn('Bloqueo de pantalla completa'));
    }
  };

  if (horasRestantes <= 0) {
    return (
      <div className="flex h-screen w-full bg-red-950 items-center justify-center flex-col text-white">
        <h1 className="text-5xl font-black text-red-500 mb-4">TIEMPO AGOTADO</h1>
        <p className="text-xl mb-8">Tu suscripción ha finalizado. Por favor, contacta al administrador.</p>
        <button onClick={onLogout} className="bg-gray-800 p-4 rounded-xl font-bold">Cerrar Sesión</button>
      </div>
    );
  }

  if (!haInteractuado) {
    return (
      <div className="flex h-screen w-full bg-gray-950 items-center justify-center flex-col text-white">
        <h1 className="text-5xl font-black text-purple-500 mb-8 tracking-widest text-center">KARAOKE SESSIONS</h1>
        <button onClick={iniciarPantallaCompleta} className="bg-purple-600 py-5 px-12 rounded-full text-2xl font-bold shadow-[0_0_40px_rgba(147,51,234,0.8)] hover:scale-110 transition-all">
          🎵 Iniciar Pantalla Principal
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-900 text-white font-sans overflow-hidden">
      <ReproductorNativo videoId={cancionActual ? extraerYouTubeId(cancionActual.youtube_url) : null} onEnd={procesarFinDeCancion} visible={fase === 'cantando'} />

      <div className="flex-1 flex flex-col p-6 relative">
        <div className="flex justify-between items-center mb-6 bg-gray-800 p-4 rounded-xl border border-gray-700">
          <h1 className="text-3xl font-bold text-purple-400">KARAOKE SESSIONS</h1>
          <div className="flex gap-4 items-center">
            <span className="text-green-400 font-mono">Tiempo Restante: {Math.floor(horasRestantes)}h {Math.floor((horasRestantes % 1) * 60)}m</span>
            <div className="bg-purple-600 px-6 py-2 rounded-lg text-xl font-mono font-bold">PIN: {codigoSala}</div>
            <button onClick={onLogout} className="text-sm text-gray-400 hover:text-white">Salir</button>
          </div>
        </div>
        
        <div className={`flex-1 bg-black rounded-xl overflow-hidden shadow-2xl relative border border-gray-800 flex items-center justify-center`}>
          {fase === 'anunciando' && cancionActual && (
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-900 via-purple-900 to-black flex flex-col items-center justify-center z-50 animate-in zoom-in-95">
              <h2 className="text-6xl font-bold text-purple-300 mb-6 tracking-widest">¡PREPÁRATE!</h2>
              <div className="text-[100px] font-black text-white mb-10 drop-shadow-[0_0_30px_rgba(255,255,255,0.7)]">🎤 {cancionActual.cantante}</div>
              <p className="text-4xl text-yellow-400 font-bold mt-4">{cancionActual.titulo}</p>
            </div>
          )}
          {fase === 'calificando' && puntaje !== null && (
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-900 to-purple-900 flex flex-col items-center justify-center z-50">
              <h2 className="text-6xl font-bold text-white mb-6">¡CANCIÓN TERMINADA!</h2>
              <div className="text-[180px] font-black text-yellow-400 drop-shadow-[0_0_40px_rgba(250,204,21,0.8)] animate-bounce">{puntaje}</div>
            </div>
          )}
          {fase === 'espera' && (
            <div className="text-center text-gray-500">
               <div className="text-7xl mb-4 animate-bounce">🎤</div>
               <p className="text-4xl font-semibold mb-4 text-gray-300">Pista Libre</p>
               <p className="text-2xl">Envía una canción desde el DJ Remote</p>
            </div>
          )}
        </div>
      </div>

      <div className="w-[400px] bg-gray-800 border-l border-gray-700 p-6 flex flex-col z-10">
        <h2 className="text-2xl font-bold mb-6 border-b border-gray-700 pb-4">Cola de Reproducción</h2>
        <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
           {cancionActual && fase !== 'espera' && (
              <div className="p-4 bg-purple-900/60 border-2 border-purple-500 rounded-xl">
                <p className="text-xs text-purple-300 font-bold uppercase">{fase === 'anunciando' ? 'Siguiente en cantar' : 'Calificando a'}</p>
                <p className="font-black text-xl text-yellow-400">🎤 {cancionActual.cantante}</p>
                <p className="font-medium text-sm text-white line-clamp-2">{cancionActual.titulo}</p>
              </div>
           )}
           {cola.map((cancion, index) => (
             <div key={cancion.id} className="p-4 bg-gray-700/50 rounded-xl flex items-center gap-4">
                <span className="text-purple-400 font-black text-xl w-6 text-center">{index + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-yellow-400 text-sm truncate">🎤 {cancion.cantante}</p>
                  <p className="font-medium text-xs text-gray-300 line-clamp-2">{cancion.titulo}</p>
                </div>
             </div>
           ))}
        </div>
      </div>
    </div>
  );
}

function RemoteDashboard({ cliente, onLogout }: { cliente: Cliente, onLogout: () => void }) {
  const [url, setUrl] = useState('');
  const [cantante, setCantante] = useState('');
  const [salaId, setSalaId] = useState<string | null>(null);
  const [historial, setHistorial] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);

  const fetchHistorial = async (id: string) => {
     try {
       const { data, error } = await supabase.from('historial_canciones').select('*').eq('cliente_id', id).order('id', { ascending: false });
       if (data && !error) setHistorial(data);
     } catch (e) { console.error("Error al cargar historial", e); }
  };

  useEffect(() => {
    let isMounted = true; 
    const cargarDatos = async () => {
      try {
        if (!cliente?.id) return;

        let { data: salas } = await supabase.from('salas').select('*').eq('cliente_id', cliente.id).limit(1);
        let sala = salas && salas.length > 0 ? salas[0] : null;
        
        if (!sala) {
          const { data: nuevaSala } = await supabase.from('salas')
            .insert([{ codigo_sala: cliente.usuario.toUpperCase(), cliente_id: cliente.id }])
            .select('*'); 
            
          if (nuevaSala && nuevaSala.length > 0) {
             sala = nuevaSala[0];
          } else {
             const { data: salaForzada } = await supabase.from('salas').select('*').eq('cliente_id', cliente.id).limit(1);
             if (salaForzada && salaForzada.length > 0) sala = salaForzada[0];
          }
        }
        
        if (isMounted && sala && sala.id) {
           setSalaId(sala.id);
        } else if (isMounted) {
           setToast({ message: "No se pudo sincronizar la sala. Intenta recargar.", type: 'error' });
        }
        
        await fetchHistorial(cliente.id);
      } catch (err) {
         console.error("Error de ejecución:", err);
      }
    };
    
    cargarDatos();
    return () => { isMounted = false; };
  }, [cliente.id, cliente.usuario]);

  const enviarCancion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!salaId) {
      setToast({ message: "La sala no está conectada. Espera unos segundos.", type: 'error' });
      return;
    }
    if (!url || !cantante) {
      setToast({ message: "Por favor completa la URL y el nombre.", type: 'error' });
      return;
    }

    const tituloReal = await obtenerTituloYouTube(url);
    
    const { error: errorCola } = await supabase.from('lista_reproduccion').insert([{ 
      sala_id: salaId, youtube_url: url, titulo: tituloReal, cantante, estado: 'en_espera' 
    }]);

    if (errorCola) {
      setToast({ message: `Error TV: ${errorCola.message}`, type: 'error' });
      return;
    }

    // FIX DEFINITIVO PARA ERRORES FANTASMAS: Solo saltará si tiene la propiedad .message explícitamente
    const { error: errorHist } = await supabase.from('historial_canciones').insert([{
      cliente_id: cliente.id, youtube_url: url, titulo: tituloReal, cantante: cantante
    }]);

    if (errorHist && errorHist.message) {
      console.error("Fallo real DB Historial:", errorHist.message);
      setToast({ message: `Error Historial: ${errorHist.message}`, type: 'error' });
    } else {
      setToast({ message: "¡Canción enviada y guardada en tu historial!", type: 'success' });
    }

    setUrl('');
    setCantante('');
    await fetchHistorial(cliente.id);
  };

  const cargarDesdeHistorial = (h: any) => {
    setUrl(h.youtube_url);
    if (h.cantante) setCantante(h.cantante);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setToast({ message: "Pista cargada lista para enviar", type: 'info' });
  };

  const cancionesFiltradas = historial.filter(h => 
    (h.titulo && h.titulo.toLowerCase().includes(searchTerm.toLowerCase())) || 
    (h.cantante && h.cantante.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6 max-w-md mx-auto relative pb-20">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex justify-between items-center mb-8 pt-4">
        <h1 className="text-2xl font-black tracking-widest text-purple-400">DJ REMOTE</h1>
        <button onClick={onLogout} className="text-sm bg-gray-800 px-4 py-2 rounded-lg font-bold hover:bg-gray-700 transition-colors">Salir</button>
      </div>

      <form onSubmit={enviarCancion} className="bg-gray-800 p-6 rounded-2xl shadow-[0_0_20px_rgba(0,0,0,0.5)] mb-8 border border-gray-700">
        <div className="mb-5">
          <label className="block text-sm font-bold mb-2 text-gray-300">🔗 Enlace de YouTube</label>
          <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 text-white focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none transition-all" placeholder="Pega el link aquí..." />
        </div>
        <div className="mb-6">
          <label className="block text-sm font-bold mb-2 text-gray-300">🎤 Nombre / Cantante</label>
          <input type="text" required value={cantante} onChange={(e) => setCantante(e.target.value)} className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 text-white focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none transition-all" placeholder="¿Quién va a cantar?" />
        </div>
        <button type="submit" className="w-full bg-purple-600 hover:bg-purple-500 font-black tracking-wider py-4 rounded-xl text-lg shadow-[0_0_15px_rgba(147,51,234,0.4)] transition-transform hover:scale-105 active:scale-95">
          ENVIAR A PANTALLA
        </button>
      </form>

      {}
      <div className="bg-gray-800 p-5 rounded-2xl shadow-[0_0_20px_rgba(0,0,0,0.5)] border border-gray-700 flex flex-col h-[400px]">
        <h2 className="text-xl font-bold mb-4 text-white flex items-center justify-between">
          Historial Inteligente
          <span className="text-2xl">🔍</span>
        </h2>
        
        <input 
          type="text"
          placeholder="Busca una pista o cantante anterior..." 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-gray-950 border border-gray-700 text-white text-sm p-3 rounded-lg outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all mb-4"
        />
        
        <div className="space-y-3 overflow-y-auto flex-1 pr-2 custom-scrollbar">
          {cancionesFiltradas.length > 0 ? (
            cancionesFiltradas.map((h) => (
              <div key={h.id} onClick={() => cargarDesdeHistorial(h)} className="bg-gray-900 p-4 rounded-xl border border-gray-700 cursor-pointer hover:border-purple-500 hover:bg-gray-800 transition-all group">
                <div className="flex justify-between items-center mb-1">
                   <span className="text-xs text-purple-400 font-bold uppercase tracking-wider group-hover:text-purple-300">🎤 {h.cantante || 'Invitado'}</span>
                   <span className="text-[10px] text-gray-500 bg-gray-800 px-2 py-1 rounded group-hover:bg-purple-900/50 group-hover:text-purple-200 transition-colors">Tocar para cargar</span>
                </div>
                <p className="font-bold text-yellow-400 line-clamp-1 group-hover:text-yellow-300">{h.titulo}</p>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center h-full opacity-50">
               <span className="text-4xl mb-2">📭</span>
               <p className="text-center text-sm font-medium">No se encontraron pistas.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [nuevoUsuario, setNuevoUsuario] = useState('');
  const [nuevoPassword, setNuevoPassword] = useState('');
  const [dias, setDias] = useState(1);
  const [tarifa, setTarifa] = useState(10);
  
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editDatos, setEditDatos] = useState<Partial<Cliente>>({});
  
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean, idToDelete: string | null, userName: string }>({ isOpen: false, idToDelete: null, userName: '' });

  useEffect(() => { cargarClientes(); }, []);

  const cargarClientes = async () => {
    const { data } = await supabase.from('usuarios').select('*').neq('usuario', 'admin').order('fecha_activacion', { ascending: false });
    if (data) setClientes(data as Cliente[]);
  };

  const registrarCliente = async (e: React.FormEvent) => {
    e.preventDefault();
    await supabase.from('usuarios').insert([{
      usuario: nuevoUsuario, password: nuevoPassword, dias_asignados: dias, tarifa_diaria: tarifa, fecha_activacion: null
    }]);
    setToast({ message: "¡Cliente Registrado con éxito!", type: 'success' });
    setNuevoUsuario(''); setNuevoPassword(''); setDias(1);
    cargarClientes();
  };

  const iniciarEdicion = (c: Cliente) => {
    setEditandoId(c.id);
    setEditDatos(c);
  };

  const guardarEdicion = async () => {
    if (!editandoId) return;
    await supabase.from('usuarios').update({
      usuario: editDatos.usuario,
      password: editDatos.password,
      dias_asignados: editDatos.dias_asignados,
      tarifa_diaria: editDatos.tarifa_diaria
    }).eq('id', editandoId);
    
    setEditandoId(null);
    cargarClientes();
    setToast({ message: "Usuario actualizado correctamente", type: 'success' });
  };

  const solicitarEliminacion = (id: string, usuario: string) => {
    setConfirmModal({ isOpen: true, idToDelete: id, userName: usuario });
  };

  const confirmarEliminacion = async () => {
    if (confirmModal.idToDelete) {
      await supabase.from('usuarios').delete().eq('id', confirmModal.idToDelete);
      cargarClientes();
      setToast({ message: `Usuario ${confirmModal.userName} eliminado definitivamente.`, type: 'info' });
    }
    setConfirmModal({ isOpen: false, idToDelete: null, userName: '' });
  };

  const ingresosTotales = clientes.reduce((acc, curr) => acc + (curr.dias_asignados * curr.tarifa_diaria), 0);

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8 relative">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      
      {/* Modal Personalizado en lugar de window.confirm nativo */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[50000] p-4">
          <div className="bg-gray-900 border border-gray-700 p-8 rounded-2xl max-w-md w-full shadow-[0_0_40px_rgba(220,38,38,0.3)] animate-in zoom-in-95">
            <h3 className="text-2xl font-black text-red-500 mb-4">¿Eliminar Usuario?</h3>
            <p className="text-gray-300 mb-8 leading-relaxed">
              Estás a punto de borrar permanentemente a <span className="font-bold text-white">"{confirmModal.userName}"</span>. 
              Esto destruirá su sala de TV y borrará todo el historial de canciones asociado. Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-4">
              <button onClick={() => setConfirmModal({ isOpen: false, idToDelete: null, userName: '' })} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 rounded-xl transition-colors">
                Cancelar
              </button>
              <button onClick={confirmarEliminacion} className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-3 rounded-xl shadow-lg transition-transform hover:scale-105 active:scale-95">
                Sí, Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {}
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-10 border-b border-gray-800 pb-4">
          <h1 className="text-4xl font-black tracking-widest text-purple-500 drop-shadow-[0_0_15px_rgba(147,51,234,0.4)]">KARAOKE ADMIN</h1>
          <button onClick={onLogout} className="bg-gray-800 px-6 py-2 rounded-lg font-bold hover:bg-gray-700 transition-colors">Salir del Sistema</button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800 h-fit shadow-2xl">
            <h2 className="text-2xl font-bold mb-6 text-white border-b border-gray-800 pb-3">Nueva Suscripción</h2>
            <form onSubmit={registrarCliente} className="space-y-5">
              <div>
                <label className="text-sm font-bold text-gray-400">Usuario (PIN de Acceso)</label>
                <input required value={nuevoUsuario} onChange={e=>setNuevoUsuario(e.target.value)} className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 mt-1 text-white focus:border-purple-500 outline-none transition-colors" />
              </div>
              <div>
                <label className="text-sm font-bold text-gray-400">Contraseña Administrador</label>
                <input required value={nuevoPassword} onChange={e=>setNuevoPassword(e.target.value)} className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 mt-1 text-white focus:border-purple-500 outline-none transition-colors" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-bold text-gray-400">Días Contratados</label>
                  <input type="number" required min="1" value={dias} onChange={e=>setDias(Number(e.target.value))} className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 mt-1 text-white focus:border-purple-500 outline-none transition-colors" />
                </div>
                <div>
                  <label className="text-sm font-bold text-gray-400">Tarifa / Día ($)</label>
                  <input type="number" required min="1" value={tarifa} onChange={e=>setTarifa(Number(e.target.value))} className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 mt-1 text-white focus:border-purple-500 outline-none transition-colors" />
                </div>
              </div>
              <div className="pt-6 border-t border-gray-800 mt-2">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-gray-400 font-bold">Monto Total Estimado:</span>
                  <span className="text-green-400 font-black text-2xl">${(dias * tarifa).toFixed(2)}</span>
                </div>
                <button type="submit" className="w-full bg-purple-600 font-black tracking-wider py-4 rounded-xl hover:bg-purple-500 shadow-[0_0_15px_rgba(147,51,234,0.4)] transition-transform hover:scale-105 active:scale-95">
                  REGISTRAR CLIENTE
                </button>
              </div>
            </form>
          </div>

          {}
          <div className="xl:col-span-2 bg-gray-900 p-6 rounded-2xl border border-gray-800 shadow-2xl">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4 border-b border-gray-800 pb-4">
              <h2 className="text-2xl font-bold text-white">Salas y Sesiones Activas</h2>
              <div className="bg-green-900/20 text-green-400 border border-green-800/50 px-5 py-3 rounded-xl font-bold shadow-inner">
                Total Ingresos Proyectados: <span className="text-xl ml-2 font-black">${ingresosTotales.toFixed(2)}</span>
              </div>
            </div>
            
            <div className="overflow-x-auto custom-scrollbar pb-4">
              <table className="w-full text-left min-w-[700px]">
                <thead>
                  <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-gray-800">
                    <th className="pb-4 px-3 font-bold">SALA / PIN</th>
                    <th className="pb-4 px-3 font-bold">CLAVE</th>
                    <th className="pb-4 px-3 font-bold">TIEMPO / TARIFA</th>
                    <th className="pb-4 px-3 font-bold">ESTADO SAAS</th>
                    <th className="pb-4 px-3 font-bold text-right">ACCIONES</th>
                  </tr>
                </thead>
                <tbody>
                  {clientes.map(c => {
                    const horas = calcularHorasRestantes(c.fecha_activacion, c.dias_asignados);
                    const activo = horas > 0;
                    const sinEmpezar = !c.fecha_activacion;
                    const isEditing = editandoId === c.id;

                    return (
                      <tr key={c.id} className="border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors group">
                        {isEditing ? (
                          <>
                            <td className="py-4 px-3">
                              <input value={editDatos.usuario || ''} onChange={e => setEditDatos({...editDatos, usuario: e.target.value})} className="w-full bg-gray-950 border border-purple-500 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-purple-500 text-white font-bold" />
                            </td>
                            <td className="py-4 px-3">
                              <input value={editDatos.password || ''} onChange={e => setEditDatos({...editDatos, password: e.target.value})} className="w-full bg-gray-950 border border-purple-500 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-purple-500 text-gray-300" />
                            </td>
                            <td className="py-4 px-3 flex gap-2 items-center h-[72px]">
                              <input type="number" title="Días" value={editDatos.dias_asignados || 1} onChange={e => setEditDatos({...editDatos, dias_asignados: Number(e.target.value)})} className="w-16 bg-gray-950 border border-purple-500 rounded p-2 text-sm outline-none text-white text-center" />
                              <span className="text-gray-500">x</span>
                              <input type="number" title="Tarifa" value={editDatos.tarifa_diaria || 1} onChange={e => setEditDatos({...editDatos, tarifa_diaria: Number(e.target.value)})} className="w-16 bg-gray-950 border border-purple-500 rounded p-2 text-sm outline-none text-green-400 text-center" />
                            </td>
                            <td className="py-4 px-3 text-xs text-purple-400 font-bold animate-pulse">Guardando...</td>
                            <td className="py-4 px-3 text-right whitespace-nowrap">
                              <button onClick={guardarEdicion} className="bg-green-600/20 text-green-400 hover:bg-green-600/40 border border-green-700/50 mr-2 font-bold text-xs px-3 py-2 rounded transition-colors">Guardar</button>
                              <button onClick={() => setEditandoId(null)} className="bg-gray-700 text-gray-300 hover:bg-gray-600 font-bold text-xs px-3 py-2 rounded transition-colors">Cancelar</button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="py-4 px-3 font-black text-white text-lg tracking-wide">{c.usuario}</td>
                            <td className="py-4 px-3 text-gray-400 font-mono text-sm tracking-widest">{c.password}</td>
                            <td className="py-4 px-3 text-gray-300 font-medium text-sm">
                              {c.dias_asignados} Días <span className="text-gray-600 mx-1">|</span> <span className="text-green-400">${c.tarifa_diaria}/día</span>
                            </td>
                            <td className="py-4 px-3">
                              {sinEmpezar ? (
                                 <span className="text-yellow-400 bg-yellow-900/30 border border-yellow-700/50 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider">Pendiente</span>
                              ) : activo ? (
                                 <span className="text-green-400 bg-green-900/30 border border-green-700/50 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider flex items-center w-fit gap-2">
                                   <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                                   {Math.floor(horas)}h restantes
                                 </span>
                              ) : (
                                 <span className="text-red-500 bg-red-900/30 border border-red-700/50 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider">Agotado</span>
                              )}
                            </td>
                            <td className="py-4 px-3 text-right opacity-50 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                              <button onClick={() => iniciarEdicion(c)} className="text-blue-400 hover:text-blue-300 mr-4 font-bold text-sm transition-colors border-b border-transparent hover:border-blue-400 pb-1">Editar</button>
                              <button onClick={() => solicitarEliminacion(c.id, c.usuario)} className="text-red-500 hover:text-red-400 font-bold text-sm transition-colors border-b border-transparent hover:border-red-500 pb-1">Eliminar</button>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {clientes.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <p className="text-lg">No hay suscripciones activas.</p>
                  <p className="text-sm mt-1">Registra un nuevo cliente en el panel lateral.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AppRouter() {
  const [isSupabaseReady, setIsSupabaseReady] = useState(false);
  const [view, setView] = useState<'login' | 'tv' | 'remote' | 'admin'>('login');
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [clienteActual, setClienteActual] = useState<Cliente | null>(null);
  const [toast, setToast] = useState<{ message: string, type: 'error' | 'success' } | null>(null);

  useEffect(() => {
    // Inicialización dinámica para compatibilidad con compiladores modernos
    if (typeof window !== 'undefined' && (window as any).supabase) {
      initSupabase();
      setIsSupabaseReady(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    script.onload = () => {
      initSupabase();
      setIsSupabaseReady(true);
    };
    document.head.appendChild(script);
  }, []);

  const handleLogin = async (e: React.FormEvent, targetView: 'tv' | 'remote' | 'admin') => {
    e.preventDefault();
    if (usuario === 'admin' && password === 'admin123' && targetView === 'admin') {
      setView('admin');
      return;
    }

    const { data, error } = await supabase.from('usuarios').select('*').eq('usuario', usuario).eq('password', password).limit(1);
    const clienteEncontrado = data && data.length > 0 ? data[0] : null;

    if (error || !clienteEncontrado) {
      setToast({ message: 'Credenciales incorrectas o usuario inexistente.', type: 'error' });
      return;
    }

    if (!clienteEncontrado.fecha_activacion) {
      const ahora = new Date().toISOString();
      await supabase.from('usuarios').update({ fecha_activacion: ahora }).eq('id', clienteEncontrado.id);
      clienteEncontrado.fecha_activacion = ahora;
    }

    setClienteActual(clienteEncontrado as Cliente);
    setView(targetView);
  };

  const handleLogout = () => {
    setClienteActual(null);
    setUsuario('');
    setPassword('');
    setView('login');
  };

  if (!isSupabaseReady) {
    return (
      <div className="flex h-screen bg-gray-950 items-center justify-center flex-col">
        <div className="w-16 h-16 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mb-8"></div>
        <h1 className="text-3xl font-black text-purple-500 tracking-widest">KARAOKE SAAS</h1>
        <p className="text-gray-500 mt-2 font-mono text-sm">INICIALIZANDO NÚCLEO...</p>
      </div>
    );
  }

  if (view === 'admin') return <AdminDashboard onLogout={handleLogout} />;
  if (view === 'tv' && clienteActual) return <TvScreen cliente={clienteActual} onLogout={handleLogout} />;
  if (view === 'remote' && clienteActual) return <RemoteDashboard cliente={clienteActual} onLogout={handleLogout} />;

  return (
    <div className="flex h-screen bg-gray-950 items-center justify-center p-4 relative">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      
      <div className="bg-gray-900 p-8 sm:p-10 rounded-3xl shadow-[0_0_50px_rgba(147,51,234,0.15)] border border-gray-800 w-full max-w-md relative overflow-hidden">
        
        {/* Adorno visual */}
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-purple-600 rounded-full blur-[80px] opacity-20"></div>
        <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-blue-600 rounded-full blur-[80px] opacity-20"></div>

        <div className="text-center mb-10 relative z-10">
          <div className="bg-gradient-to-br from-purple-500 to-indigo-600 w-16 h-16 rounded-2xl mx-auto mb-6 flex items-center justify-center shadow-lg shadow-purple-500/30 transform rotate-3 hover:rotate-6 transition-transform">
            <span className="text-3xl">🎤</span>
          </div>
          <h1 className="text-4xl font-black text-white tracking-tight">KARAOKE <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-indigo-400">SAAS</span></h1>
          <p className="text-gray-400 text-sm mt-2 font-medium">Plataforma de Gestión y Reproducción</p>
        </div>

        <form className="space-y-5 relative z-10">
          <div>
            <label className="block text-gray-400 text-xs font-bold uppercase tracking-wider mb-2 ml-1">Usuario / PIN de Acceso</label>
            <input required type="text" value={usuario} onChange={(e) => setUsuario(e.target.value)} className="w-full bg-gray-950 border border-gray-800 rounded-xl p-4 text-white font-bold focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none transition-all" placeholder="Introduce tu PIN" />
          </div>
          <div>
            <label className="block text-gray-400 text-xs font-bold uppercase tracking-wider mb-2 ml-1">Contraseña de Sesión</label>
            <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-gray-950 border border-gray-800 rounded-xl p-4 text-white font-bold focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none transition-all" placeholder="••••••••" />
          </div>
          
          <div className="grid grid-cols-2 gap-4 pt-6">
            <button onClick={(e) => handleLogin(e, 'tv')} className="bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white font-black tracking-wide py-4 rounded-xl shadow-[0_10px_20px_rgba(147,51,234,0.3)] transition-transform hover:-translate-y-1 active:translate-y-0">
              ENTRAR TV
            </button>
            <button onClick={(e) => handleLogin(e, 'remote')} className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-black tracking-wide py-4 rounded-xl shadow-[0_10px_20px_rgba(79,70,229,0.3)] transition-transform hover:-translate-y-1 active:translate-y-0">
              ENTRAR DJ
            </button>
          </div>
          <div className="pt-4">
             <button onClick={(e) => handleLogin(e, 'admin')} className="w-full bg-transparent hover:bg-gray-800/50 text-gray-500 hover:text-gray-300 font-bold py-3 rounded-xl transition-colors text-sm border border-transparent hover:border-gray-700">
               Acceso a Panel Administrativo
             </button>
          </div>
        </form>
      </div>
      
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #6b7280; }
      `}} />
    </div>
  );
}