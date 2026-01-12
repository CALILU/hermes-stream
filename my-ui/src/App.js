import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Film, Tv, Settings, Search, HardDrive } from 'lucide-react';

// Configuración de la API base (desarrollo vs producción)
const API_BASE = process.env.REACT_APP_API_URL ||
                 (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001');

export default function HermesApp() {
  const [videos, setVideos] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/videos`)
      .then(res => res.json())
      .then(data => { setVideos(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-8 font-sans relative overflow-hidden">
      {/* Fondo Animado Pastel */}
      <motion.div animate={{ scale: [1, 1.2, 1], rotate: [0, 90, 0] }} transition={{ duration: 20, repeat: Infinity }} 
        className="absolute -top-20 -left-20 w-96 h-96 bg-purple-100 rounded-full blur-3xl opacity-60" />
      <motion.div animate={{ scale: [1, 1.5, 1], rotate: [0, -90, 0] }} transition={{ duration: 25, repeat: Infinity }} 
        className="absolute -bottom-20 -right-20 w-[30rem] h-[30rem] bg-blue-100 rounded-full blur-3xl opacity-60" />

      {/* Header Glassmorphism */}
      <header className="relative z-10 flex justify-between items-center bg-white/60 backdrop-blur-md border border-white p-6 rounded-3xl shadow-sm mb-12">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-500 rounded-2xl shadow-lg shadow-indigo-200"><Film className="text-white" /></div>
          <h1 className="text-2xl font-bold text-slate-800">Hermes<span className="text-indigo-500">Stream</span></h1>
        </div>
        <div className="flex gap-4">
          <button className="p-3 bg-white/80 rounded-xl border border-slate-100 hover:shadow-md transition-all"><Search className="text-slate-400" size={20}/></button>
          <button className="p-3 bg-white/80 rounded-xl border border-slate-100 hover:shadow-md transition-all"><Settings className="text-slate-400" size={20}/></button>
        </div>
      </header>

      {/* Listado de Archivos */}
      <main className="relative z-10">
        <h2 className="text-3xl font-bold text-slate-800 mb-8 flex items-center gap-3">
          <HardDrive className="text-indigo-400" /> Mi Biblioteca
        </h2>

        {loading ? (
          <div className="flex gap-6 animate-pulse">
            {[1,2,3,4].map(i => <div key={i} className="w-56 h-72 bg-slate-200 rounded-[2.5rem]" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8">
            {videos.map((video, idx) => (
              <motion.div 
                key={idx} whileHover={{ y: -10 }} onClick={() => setSelectedVideo(video)}
                className="cursor-pointer group"
              >
                <div className={`aspect-[3/4] rounded-[2.5rem] bg-gradient-to-br ${idx % 2 === 0 ? 'from-indigo-100 to-purple-200' : 'from-emerald-50 to-teal-100'} border border-white shadow-sm flex items-center justify-center relative overflow-hidden`}>
                  <Play className="text-white opacity-0 group-hover:opacity-100 transition-opacity scale-150 z-10" fill="white" />
                  <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <h3 className="mt-4 font-bold text-slate-700 truncate px-2">{video.title}</h3>
                <p className="text-sm text-slate-400 px-2">{video.size}</p>
              </motion.div>
            ))}
          </div>
        )}
      </main>

      {/* Modal Reproductor */}
      <AnimatePresence>
        {selectedVideo && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/90 backdrop-blur-md p-6">
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="bg-white rounded-[3rem] w-full max-w-5xl overflow-hidden shadow-2xl">
              <div className="p-6 flex justify-between bg-slate-50 border-b">
                <span className="font-bold text-slate-700">{selectedVideo.title}</span>
                <button onClick={() => setSelectedVideo(null)} className="text-slate-400 hover:text-red-500 transition-colors text-xl">✕</button>
              </div>
              <video src={selectedVideo.url} controls autoPlay className="w-full aspect-video bg-black" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}