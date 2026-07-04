'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';

export default function AdminModule() {
  const [isAuth, setIsAuth] = useState(false);
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  
  const [logs, setLogs] = useState<any[]>([]);
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [nuevaPass, setNuevaPass] = useState('');
  const [usuarioSeleccionado, setUsuarioSeleccionado] = useState('');

  // 1. SISTEMA DE LOGIN PARA EL ADMIN
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data } = await supabase
      .from('usuarios')
      .select('*')
      .eq('usuario', loginUser.toLowerCase())
      .eq('password', loginPass)
      .single();

    if (data && data.rol === 'admin') {
      setIsAuth(true);
      await supabase.from('log_ingresos').insert([{ usuario: data.usuario, evento: 'INGRESO ADMIN EXITOSO' }]);
      cargarDatos();
    } else {
      await supabase.from('log_ingresos').insert([{ usuario: loginUser || 'Desconocido', evento: 'INTENTO ADMIN FALLIDO' }]);
      alert("Credenciales incorrectas o no tienes permisos de Administrador.");
    }
  };

  // 2. CARGAR BASE DE DATOS
  const cargarDatos = async () => {
    const { data: logsData } = await supabase.from('log_ingresos').select('*').order('fecha', { ascending: false }).limit(50);
    const { data: usersData } = await supabase.from('usuarios').select('usuario, rol');
    if (logsData) setLogs(logsData);
    if (usersData) {
       setUsuarios(usersData);
       setUsuarioSeleccionado(usersData[0]?.usuario || '');
    }
  };

  // 3. CAMBIAR CONTRASEÑA
  const cambiarPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevaPass || !usuarioSeleccionado) return;
    
    await supabase.from('usuarios').update({ password: nuevaPass }).eq('usuario', usuarioSeleccionado);
    await supabase.from('log_ingresos').insert([{ usuario: 'admin', evento: `CAMBIÓ CONTRASEÑA DE: ${usuarioSeleccionado}` }]);
    
    alert(`Contraseña de ${usuarioSeleccionado} actualizada con éxito.`);
    setNuevaPass('');
    cargarDatos(); // Recargar logs
  };

  // PANTALLA DE LOGIN
  if (!isAuth) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950 text-white p-4">
        <form onSubmit={handleLogin} className="bg-gray-900 p-8 rounded-xl border border-red-500/50 shadow-[0_0_30px_rgba(220,38,38,0.3)] w-full max-w-md">
          <h1 className="text-3xl font-black text-red-500 mb-2 text-center tracking-widest">SISTEMA ADMIN</h1>
          <p className="text-gray-400 text-center mb-8">Acceso Restringido</p>
          <input type="text" placeholder="Usuario Admin" value={loginUser} onChange={(e)=>setLoginUser(e.target.value)} className="w-full mb-4 p-3 bg-black border border-gray-700 rounded text-white" required />
          <input type="password" placeholder="Contraseña" value={loginPass} onChange={(e)=>setLoginPass(e.target.value)} className="w-full mb-6 p-3 bg-black border border-gray-700 rounded text-white" required />
          <button type="submit" className="w-full bg-red-600 hover:bg-red-500 font-bold py-3 rounded transition-all">INGRESAR</button>
        </form>
      </div>
    );
  }

  // PANTALLA DEL DASHBOARD ADMIN
  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8 pb-4 border-b border-gray-800">
          <h1 className="text-3xl font-black text-red-500 tracking-widest">PANEL DE CONTROL (AUDITORÍA)</h1>
          <button onClick={() => setIsAuth(false)} className="bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded text-sm font-bold">Cerrar Sesión</button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* MÓDULO DE CONTRASEÑAS */}
          <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 h-fit shadow-xl">
            <h2 className="text-xl font-bold mb-4 text-purple-400 flex items-center gap-2">🔑 Gestor de Contraseñas</h2>
            <form onSubmit={cambiarPassword} className="space-y-4">
              <div>
                <label className="text-sm text-gray-400">Seleccionar Usuario:</label>
                <select value={usuarioSeleccionado} onChange={(e)=>setUsuarioSeleccionado(e.target.value)} className="w-full mt-1 p-3 bg-black border border-gray-700 rounded text-white">
                  {usuarios.map(u => <option key={u.usuario} value={u.usuario}>{u.usuario} ({u.rol})</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-400">Nueva Contraseña:</label>
                <input type="text" value={nuevaPass} onChange={(e)=>setNuevaPass(e.target.value)} className="w-full mt-1 p-3 bg-black border border-gray-700 rounded text-white" required />
              </div>
              <button type="submit" className="w-full bg-purple-600 hover:bg-purple-500 font-bold py-3 rounded">Actualizar Credencial</button>
            </form>
          </div>

          {/* BITÁCORA DE LOGS */}
          <div className="md:col-span-2 bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-xl">
            <h2 className="text-xl font-bold mb-4 text-blue-400 flex items-center gap-2">📋 Log de Eventos de Seguridad</h2>
            <div className="overflow-y-auto h-[500px] pr-2 space-y-2">
              {logs.map(log => (
                <div key={log.id} className="bg-black p-3 rounded border border-gray-800 flex justify-between items-center text-sm">
                  <div>
                    <span className="font-bold text-gray-300 mr-2">[{new Date(log.fecha).toLocaleString()}]</span>
                    <span className="font-black text-yellow-500 mr-2">@{log.usuario.toUpperCase()}</span>
                    <span className={log.evento.includes('FALLIDO') ? 'text-red-400 font-bold' : 'text-green-400'}>{log.evento}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}