'use client';

import React, { useEffect, useState, useRef, memo, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

// ==========================================
// 1. TIPOS DE DATOS Y ESTRUCTURAS
// ==========================================
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

// ==========================================
// 2. FUNCIONES DE UTILIDAD
// ==========================================
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

// ==========================================
// 3. REPRODUCTOR PERSISTENTE ANTIBLOQUEO
// ==========================================
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

// ==========================================
// 4. PANTALLA DE TV (KARAOKE) - SINCRONIZADA
// ==========================================
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
      // FIX: Utilizamos cliente_id igual que en el DJ Remote para evitar conexiones cruzadas
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
        const pendientes = data.filter((c) => c.estado === 'en_espera');
        const actual = data.find((c) => c.estado === 'reproduciendo');
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
    
    // Escucha en tiempo real sobre la misma sala
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
        <button onClick={onLogout} className="bg-gray-800 p-4 rounded-xl">Cerrar Sesión</button>
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
        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
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

// ==========================================
// 5. CONTROL REMOTO DJ - SINCRONIZADO
// ==========================================
function RemoteDashboard({ cliente, onLogout }: { cliente: Cliente, onLogout: () => void }) {
  const [url, setUrl] = useState('');
  const [cantante, setCantante] = useState('');
  const [salaId, setSalaId] = useState<string | null>(null);
  const [historial, setHistorial] = useState<any[]>([]);

  useEffect(() => {
    let isMounted = true; 

    const cargarDatos = async () => {
      try {
        if (!cliente?.id) return;

        // FIX: Se conecta con cliente_id (Mismo parámetro exacto de la TV)
        let { data: salas } = await supabase.from('salas').select('*').eq('cliente_id', cliente.id).limit(1);
        let sala = salas && salas.length > 0 ? salas[0] : null;
        
        if (!sala) {
          const { data: nuevaSala, error: errorInsert } = await supabase.from('salas')
            .insert([{ codigo_sala: cliente.usuario.toUpperCase(), cliente_id: cliente.id }])
            .select('*'); 
            
          if (nuevaSala && nuevaSala.length > 0) {
             sala = nuevaSala[0];
          } else {
             const { data: salaForzada } = await supabase.from('salas').select('*').eq('cliente_id', cliente.id).limit(1);
             if (salaForzada && salaForzada.length > 0) {
                 sala = salaForzada[0];
             } else if (errorInsert) {
                 console.error("Error crítico de base de datos:", errorInsert.message || JSON.stringify(errorInsert));
             }
          }
        }
        
        if (isMounted && sala && sala.id) {
           setSalaId(sala.id);
        } else if (isMounted) {
           console.error("Fallo definitivo: No se pudo enlazar el ID de la sala.");
        }
        
        const { data: hist } = await supabase.from('historial_canciones').select('*').eq('cliente_id', cliente.id).order('fecha', { ascending: false });
        if (isMounted && hist) setHistorial(hist);
        
      } catch (err) {
         console.error("Error de ejecución en cargarDatos:", err);
      }
    };
    
    cargarDatos();
    return () => { isMounted = false; };
  }, [cliente.id, cliente.usuario]);

  const enviarCancion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!salaId) {
      alert("Error de conexión: No se pudo enlazar tu DJ Remote con la TV. Recarga la página.");
      return;
    }
    if (!url || !cantante) {
      alert("Completa todos los campos.");
      return;
    }

    const tituloReal = await obtenerTituloYouTube(url);
    
    // Insertar en cola actual vinculada al mismo salaId de la TV
    const { error: errorCola } = await supabase.from('lista_reproduccion').insert([{ 
      sala_id: salaId, youtube_url: url, titulo: tituloReal, cantante, estado: 'en_espera' 
    }]);

    if (errorCola) {
      alert("Error al enviar canción: " + errorCola.message);
      return;
    }

    await supabase.from('historial_canciones').insert([{
      cliente_id: cliente.id, youtube_url: url, titulo: tituloReal, cantante: cantante
    }]);

    setUrl('');
    setCantante('');
    
    const { data: hist } = await supabase.from('historial_canciones').select('*').eq('cliente_id', cliente.id).order('fecha', { ascending: false });
    if (hist) setHistorial(hist);
    
    alert('¡Canción enviada a la TV!');
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6 max-w-md mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold text-purple-400">DJ Remote</h1>
        <button onClick={onLogout} className="text-sm bg-gray-800 px-3 py-1 rounded">Salir</button>
      </div>

      <form onSubmit={enviarCancion} className="bg-gray-800 p-6 rounded-2xl shadow-xl mb-8">
        <div className="mb-4">
          <label className="block text-sm font-bold mb-2">URL de YouTube</label>
          <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 focus:border-purple-500 outline-none" placeholder="https://youtube.com/..." />
        </div>
        <div className="mb-6">
          <label className="block text-sm font-bold mb-2">Tu Nombre / Cantante</label>
          <input type="text" required value={cantante} onChange={(e) => setCantante(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 focus:border-purple-500 outline-none" placeholder="Ej. Juan Pérez" />
        </div>
        <button type="submit" className="w-full bg-purple-600 hover:bg-purple-500 font-bold py-4 rounded-xl text-lg shadow-lg">Enviar a Pantalla</button>
      </form>

      <h2 className="text-xl font-bold mb-4 border-b border-gray-700 pb-2">Historial de la Sesión</h2>
      <div className="space-y-3">
        {historial.map((h) => (
          <div key={h.id} className="bg-gray-800 p-3 rounded-lg text-sm border border-gray-700 flex flex-col">
            <span className="text-xs text-purple-400 font-bold mb-1">🎤 {h.cantante || 'Invitado'}</span>
            <p className="font-bold text-yellow-400 line-clamp-1">{h.titulo}</p>
            <p className="text-xs text-gray-400 truncate mt-1">{h.youtube_url}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ==========================================
// 6. PANEL DE ADMINISTRADOR SAAS (CRUD COMPLETO)
// ==========================================
function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [nuevoUsuario, setNuevoUsuario] = useState('');
  const [nuevoPassword, setNuevoPassword] = useState('');
  const [dias, setDias] = useState(1);
  const [tarifa, setTarifa] = useState(10);
  
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editDatos, setEditDatos] = useState<Partial<Cliente>>({});

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
    alert('Cliente Registrado');
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
    alert('Usuario actualizado correctamente');
  };

  const eliminarCliente = async (id: string, usuario: string) => {
    if (window.confirm(`¿Estás completamente seguro de eliminar al usuario "${usuario}"?\nEsto borrará sus salas y su historial de canciones para siempre.`)) {
      await supabase.from('usuarios').delete().eq('id', id);
      cargarClientes();
    }
  };

  const ingresosTotales = clientes.reduce((acc, curr) => acc + (curr.dias_asignados * curr.tarifa_diaria), 0);

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-10 border-b border-gray-800 pb-4">
          <h1 className="text-4xl font-black text-purple-500">Panel Admin: SaaS Karaoke</h1>
          <button onClick={onLogout} className="bg-gray-800 px-6 py-2 rounded-lg font-bold hover:bg-gray-700">Salir</button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800 h-fit">
            <h2 className="text-2xl font-bold mb-6 text-white">Nueva Suscripción</h2>
            <form onSubmit={registrarCliente} className="space-y-4">
              <div>
                <label className="text-sm text-gray-400">Usuario (PIN)</label>
                <input required value={nuevoUsuario} onChange={e=>setNuevoUsuario(e.target.value)} className="w-full bg-black border border-gray-700 rounded p-3 mt-1 text-white" />
              </div>
              <div>
                <label className="text-sm text-gray-400">Contraseña</label>
                <input required value={nuevoPassword} onChange={e=>setNuevoPassword(e.target.value)} className="w-full bg-black border border-gray-700 rounded p-3 mt-1 text-white" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-400">Días</label>
                  <input type="number" required min="1" value={dias} onChange={e=>setDias(Number(e.target.value))} className="w-full bg-black border border-gray-700 rounded p-3 mt-1 text-white" />
                </div>
                <div>
                  <label className="text-sm text-gray-400">Tarifa / Día ($)</label>
                  <input type="number" required min="1" value={tarifa} onChange={e=>setTarifa(Number(e.target.value))} className="w-full bg-black border border-gray-700 rounded p-3 mt-1 text-white" />
                </div>
              </div>
              <div className="pt-4 border-t border-gray-800">
                <p className="text-gray-400 mb-2">Monto Total: <span className="text-green-400 font-bold text-xl">${(dias * tarifa).toFixed(2)}</span></p>
                <button type="submit" className="w-full bg-purple-600 font-bold py-3 rounded-lg hover:bg-purple-500">Registrar Cliente</button>
              </div>
            </form>
          </div>

          <div className="lg:col-span-2 bg-gray-900 p-6 rounded-2xl border border-gray-800">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-white">Salas Activas</h2>
              <div className="bg-green-900/30 text-green-400 border border-green-800 px-4 py-2 rounded-lg font-bold">
                Ingresos Generados: ${ingresosTotales.toFixed(2)}
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-gray-500 text-sm border-b border-gray-800">
                    <th className="pb-3 px-2">SALA / PIN</th>
                    <th className="pb-3 px-2">CLAVE</th>
                    <th className="pb-3 px-2">TIEMPO / TARIFA</th>
                    <th className="pb-3 px-2">ESTADO</th>
                    <th className="pb-3 px-2 text-right">ACCIONES</th>
                  </tr>
                </thead>
                <tbody>
                  {clientes.map(c => {
                    const horas = calcularHorasRestantes(c.fecha_activacion, c.dias_asignados);
                    const activo = horas > 0;
                    const sinEmpezar = !c.fecha_activacion;
                    const isEditing = editandoId === c.id;

                    return (
                      <tr key={c.id} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                        {isEditing ? (
                          <>
                            <td className="py-3 px-2">
                              <input value={editDatos.usuario || ''} onChange={e => setEditDatos({...editDatos, usuario: e.target.value})} className="w-24 bg-black border border-gray-600 rounded p-1 text-sm" />
                            </td>
                            <td className="py-3 px-2">
                              <input value={editDatos.password || ''} onChange={e => setEditDatos({...editDatos, password: e.target.value})} className="w-24 bg-black border border-gray-600 rounded p-1 text-sm" />
                            </td>
                            <td className="py-3 px-2 flex gap-2">
                              <input type="number" title="Días" value={editDatos.dias_asignados || 1} onChange={e => setEditDatos({...editDatos, dias_asignados: Number(e.target.value)})} className="w-16 bg-black border border-gray-600 rounded p-1 text-sm" />
                              <input type="number" title="Tarifa" value={editDatos.tarifa_diaria || 1} onChange={e => setEditDatos({...editDatos, tarifa_diaria: Number(e.target.value)})} className="w-16 bg-black border border-gray-600 rounded p-1 text-sm" />
                            </td>
                            <td className="py-3 px-2 text-xs text-gray-500">En edición...</td>
                            <td className="py-3 px-2 text-right">
                              <button onClick={guardarEdicion} className="text-green-400 hover:text-green-300 mr-3 font-bold text-sm">Guardar</button>
                              <button onClick={() => setEditandoId(null)} className="text-gray-400 hover:text-gray-200 font-bold text-sm">Cancelar</button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="py-4 px-2 font-bold text-white">{c.usuario}</td>
                            <td className="py-4 px-2 text-gray-400 font-mono text-sm">{c.password}</td>
                            <td className="py-4 px-2 text-gray-300 text-sm">
                              {c.dias_asignados}D <span className="text-gray-500">@</span> ${c.tarifa_diaria}/día
                            </td>
                            <td className="py-4 px-2">
                              {sinEmpezar ? (
                                 <span className="text-yellow-500 bg-yellow-900/30 px-3 py-1 rounded-full text-xs">Pendiente</span>
                              ) : activo ? (
                                 <span className="text-green-400 bg-green-900/30 px-3 py-1 rounded-full text-xs">{Math.floor(horas)}h res.</span>
                              ) : (
                                 <span className="text-red-500 bg-red-900/30 px-3 py-1 rounded-full text-xs">Agotado</span>
                              )}
                            </td>
                            <td className="py-4 px-2 text-right">
                              <button onClick={() => iniciarEdicion(c)} className="text-blue-400 hover:text-blue-300 mr-4 font-bold text-sm transition-colors">Editar</button>
                              <button onClick={() => eliminarCliente(c.id, c.usuario)} className="text-red-500 hover:text-red-400 font-bold text-sm transition-colors">Eliminar</button>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 7. ENRUTADOR PRINCIPAL (LOGIN)
// ==========================================
export default function AppRouter() {
  const [view, setView] = useState<'login' | 'tv' | 'remote' | 'admin'>('login');
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [clienteActual, setClienteActual] = useState<Cliente | null>(null);

  const handleLogin = async (e: React.FormEvent, targetView: 'tv' | 'remote' | 'admin') => {
    e.preventDefault();
    if (usuario === 'admin' && password === 'admin123' && targetView === 'admin') {
      setView('admin');
      return;
    }

    const { data, error } = await supabase.from('usuarios').select('*').eq('usuario', usuario).eq('password', password).single();
    if (error || !data) {
      alert('Credenciales incorrectas');
      return;
    }

    if (!data.fecha_activacion) {
      const ahora = new Date().toISOString();
      await supabase.from('usuarios').update({ fecha_activacion: ahora }).eq('id', data.id);
      data.fecha_activacion = ahora;
    }

    setClienteActual(data as Cliente);
    setView(targetView);
  };

  const handleLogout = () => {
    setClienteActual(null);
    setUsuario('');
    setPassword('');
    setView('login');
  };

  if (view === 'admin') return <AdminDashboard onLogout={handleLogout} />;
  if (view === 'tv' && clienteActual) return <TvScreen cliente={clienteActual} onLogout={handleLogout} />;
  if (view === 'remote' && clienteActual) return <RemoteDashboard cliente={clienteActual} onLogout={handleLogout} />;

  return (
    <div className="flex h-screen bg-gray-950 items-center justify-center p-4">
      <div className="bg-gray-900 p-8 rounded-2xl shadow-2xl border border-gray-800 w-full max-w-md">
        <h1 className="text-3xl font-black text-center text-purple-500 mb-8 tracking-widest">KARAOKE SAAS</h1>
        <form className="space-y-6">
          <div>
            <label className="block text-gray-400 text-sm font-bold mb-2">Usuario / PIN</label>
            <input required type="text" value={usuario} onChange={(e) => setUsuario(e.target.value)} className="w-full bg-black border border-gray-700 rounded-lg p-3 text-white focus:border-purple-500 outline-none" />
          </div>
          <div>
            <label className="block text-gray-400 text-sm font-bold mb-2">Contraseña</label>
            <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-black border border-gray-700 rounded-lg p-3 text-white focus:border-purple-500 outline-none" />
          </div>
          
          <div className="grid grid-cols-2 gap-4 pt-4">
            <button onClick={(e) => handleLogin(e, 'tv')} className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 rounded-lg shadow-lg">Entrar TV</button>
            <button onClick={(e) => handleLogin(e, 'remote')} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-lg shadow-lg">Entrar DJ</button>
          </div>
          <button onClick={(e) => handleLogin(e, 'admin')} className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold py-3 rounded-lg mt-4 border border-gray-700">Acceso Admin</button>
        </form>
      </div>
    </div>
  );
}