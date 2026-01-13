import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Film, Settings, Search, HardDrive, ListFilter } from 'lucide-react';

// Configuración de la API base (siempre usa rutas relativas para aprovechar el proxy)
const API_BASE = '';

export default function HermesApp() {
  const [videos, setVideos] = useState([]);
  const [genres, setGenres] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [loading, setLoading] = useState(true);

  // Estados de filtrado
  const [selectedGenre, setSelectedGenre] = useState(null);
  const [selectedLetter, setSelectedLetter] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Cargar películas
  useEffect(() => {
    fetch(`${API_BASE}/api/videos`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setVideos(data);
        } else {
          console.error('Error del servidor:', data);
          setVideos([]);
        }
        setLoading(false);
      })
      .catch((error) => {
        console.error('Error de conexión:', error);
        setVideos([]);
        setLoading(false);
      });
  }, []);

  // Cargar géneros de TMDB
  useEffect(() => {
    fetch(`${API_BASE}/api/genres`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setGenres(data);
        }
      })
      .catch(error => console.error('Error cargando géneros:', error));
  }, []);

  // Enriquecer películas usando el backend como proxy de TMDB
  useEffect(() => {
    const enrichMovies = async () => {
      // Filtrar solo películas con placeholder SVG (sin metadata de TMDB)
      const videosToEnrich = videos
        .filter(video => video.poster && video.poster.startsWith('data:image/svg'))
        .map(video => video.filename);

      if (videosToEnrich.length === 0) {
        console.log('✅ Todas las películas ya tienen metadata');
        return;
      }

      console.log(`🎬 Enriqueciendo ${videosToEnrich.length} películas vía backend...`);

      try {
        const res = await fetch(`${API_BASE}/api/movies/enrich`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ filenames: videosToEnrich })
        });

        if (!res.ok) {
          console.error('Error al enriquecer películas:', res.statusText);
          return;
        }

        const data = await res.json();

        if (data.success && data.results) {
          console.log(`✅ Backend procesó ${data.results.length} películas`);

          // Actualizar videos con metadata del backend
          setVideos(prevVideos => {
            const newVideos = [...prevVideos];

            data.results.forEach(result => {
              if (result.success) {
                const index = newVideos.findIndex(v => v.filename === result.filename);
                if (index !== -1) {
                  newVideos[index] = {
                    ...newVideos[index],
                    poster: result.metadata.poster || newVideos[index].poster,
                    backdrop: result.metadata.backdrop || newVideos[index].backdrop,
                    overview: result.metadata.overview || newVideos[index].overview,
                    rating: result.metadata.rating || newVideos[index].rating,
                    releaseDate: result.metadata.releaseDate || newVideos[index].releaseDate,
                    genreIds: result.metadata.genreIds || newVideos[index].genreIds
                  };
                  console.log(`✅ Actualizado: ${result.filename}`);
                }
              }
            });

            return newVideos;
          });

          console.log('✅ Enriquecimiento completado');
        }
      } catch (error) {
        console.error('Error al enriquecer películas:', error);
      }
    };

    if (videos.length > 0) {
      enrichMovies();
    }
  }, [videos.length]);

  // Filtrado combinado con useMemo para performance
  const filteredVideos = useMemo(() => {
    let result = videos;

    // Filtro por búsqueda
    if (searchQuery.trim()) {
      result = result.filter(v =>
        v.title.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Filtro por género
    if (selectedGenre) {
      result = result.filter(v =>
        v.genreIds && v.genreIds.includes(selectedGenre)
      );
    }

    // Filtro por letra inicial
    if (selectedLetter) {
      result = result.filter(v => {
        const firstChar = v.title.charAt(0).toUpperCase();
        return firstChar === selectedLetter;
      });
    }

    return result;
  }, [videos, searchQuery, selectedGenre, selectedLetter]);

  // Letras del alfabeto
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  // Determinar qué letras tienen películas
  const lettersWithMovies = useMemo(() => {
    const letters = new Set();
    videos.forEach(v => {
      const firstChar = v.title.charAt(0).toUpperCase();
      if (/[A-Z]/.test(firstChar)) {
        letters.add(firstChar);
      }
    });
    return letters;
  }, [videos]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans relative overflow-hidden">
      {/* Fondo Animado Pastel */}
      <motion.div
        animate={{ scale: [1, 1.2, 1], rotate: [0, 90, 0] }}
        transition={{ duration: 20, repeat: Infinity }}
        className="absolute -top-20 -left-20 w-96 h-96 bg-purple-100 rounded-full blur-3xl opacity-60"
      />
      <motion.div
        animate={{ scale: [1, 1.5, 1], rotate: [0, -90, 0] }}
        transition={{ duration: 25, repeat: Infinity }}
        className="absolute -bottom-20 -right-20 w-[30rem] h-[30rem] bg-blue-100 rounded-full blur-3xl opacity-60"
      />

      {/* Header Glassmorphism */}
      <header className="relative z-10 mx-4 md:mx-8 mt-8 flex flex-col md:flex-row justify-between items-center bg-white/60 backdrop-blur-md border border-white p-4 md:p-6 rounded-3xl shadow-sm mb-8">
        <div className="flex items-center gap-3 mb-4 md:mb-0">
          <div className="p-3 bg-indigo-500 rounded-2xl shadow-lg shadow-indigo-200">
            <Film className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">
            Hermes<span className="text-indigo-500">Stream</span>
          </h1>
        </div>

        {/* Barra de búsqueda activa */}
        <div className="flex gap-4 w-full md:w-auto">
          <div className="relative flex-1 md:flex-initial">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar películas..."
              className="w-full md:w-64 pl-10 pr-4 py-2.5 bg-white/80 rounded-xl border border-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-slate-700 placeholder-slate-400"
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18}/>
          </div>
          <button className="p-3 bg-white/80 rounded-xl border border-slate-100 hover:shadow-md transition-all">
            <Settings className="text-slate-400" size={20}/>
          </button>
        </div>
      </header>

      {/* Panel de Géneros (Izquierda) */}
      <div className="fixed left-0 top-36 w-56 h-[calc(100vh-10rem)] overflow-y-auto bg-white/60 backdrop-blur-md border border-white rounded-r-3xl shadow-sm p-4 z-20 hidden lg:block">
        <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
          <ListFilter size={18} /> Géneros
        </h3>

        {/* Opción "Todas" */}
        <button
          onClick={() => {
            setSelectedGenre(null);
            setSelectedLetter(null);
            setSearchQuery('');
          }}
          className={`w-full text-left px-4 py-2.5 rounded-xl transition-all mb-2 ${
            selectedGenre === null && selectedLetter === null && !searchQuery
              ? 'bg-indigo-500 text-white shadow-md'
              : 'bg-white/50 text-slate-700 hover:bg-white/80'
          }`}
        >
          🏠 Todas
        </button>

        {/* Lista de géneros */}
        {genres.length === 0 ? (
          <div className="text-sm text-slate-400 px-4 py-2">Cargando géneros...</div>
        ) : (
          genres.map(genre => (
            <button
              key={genre.id}
              onClick={() => setSelectedGenre(genre.id)}
              className={`w-full text-left px-4 py-2.5 rounded-xl transition-all mb-2 ${
                selectedGenre === genre.id
                  ? 'bg-indigo-500 text-white shadow-md'
                  : 'bg-white/50 text-slate-700 hover:bg-white/80'
              }`}
            >
              {genre.name}
            </button>
          ))
        )}
      </div>

      {/* Índice Alfabético (Derecha) */}
      <div className="hidden md:flex fixed right-0 top-36 w-16 h-[calc(100vh-10rem)] overflow-y-auto bg-white/60 backdrop-blur-md border border-white rounded-l-3xl shadow-sm p-2 flex-col items-center gap-1 z-20">
        {/* Botón "Todas" para desactivar filtro alfabético */}
        <motion.button
          whileHover={{ scale: 1.15 }}
          onClick={() => setSelectedLetter(null)}
          className={`w-11 h-11 rounded-xl flex items-center justify-center text-xs font-bold transition-all mb-2 ${
            selectedLetter === null
              ? 'bg-indigo-500 text-white shadow-md'
              : 'bg-white/50 text-slate-700 hover:bg-white/80 cursor-pointer'
          }`}
        >
          🏠
        </motion.button>

        {alphabet.map(letter => {
          const hasMovies = lettersWithMovies.has(letter);

          return (
            <motion.button
              key={letter}
              whileHover={{ scale: hasMovies ? 1.15 : 1 }}
              onClick={() => hasMovies && setSelectedLetter(letter === selectedLetter ? null : letter)}
              disabled={!hasMovies}
              className={`w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold transition-all ${
                selectedLetter === letter
                  ? 'bg-indigo-500 text-white shadow-md'
                  : hasMovies
                    ? 'bg-white/50 text-slate-700 hover:bg-white/80 cursor-pointer'
                    : 'bg-slate-100 text-slate-300 cursor-not-allowed'
              }`}
            >
              {letter}
            </motion.button>
          );
        })}
      </div>

      {/* Contenedor Principal con padding para los paneles */}
      <main className="relative z-10 px-4 md:pl-64 md:pr-24 pb-8">
        <h2 className="text-3xl font-bold text-slate-800 mb-8 flex items-center gap-3">
          <HardDrive className="text-indigo-400" />
          {selectedGenre
            ? genres.find(g => g.id === selectedGenre)?.name
            : selectedLetter
              ? `Letra ${selectedLetter}`
              : searchQuery
                ? 'Resultados de búsqueda'
                : 'Mi Biblioteca'
          }
          <span className="text-sm font-normal text-slate-500">({filteredVideos.length})</span>
        </h2>

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-8 animate-pulse">
            {[1,2,3,4,5].map(i => <div key={i} className="w-full aspect-[3/4] bg-slate-200 rounded-[2.5rem]" />)}
          </div>
        ) : filteredVideos.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-slate-300 text-6xl mb-4">🎬</div>
            <p className="text-slate-400 text-lg">No se encontraron películas</p>
            <p className="text-slate-300 text-sm mt-2">Intenta con otro filtro o búsqueda</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-8">
            {filteredVideos.map((video, idx) => (
              <motion.div
                key={video.filename}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.02 }}
                whileHover={{ y: -10 }}
                onClick={() => setSelectedVideo(video)}
                className="cursor-pointer group"
              >
                <div className={`aspect-[3/4] rounded-[2.5rem] ${
                  !video.poster
                    ? `bg-gradient-to-br ${idx % 2 === 0 ? 'from-indigo-100 to-purple-200' : 'from-emerald-50 to-teal-100'}`
                    : 'bg-slate-800'
                } border border-white shadow-sm flex items-center justify-center relative overflow-hidden`}>
                  {video.poster ? (
                    <img
                      src={video.poster}
                      alt={video.title}
                      className="absolute inset-0 w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : null}
                  <Play className="text-white opacity-0 group-hover:opacity-100 transition-opacity scale-150 z-10 drop-shadow-lg" fill="white" />
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <h3 className="mt-4 font-bold text-slate-700 truncate px-2">{video.title}</h3>
                <p className="text-sm text-slate-400 px-2">{video.size}</p>
                {video.rating && (
                  <div className="flex items-center gap-1 px-2 mt-1">
                    <span className="text-yellow-500 text-sm">⭐</span>
                    <span className="text-sm text-slate-600">{video.rating.toFixed(1)}</span>
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </main>

      {/* Modal Reproductor */}
      <AnimatePresence>
        {selectedVideo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/90 backdrop-blur-md p-6"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="bg-white rounded-[3rem] w-full max-w-5xl overflow-hidden shadow-2xl"
            >
              <div className="p-6 flex justify-between bg-slate-50 border-b">
                <span className="font-bold text-slate-700">{selectedVideo.title}</span>
                <button
                  onClick={() => setSelectedVideo(null)}
                  className="text-slate-400 hover:text-red-500 transition-colors text-xl"
                >
                  ✕
                </button>
              </div>
              <video src={selectedVideo.url} controls autoPlay className="w-full aspect-video bg-black" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
