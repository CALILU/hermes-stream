import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Settings, Search, HardDrive, ListFilter, X, Image, Trash2, Layers, FolderOpen, RefreshCw, Volume2, Lock, User, LogOut, Wifi } from 'lucide-react';

// Configuración de la API base (siempre usa rutas relativas para aprovechar el proxy)
const API_BASE = '';

// Obtener token de sesión
const getSessionToken = () => localStorage.getItem('isiprime_session');
const setSessionToken = (token) => token ? localStorage.setItem('isiprime_session', token) : localStorage.removeItem('isiprime_session');

// Fetch con autenticación
const authFetch = async (url, options = {}) => {
  const token = getSessionToken();
  const headers = { ...options.headers };
  if (token) {
    headers['X-Session-Token'] = token;
  }
  return fetch(url, { ...options, headers });
};

// Funciones de localStorage para caché de carátulas
const CACHE_KEY = 'hermes_posters_cache';

function loadCache() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    return cached ? JSON.parse(cached) : {};
  } catch {
    return {};
  }
}

function saveCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn('No se pudo guardar en localStorage:', e);
  }
}

export default function HermesApp() {
  // Estados de autenticación
  const [authState, setAuthState] = useState({
    checking: true,    // Verificando estado inicial
    isLocal: true,     // ¿Es usuario local?
    authenticated: false,
    user: null,
    requiresLogin: false
  });
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [videos, setVideos] = useState([]);
  const [genres, setGenres] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [loadingVideo, setLoadingVideo] = useState(null); // Video que se está cargando
  const [loading, setLoading] = useState(true);
  const enrichmentDone = useRef(false);

  // Estados para amplificación de volumen
  const [volumeBoost, setVolumeBoost] = useState(100); // 100% = normal, hasta 600%
  const [showVolumeBoost, setShowVolumeBoost] = useState(false);
  const videoRef = useRef(null);
  const audioContextRef = useRef(null);
  const gainNodeRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const lastSaveTimeRef = useRef(0); // Para evitar guardar demasiado frecuente

  // ========== SISTEMA DE CONTINUAR VIENDO ==========

  // Guardar progreso de reproducción
  const saveVideoProgress = (filename, currentTime, duration) => {
    if (!filename || !currentTime || !duration) return;

    // No guardar si está casi al principio (< 30 seg) o casi al final (> 95%)
    const progress = currentTime / duration;
    if (currentTime < 30 || progress > 0.95) {
      // Si terminó la película, eliminar el progreso guardado
      if (progress > 0.95) {
        localStorage.removeItem(`video_progress_${filename}`);
      }
      return;
    }

    const data = {
      currentTime,
      duration,
      savedAt: Date.now(),
      progress: Math.round(progress * 100)
    };
    localStorage.setItem(`video_progress_${filename}`, JSON.stringify(data));
  };

  // Recuperar progreso guardado
  const getVideoProgress = (filename) => {
    if (!filename) return null;

    try {
      const saved = localStorage.getItem(`video_progress_${filename}`);
      if (!saved) return null;

      const data = JSON.parse(saved);
      // Ignorar si tiene más de 30 días
      if (Date.now() - data.savedAt > 30 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem(`video_progress_${filename}`);
        return null;
      }

      return data;
    } catch {
      return null;
    }
  };

  // Manejar actualización de tiempo del video
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !selectedVideo) return;

    // Guardar cada 10 segundos para no saturar localStorage
    const now = Date.now();
    if (now - lastSaveTimeRef.current < 10000) return;
    lastSaveTimeRef.current = now;

    saveVideoProgress(selectedVideo.filename, video.currentTime, video.duration);
  };

  // Restaurar posición al cargar el video
  const handleVideoLoaded = () => {
    const video = videoRef.current;
    if (!video || !selectedVideo) return;

    const saved = getVideoProgress(selectedVideo.filename);
    if (saved && saved.currentTime > 30) {
      // Mostrar confirmación o ir directamente
      video.currentTime = saved.currentTime;
      console.log(`▶️ Continuando desde ${Math.floor(saved.currentTime / 60)}:${String(Math.floor(saved.currentTime % 60)).padStart(2, '0')} (${saved.progress}%)`);
    }
  };

  // Guardar progreso al cerrar el reproductor
  const closeVideoPlayer = () => {
    const video = videoRef.current;
    if (video && selectedVideo) {
      saveVideoProgress(selectedVideo.filename, video.currentTime, video.duration);
    }
    setSelectedVideo(null);
  };

  // Estados de filtrado
  const [selectedGenre, setSelectedGenre] = useState(null);
  const [selectedLetter, setSelectedLetter] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Estados para colecciones
  const [collections, setCollections] = useState([]);
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [showCollections, setShowCollections] = useState(false); // Toggle entre géneros y colecciones
  const [generatingCollections, setGeneratingCollections] = useState(false);

  // Mapeo de géneros a emoticonos
  const genreEmojis = {
    'Acción': '💥',
    'Action': '💥',
    'Aventura': '🧭',
    'Adventure': '🧭',
    'Animación': '✨',
    'Animation': '✨',
    'Comedia': '😂',
    'Comedy': '😂',
    'Crimen': '🔪',
    'Crime': '🔪',
    'Documental': '🎥',
    'Documentary': '🎥',
    'Drama': '🎭',
    'Familia': '👨‍👩‍👧‍👦',
    'Family': '👨‍👩‍👧‍👦',
    'Fantasía': '🧙‍♂️',
    'Fantasy': '🧙‍♂️',
    'Historia': '📜',
    'History': '📜',
    'Terror': '👻',
    'Horror': '👻',
    'Música': '🎵',
    'Music': '🎵',
    'Misterio': '🔍',
    'Mystery': '🔍',
    'Romance': '💕',
    'Ciencia ficción': '🚀',
    'Science Fiction': '🚀',
    'Película de TV': '📺',
    'TV Movie': '📺',
    'Suspense': '😰',
    'Thriller': '😰',
    'Bélica': '⚔️',
    'Guerra': '⚔️',
    'War': '⚔️',
    'Western': '🤠'
  };

  // Estados para filtro por décadas/años
  const [selectedDecade, setSelectedDecade] = useState(null);
  const [selectedYear, setSelectedYear] = useState(null);
  const [showDecades, setShowDecades] = useState(false); // Toggle para mostrar filtro de décadas
  const [showRecent, setShowRecent] = useState(false); // Mostrar películas recientes

  // Estado para paginación/carga progresiva
  const [visibleCount, setVisibleCount] = useState(50); // Mostrar inicialmente 50 películas
  const LOAD_MORE_COUNT = 50; // Cargar 50 más cada vez

  // Estados para búsqueda por actor en galería
  const [galleryActorQuery, setGalleryActorQuery] = useState('');
  const [galleryActorMovieIds, setGalleryActorMovieIds] = useState(null); // Array de TMDB IDs del actor
  const [galleryActorLoading, setGalleryActorLoading] = useState(false);
  const [galleryActorName, setGalleryActorName] = useState(''); // Nombre del actor encontrado

  // Estados para menú contextual
  const [contextMenu, setContextMenu] = useState(null); // { x, y, video }

  // Estados para modal de búsqueda de carátula
  const [posterSearchModal, setPosterSearchModal] = useState(null); // video a editar
  const [posterSearchQuery, setPosterSearchQuery] = useState('');
  const [posterSearchResults, setPosterSearchResults] = useState([]);
  const [posterSearchLoading, setPosterSearchLoading] = useState(false);

  // Estado para confirmación de borrado
  const [deleteConfirm, setDeleteConfirm] = useState(null); // video a borrar
  const [deleting, setDeleting] = useState(false);

  // Estado para conversión de AVI/MKV a MP4
  const [conversionProgress, setConversionProgress] = useState(null); // { jobId, status, progress, message, filename }

  // Estado para selección de pista de audio
  const [audioSelectionModal, setAudioSelectionModal] = useState(null); // { video, tracks, loading }
  const [selectedAudioTrack, setSelectedAudioTrack] = useState(0);
  const [preferredLanguage, setPreferredLanguage] = useState(() => {
    return localStorage.getItem('preferredAudioLanguage') || 'spa';
  });

  // Estado para modal de configuración
  const [settingsModal, setSettingsModal] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheProgress, setCacheProgress] = useState({ current: 0, total: 0, status: '' });

  // Estado para modo de almacenamiento (local/ftp)
  const [storageMode, setStorageMode] = useState('ftp'); // 'ftp' o 'local'
  const [storagePath, setStoragePath] = useState('');
  const [changingMode, setChangingMode] = useState(false);

  // Estado para sistema de peticiones de películas
  const [requestsModal, setRequestsModal] = useState(false);
  const [requestsAdminModal, setRequestsAdminModal] = useState(false);
  const [requestSearchQuery, setRequestSearchQuery] = useState('');
  const [requestSearchResults, setRequestSearchResults] = useState([]);
  const [requestSearchLoading, setRequestSearchLoading] = useState(false);
  const [selectedRequests, setSelectedRequests] = useState([]); // películas seleccionadas para pedir
  const [submittingRequests, setSubmittingRequests] = useState(false);
  const [allRequests, setAllRequests] = useState([]); // todas las peticiones (admin)
  const [existingRequests, setExistingRequests] = useState([]); // peticiones ya enviadas (para mostrar borde rojo)
  const [actorSearchQuery, setActorSearchQuery] = useState('');
  const [actorSearchResult, setActorSearchResult] = useState(null); // { actor, movies }
  const [actorSearchLoading, setActorSearchLoading] = useState(false);
  const [requestsStats, setRequestsStats] = useState(null);
  const [requestsReadonly, setRequestsReadonly] = useState(false); // modo solo lectura para peticiones
  const [requestDetailMovie, setRequestDetailMovie] = useState(null); // película para ver sinopsis completa
  const [downloadUrl, setDownloadUrl] = useState(''); // URL para añadir a cola de descargas
  const [downloadQueueStatus, setDownloadQueueStatus] = useState(null); // estado de la cola

  // Verificar estado de autenticación al cargar
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await authFetch(`${API_BASE}/api/auth/status`);
        const data = await response.json();

        setAuthState({
          checking: false,
          isLocal: data.isLocal,
          authenticated: data.authenticated,
          user: data.user,
          requiresLogin: data.requiresLogin || false
        });
      } catch (error) {
        console.error('Error verificando autenticación:', error);
        // En caso de error, asumir que es local
        setAuthState({
          checking: false,
          isLocal: true,
          authenticated: true,
          user: null,
          requiresLogin: false
        });
      }
    };

    checkAuth();
  }, []);

  // Cargar configuración de almacenamiento
  useEffect(() => {
    fetch(`${API_BASE}/api/storage/config`)
      .then(res => res.json())
      .then(data => {
        setStorageMode(data.mode || 'ftp');
        setStoragePath(data.localPath || '');
        console.log(`📁 Modo almacenamiento: ${data.mode?.toUpperCase()}`);
      })
      .catch(err => console.error('Error cargando config almacenamiento:', err));
  }, []);

  // SSE para actualizaciones de peticiones en tiempo real
  useEffect(() => {
    if (!requestsAdminModal) return;

    const eventSource = new EventSource(`${API_BASE}/api/requests/events`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'update' && data.request) {
          // Actualizar la petición específica en el array
          setAllRequests(prev => prev.map(req =>
            req.id === data.request.id ? { ...req, ...data.request } : req
          ));
          console.log(`📡 Petición #${data.request.id} actualizada a: ${data.request.status}`);
        }
      } catch (err) {
        console.error('Error procesando evento SSE:', err);
      }
    };

    eventSource.onerror = () => {
      console.log('📡 Conexión SSE cerrada');
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [requestsAdminModal]);

  // Cambiar modo de almacenamiento
  const handleStorageModeChange = async (newMode) => {
    if (changingMode || newMode === storageMode) return;

    setChangingMode(true);
    try {
      const res = await authFetch(`${API_BASE}/api/storage/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode, localPath: storagePath })
      });

      const data = await res.json();

      if (data.success) {
        setStorageMode(newMode);
        // Recargar películas
        setLoading(true);
        setVideos([]);
        const videosRes = await authFetch(`${API_BASE}/api/videos`);
        const videosData = await videosRes.json();
        if (Array.isArray(videosData)) {
          setVideos(videosData);
        }
        setLoading(false);
        console.log(`✅ Cambiado a modo ${newMode.toUpperCase()}`);
      } else {
        alert(data.error || 'Error al cambiar modo');
      }
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setChangingMode(false);
    }
  };

  // Explorar y seleccionar carpeta local
  const handleBrowseLocalFolder = async () => {
    if (changingMode) return;
    setChangingMode(true);

    try {
      const res = await authFetch(`${API_BASE}/api/storage/browse`);
      const data = await res.json();

      if (data.success && data.path) {
        // Actualizar la ruta y cambiar a modo local
        setStoragePath(data.path);

        const modeRes = await authFetch(`${API_BASE}/api/storage/mode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'local', localPath: data.path })
        });

        const modeData = await modeRes.json();

        if (modeData.success) {
          setStorageMode('local');
          // Recargar películas
          setLoading(true);
          setVideos([]);
          const videosRes = await authFetch(`${API_BASE}/api/videos`);
          const videosData = await videosRes.json();
          if (Array.isArray(videosData)) {
            setVideos(videosData);
          }
          setLoading(false);
          console.log(`✅ Carpeta seleccionada: ${data.path}`);
        } else {
          alert(modeData.error || 'Error al cambiar a modo local');
        }
      }
    } catch (err) {
      console.error('Error seleccionando carpeta:', err);
    } finally {
      setChangingMode(false);
    }
  };

  // Función de login
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });

      const data = await response.json();

      if (data.success) {
        setSessionToken(data.sessionToken);
        setAuthState({
          checking: false,
          isLocal: false,
          authenticated: true,
          user: data.user,
          requiresLogin: false
        });
        setLoginForm({ username: '', password: '' });
      } else {
        setLoginError(data.error || 'Error al iniciar sesión');
      }
    } catch (error) {
      console.error('Error en login:', error);
      setLoginError('Error de conexión');
    } finally {
      setLoginLoading(false);
    }
  };

  // Función de logout
  const handleLogout = async () => {
    try {
      await authFetch(`${API_BASE}/api/auth/logout`, { method: 'POST' });
    } catch (error) {
      console.error('Error en logout:', error);
    }
    setSessionToken(null);
    setAuthState(prev => ({
      ...prev,
      authenticated: false,
      user: null,
      requiresLogin: true
    }));
  };

  // Función para limpiar caché y recargar carátulas desde TMDB
  const handleClearCacheAndReload = async () => {
    if (clearingCache) return;

    setClearingCache(true);
    setCacheProgress({ current: 0, total: 0, status: 'Limpiando caché del servidor...' });

    try {
      // 1. Limpiar caché del servidor
      const clearRes = await authFetch(`${API_BASE}/api/cache`, { method: 'DELETE' });
      if (!clearRes.ok) {
        throw new Error('Error al limpiar caché del servidor');
      }

      // 2. Limpiar caché local (localStorage)
      setCacheProgress(p => ({ ...p, status: 'Limpiando caché local...' }));
      localStorage.removeItem(CACHE_KEY);

      // 3. Recargar películas
      setCacheProgress(p => ({ ...p, status: 'Cargando lista de películas...' }));
      setVideos([]);

      const videosRes = await authFetch(`${API_BASE}/api/videos`);
      if (!videosRes.ok) {
        throw new Error('Error al cargar películas');
      }

      const data = await videosRes.json();
      if (Array.isArray(data)) {
        setVideos(data);
        const filenames = data.map(v => v.filename);
        const BATCH_SIZE = 20;
        const totalBatches = Math.ceil(filenames.length / BATCH_SIZE);

        setCacheProgress({ current: 0, total: filenames.length, status: 'Descargando metadatos de TMDB...' });

        // 4. Enriquecer en lotes con progreso
        for (let i = 0; i < filenames.length; i += BATCH_SIZE) {
          const batch = filenames.slice(i, i + BATCH_SIZE);
          const batchNum = Math.floor(i / BATCH_SIZE) + 1;

          setCacheProgress(p => ({
            ...p,
            current: i,
            status: `Procesando lote ${batchNum}/${totalBatches}...`
          }));

          try {
            const enrichRes = await authFetch(`${API_BASE}/api/videos/enrich`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filenames: batch })
            });

            if (enrichRes.ok) {
              const enrichData = await enrichRes.json();
              if (enrichData.results) {
                setVideos(prev => prev.map(video => {
                  const enriched = enrichData.results.find(r => r.filename === video.filename);
                  if (enriched && enriched.success && enriched.metadata) {
                    return {
                      ...video,
                      title: enriched.metadata.title || video.title,
                      poster: enriched.metadata.poster || video.poster,
                      backdrop: enriched.metadata.backdrop || video.backdrop,
                      overview: enriched.metadata.overview || video.overview,
                      rating: enriched.metadata.rating || video.rating,
                      releaseDate: enriched.metadata.releaseDate || video.releaseDate,
                      genreIds: enriched.metadata.genreIds || video.genreIds || [],
                      runtime: enriched.metadata.runtime || video.runtime,
                      videos: enriched.metadata.videos || video.videos || [],
                      recommendations: enriched.metadata.recommendations || video.recommendations || [],
                      cast: enriched.metadata.cast || video.cast || []
                    };
                  }
                  return video;
                }));
              }
            }
          } catch (batchError) {
            console.error(`Error en lote ${batchNum}:`, batchError);
          }

          // Actualizar progreso
          setCacheProgress(p => ({ ...p, current: Math.min(i + BATCH_SIZE, filenames.length) }));
        }
      }

      setCacheProgress(p => ({ ...p, status: '¡Completado!' }));
      setTimeout(() => {
        setSettingsModal(false);
        setCacheProgress({ current: 0, total: 0, status: '' });
      }, 1000);
    } catch (error) {
      console.error('Error al limpiar caché:', error);
      setCacheProgress(p => ({ ...p, status: `Error: ${error.message}` }));
      setTimeout(() => {
        setCacheProgress({ current: 0, total: 0, status: '' });
      }, 3000);
    } finally {
      setClearingCache(false);
      setLoading(false);
    }
  };

  // Cargar películas - el backend ya incluye carátulas del cache.json
  useEffect(() => {
    // No cargar si requiere login
    if (authState.checking || authState.requiresLogin) return;

    authFetch(`${API_BASE}/api/videos`)
      .then(res => {
        if (res.status === 401) {
          setAuthState(prev => ({ ...prev, requiresLogin: true, authenticated: false }));
          throw new Error('No autorizado');
        }
        return res.json();
      })
      .then(data => {
        if (Array.isArray(data)) {
          // El backend ahora devuelve videos con carátulas del cache.json
          // Solo usar localStorage para películas que el backend no tenga en caché
          const cache = loadCache();

          const videosWithAllPosters = data.map(video => {
            // Si el backend ya tiene poster, usarlo
            if (video.poster) {
              return video;
            }
            // Si no, intentar desde localStorage
            const cached = cache[video.filename];
            if (cached && cached.poster) {
              return {
                ...video,
                tmdb_id: cached.tmdb_id || video.tmdb_id,
                poster: cached.poster,
                backdrop: cached.backdrop || video.backdrop,
                overview: cached.overview || video.overview,
                rating: cached.rating || video.rating,
                releaseDate: cached.releaseDate || video.releaseDate,
                genreIds: cached.genreIds || video.genreIds || [],
                runtime: cached.runtime || video.runtime,
                videos: cached.videos || video.videos || [],
                recommendations: cached.recommendations || video.recommendations || []
              };
            }
            return video;
          });

          const withPoster = videosWithAllPosters.filter(v => v.poster).length;
          console.log(`✅ ${withPoster}/${videosWithAllPosters.length} películas con carátula`);
          setVideos(videosWithAllPosters);

          // Detectar películas nuevas y regenerar sagas automáticamente
          const currentFilenames = videosWithAllPosters.map(v => v.filename);
          const savedFilenames = JSON.parse(localStorage.getItem('isiprime_filenames') || '[]');
          const newFilenames = currentFilenames.filter(f => !savedFilenames.includes(f));

          if (newFilenames.length > 0 && savedFilenames.length > 0) {
            console.log(`🆕 ${newFilenames.length} películas nuevas detectadas, actualizando sagas...`);
            // Regenerar sagas en segundo plano
            authFetch(`${API_BASE}/api/collections/generate`, { method: 'POST' })
              .then(res => res.json())
              .then(result => {
                if (result.success) {
                  console.log(`📚 Sagas actualizadas: ${result.totalCollections} colecciones`);
                  // Recargar colecciones
                  authFetch(`${API_BASE}/api/collections`)
                    .then(res => res.json())
                    .then(cols => {
                      if (Array.isArray(cols)) setCollections(cols);
                    })
                    .catch(() => {});
                }
              })
              .catch(err => console.error('Error actualizando sagas:', err));
          }

          // Guardar filenames actuales para próxima comparación
          localStorage.setItem('isiprime_filenames', JSON.stringify(currentFilenames));
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
  }, [authState.checking, authState.requiresLogin]);

  // Cargar géneros de TMDB
  useEffect(() => {
    if (authState.checking || authState.requiresLogin) return;

    authFetch(`${API_BASE}/api/genres`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setGenres(data);
        }
      })
      .catch(error => console.error('Error cargando géneros:', error));
  }, [authState.checking, authState.requiresLogin]);

  // Cargar colecciones (filtradas por género si hay uno seleccionado)
  useEffect(() => {
    if (authState.checking || authState.requiresLogin) return;

    const url = selectedGenre
      ? `${API_BASE}/api/collections?genre=${selectedGenre}`
      : `${API_BASE}/api/collections`;

    authFetch(url)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setCollections(data);
          console.log(`📚 Colecciones cargadas: ${data.length}`);
        }
      })
      .catch(error => console.error('Error cargando colecciones:', error));
  }, [selectedGenre, authState.checking, authState.requiresLogin]); // Recargar cuando cambie el género

  // Función para generar colecciones desde el caché
  const generateCollections = async () => {
    setGeneratingCollections(true);
    try {
      const response = await authFetch(`${API_BASE}/api/collections/generate`, {
        method: 'POST'
      });
      const data = await response.json();
      if (data.success) {
        console.log(`✅ ${data.message}`);
        // Recargar colecciones
        const collectionsRes = await authFetch(`${API_BASE}/api/collections`);
        const collectionsData = await collectionsRes.json();
        if (Array.isArray(collectionsData)) {
          setCollections(collectionsData);
        }
      } else {
        alert('Error generando colecciones: ' + (data.error || 'Error desconocido'));
      }
    } catch (error) {
      console.error('Error generando colecciones:', error);
      alert('Error de conexión al generar colecciones');
    } finally {
      setGeneratingCollections(false);
    }
  };

  // Enriquecer películas sin poster en LOTES y guardar en localStorage
  useEffect(() => {
    const BATCH_SIZE = 30; // Procesar 30 películas por lote

    const enrichBatch = async (filenames) => {
      const res = await authFetch(`${API_BASE}/api/movies/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames })
      });

      if (!res.ok) throw new Error(res.statusText);
      return res.json();
    };

    const enrichMovies = async () => {
      if (enrichmentDone.current) return;

      const videosToEnrich = videos
        .filter(video => !video.poster)
        .map(video => video.filename);

      if (videosToEnrich.length === 0) {
        console.log('✅ Todas las películas ya tienen carátulas');
        enrichmentDone.current = true;
        return;
      }

      enrichmentDone.current = true;
      const totalBatches = Math.ceil(videosToEnrich.length / BATCH_SIZE);
      console.log(`🎬 Enriqueciendo ${videosToEnrich.length} películas en ${totalBatches} lotes...`);

      const cache = loadCache();
      let totalSuccess = 0;

      for (let i = 0; i < videosToEnrich.length; i += BATCH_SIZE) {
        const batch = videosToEnrich.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;

        try {
          console.log(`📦 Lote ${batchNum}/${totalBatches}: ${batch.length} películas...`);
          const data = await enrichBatch(batch);

          if (data.success && data.results) {
            const successCount = data.results.filter(r => r.success).length;
            totalSuccess += successCount;

            // Actualizar videos y caché
            setVideos(prevVideos => {
              const newVideos = [...prevVideos];

              data.results.forEach(result => {
                if (result.success && result.metadata) {
                  const index = newVideos.findIndex(v => v.filename === result.filename);
                  if (index !== -1) {
                    const metadata = {
                      poster: result.metadata.poster,
                      backdrop: result.metadata.backdrop,
                      overview: result.metadata.overview,
                      rating: result.metadata.rating,
                      releaseDate: result.metadata.releaseDate,
                      genreIds: result.metadata.genreIds || [],
                      runtime: result.metadata.runtime,
                      videos: result.metadata.videos || [],
                      recommendations: result.metadata.recommendations || [],
                      cast: result.metadata.cast || []
                    };
                    newVideos[index] = { ...newVideos[index], ...metadata };
                    cache[result.filename] = metadata;
                  }
                }
              });

              return newVideos;
            });

            console.log(`✅ Lote ${batchNum} completado: ${successCount}/${batch.length}`);
          }
        } catch (error) {
          console.error(`❌ Error en lote ${batchNum}:`, error.message);
        }

        // Pequeña pausa entre lotes
        if (i + BATCH_SIZE < videosToEnrich.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      // Guardar caché final
      saveCache(cache);
      console.log(`💾 Caché guardado: ${Object.keys(cache).length} películas`);
      console.log(`✅ Enriquecimiento completado: ${totalSuccess}/${videosToEnrich.length}`);
    };

    if (videos.length > 0 && !loading) {
      enrichMovies();
    }
  }, [videos.length, loading]);

  // Función para buscar carátulas en TMDB
  const searchPosters = async (query) => {
    if (!query || query.trim().length < 2) return;

    setPosterSearchLoading(true);
    setPosterSearchResults([]);

    try {
      const res = await authFetch(`${API_BASE}/api/tmdb/search?query=${encodeURIComponent(query)}`);
      const data = await res.json();

      if (data.success && data.results) {
        setPosterSearchResults(data.results);
      }
    } catch (error) {
      console.error('Error buscando carátulas:', error);
    } finally {
      setPosterSearchLoading(false);
    }
  };

  // Función para seleccionar una nueva carátula
  const selectPoster = async (video, newMetadata) => {
    console.log(`🎨 Actualizando carátula de: ${video.filename}`);

    // Actualizar caché del backend primero (obtiene datos extendidos y renombra archivo)
    let extendedData = null;
    let newFilename = video.filename;
    let wasRenamed = false;

    try {
      const response = await authFetch(`${API_BASE}/api/movies/update-poster`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: video.filename,
          metadata: newMetadata
        })
      });
      const result = await response.json();
      if (result.success) {
        if (result.metadata) {
          extendedData = result.metadata;
          console.log(`✅ Datos extendidos recibidos: ${extendedData.videos?.length || 0} videos, ${extendedData.recommendations?.length || 0} recomendaciones, ${extendedData.cast?.length || 0} actores`);
        }
        if (result.renamed && result.newFilename) {
          newFilename = result.newFilename;
          wasRenamed = true;
          console.log(`📝 Archivo renombrado: ${video.filename} → ${newFilename}`);
        }
      }
    } catch (error) {
      console.error('Error actualizando backend:', error);
    }

    // Usar datos extendidos si los tenemos, sino los básicos
    const finalMetadata = extendedData || newMetadata;

    // Actualizar estado local
    setVideos(prevVideos => {
      const newVideos = [...prevVideos];
      const index = newVideos.findIndex(v => v.filename === video.filename);
      if (index !== -1) {
        newVideos[index] = {
          ...newVideos[index],
          filename: newFilename,
          url: `${API_BASE}/stream/${encodeURIComponent(newFilename)}`,
          title: finalMetadata.title || newVideos[index].title,
          poster: finalMetadata.poster_path || finalMetadata.poster,
          backdrop: finalMetadata.backdrop_path || finalMetadata.backdrop,
          overview: finalMetadata.overview,
          rating: finalMetadata.vote_average || finalMetadata.rating,
          releaseDate: finalMetadata.release_date,
          genreIds: finalMetadata.genre_ids || [],
          runtime: finalMetadata.runtime,
          videos: finalMetadata.videos || [],
          recommendations: finalMetadata.recommendations || [],
          cast: finalMetadata.cast || [],
          tmdb_id: finalMetadata.tmdb_id || newVideos[index].tmdb_id
        };
      }
      return newVideos;
    });

    // Actualizar localStorage
    const cache = loadCache();

    // Si se renombró, eliminar la entrada antigua
    if (wasRenamed && newFilename !== video.filename) {
      delete cache[video.filename];
    }

    cache[newFilename] = {
      tmdb_id: finalMetadata.tmdb_id || finalMetadata.id,
      title: finalMetadata.title,
      poster: finalMetadata.poster_path || finalMetadata.poster,
      backdrop: finalMetadata.backdrop_path || finalMetadata.backdrop,
      overview: finalMetadata.overview,
      rating: finalMetadata.vote_average || finalMetadata.rating,
      releaseDate: finalMetadata.release_date,
      genreIds: finalMetadata.genre_ids || [],
      runtime: finalMetadata.runtime,
      videos: finalMetadata.videos || [],
      recommendations: finalMetadata.recommendations || [],
      cast: finalMetadata.cast || []
    };
    saveCache(cache);

    // Cerrar modal
    setPosterSearchModal(null);
    setPosterSearchQuery('');
    setPosterSearchResults([]);
  };

  // Manejar clic derecho en carátula - mostrar menú contextual
  const handlePosterContextMenu = (e, video) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      video
    });
  };

  // Cerrar menú contextual al hacer clic en cualquier lugar
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);

  // Bloquear scroll del body cuando hay modales abiertos
  useEffect(() => {
    if (requestsModal || settingsModal || requestsAdminModal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [requestsModal, settingsModal, requestsAdminModal]);

  // Configurar Web Audio API para amplificación de volumen
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selectedVideo) return;

    const setupAudioBoost = () => {
      // Solo crear el contexto una vez
      if (!audioContextRef.current) {
        try {
          audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
          sourceNodeRef.current = audioContextRef.current.createMediaElementSource(video);
          gainNodeRef.current = audioContextRef.current.createGain();

          sourceNodeRef.current.connect(gainNodeRef.current);
          gainNodeRef.current.connect(audioContextRef.current.destination);

          console.log('🔊 Audio boost configurado');
        } catch (error) {
          console.error('Error configurando audio boost:', error);
        }
      }
    };

    // Configurar cuando el video empiece a reproducirse
    video.addEventListener('play', setupAudioBoost, { once: true });

    return () => {
      video.removeEventListener('play', setupAudioBoost);
    };
  }, [selectedVideo]);

  // Actualizar ganancia cuando cambia el volumeBoost
  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volumeBoost / 100;
    }
  }, [volumeBoost]);

  // Limpiar audio context cuando se cierra el video
  useEffect(() => {
    if (!selectedVideo) {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
        sourceNodeRef.current = null;
        gainNodeRef.current = null;
      }
      setVolumeBoost(100);
      setShowVolumeBoost(false);
    } else {
      // Cargar peticiones existentes para mostrar indicadores en películas similares
      authFetch(`${API_BASE}/api/requests`)
        .then(res => res.json())
        .then(data => {
          if (data.requests) {
            setAllRequests(data.requests);
          }
        })
        .catch(() => {}); // Silenciar errores
    }
  }, [selectedVideo]);

  // Abrir modal de búsqueda de carátula desde el menú
  const openPosterSearch = () => {
    if (contextMenu?.video) {
      setPosterSearchModal(contextMenu.video);
      setPosterSearchQuery(contextMenu.video.title);
      setPosterSearchResults([]);
      searchPosters(contextMenu.video.title);
    }
    setContextMenu(null);
  };

  // Confirmar borrado de archivo
  const confirmDelete = () => {
    if (contextMenu?.video) {
      setDeleteConfirm(contextMenu.video);
    }
    setContextMenu(null);
  };

  // Borrar archivo del FTP
  const deleteFile = async () => {
    if (!deleteConfirm) return;

    setDeleting(true);
    try {
      const response = await authFetch(`${API_BASE}/api/files/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: deleteConfirm.filename })
      });

      const result = await response.json();

      if (result.success) {
        // Eliminar de la lista de videos
        setVideos(prev => prev.filter(v => v.filename !== deleteConfirm.filename));
        // Eliminar del caché
        const cache = loadCache();
        delete cache[deleteConfirm.filename];
        saveCache(cache);
        console.log(`🗑️ Archivo eliminado: ${deleteConfirm.filename}`);
      } else {
        alert(`Error al eliminar: ${result.error}`);
      }
    } catch (error) {
      console.error('Error eliminando archivo:', error);
      alert('Error de conexión al eliminar el archivo');
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  };

  // Iniciar conversión de AVI/MKV a MP4
  const startConversion = async () => {
    if (!contextMenu?.video) return;

    const video = contextMenu.video;
    const ext = video.filename.split('.').pop().toLowerCase();

    if (!['avi', 'mkv'].includes(ext)) {
      alert('Solo se pueden convertir archivos AVI o MKV');
      return;
    }

    setContextMenu(null);

    try {
      // Iniciar conversión
      const response = await authFetch(`${API_BASE}/api/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: video.filename })
      });

      const { jobId, mp4Filename } = await response.json();

      if (!jobId) {
        alert('Error al iniciar conversión');
        return;
      }

      // Mostrar modal de progreso
      setConversionProgress({
        jobId,
        status: 'starting',
        progress: 0,
        message: 'Iniciando conversión...',
        filename: video.filename,
        mp4Filename
      });

      // Escuchar progreso via SSE (añadir token en query string porque EventSource no soporta headers)
      const token = getSessionToken();
      const sseUrl = token
        ? `${API_BASE}/api/convert/${jobId}/progress?session=${token}`
        : `${API_BASE}/api/convert/${jobId}/progress`;
      const eventSource = new EventSource(sseUrl);

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setConversionProgress(prev => ({ ...prev, ...data }));

        if (data.status === 'completed') {
          eventSource.close();
          // Recargar lista de videos después de 1 segundo
          setTimeout(() => {
            authFetch(`${API_BASE}/api/videos`)
              .then(res => res.json())
              .then(data => setVideos(data))
              .catch(console.error);
          }, 1000);
        } else if (data.status === 'error') {
          eventSource.close();
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        setConversionProgress(prev => prev ? { ...prev, status: 'error', message: 'Conexión perdida' } : null);
      };

    } catch (error) {
      console.error('Error iniciando conversión:', error);
      alert('Error al iniciar la conversión');
    }
  };

  // Verificar si un video es convertible (AVI/MKV)
  const isConvertible = (filename) => {
    const ext = filename?.split('.').pop().toLowerCase();
    return ['avi', 'mkv'].includes(ext);
  };

  // Manejar clic en reproducir - detectar pistas de audio y seleccionar español automáticamente
  const handlePlayClick = async (video) => {
    // Mostrar indicador de carga
    setLoadingVideo(video);

    // Detectar pistas de audio para TODOS los formatos (MP4, MKV, AVI, etc.)
    try {
      const response = await authFetch(`${API_BASE}/api/audio-tracks/${encodeURIComponent(video.filename)}`);
      const data = await response.json();

      if (data.tracks && data.tracks.length > 0) {
        // Buscar pista en español automáticamente
        const spanishIndex = data.tracks.findIndex(t => {
          const lang = (t.language || '').toLowerCase();
          const label = (t.label || '').toLowerCase();
          return lang.includes('spa') || lang.includes('esp') || lang.includes('spanish') ||
                 label.includes('español') || label.includes('spanish') || label.includes('spa') ||
                 lang === 'es' || lang.includes('castellano');
        });

        // Seleccionar español si existe, sino la primera pista
        const trackToUse = spanishIndex >= 0 ? spanishIndex : 0;
        setSelectedAudioTrack(trackToUse);

        // Si hay múltiples pistas y NO se encontró español, mostrar selector
        if (data.tracks.length > 1 && spanishIndex < 0) {
          setAudioSelectionModal({ video, tracks: data.tracks, loading: false });
          setLoadingVideo(null);
          console.log(`🎬 Múltiples pistas de audio detectadas - mostrando selector`);
          return; // No reproducir aún, esperar selección del usuario
        }

        // Si solo hay una pista o se encontró español, reproducir directamente
        setSelectedVideo({ ...video, audioTrack: trackToUse, availableTracks: data.tracks });

        if (spanishIndex >= 0) {
          console.log(`🎬 Audio español detectado (pista ${spanishIndex + 1})`);
        } else {
          console.log(`🎬 Audio: usando única pista disponible`);
        }
      } else {
        // No se detectaron pistas, reproducir con la predeterminada
        setSelectedVideo({ ...video, audioTrack: 0 });
      }
    } catch (error) {
      console.error('Error detectando pistas de audio:', error);
      // En caso de error, reproducir con la predeterminada
      setSelectedVideo({ ...video, audioTrack: 0 });
    } finally {
      // Ocultar indicador de carga
      setLoadingVideo(null);
    }
  };

  // Reproducir con la pista de audio seleccionada
  const playWithSelectedAudio = () => {
    if (!audioSelectionModal?.video) return;

    // Guardar preferencia de idioma
    const selectedTrack = audioSelectionModal.tracks[selectedAudioTrack];
    if (selectedTrack?.language) {
      localStorage.setItem('preferredAudioLanguage', selectedTrack.language);
      setPreferredLanguage(selectedTrack.language);
    }

    setSelectedVideo({ ...audioSelectionModal.video, audioTrack: selectedAudioTrack });
    setAudioSelectionModal(null);
  };

  // ========== SISTEMA DE PETICIONES DE PELÍCULAS ==========

  // Buscar películas en TMDB para peticiones
  const handleRequestSearch = async () => {
    if (!requestSearchQuery.trim() || requestSearchLoading) return;

    setRequestSearchLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/tmdb/search?query=${encodeURIComponent(requestSearchQuery)}`);
      const data = await res.json();

      if (data.results) {
        // Filtrar solo películas con poster (el API ya devuelve URL completa)
        const movies = data.results.filter(m => m.poster).map(m => ({
          tmdbId: m.tmdb_id,
          title: m.title,
          originalTitle: m.original_title,
          year: m.year,
          poster: m.poster,
          overview: m.overview,
          rating: m.rating
        }));
        setRequestSearchResults(movies);
      }
    } catch (error) {
      console.error('Error buscando en TMDB:', error);
    } finally {
      setRequestSearchLoading(false);
    }
  };

  // Buscar películas por actor
  const handleActorSearch = async () => {
    if (!actorSearchQuery.trim() || actorSearchLoading) return;

    setActorSearchLoading(true);
    setActorSearchResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/tmdb/actor?query=${encodeURIComponent(actorSearchQuery)}`);
      const data = await res.json();

      if (data.success && data.actor) {
        // Mapear películas al formato esperado
        const movies = data.movies.map(m => ({
          tmdbId: m.tmdb_id,
          title: m.title,
          originalTitle: m.original_title,
          year: m.year,
          poster: m.poster,
          rating: m.rating,
          character: m.character,
          overview: m.overview
        }));
        setActorSearchResult({ actor: data.actor, movies });
      } else {
        setActorSearchResult({ actor: null, movies: [] });
      }
    } catch (error) {
      console.error('Error buscando actor:', error);
    } finally {
      setActorSearchLoading(false);
    }
  };

  // Auto-buscar cuando se establece actorSearchQuery desde el panel de actores
  useEffect(() => {
    if (actorSearchQuery && requestsModal && !actorSearchLoading) {
      handleActorSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorSearchQuery, requestsModal]);

  // Buscar películas de un actor para filtrar la galería
  const handleGalleryActorSearch = async () => {
    if (!galleryActorQuery.trim() || galleryActorLoading) return;

    setGalleryActorLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/tmdb/actor?query=${encodeURIComponent(galleryActorQuery)}`);
      const data = await res.json();

      if (data.success && data.actor && data.movies) {
        // Obtener los TMDB IDs de las películas del actor
        const movieIds = data.movies.map(m => m.tmdb_id);
        setGalleryActorMovieIds(movieIds);
        setGalleryActorName(data.actor.name);
        console.log(`🎭 Encontradas ${movieIds.length} películas de ${data.actor.name}`);
      } else {
        setGalleryActorMovieIds([]);
        setGalleryActorName('');
      }
    } catch (error) {
      console.error('Error buscando actor:', error);
      setGalleryActorMovieIds([]);
      setGalleryActorName('');
    } finally {
      setGalleryActorLoading(false);
    }
  };

  // Limpiar búsqueda por actor en galería
  const clearGalleryActorSearch = () => {
    setGalleryActorQuery('');
    setGalleryActorMovieIds(null);
    setGalleryActorName('');
  };

  // Alternar selección de película para petición
  const toggleRequestSelection = (movie) => {
    setSelectedRequests(prev => {
      const exists = prev.find(m => m.tmdbId === movie.tmdbId);
      if (exists) {
        return prev.filter(m => m.tmdbId !== movie.tmdbId);
      } else {
        return [...prev, movie];
      }
    });
  };

  // Enviar peticiones
  const submitRequests = async () => {
    if (selectedRequests.length === 0 || submittingRequests) return;

    setSubmittingRequests(true);
    try {
      const requestedBy = authState.user?.username || 'Usuario local';

      const res = await authFetch(`${API_BASE}/api/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          movies: selectedRequests,
          requestedBy
        })
      });

      const data = await res.json();

      if (data.success) {
        // Añadir a existingRequests para mostrar borde rojo persistente
        setExistingRequests(prev => [
          ...prev,
          ...selectedRequests.map(m => ({ tmdbId: m.tmdbId, title: m.title }))
        ]);
        setSelectedRequests([]);
        // No cerrar el modal, permitir seguir buscando
        console.log(`✅ ${data.created} peticiones enviadas`);
      } else {
        console.error('Error:', data.error);
      }
    } catch (error) {
      console.error('Error enviando peticiones:', error);
    } finally {
      setSubmittingRequests(false);
    }
  };

  // Añadir película recomendada directamente a peticiones (clic derecho en similares)
  const addRecommendationToRequests = async (rec) => {
    try {
      const requestedBy = authState.user?.username || 'Usuario local';
      const movie = {
        tmdbId: rec.tmdb_id,
        title: rec.title,
        year: rec.release_date?.split('-')[0] || '',
        poster: rec.poster_path || null,
        overview: rec.overview || ''
      };

      const res = await authFetch(`${API_BASE}/api/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          movies: [movie],
          requestedBy
        })
      });

      const data = await res.json();
      if (data.success) {
        // Actualizar estado local para reflejar el cambio inmediatamente
        setExistingRequests(prev => [...prev, { tmdbId: rec.tmdb_id, title: rec.title }]);
        setAllRequests(prev => [...prev, {
          tmdbId: rec.tmdb_id,
          title: rec.title,
          year: rec.release_date?.split('-')[0] || '',
          poster: rec.poster_path,
          status: 'pending',
          requestedBy: authState.user?.username || 'Usuario local'
        }]);
        // Feedback visual breve
        console.log(`✅ "${rec.title}" añadida a peticiones`);
      } else if (data.duplicates > 0) {
        alert(`⚠️ "${rec.title}" ya está en peticiones`);
      } else {
        alert(`❌ Error: ${data.error || 'No se pudo añadir'}`);
      }
    } catch (error) {
      console.error('Error añadiendo petición:', error);
      alert('Error al añadir petición');
    }
  };

  // Cargar todas las peticiones (admin) y verificar las que ya están en catálogo
  const loadAllRequests = async () => {
    try {
      // Verificar si estamos en modo solo lectura
      try {
        const readonlyRes = await authFetch(`${API_BASE}/api/requests/readonly`);
        const readonlyData = await readonlyRes.json();
        setRequestsReadonly(readonlyData.readonly === true);
      } catch (e) {
        setRequestsReadonly(false);
      }

      const res = await authFetch(`${API_BASE}/api/requests`);
      const data = await res.json();
      if (data.requests) {
        // Verificar qué películas ya están en el catálogo y actualizar su estado
        const requestsToUpdate = [];

        for (const request of data.requests) {
          // Solo verificar las que no están ya marcadas como descargadas o rechazadas
          if (request.status === 'pending' || request.status === 'downloading') {
            // Buscar en el catálogo por TMDB ID o por título similar
            const inCatalog = videos.some(v => {
              // Comparar por TMDB ID si existe
              if (request.tmdbId && v.tmdb_id) {
                return request.tmdbId === v.tmdb_id;
              }
              // Comparar por título y año
              const requestTitle = request.title?.toLowerCase().trim();
              const videoTitle = v.title?.toLowerCase().trim();
              const requestYear = request.year?.toString();
              const videoYear = v.year?.toString();

              if (requestTitle && videoTitle) {
                // Coincidencia exacta de título y año
                if (requestTitle === videoTitle && requestYear === videoYear) {
                  return true;
                }
                // Coincidencia parcial (el título del catálogo contiene el título solicitado)
                if (videoTitle.includes(requestTitle) && requestYear === videoYear) {
                  return true;
                }
              }
              return false;
            });

            if (inCatalog) {
              requestsToUpdate.push(request.id);
            }
          }
        }

        // Actualizar estado de las peticiones que ya están en el catálogo
        for (const requestId of requestsToUpdate) {
          try {
            await authFetch(`${API_BASE}/api/requests/${requestId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'downloaded' })
            });
            console.log(`✅ Petición ${requestId} marcada como descargada (encontrada en catálogo)`);
          } catch (e) {
            console.error(`Error actualizando petición ${requestId}:`, e);
          }
        }

        // Si hubo actualizaciones, recargar las peticiones
        if (requestsToUpdate.length > 0) {
          const refreshRes = await authFetch(`${API_BASE}/api/requests`);
          const refreshData = await refreshRes.json();
          if (refreshData.requests) {
            setAllRequests(refreshData.requests);
          }
        } else {
          setAllRequests(data.requests);
        }
      }

      // Cargar estadísticas
      const statsRes = await authFetch(`${API_BASE}/api/requests/stats`);
      const statsData = await statsRes.json();
      setRequestsStats(statsData);
    } catch (error) {
      console.error('Error cargando peticiones:', error);
    }
  };

  // Actualizar estado de una petición (admin)
  const updateRequestStatus = async (id, status) => {
    try {
      const res = await authFetch(`${API_BASE}/api/requests/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });

      const data = await res.json();
      if (data.success) {
        loadAllRequests();
      } else {
        alert('Error: ' + (data.error || 'Error desconocido'));
      }
    } catch (error) {
      console.error('Error actualizando petición:', error);
    }
  };

  // Eliminar una petición (admin) - sin confirmación
  const deleteRequest = async (id) => {
    try {
      const res = await authFetch(`${API_BASE}/api/requests/${id}`, {
        method: 'DELETE'
      });

      const data = await res.json();
      if (data.success) {
        loadAllRequests();
      }
    } catch (error) {
      console.error('Error eliminando petición:', error);
    }
  };

  // Buscar película en TodoTorrents (abre Tor Browser)
  const searchTodoTorrents = async (movieTitle) => {
    try {
      const res = await authFetch(`${API_BASE}/api/search-torrents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movieTitle })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Error al buscar');
      }
    } catch (error) {
      console.error('Error buscando en TodoTorrents:', error);
      alert('Error de conexión');
    }
  };

  // Añadir URL a cola de descargas (Python Downloader)
  const addToDownloadQueue = async (url, title) => {
    if (!url || !url.trim()) {
      setDownloadQueueStatus({ type: 'error', message: 'Introduce una URL' });
      return;
    }

    try {
      setDownloadQueueStatus({ type: 'loading', message: 'Añadiendo...' });

      const res = await authFetch(`${API_BASE}/api/download-queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), title })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setDownloadQueueStatus({ type: 'success', message: 'URL añadida a la cola' });
        setDownloadUrl('');
        // Limpiar mensaje después de 3 segundos
        setTimeout(() => setDownloadQueueStatus(null), 3000);
      } else {
        setDownloadQueueStatus({ type: 'error', message: data.error || 'Error al añadir' });
        setTimeout(() => setDownloadQueueStatus(null), 5000);
      }
    } catch (error) {
      console.error('Error añadiendo a cola:', error);
      setDownloadQueueStatus({ type: 'error', message: 'Error de conexión' });
      setTimeout(() => setDownloadQueueStatus(null), 5000);
    }
  };

  // Abrir modal de admin de peticiones
  const openRequestsAdmin = () => {
    loadAllRequests();
    setRequestsAdminModal(true);
  };

  // Abrir modal de peticiones (carga peticiones existentes)
  const openRequestsModal = async () => {
    setRequestsModal(true);
    // Cargar peticiones existentes para mostrar borde rojo
    try {
      const res = await authFetch(`${API_BASE}/api/requests`);
      const data = await res.json();
      if (data.requests) {
        setExistingRequests(data.requests);
      }
    } catch (error) {
      console.error('Error cargando peticiones:', error);
    }
  };

  // Verificar si una película ya está en el catálogo (por tmdb_id o título+año)
  const isMovieInCatalog = (tmdbId) => {
    if (!videos.length) return false;

    // Solo buscar por TMDB ID (única forma fiable)
    return tmdbId && videos.some(v => v.tmdb_id === tmdbId);
  };

  // Verificar si una película ya fue solicitada
  const isMovieRequested = (tmdbId) => {
    return existingRequests.some(r => r.tmdbId === tmdbId);
  };

  // Normalizar texto (quitar acentos y convertir a minúsculas)
  const normalizeText = (text) => {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  };

  // Filtrado combinado con useMemo para performance
  const filteredVideos = useMemo(() => {
    let result = videos;

    // Filtro por búsqueda (ignorando acentos)
    if (searchQuery.trim()) {
      const normalizedQuery = normalizeText(searchQuery);
      result = result.filter(v =>
        normalizeText(v.title).includes(normalizedQuery) ||
        normalizeText(v.filename).includes(normalizedQuery)
      );
    }

    // Filtro por colección (tiene prioridad sobre género)
    if (selectedCollection) {
      const collection = collections.find(c => c.id === selectedCollection);
      if (collection && collection.movies) {
        const collectionFilenames = collection.movies.map(m => m.filename);
        result = result.filter(v => collectionFilenames.includes(v.filename));
      }
    } else if (selectedGenre) {
      // Filtro por género (solo si no hay colección seleccionada)
      result = result.filter(v =>
        v.genreIds && v.genreIds.includes(selectedGenre)
      );
    }

    // Filtro por letra inicial (ignorando acentos)
    if (selectedLetter) {
      result = result.filter(v => {
        const firstChar = normalizeText(v.title.charAt(0)).toUpperCase();
        return firstChar === selectedLetter.toLowerCase() || firstChar === selectedLetter;
      });
    }

    // Filtro por década
    if (selectedDecade) {
      result = result.filter(v => {
        const year = v.releaseDate ? parseInt(v.releaseDate.substring(0, 4)) : null;
        if (!year) return false;
        const decade = Math.floor(year / 10) * 10;
        return decade === selectedDecade;
      });
    }

    // Filtro por año específico
    if (selectedYear) {
      result = result.filter(v => {
        const year = v.releaseDate ? parseInt(v.releaseDate.substring(0, 4)) : null;
        return year === selectedYear;
      });
    }

    // Filtro por actor (usando TMDB IDs)
    if (galleryActorMovieIds && galleryActorMovieIds.length > 0) {
      result = result.filter(v => v.tmdb_id && galleryActorMovieIds.includes(v.tmdb_id));
    }

    // Filtro por recientes (ordenar por fecha de adición)
    if (showRecent) {
      result = [...result]
        .filter(v => v.addedDate) // Solo películas con fecha
        .sort((a, b) => new Date(b.addedDate) - new Date(a.addedDate));
    }

    return result;
  }, [videos, searchQuery, selectedGenre, selectedLetter, selectedCollection, collections, selectedDecade, selectedYear, galleryActorMovieIds, showRecent]);

  // Reset del contador visible cuando cambian los filtros
  useEffect(() => {
    setVisibleCount(50);
  }, [searchQuery, selectedGenre, selectedLetter, selectedCollection, selectedDecade, selectedYear, galleryActorMovieIds, showRecent]);

  // Videos a mostrar (paginados)
  const displayedVideos = useMemo(() => {
    return filteredVideos.slice(0, visibleCount);
  }, [filteredVideos, visibleCount]);

  // ¿Hay más videos para cargar?
  const hasMoreVideos = filteredVideos.length > visibleCount;

  // Ref para el elemento "sentinela" de scroll infinito
  const loadMoreRef = useRef(null);

  // Intersection Observer para scroll infinito
  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element || !hasMoreVideos) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount(prev => prev + LOAD_MORE_COUNT);
        }
      },
      { rootMargin: '200px' } // Cargar 200px antes de llegar
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [hasMoreVideos]);

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

  // Calcular décadas disponibles y años por década
  const decadesData = useMemo(() => {
    const decadesMap = new Map();
    videos.forEach(v => {
      const year = v.releaseDate ? parseInt(v.releaseDate.substring(0, 4)) : null;
      if (year && year > 1900 && year < 2100) {
        const decade = Math.floor(year / 10) * 10;
        if (!decadesMap.has(decade)) {
          decadesMap.set(decade, new Set());
        }
        decadesMap.get(decade).add(year);
      }
    });
    // Convertir a array ordenado de mayor a menor
    return Array.from(decadesMap.entries())
      .map(([decade, yearsSet]) => ({
        decade,
        years: Array.from(yearsSet).sort((a, b) => b - a),
        count: yearsSet.size
      }))
      .sort((a, b) => b.decade - a.decade);
  }, [videos]);

  // Mostrar pantalla de carga inicial
  if (authState.checking) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <img src="/logo.jpg" alt="IsiPrime" className="h-24 w-auto mx-auto mb-4 rounded-2xl" />
          <div className="text-slate-400">Cargando...</div>
        </motion.div>
      </div>
    );
  }

  // Mostrar pantalla de login para usuarios externos no autenticados
  if (authState.requiresLogin && !authState.authenticated) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] font-sans relative overflow-hidden flex items-center justify-center p-4">
        {/* Fondo Animado */}
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

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 bg-slate-800/80 backdrop-blur-md rounded-3xl p-8 w-full max-w-md shadow-xl border border-white"
        >
          {/* Logo */}
          <div className="text-center mb-8">
            <img
              src="/logo.jpg"
              alt="IsiPrime"
              className="h-20 w-auto mx-auto mb-4 rounded-2xl"
              style={{ filter: 'drop-shadow(0 4px 12px rgba(99, 102, 241, 0.3))' }}
            />
            <h1 className="text-2xl font-bold text-white">Bienvenido</h1>
            <p className="text-slate-500 text-sm mt-1">Inicia sesión para acceder a tu biblioteca</p>
          </div>

          {/* Formulario */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-200 mb-1">Usuario</label>
              <div className="relative">
                <input
                  type="text"
                  value={loginForm.username}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, username: e.target.value }))}
                  className="w-full pl-10 pr-4 py-3 bg-slate-800 rounded-xl border border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-white"
                  placeholder="Tu nombre de usuario"
                  autoFocus
                  required
                />
                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200 mb-1">Contraseña</label>
              <div className="relative">
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full pl-10 pr-4 py-3 bg-slate-800 rounded-xl border border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-white"
                  placeholder="Tu contraseña"
                  required
                />
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              </div>
            </div>

            {loginError && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm text-center"
              >
                {loginError}
              </motion.div>
            )}

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full py-3 bg-indigo-500 text-white rounded-xl font-medium hover:bg-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-wait flex items-center justify-center gap-2"
            >
              {loginLoading ? (
                <>
                  <span className="animate-spin">⏳</span>
                  Iniciando sesión...
                </>
              ) : (
                <>
                  <Lock size={18} />
                  Iniciar sesión
                </>
              )}
            </button>
          </form>

          <p className="text-center text-slate-400 text-xs mt-6">
            Acceso exclusivo para usuarios autorizados
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-black font-sans relative overflow-hidden flex flex-col">
      {/* Fondo Animado Oscuro */}
      <motion.div
        animate={{ scale: [1, 1.2, 1], rotate: [0, 90, 0] }}
        transition={{ duration: 20, repeat: Infinity }}
        className="absolute -top-20 -left-20 w-96 h-96 bg-purple-900/30 rounded-full blur-3xl opacity-60"
      />
      <motion.div
        animate={{ scale: [1, 1.5, 1], rotate: [0, -90, 0] }}
        transition={{ duration: 25, repeat: Infinity }}
        className="absolute -bottom-20 -right-20 w-[30rem] h-[30rem] bg-indigo-900/30 rounded-full blur-3xl opacity-60"
      />

      {/* Header Glassmorphism - Fijo */}
      <header className="sticky top-0 z-30 mx-4 md:mx-8 mt-2 flex flex-col md:flex-row justify-between items-center bg-slate-900/80 backdrop-blur-md border border-slate-700 p-2 md:p-3 rounded-2xl shadow-sm flex-shrink-0">
        <div className="flex items-center mb-4 md:mb-0">
          <img
            src="/logo.jpg"
            alt="IsiPrime"
            className="h-10 md:h-12 lg:h-14 w-auto object-cover rounded-xl"
            style={{
              filter: 'drop-shadow(0 4px 12px rgba(99, 102, 241, 0.3))',
              borderRadius: '1rem'
            }}
          />
        </div>

        {/* Búsqueda para móviles (visible solo en pantallas pequeñas) */}
        <div className="flex gap-4 w-full lg:hidden">
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar películas..."
              className="w-full pl-10 pr-10 py-2.5 bg-slate-800/80 rounded-xl border border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-white placeholder-slate-400"
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18}/>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full p-1 transition-all"
                aria-label="Limpiar búsqueda"
              >
                <X size={16}/>
              </button>
            )}
          </div>
          {/* Botón Recientes (móvil) */}
          <button
            onClick={() => {
              setShowRecent(!showRecent);
              if (!showRecent) {
                setSelectedGenre(null);
                setSelectedCollection(null);
                setSelectedDecade(null);
                setSelectedYear(null);
                setSelectedLetter(null);
                clearGalleryActorSearch();
                setSearchQuery('');
              }
            }}
            className={`p-3 rounded-xl hover:shadow-md transition-all ${
              showRecent
                ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white'
                : 'bg-slate-800/80 text-white border border-slate-600'
            }`}
            title="Últimas películas añadidas"
          >
            🆕
          </button>
          {/* Botón Pedir Película (móvil) */}
          <button
            onClick={openRequestsModal}
            className="p-3 bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl hover:shadow-md transition-all text-white"
            title="Pedir película"
          >
            🎬
          </button>
          {/* Logout para usuarios externos en móvil */}
          {!authState.isLocal && authState.authenticated && (
            <button
              onClick={handleLogout}
              className="p-3 bg-slate-800/80 rounded-xl border border-slate-600 hover:shadow-md transition-all text-slate-400 hover:text-red-500"
              title="Cerrar sesión"
            >
              <LogOut size={20}/>
            </button>
          )}
          <button
            onClick={() => setSettingsModal(true)}
            className="p-3 bg-slate-800/80 rounded-xl border border-slate-600 hover:shadow-md transition-all"
            title="Configuracion"
          >
            <Settings className="text-slate-400" size={20}/>
          </button>
        </div>

        {/* Búsquedas para pantallas grandes */}
        <div className="hidden lg:flex items-center gap-3 flex-1 max-w-2xl mx-4">
          {/* Búsqueda por título */}
          <div className="relative flex-1 flex items-center gap-1">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar película..."
                className="w-full pl-9 pr-8 py-2 bg-slate-800/80 rounded-xl border border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-200 placeholder-slate-400 text-sm"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1 hover:bg-slate-700 rounded-full transition-all"
                  title="Limpiar búsqueda"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
          {/* Búsqueda por actor en galería */}
          <div className="relative flex-1 flex items-center gap-1">
            <div className="relative flex-1">
              <input
                type="text"
                value={galleryActorQuery}
                onChange={(e) => setGalleryActorQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleGalleryActorSearch()}
                placeholder={galleryActorName ? `🎭 ${galleryActorName}` : "Buscar por actor..."}
                className={`w-full pl-4 pr-16 py-2 bg-slate-800/80 rounded-xl border focus:outline-none focus:ring-2 text-slate-200 placeholder-slate-400 text-sm ${
                  galleryActorMovieIds ? 'border-purple-400 ring-2 ring-purple-200' : 'border-purple-200 focus:ring-purple-500'
                }`}
              />
              {/* Botón lupa para buscar actor */}
              <button
                onClick={handleGalleryActorSearch}
                disabled={galleryActorLoading || !galleryActorQuery.trim()}
                className={`absolute right-8 top-1/2 -translate-y-1/2 p-1 rounded-full transition-all ${
                  galleryActorQuery.trim() && !galleryActorLoading
                    ? 'text-purple-500 hover:text-purple-700 hover:bg-purple-100'
                    : 'text-slate-300 cursor-not-allowed'
                }`}
                title="Buscar películas del actor"
              >
                {galleryActorLoading ? (
                  <div className="animate-spin w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full"></div>
                ) : (
                  <Search size={14} />
                )}
              </button>
              {/* Botón X para limpiar */}
              {(galleryActorQuery || galleryActorMovieIds) && (
                <button
                  onClick={clearGalleryActorSearch}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-purple-600 p-1 hover:bg-purple-100 rounded-full transition-all"
                  title="Limpiar búsqueda"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Botones de configuración y logout para pantallas grandes */}
        <div className="hidden lg:flex items-center gap-3">
          {/* Mostrar usuario y logout para usuarios externos autenticados */}
          {!authState.isLocal && authState.authenticated && authState.user && (
            <div className="flex items-center gap-3 bg-slate-800/80 rounded-xl border border-slate-600 px-4 py-2">
              <span className="text-sm text-slate-600">
                <User size={16} className="inline mr-1" />
                {authState.user.username}
              </span>
              <button
                onClick={handleLogout}
                className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-900/30 rounded-lg transition-all"
                title="Cerrar sesión"
              >
                <LogOut size={18} />
              </button>
            </div>
          )}
          {/* Botón Recientes (desktop) */}
          <button
            onClick={() => {
              setShowRecent(!showRecent);
              if (!showRecent) {
                // Limpiar otros filtros al activar recientes
                setSelectedGenre(null);
                setSelectedCollection(null);
                setSelectedDecade(null);
                setSelectedYear(null);
                setSelectedLetter(null);
                clearGalleryActorSearch();
                setSearchQuery('');
              }
            }}
            className={`px-4 py-2.5 rounded-xl font-medium transition-all shadow-md hover:shadow-lg flex items-center gap-2 ${
              showRecent
                ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white'
                : 'bg-slate-800/80 text-slate-200 border border-slate-600 hover:bg-slate-700'
            }`}
            title="Últimas películas añadidas"
          >
            🆕 Recientes
          </button>
          {/* Botón Pedir Película (desktop) */}
          <button
            onClick={openRequestsModal}
            className="px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-medium hover:from-amber-600 hover:to-orange-600 transition-all shadow-md hover:shadow-lg flex items-center gap-2"
            title="Pedir película"
          >
            🎬 Pedir Película
          </button>
          {/* Botón Admin Peticiones (solo admin/local) */}
          {(authState.isLocal || authState.user?.isAdmin) && (
            <button
              onClick={openRequestsAdmin}
              className="p-3 bg-slate-800/80 rounded-xl border border-slate-600 hover:shadow-md transition-all"
              title="Ver peticiones"
            >
              📋
            </button>
          )}
          <button
            onClick={() => setSettingsModal(true)}
            className="p-3 bg-slate-800/80 rounded-xl border border-slate-600 hover:shadow-md transition-all"
            title="Configuracion"
          >
            <Settings className="text-slate-400" size={20}/>
          </button>
        </div>
      </header>

      {/* Panel Izquierdo (Géneros/Colecciones) */}
      <div className="fixed left-0 top-24 w-56 h-[calc(100vh-7rem)] bg-slate-900/80 backdrop-blur-md border border-slate-700 rounded-r-3xl shadow-sm z-20 hidden lg:flex flex-col">
        {/* Parte fija: tabs */}
        <div className="p-4 pb-2 flex-shrink-0">
          {/* Tabs Géneros / Colecciones / Décadas */}
          <div className="flex gap-1 bg-slate-800 p-1 rounded-xl">
          <button
            onClick={() => {
              setShowCollections(false);
              setShowDecades(false);
              setSelectedCollection(null);
              setSelectedDecade(null);
              setSelectedYear(null);
              setShowRecent(false);
            }}
            className={`flex-1 flex items-center justify-center gap-1 py-2 px-1 rounded-lg text-[10px] font-medium transition-all ${
              !showCollections && !showDecades
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ListFilter size={12} /> Géneros
          </button>
          <button
            onClick={() => {
              setShowCollections(true);
              setShowDecades(false);
              setSelectedGenre(null);
              setSelectedDecade(null);
              setSelectedYear(null);
              setShowRecent(false);
            }}
            className={`flex-1 flex items-center justify-center gap-1 py-2 px-1 rounded-lg text-[10px] font-medium transition-all ${
              showCollections
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers size={12} /> Sagas
          </button>
          <button
            onClick={() => {
              setShowCollections(false);
              setShowDecades(true);
              setSelectedGenre(null);
              setSelectedCollection(null);
              setShowRecent(false);
            }}
            className={`flex-1 flex items-center justify-center gap-1 py-2 px-1 rounded-lg text-[10px] font-medium transition-all ${
              showDecades
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            📅 Años
          </button>
          </div>
        </div>

        {/* Parte scrollable: lista de géneros/sagas/décadas */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
        {/* Contenido según tab seleccionado */}
        {showDecades ? (
          <>
            {/* Tab Décadas */}
            <button
              onClick={() => {
                setSelectedDecade(null);
                setSelectedYear(null);
              }}
              className={`w-full text-left px-4 py-2.5 rounded-xl transition-all mb-2 ${
                selectedDecade === null && selectedYear === null
                  ? 'bg-indigo-500 text-white shadow-md'
                  : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/80'
              }`}
            >
              🏠 Todas
            </button>

            {decadesData.length === 0 ? (
              <div className="text-sm text-slate-400 px-4 py-2">Sin datos de años...</div>
            ) : (
              decadesData.map(({ decade, years }) => (
                <div key={decade} className="mb-2">
                  <button
                    onClick={() => {
                      if (selectedDecade === decade) {
                        setSelectedDecade(null);
                        setSelectedYear(null);
                      } else {
                        setSelectedDecade(decade);
                        setSelectedYear(null);
                      }
                    }}
                    className={`w-full text-left px-4 py-2.5 rounded-xl transition-all font-medium ${
                      selectedDecade === decade
                        ? 'bg-indigo-500 text-white shadow-md'
                        : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/80'
                    }`}
                  >
                    📅 {decade}s
                    <span className="ml-2 text-xs opacity-70">({years.length})</span>
                  </button>
                  {/* Años dentro de la década seleccionada */}
                  {selectedDecade === decade && (
                    <div className="ml-4 mt-1 space-y-1">
                      {years.map(year => (
                        <button
                          key={year}
                          onClick={() => setSelectedYear(selectedYear === year ? null : year)}
                          className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-all ${
                            selectedYear === year
                              ? 'bg-indigo-400 text-white shadow-sm'
                              : 'bg-slate-700/30 text-slate-400 hover:bg-slate-600/60'
                          }`}
                        >
                          {year}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </>
        ) : !showCollections ? (
          <>
            {/* Tab Géneros */}
            <button
              onClick={() => {
                setSelectedGenre(null);
                setSelectedLetter(null);
                setSelectedCollection(null);
                setSearchQuery('');
              }}
              className={`w-full text-left px-4 py-2.5 rounded-xl transition-all mb-2 ${
                selectedGenre === null && selectedLetter === null && !searchQuery && !selectedCollection
                  ? 'bg-indigo-500 text-white shadow-md'
                  : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/80'
              }`}
            >
              🏠 Todas
            </button>

            {genres.length === 0 ? (
              <div className="text-sm text-slate-400 px-4 py-2">Cargando géneros...</div>
            ) : (
              genres.map(genre => (
                <button
                  key={genre.id}
                  onClick={() => {
                    setSelectedGenre(genre.id);
                    setSelectedCollection(null);
                  }}
                  className={`w-full text-left px-4 py-2.5 rounded-xl transition-all mb-2 ${
                    selectedGenre === genre.id
                      ? 'bg-indigo-500 text-white shadow-md'
                      : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/80'
                  }`}
                >
                  {genreEmojis[genre.name] || '🎬'} {genre.name}
                </button>
              ))
            )}
          </>
        ) : (
          <>
            {/* Tab Colecciones/Sagas */}
            <button
              onClick={() => {
                setSelectedCollection(null);
                setSelectedGenre(null);
                setSelectedLetter(null);
                setSearchQuery('');
              }}
              className={`w-full text-left px-4 py-2.5 rounded-xl transition-all mb-2 ${
                selectedCollection === null && !selectedGenre
                  ? 'bg-indigo-500 text-white shadow-md'
                  : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/80'
              }`}
            >
              🎬 Todas las sagas
            </button>

            {/* Filtro de colecciones por género */}
            <div className="mb-3">
              <select
                value={selectedGenre || ''}
                onChange={(e) => setSelectedGenre(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full px-3 py-2 text-xs bg-slate-800/80 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">🎬 Todos los géneros</option>
                {genres.map(g => (
                  <option key={g.id} value={g.id}>{genreEmojis[g.name] || '🎬'} {g.name}</option>
                ))}
              </select>
            </div>

            {collections.length === 0 ? (
              <div className="text-sm text-slate-400 px-2 py-2 text-center">
                <FolderOpen className="mx-auto mb-2 opacity-50" size={24} />
                <p className="mb-3">{selectedGenre ? 'Sin sagas en este género' : 'Sin sagas disponibles'}</p>
                {!selectedGenre && (
                  <button
                    onClick={generateCollections}
                    disabled={generatingCollections}
                    className="w-full px-3 py-2 bg-indigo-500 text-white text-xs font-medium rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-wait"
                  >
                    {generatingCollections ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="animate-spin">⏳</span> Generando...
                      </span>
                    ) : (
                      'Descargar sagas'
                    )}
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {collections.map(collection => (
                  <button
                    key={collection.id}
                    onClick={() => setSelectedCollection(collection.id)}
                    className={`w-full text-left rounded-xl transition-all overflow-hidden ${
                      selectedCollection === collection.id
                        ? 'ring-2 ring-indigo-500 shadow-md'
                        : 'hover:shadow-md'
                    }`}
                  >
                    <div className="flex items-center gap-2 p-2 bg-slate-800/70">
                      {collection.poster ? (
                        <img
                          src={collection.poster}
                          alt={collection.name}
                          className="w-10 h-14 object-cover rounded-lg"
                        />
                      ) : (
                        <div className="w-10 h-14 bg-slate-700 rounded-lg flex items-center justify-center">
                          <Layers size={16} className="text-slate-400" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-300 truncate">{collection.name}</p>
                        <p className="text-[10px] text-slate-400">{collection.movies?.length || 0} películas</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* Separador */}
        <div className="border-t border-slate-200 my-4"></div>

        {/* Botones de Peticiones */}
        <div className="space-y-2">
          <button
            onClick={openRequestsModal}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-medium hover:from-amber-600 hover:to-orange-600 transition-all shadow-md hover:shadow-lg"
          >
            🎬 Pedir Película
          </button>

          {/* Botón Admin - solo para usuarios locales o admin */}
          {(authState.isLocal || authState.user?.isAdmin) && (
            <button
              onClick={openRequestsAdmin}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 text-slate-300 rounded-xl text-sm font-medium hover:bg-slate-700 transition-all"
            >
              📋 Ver Peticiones
            </button>
          )}
        </div>
        </div>
      </div>

      {/* Índice Alfabético (Derecha) */}
      <div className="hidden md:flex fixed right-0 top-24 w-16 h-[calc(100vh-7rem)] overflow-y-auto bg-slate-900/80 backdrop-blur-md border border-slate-700 rounded-l-3xl shadow-sm p-2 flex-col items-center gap-1 z-20">
        {/* Botón "Todas" para desactivar filtro alfabético */}
        <motion.button
          whileHover={{ scale: 1.15 }}
          onClick={() => setSelectedLetter(null)}
          className={`w-11 h-11 rounded-xl flex items-center justify-center text-xs font-bold transition-all mb-2 ${
            selectedLetter === null
              ? 'bg-indigo-500 text-white shadow-md'
              : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/80 cursor-pointer'
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
                    ? 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/80 cursor-pointer'
                    : 'bg-slate-800/30 text-slate-600 cursor-not-allowed'
              }`}
            >
              {letter}
            </motion.button>
          );
        })}
      </div>

      {/* Contenedor Principal con padding para los paneles - Scrollable */}
      <main className="relative z-10 px-4 md:pl-64 md:pr-24 pb-8 flex-1 overflow-y-auto pt-4">
        <h2 className="text-3xl font-bold text-white mb-8 flex items-center gap-3">
          {selectedCollection ? <Layers className="text-indigo-400" /> : <HardDrive className="text-indigo-400" />}
          {selectedCollection
            ? collections.find(c => c.id === selectedCollection)?.name || 'Colección'
            : selectedGenre
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
            {[1,2,3,4,5].map(i => <div key={i} className="w-full aspect-[3/4] bg-slate-800 rounded-[2.5rem]" />)}
          </div>
        ) : filteredVideos.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-slate-300 text-6xl mb-4">🎬</div>
            <p className="text-slate-400 text-lg">No se encontraron películas</p>
            <p className="text-slate-300 text-sm mt-2">Intenta con otro filtro o búsqueda</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-8">
              {displayedVideos.map((video, idx) => (
                <div
                  key={video.filename}
                  onClick={() => handlePlayClick(video)}
                  onContextMenu={(e) => handlePosterContextMenu(e, video)}
                  className="cursor-pointer group transition-transform duration-200 hover:-translate-y-2"
                  title="Clic derecho para cambiar carátula"
                  style={{ contentVisibility: 'auto', containIntrinsicSize: '0 350px' }}
                >
                  <div className={`aspect-[3/4] rounded-[2.5rem] ${
                    !video.poster
                      ? `bg-gradient-to-br ${idx % 2 === 0 ? 'from-indigo-900 to-purple-900' : 'from-slate-800 to-slate-700'}`
                      : 'bg-slate-800'
                  } border border-slate-700 shadow-lg flex items-center justify-center relative overflow-hidden`}>
                    {video.poster ? (
                      <img
                        src={video.poster}
                        alt={video.title}
                        className="absolute inset-0 w-full h-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : null}
                    <Play className="text-white opacity-0 group-hover:opacity-100 transition-opacity scale-150 z-10 drop-shadow-lg" fill="white" />
                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                    {/* Sinopsis en hover */}
                    {video.overview && (
                      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-black/40 opacity-0 group-hover:opacity-100 transition-all duration-300 p-4 flex flex-col justify-end z-10 pointer-events-none">
                        <div
                          className="overflow-y-auto max-h-[85%] overscroll-contain scrollbar-thin scrollbar-thumb-white/40 scrollbar-track-transparent pointer-events-auto"
                          onWheel={(e) => e.stopPropagation()}
                        >
                          <p className="text-white text-xs leading-relaxed pr-1">
                            {video.overview}
                          </p>
                        </div>
                      </div>
                    )}
                    {/* Botón Trailer en esquina superior derecha */}
                    {video.videos && video.videos.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(video.videos[0].url, '_blank');
                        }}
                        className="absolute top-3 right-3 bg-red-600 hover:bg-red-700 text-white p-2 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-all z-20 hover:scale-110"
                        title={`Ver Trailer: ${video.videos[0].name}`}
                      >
                        <Play size={16} fill="white" />
                      </button>
                    )}
                  </div>
                  <h3 className="mt-4 font-bold text-white truncate px-2">{video.title}</h3>
                  <div className="flex items-center gap-2 px-2 text-sm text-slate-400">
                    <span>{video.size}</span>
                    {video.runtime && (
                      <>
                        <span>•</span>
                        <span>{Math.floor(video.runtime / 60)}h {video.runtime % 60}m</span>
                      </>
                    )}
                  </div>
                  {video.rating && (
                    <div className="flex items-center gap-1 px-2 mt-1">
                      <span className="text-yellow-500 text-sm">⭐</span>
                      <span className="text-sm text-slate-300">{video.rating.toFixed(1)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {/* Sentinela para scroll infinito */}
            {hasMoreVideos && (
              <div ref={loadMoreRef} className="flex flex-col items-center mt-8 py-8 gap-3">
                <div className="flex items-center gap-2 text-slate-400">
                  <RefreshCw size={18} className="animate-spin" />
                  <span>Cargando más películas...</span>
                </div>
                <span className="text-sm text-slate-500">
                  Mostrando {visibleCount} de {filteredVideos.length}
                </span>
              </div>
            )}
          </>
        )}
      </main>

      {/* Overlay de Carga de Película */}
      <AnimatePresence>
        {loadingVideo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="bg-slate-900 rounded-3xl p-8 shadow-2xl flex flex-col items-center gap-4 max-w-sm mx-4 border border-slate-700"
            >
              {/* Spinner animado */}
              <div className="relative">
                <div className="w-16 h-16 border-4 border-indigo-200 rounded-full"></div>
                <div className="absolute top-0 left-0 w-16 h-16 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
              </div>

              {/* Título de la película */}
              <div className="text-center">
                <p className="text-lg font-bold text-slate-200">Cargando película</p>
                <p className="text-sm text-slate-500 mt-1 truncate max-w-[250px]">{loadingVideo.title}</p>
              </div>

              {/* Mensaje animado */}
              <p className="text-xs text-slate-400 animate-pulse">Detectando pistas de audio...</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Reproductor */}
      <AnimatePresence>
        {selectedVideo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/90 backdrop-blur-md p-6 gap-4"
          >
            {/* Panel izquierdo vacío para centrar */}
            <div className="hidden md:block w-44 flex-shrink-0" />

            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="bg-slate-900 rounded-[3rem] w-full max-w-5xl overflow-hidden shadow-2xl border border-slate-700"
            >
              <div className="p-6 flex justify-between items-center bg-slate-800 border-b border-slate-700">
                <span className="font-bold text-slate-200">{selectedVideo.title}</span>
                <div className="flex items-center gap-3">
                  {/* Botón cambiar audio - solo si hay múltiples pistas de audio */}
                  {selectedVideo.availableTracks && selectedVideo.availableTracks.length > 1 && (
                    <button
                      onClick={() => {
                        // Guardar progreso actual antes de cambiar audio
                        const video = videoRef.current;
                        const currentVideo = selectedVideo;
                        if (video && currentVideo) {
                          saveVideoProgress(currentVideo.filename, video.currentTime, video.duration);
                        }
                        setSelectedVideo(null); // Pausar video
                        setSelectedAudioTrack(currentVideo.audioTrack || 0);
                        setAudioSelectionModal({ video: currentVideo, tracks: currentVideo.availableTracks, loading: false });
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-100 text-indigo-600 rounded-xl hover:bg-indigo-200 transition-colors"
                      title={`Cambiar idioma (${selectedVideo.availableTracks.length} pistas)`}
                    >
                      <Volume2 size={18} />
                      <span className="text-sm font-medium">Audio ({selectedVideo.availableTracks.length})</span>
                    </button>
                  )}
                  {/* Botón amplificar volumen */}
                  <div className="relative">
                    <button
                      onClick={() => setShowVolumeBoost(!showVolumeBoost)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-colors ${
                        volumeBoost > 100
                          ? 'bg-green-100 text-green-600 hover:bg-green-200'
                          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                      title="Amplificar volumen"
                    >
                      🔊
                      {volumeBoost > 100 && (
                        <span className="text-xs font-bold">{volumeBoost}%</span>
                      )}
                    </button>
                    {/* Panel de control de volumen */}
                    {showVolumeBoost && (
                      <>
                        {/* Overlay invisible para cerrar al hacer clic fuera */}
                        <div
                          className="fixed inset-0 z-40"
                          onClick={() => setShowVolumeBoost(false)}
                        />
                        <div className="absolute top-full right-0 mt-2 bg-slate-900 rounded-xl shadow-xl border border-slate-600 p-4 z-50 w-64">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm font-medium text-slate-200">Amplificar Volumen</span>
                          <span className={`text-sm font-bold ${volumeBoost > 100 ? 'text-green-600' : 'text-slate-500'}`}>
                            {volumeBoost}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="100"
                          max="600"
                          step="10"
                          value={volumeBoost}
                          onChange={(e) => setVolumeBoost(parseInt(e.target.value))}
                          className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-green-500"
                        />
                        <div className="flex justify-between text-xs text-slate-400 mt-1">
                          <span>100%</span>
                          <span>300%</span>
                          <span>600%</span>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-3">
                          <button
                            onClick={() => setVolumeBoost(100)}
                            className="flex-1 px-2 py-1.5 text-xs bg-slate-700 text-slate-200 rounded-lg hover:bg-slate-600"
                          >
                            Normal
                          </button>
                          <button
                            onClick={() => setVolumeBoost(200)}
                            className="flex-1 px-2 py-1.5 text-xs bg-green-900 text-green-400 rounded-lg hover:bg-green-800"
                          >
                            2x
                          </button>
                          <button
                            onClick={() => setVolumeBoost(300)}
                            className="flex-1 px-2 py-1.5 text-xs bg-green-900 text-green-400 rounded-lg hover:bg-green-800"
                          >
                            3x
                          </button>
                          <button
                            onClick={() => setVolumeBoost(400)}
                            className="flex-1 px-2 py-1.5 text-xs bg-green-900 text-green-400 rounded-lg hover:bg-green-800"
                          >
                            4x
                          </button>
                          <button
                            onClick={() => setVolumeBoost(500)}
                            className="flex-1 px-2 py-1.5 text-xs bg-orange-900 text-orange-400 rounded-lg hover:bg-orange-800"
                          >
                            5x
                          </button>
                          <button
                            onClick={() => setVolumeBoost(600)}
                            className="flex-1 px-2 py-1.5 text-xs bg-red-900 text-red-400 rounded-lg hover:bg-red-800"
                          >
                            6x
                          </button>
                        </div>
                      </div>
                      </>
                    )}
                  </div>
                  {/* Duración */}
                  {selectedVideo.runtime && (
                    <span className="text-sm text-slate-500 px-2">
                      {Math.floor(selectedVideo.runtime / 60)}h {selectedVideo.runtime % 60}m
                    </span>
                  )}
                  <button
                    onClick={closeVideoPlayer}
                    className="text-slate-400 hover:text-red-500 transition-colors text-xl p-2"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="relative">
                <video
                  key={selectedVideo.filename}
                  ref={videoRef}
                  src={(() => {
                    const token = getSessionToken();
                    const params = new URLSearchParams();
                    if (selectedVideo.audioTrack !== undefined) params.set('audio', selectedVideo.audioTrack);
                    if (token) params.set('session', token);
                    const queryString = params.toString();
                    return `${selectedVideo.url}${queryString ? '?' + queryString : ''}`;
                  })()}
                  controls
                  autoPlay
                  className="w-full aspect-video bg-black"
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleVideoLoaded}
                />
                {/* Zona de detección de hover en la parte inferior */}
                {/* Overlay con sinopsis - en la parte superior */}
                {selectedVideo.overview && (
                  <div
                    className="absolute top-0 left-0 right-0 h-32 group z-10"
                    onMouseEnter={(e) => {
                      const overlay = e.currentTarget.querySelector('.synopsis-overlay');
                      if (overlay) overlay.style.opacity = '1';
                    }}
                    onMouseLeave={(e) => {
                      const overlay = e.currentTarget.querySelector('.synopsis-overlay');
                      if (overlay) overlay.style.opacity = '0';
                    }}
                  >
                    <div
                      className="synopsis-overlay absolute top-0 left-0 right-0 bg-gradient-to-b from-black/95 via-black/80 to-transparent p-6 pb-16 transition-opacity duration-300 pointer-events-none"
                      style={{ opacity: 0 }}
                    >
                      <h4 className="text-white font-bold text-lg mb-2 drop-shadow-lg">Sinopsis</h4>
                      <p
                        className="text-white/90 text-sm leading-relaxed drop-shadow-md"
                        style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden'
                        }}
                      >
                        {selectedVideo.overview}
                      </p>
                    </div>
                  </div>
                )}
              </div>
              {/* Películas Recomendadas */}
              {selectedVideo.recommendations && selectedVideo.recommendations.length > 0 && (
                <div className="p-4 bg-slate-800 border-t border-slate-700">
                  <h4 className="text-sm font-bold text-slate-600 mb-3">Películas similares</h4>
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {selectedVideo.recommendations.map((rec) => {
                      // Verificar si la película está en la biblioteca por tmdb_id
                      const isInLibrary = videos.some(v => v.tmdb_id === rec.tmdb_id);
                      // Verificar si ya está en peticiones
                      const isRequested = allRequests.some(r => r.tmdbId === rec.tmdb_id) ||
                                          existingRequests.some(r => r.tmdbId === rec.tmdb_id);
                      return (
                      <div
                        key={rec.tmdb_id}
                        className={`relative flex-shrink-0 w-20 cursor-pointer hover:opacity-80 transition-all ${
                          isInLibrary ? 'ring-2 ring-green-500 ring-offset-2 rounded-lg' :
                          isRequested ? 'ring-2 ring-amber-500 ring-offset-2 rounded-lg' : ''
                        }`}
                        onClick={() => {
                          // 1. Buscar por TMDB ID (más preciso)
                          let found = videos.find(v => v.tmdb_id === rec.tmdb_id);

                          // 2. Fallback: buscar por título
                          if (!found) {
                            const recTitleLower = rec.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                            found = videos.find(v => v.title === rec.title);
                            if (!found) {
                              found = videos.find(v => {
                                const vTitleLower = v.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                                return vTitleLower === recTitleLower || vTitleLower.includes(recTitleLower) || recTitleLower.includes(vTitleLower);
                              });
                            }
                          }

                          if (found) {
                            // Guardar progreso y cerrar reproductor actual
                            closeVideoPlayer();
                            // Esperar a que se limpie el AudioContext antes de abrir la nueva
                            setTimeout(() => handlePlayClick(found), 400);
                          } else {
                            alert(`"${rec.title}" no está en tu biblioteca`);
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          // Añadir directamente a peticiones
                          addRecommendationToRequests(rec);
                        }}
                        title={`${rec.title} (${rec.release_date?.split('-')[0] || '?'}) - ⭐ ${rec.vote_average?.toFixed(1) || '?'}${rec.overview ? '\n\n' + rec.overview : ''}\n\n💡 Clic izq: reproducir | Clic der: añadir a peticiones`}
                      >
                        {rec.poster_path ? (
                          <img
                            src={rec.poster_path}
                            alt={rec.title}
                            className="w-20 h-28 object-cover rounded-lg shadow"
                          />
                        ) : (
                          <div className="w-20 h-28 bg-slate-200 rounded-lg flex items-center justify-center">
                            <span className="text-xs text-slate-400">Sin imagen</span>
                          </div>
                        )}
                        <p className="text-xs text-slate-600 mt-1 truncate">{rec.title}</p>
                        {isInLibrary && (
                          <div className="absolute -top-1 -right-1 bg-green-500 text-white text-[8px] px-1 rounded-full">
                            ✓
                          </div>
                        )}
                        {!isInLibrary && isRequested && (
                          <div className="absolute -top-1 -right-1 bg-amber-500 text-white text-[8px] px-1 rounded-full">
                            ⏳
                          </div>
                        )}
                      </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </motion.div>

            {/* Panel de Actores - Derecha */}
            {selectedVideo.cast && selectedVideo.cast.length > 0 && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="hidden md:flex flex-col w-44 flex-shrink-0 bg-slate-900/95 backdrop-blur rounded-2xl shadow-xl max-h-[80vh] overflow-hidden"
              >
                <div className="p-3 bg-slate-800 border-b border-slate-700">
                  <h3 className="font-bold text-slate-200 text-sm">🎭 Reparto</h3>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {selectedVideo.cast.map((actor) => (
                    <div
                      key={actor.id}
                      onClick={() => {
                        // Guardar progreso, cerrar reproductor y abrir búsqueda por actor
                        closeVideoPlayer();
                        // Limpiar resultados anteriores
                        setActorSearchResult(null);
                        setActorSearchQuery(actor.name);
                        setRequestsModal(true);
                      }}
                      className="flex items-center gap-2 p-2 rounded-xl hover:bg-indigo-50 cursor-pointer transition-colors group"
                      title={`Ver películas de ${actor.name}`}
                    >
                      {actor.photo ? (
                        <img
                          src={actor.photo}
                          alt={actor.name}
                          className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                          <span className="text-slate-400 text-xs">👤</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-200 truncate group-hover:text-indigo-600">
                          {actor.name}
                        </p>
                        {actor.character && (
                          <p className="text-[10px] text-slate-400 truncate">
                            {actor.character}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Menú Contextual */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.1 }}
            style={{
              position: 'fixed',
              left: Math.min(contextMenu.x, window.innerWidth - 200),
              top: Math.min(contextMenu.y, window.innerHeight - 120),
              zIndex: 100
            }}
            className="bg-slate-900 rounded-xl shadow-2xl border border-slate-600 overflow-hidden min-w-[180px]"
          >
            <div className="p-2">
              <button
                onClick={openPosterSearch}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-indigo-900 hover:text-indigo-300 rounded-lg transition-colors"
              >
                <Image size={18} />
                <span className="font-medium">Cambiar carátula</span>
              </button>
              {isConvertible(contextMenu.video?.filename) && (
                <button
                  onClick={startConversion}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-emerald-900 hover:text-emerald-300 rounded-lg transition-colors"
                >
                  <RefreshCw size={18} />
                  <span className="font-medium">Convertir a MP4</span>
                </button>
              )}
              <button
                onClick={confirmDelete}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors"
              >
                <Trash2 size={18} />
                <span className="font-medium">Eliminar archivo</span>
              </button>
            </div>
            <div className="px-4 py-2 bg-slate-800 border-t border-slate-700 text-xs text-slate-400 truncate">
              {contextMenu.video?.filename}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Confirmación de Borrado */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/90 backdrop-blur-md p-6"
            onClick={() => !deleting && setDeleteConfirm(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900 rounded-3xl w-full max-w-md p-6 shadow-2xl border border-slate-700"
            >
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-red-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Trash2 className="text-red-500" size={32} />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">¿Eliminar archivo?</h3>
                <p className="text-slate-500 text-sm">
                  Esta acción eliminará permanentemente el archivo del servidor FTP:
                </p>
                <p className="text-slate-200 font-medium mt-2 bg-slate-800 p-2 rounded-lg text-sm break-all">
                  {deleteConfirm.filename}
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  disabled={deleting}
                  className="flex-1 px-4 py-3 bg-slate-700 text-slate-200 rounded-xl font-medium hover:bg-slate-600 transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={deleteFile}
                  disabled={deleting}
                  className="flex-1 px-4 py-3 bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {deleting ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      Eliminando...
                    </>
                  ) : (
                    <>
                      <Trash2 size={18} />
                      Eliminar
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Progreso de Conversión */}
      <AnimatePresence>
        {conversionProgress && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/90 backdrop-blur-md p-6"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-slate-900 rounded-3xl p-8 w-full max-w-md shadow-2xl border border-slate-700"
            >
              <div className="text-center mb-6">
                <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 ${
                  conversionProgress.status === 'completed' ? 'bg-emerald-100' :
                  conversionProgress.status === 'error' ? 'bg-red-100' : 'bg-indigo-100'
                }`}>
                  {conversionProgress.status === 'completed' ? (
                    <span className="text-3xl">✅</span>
                  ) : conversionProgress.status === 'error' ? (
                    <span className="text-3xl">❌</span>
                  ) : (
                    <RefreshCw className={`text-indigo-500 ${conversionProgress.status !== 'completed' ? 'animate-spin' : ''}`} size={32} />
                  )}
                </div>
                <h3 className="text-xl font-bold text-white mb-2">
                  {conversionProgress.status === 'completed' ? 'Conversión completada' :
                   conversionProgress.status === 'error' ? 'Error en conversión' :
                   'Convirtiendo a MP4'}
                </h3>
                <p className="text-sm text-slate-500 truncate px-4">
                  {conversionProgress.filename}
                </p>
              </div>

              {/* Barra de progreso */}
              <div className="mb-4">
                <div className="flex justify-between text-sm text-slate-600 mb-2">
                  <span>{conversionProgress.message}</span>
                  <span className="font-bold">{conversionProgress.progress}%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${
                      conversionProgress.status === 'completed' ? 'bg-emerald-500' :
                      conversionProgress.status === 'error' ? 'bg-red-500' : 'bg-indigo-500'
                    }`}
                    initial={{ width: 0 }}
                    animate={{ width: `${conversionProgress.progress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </div>

              {/* Etapas */}
              <div className="grid grid-cols-5 gap-1 text-xs text-center mb-6">
                {['downloading', 'converting', 'uploading', 'deleting', 'completed'].map((stage, idx) => {
                  const stages = ['downloading', 'converting', 'uploading', 'deleting', 'completed'];
                  const currentIdx = stages.indexOf(conversionProgress.status);
                  const isActive = idx <= currentIdx;
                  const isCurrent = conversionProgress.status === stage;
                  return (
                    <div key={stage} className={`${isActive ? 'text-indigo-600 font-medium' : 'text-slate-400'} ${isCurrent ? 'scale-110' : ''} transition-all`}>
                      <div className={`w-2 h-2 rounded-full mx-auto mb-1 ${isActive ? 'bg-indigo-500' : 'bg-slate-300'}`} />
                      {stage === 'downloading' ? '📥' : stage === 'converting' ? '🔄' : stage === 'uploading' ? '📤' : stage === 'deleting' ? '🗑️' : '✅'}
                    </div>
                  );
                })}
              </div>

              {/* Botón cerrar (solo cuando termina) */}
              {(conversionProgress.status === 'completed' || conversionProgress.status === 'error') && (
                <button
                  onClick={() => setConversionProgress(null)}
                  className={`w-full py-3 rounded-xl font-medium transition-colors ${
                    conversionProgress.status === 'completed'
                      ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                      : 'bg-slate-200 text-slate-200 hover:bg-slate-300'
                  }`}
                >
                  {conversionProgress.status === 'completed' ? 'Listo' : 'Cerrar'}
                </button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Selección de Audio */}
      <AnimatePresence>
        {audioSelectionModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/90 backdrop-blur-md p-6"
            onClick={() => !audioSelectionModal.loading && setAudioSelectionModal(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900 rounded-3xl p-8 w-full max-w-md shadow-2xl border border-slate-700"
            >
              {audioSelectionModal.loading ? (
                <div className="text-center py-8">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-100 mb-4">
                    <Volume2 className="text-indigo-500 animate-pulse" size={32} />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">Analizando audio...</h3>
                  <p className="text-slate-500">Detectando pistas de audio disponibles</p>
                </div>
              ) : (
                <>
                  <div className="text-center mb-6">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-100 mb-4">
                      <Volume2 className="text-indigo-500" size={32} />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">Seleccionar audio</h3>
                    <p className="text-sm text-slate-500 truncate px-4">{audioSelectionModal.video?.title}</p>
                  </div>

                  <div className="space-y-2 mb-6 max-h-64 overflow-y-auto">
                    {audioSelectionModal.tracks.map((track, idx) => (
                      <button
                        key={idx}
                        onClick={() => setSelectedAudioTrack(idx)}
                        className={`w-full p-4 rounded-xl text-left transition-all ${
                          selectedAudioTrack === idx
                            ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-200'
                            : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            selectedAudioTrack === idx ? 'border-white' : 'border-slate-400'
                          }`}>
                            {selectedAudioTrack === idx && (
                              <div className="w-2.5 h-2.5 rounded-full bg-white" />
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="font-medium">{track.label}</div>
                            {track.bitrate && (
                              <div className={`text-xs ${selectedAudioTrack === idx ? 'text-indigo-200' : 'text-slate-400'}`}>
                                {track.bitrate}
                              </div>
                            )}
                          </div>
                          {track.default && (
                            <span className={`text-xs px-2 py-1 rounded-full ${
                              selectedAudioTrack === idx ? 'bg-indigo-400 text-white' : 'bg-slate-200 text-slate-500'
                            }`}>
                              Por defecto
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => setAudioSelectionModal(null)}
                      className="flex-1 px-4 py-3 bg-slate-700 text-slate-200 rounded-xl font-medium hover:bg-slate-600 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={playWithSelectedAudio}
                      className="flex-1 px-4 py-3 bg-indigo-500 text-white rounded-xl font-medium hover:bg-indigo-600 transition-colors flex items-center justify-center gap-2"
                    >
                      <Play size={18} />
                      Reproducir
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Búsqueda de Carátula */}
      <AnimatePresence>
        {posterSearchModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/90 backdrop-blur-md p-6"
            onClick={() => setPosterSearchModal(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900 rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col border border-slate-700"
            >
              {/* Header */}
              <div className="p-6 bg-slate-800 border-b border-slate-700 flex-shrink-0">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-bold text-white">
                    Cambiar carátula: <span className="text-indigo-500">{posterSearchModal.title}</span>
                  </h3>
                  <button
                    onClick={() => setPosterSearchModal(null)}
                    className="text-slate-400 hover:text-red-500 transition-colors text-2xl"
                  >
                    ✕
                  </button>
                </div>

                {/* Barra de búsqueda */}
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={posterSearchQuery}
                      onChange={(e) => setPosterSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && searchPosters(posterSearchQuery)}
                      placeholder="Buscar película en TMDB..."
                      className="w-full pl-10 pr-4 py-3 bg-slate-800 rounded-xl border border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-200"
                      autoFocus
                    />
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18}/>
                  </div>
                  <button
                    onClick={() => searchPosters(posterSearchQuery)}
                    disabled={posterSearchLoading}
                    className="px-6 py-3 bg-indigo-500 text-white rounded-xl font-medium hover:bg-indigo-600 transition-colors disabled:opacity-50"
                  >
                    {posterSearchLoading ? 'Buscando...' : 'Buscar'}
                  </button>
                </div>
              </div>

              {/* Resultados */}
              <div className="p-6 overflow-y-auto flex-1">
                {posterSearchLoading ? (
                  <div className="grid grid-cols-3 md:grid-cols-4 gap-4">
                    {[1,2,3,4,5,6,7,8].map(i => (
                      <div key={i} className="aspect-[2/3] bg-slate-200 rounded-xl animate-pulse" />
                    ))}
                  </div>
                ) : posterSearchResults.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <div className="text-5xl mb-4">🔍</div>
                    <p>Escribe un título y presiona Enter o Buscar</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 md:grid-cols-4 gap-4">
                    {posterSearchResults.map((result) => (
                      <motion.div
                        key={result.tmdb_id}
                        whileHover={{ scale: 1.05 }}
                        onClick={() => selectPoster(posterSearchModal, result)}
                        className="cursor-pointer group"
                      >
                        <div className="aspect-[2/3] rounded-xl overflow-hidden bg-slate-200 relative">
                          {result.poster ? (
                            <img
                              src={result.poster}
                              alt={result.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-400">
                              Sin imagen
                            </div>
                          )}
                          <div className="absolute inset-0 bg-indigo-500/0 group-hover:bg-indigo-500/30 transition-colors flex items-center justify-center">
                            <span className="text-white opacity-0 group-hover:opacity-100 font-bold text-lg">
                              Seleccionar
                            </span>
                          </div>
                        </div>
                        <p className="mt-2 text-sm font-medium text-slate-200 truncate">{result.title}</p>
                        <p className="text-xs text-slate-400">
                          {result.year && `(${result.year})`}
                          {result.rating && ` ⭐ ${result.rating.toFixed(1)}`}
                        </p>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal de Petición de Películas (Usuario) */}
      <AnimatePresence>
        {requestsModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-hidden"
            onWheel={(e) => e.stopPropagation()}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-700"
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4 flex items-center justify-between flex-shrink-0">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  🎬 Pedir Películas
                </h2>
                <button
                  onClick={() => !submittingRequests && setRequestsModal(false)}
                  className="text-white/80 hover:text-white transition-colors"
                  disabled={submittingRequests}
                >
                  <X size={24} />
                </button>
              </div>

              {/* Barras de búsqueda */}
              <div className="p-4 border-b border-slate-700 flex-shrink-0 space-y-3">
                {/* Búsqueda por título */}
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={requestSearchQuery}
                      onChange={(e) => setRequestSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleRequestSearch()}
                      placeholder="🎬 Buscar por título de película..."
                      className="w-full pl-4 pr-10 py-3 bg-slate-800 rounded-xl border border-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500 text-slate-200"
                      autoFocus
                    />
                    {requestSearchQuery && (
                      <button
                        onClick={() => { setRequestSearchQuery(''); setRequestSearchResults([]); }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1 hover:bg-slate-700 rounded-full"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                  <button
                    onClick={handleRequestSearch}
                    disabled={requestSearchLoading}
                    className="px-5 py-3 bg-amber-500 text-white rounded-xl font-medium hover:bg-amber-600 transition-colors disabled:opacity-50"
                  >
                    {requestSearchLoading ? '...' : 'Buscar'}
                  </button>
                </div>

                {/* Búsqueda por actor */}
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={actorSearchQuery}
                      onChange={(e) => setActorSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleActorSearch()}
                      placeholder="🎭 Buscar por nombre de actor..."
                      className="w-full pl-4 pr-10 py-3 bg-slate-800 rounded-xl border border-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-200"
                    />
                    {actorSearchQuery && (
                      <button
                        onClick={() => { setActorSearchQuery(''); setActorSearchResult(null); }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-purple-300 p-1 hover:bg-purple-900 rounded-full"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                  <button
                    onClick={handleActorSearch}
                    disabled={actorSearchLoading}
                    className="px-5 py-3 bg-purple-500 text-white rounded-xl font-medium hover:bg-purple-600 transition-colors disabled:opacity-50"
                  >
                    {actorSearchLoading ? '...' : 'Buscar'}
                  </button>
                </div>
              </div>

              {/* Info del actor encontrado */}
              {actorSearchResult?.actor && (
                <div className="px-4 py-3 bg-purple-50 border-b border-purple-200 flex items-center gap-3 flex-shrink-0">
                  {actorSearchResult.actor.photo && (
                    <img src={actorSearchResult.actor.photo} alt={actorSearchResult.actor.name} className="w-12 h-12 rounded-full object-cover" />
                  )}
                  <div>
                    <p className="font-semibold text-purple-800">{actorSearchResult.actor.name}</p>
                    <p className="text-sm text-purple-600">{actorSearchResult.movies.length} películas encontradas</p>
                  </div>
                  <button
                    onClick={() => { setActorSearchResult(null); setActorSearchQuery(''); }}
                    className="ml-auto text-purple-400 hover:text-purple-600"
                  >
                    <X size={20} />
                  </button>
                </div>
              )}

              {/* Seleccionadas */}
              {selectedRequests.length > 0 && (
                <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex-shrink-0">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-amber-800">
                      {selectedRequests.length} película(s) seleccionada(s)
                    </span>
                    <button
                      onClick={() => setSelectedRequests([])}
                      className="text-xs text-amber-600 hover:text-amber-800"
                    >
                      Limpiar selección
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedRequests.map(movie => (
                      <span
                        key={movie.tmdbId}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-amber-200 text-amber-800 rounded-lg text-xs"
                      >
                        {movie.title} {movie.year && `(${movie.year})`}
                        <button
                          onClick={() => toggleRequestSelection(movie)}
                          className="hover:text-red-600"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Resultados */}
              <div className="p-4 overflow-y-auto flex-1">
                {(requestSearchLoading || actorSearchLoading) ? (
                  <div className="grid grid-cols-3 md:grid-cols-5 gap-4">
                    {[1,2,3,4,5,6,7,8,9,10].map(i => (
                      <div key={i} className="aspect-[2/3] bg-slate-200 rounded-xl animate-pulse" />
                    ))}
                  </div>
                ) : (actorSearchResult?.movies?.length > 0) ? (
                  /* Mostrar películas del actor */
                  <div className="grid grid-cols-3 md:grid-cols-5 gap-4">
                    {actorSearchResult.movies.map((movie) => {
                      const isSelected = selectedRequests.some(m => m.tmdbId === movie.tmdbId);
                      const alreadyRequested = isMovieRequested(movie.tmdbId);
                      const inCatalog = isMovieInCatalog(movie.tmdbId);
                      const isUnavailable = alreadyRequested || inCatalog;
                      return (
                        <motion.div
                          key={movie.tmdbId}
                          whileHover={{ scale: isUnavailable ? 1 : 1.03 }}
                          onClick={() => !isUnavailable && toggleRequestSelection(movie)}
                          className={`group relative ${isUnavailable ? 'cursor-default' : 'cursor-pointer'} ${
                            isUnavailable ? 'ring-4 ring-red-500 rounded-xl' :
                            isSelected ? 'ring-4 ring-amber-500 rounded-xl' : ''
                          }`}
                        >
                          <div className="aspect-[2/3] rounded-xl overflow-hidden bg-slate-200 relative">
                            <img src={movie.poster} alt={movie.title} className={`w-full h-full object-cover ${isUnavailable ? 'opacity-60' : ''}`} />
                            {/* Sinopsis en hover con botón para ver más */}
                            {movie.overview && (
                              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 p-3 flex flex-col justify-end">
                                <p className="text-white text-xs leading-relaxed pointer-events-none" style={{
                                  display: '-webkit-box',
                                  WebkitLineClamp: 4,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden'
                                }}>{movie.overview}</p>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setRequestDetailMovie(movie); }}
                                  className="mt-2 text-xs text-amber-400 hover:text-amber-300 font-medium self-start"
                                >
                                  Ver sinopsis completa →
                                </button>
                              </div>
                            )}
                            {/* Indicadores de estado */}
                            {isUnavailable && (
                              <div className="absolute top-2 right-2 z-10">
                                <span className="bg-red-500 text-white rounded-lg px-2 py-1 text-xs font-bold shadow-lg">
                                  {inCatalog ? 'EN CATÁLOGO' : 'SOLICITADA'}
                                </span>
                              </div>
                            )}
                            {isSelected && !isUnavailable && (
                              <div className="absolute top-2 right-2 z-10">
                                <span className="bg-amber-500 text-white rounded-full p-1.5 shadow-lg">✓</span>
                              </div>
                            )}
                          </div>
                          <p className="mt-2 text-sm font-medium text-slate-200 truncate">{movie.title}</p>
                          <p className="text-xs text-slate-400">
                            {movie.year && `(${movie.year})`}
                            {movie.rating && ` ⭐ ${movie.rating.toFixed(1)}`}
                          </p>
                          {movie.character && (
                            <p className="text-xs text-purple-500 truncate">como {movie.character}</p>
                          )}
                        </motion.div>
                      );
                    })}
                  </div>
                ) : requestSearchResults.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <div className="text-5xl mb-4">🔍</div>
                    <p>Busca películas por título o por nombre de actor</p>
                    <p className="text-sm mt-2">Ejemplo: "Matrix", "Mel Gibson", "El Padrino"</p>
                  </div>
                ) : (
                  /* Mostrar resultados de búsqueda por título */
                  <div className="grid grid-cols-3 md:grid-cols-5 gap-4">
                    {requestSearchResults.map((movie) => {
                      const isSelected = selectedRequests.some(m => m.tmdbId === movie.tmdbId);
                      const alreadyRequested = isMovieRequested(movie.tmdbId);
                      const inCatalog = isMovieInCatalog(movie.tmdbId);
                      const isUnavailable = alreadyRequested || inCatalog;
                      return (
                        <motion.div
                          key={movie.tmdbId}
                          whileHover={{ scale: isUnavailable ? 1 : 1.03 }}
                          onClick={() => !isUnavailable && toggleRequestSelection(movie)}
                          className={`group relative ${isUnavailable ? 'cursor-default' : 'cursor-pointer'} ${
                            isUnavailable ? 'ring-4 ring-red-500 rounded-xl' :
                            isSelected ? 'ring-4 ring-amber-500 rounded-xl' : ''
                          }`}
                        >
                          <div className="aspect-[2/3] rounded-xl overflow-hidden bg-slate-200 relative">
                            <img
                              src={movie.poster}
                              alt={movie.title}
                              className={`w-full h-full object-cover ${isUnavailable ? 'opacity-60' : ''}`}
                            />
                            {/* Sinopsis en hover con botón para ver más */}
                            {movie.overview && (
                              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 p-3 flex flex-col justify-end">
                                <p className="text-white text-xs leading-relaxed pointer-events-none" style={{
                                  display: '-webkit-box',
                                  WebkitLineClamp: 4,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden'
                                }}>{movie.overview}</p>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setRequestDetailMovie(movie); }}
                                  className="mt-2 text-xs text-amber-400 hover:text-amber-300 font-medium self-start"
                                >
                                  Ver sinopsis completa →
                                </button>
                              </div>
                            )}
                            {/* Indicadores de estado */}
                            {isUnavailable && (
                              <div className="absolute top-2 right-2 z-10">
                                <span className="bg-red-500 text-white rounded-lg px-2 py-1 text-xs font-bold shadow-lg">
                                  {inCatalog ? 'EN CATÁLOGO' : 'SOLICITADA'}
                                </span>
                              </div>
                            )}
                            {isSelected && !isUnavailable && (
                              <div className="absolute top-2 right-2 z-10">
                                <span className="bg-amber-500 text-white rounded-full p-1.5 shadow-lg">✓</span>
                              </div>
                            )}
                          </div>
                          <p className="mt-2 text-sm font-medium text-slate-200 truncate">{movie.title}</p>
                          <p className="text-xs text-slate-400">
                            {movie.year && `(${movie.year})`}
                            {movie.rating && ` ⭐ ${movie.rating.toFixed(1)}`}
                          </p>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="bg-slate-800 px-6 py-4 flex justify-between items-center flex-shrink-0 border-t border-slate-700">
                <button
                  onClick={() => {
                    setSelectedRequests([]);
                    setRequestSearchResults([]);
                    setRequestSearchQuery('');
                    setActorSearchQuery('');
                    setActorSearchResult(null);
                    setRequestsModal(false);
                  }}
                  disabled={submittingRequests}
                  className="px-6 py-2 rounded-xl text-slate-600 hover:bg-slate-200 transition-colors"
                >
                  Cerrar
                </button>
                <button
                  onClick={submitRequests}
                  disabled={selectedRequests.length === 0 || submittingRequests}
                  className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-medium hover:from-amber-600 hover:to-orange-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {submittingRequests ? (
                    <>
                      <RefreshCw size={18} className="animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    <>Enviar Petición ({selectedRequests.length})</>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal de Detalle de Película (Sinopsis completa) */}
      <AnimatePresence>
        {requestDetailMovie && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setRequestDetailMovie(null)}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden border border-slate-700"
            >
              {/* Header con poster y título */}
              <div className="flex gap-4 p-4 bg-gradient-to-r from-slate-800 to-slate-900 border-b border-slate-700">
                {requestDetailMovie.poster && (
                  <img
                    src={requestDetailMovie.poster}
                    alt={requestDetailMovie.title}
                    className="w-24 h-36 object-cover rounded-lg shadow-lg flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="text-xl font-bold text-white leading-tight">
                    {requestDetailMovie.title}
                  </h3>
                  <p className="text-slate-400 mt-1">
                    {requestDetailMovie.year && `(${requestDetailMovie.year})`}
                    {requestDetailMovie.rating && ` • ⭐ ${requestDetailMovie.rating.toFixed(1)}`}
                  </p>
                  {requestDetailMovie.character && (
                    <p className="text-purple-400 text-sm mt-2">
                      🎭 como {requestDetailMovie.character}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setRequestDetailMovie(null)}
                  className="text-slate-400 hover:text-white transition-colors self-start"
                >
                  <X size={24} />
                </button>
              </div>

              {/* Sinopsis con scroll */}
              <div className="flex-1 overflow-y-auto p-4">
                <h4 className="text-sm font-semibold text-amber-500 mb-2">Sinopsis</h4>
                <p className="text-slate-300 leading-relaxed whitespace-pre-line">
                  {requestDetailMovie.overview || 'Sin sinopsis disponible.'}
                </p>
              </div>

              {/* Footer con botón para seleccionar */}
              <div className="p-4 bg-slate-800 border-t border-slate-700 flex gap-3">
                <button
                  onClick={() => setRequestDetailMovie(null)}
                  className="flex-1 px-4 py-2.5 rounded-xl text-slate-400 hover:bg-slate-700 transition-colors"
                >
                  Cerrar
                </button>
                {!isMovieInCatalog(requestDetailMovie.tmdbId) && !isMovieRequested(requestDetailMovie.tmdbId) && (
                  <button
                    onClick={() => {
                      toggleRequestSelection(requestDetailMovie);
                      setRequestDetailMovie(null);
                    }}
                    className={`flex-1 px-4 py-2.5 rounded-xl font-medium transition-colors ${
                      selectedRequests.some(m => m.tmdbId === requestDetailMovie.tmdbId)
                        ? 'bg-red-500 text-white hover:bg-red-600'
                        : 'bg-amber-500 text-white hover:bg-amber-600'
                    }`}
                  >
                    {selectedRequests.some(m => m.tmdbId === requestDetailMovie.tmdbId)
                      ? '✕ Quitar de la lista'
                      : '✓ Añadir a la lista'
                    }
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal de Administración de Peticiones */}
      <AnimatePresence>
        {requestsAdminModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-hidden"
            onWheel={(e) => e.stopPropagation()}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-slate-900 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-700"
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-4 flex items-center justify-between flex-shrink-0">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  📋 Administrar Peticiones
                  {requestsReadonly && (
                    <span className="ml-2 px-2 py-0.5 bg-yellow-500/30 text-yellow-200 text-xs rounded-full font-normal">
                      Solo lectura
                    </span>
                  )}
                </h2>
                <button
                  onClick={() => setRequestsAdminModal(false)}
                  className="text-white/80 hover:text-white transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              {/* Estadísticas */}
              {requestsStats && (
                <div className="px-6 py-3 bg-slate-800 border-b border-slate-700 flex gap-4 flex-shrink-0">
                  <span className="text-sm">
                    <span className="font-medium text-slate-200">Total:</span>{' '}
                    <span className="text-slate-600">{requestsStats.total}</span>
                  </span>
                  <span className="text-sm">
                    <span className="font-medium text-amber-600">Pendientes:</span>{' '}
                    <span className="text-amber-600">{requestsStats.pending}</span>
                  </span>
                  <span className="text-sm">
                    <span className="font-medium text-blue-600">Descargando:</span>{' '}
                    <span className="text-blue-600">{requestsStats.downloading}</span>
                  </span>
                  <span className="text-sm">
                    <span className="font-medium text-green-600">Completadas:</span>{' '}
                    <span className="text-green-600">{requestsStats.downloaded}</span>
                  </span>
                  <span className="text-sm">
                    <span className="font-medium text-purple-600">Convertidas:</span>{' '}
                    <span className="text-purple-600">{requestsStats.mp4 || 0}</span>
                  </span>
                  <span className="text-sm">
                    <span className="font-medium text-emerald-600">En servidor:</span>{' '}
                    <span className="text-emerald-600">{requestsStats.server || 0}</span>
                  </span>
                  <span className="text-sm">
                    <span className="font-medium text-red-600">Rechazadas:</span>{' '}
                    <span className="text-red-600">{requestsStats.rejected}</span>
                  </span>
                </div>
              )}

              {/* Añadir URL a cola de descargas */}
              {!requestsReadonly && (
                <div className="px-6 py-3 bg-slate-800/50 border-b border-slate-700 flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <span className="text-slate-400 text-sm whitespace-nowrap">📥 Cola de descargas:</span>
                    <input
                      type="text"
                      value={downloadUrl}
                      onChange={(e) => setDownloadUrl(e.target.value)}
                      placeholder="Pega aquí la URL de OK.ru (ej: https://ok.ru/video/123456)"
                      className="flex-1 px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          addToDownloadQueue(downloadUrl);
                        }
                      }}
                    />
                    <button
                      onClick={() => addToDownloadQueue(downloadUrl)}
                      disabled={downloadQueueStatus?.type === 'loading'}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                        downloadQueueStatus?.type === 'loading'
                          ? 'bg-slate-600 text-slate-400 cursor-wait'
                          : 'bg-green-600 hover:bg-green-500 text-white'
                      }`}
                    >
                      {downloadQueueStatus?.type === 'loading' ? '...' : '+ Añadir'}
                    </button>
                    {downloadQueueStatus && downloadQueueStatus.type !== 'loading' && (
                      <span className={`text-sm ${
                        downloadQueueStatus.type === 'success' ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {downloadQueueStatus.message}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Lista de peticiones */}
              <div className="flex-1 overflow-y-auto p-4">
                {allRequests.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <div className="text-5xl mb-4">📭</div>
                    <p>No hay peticiones pendientes</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {allRequests.map(request => (
                      <div
                        key={request.id}
                        className={`flex items-center gap-4 p-4 rounded-xl border ${
                          request.status === 'pending' ? 'bg-amber-900/20 border-amber-800/50' :
                          request.status === 'downloading' ? 'bg-blue-900/20 border-blue-800/50' :
                          request.status === 'downloaded' ? 'bg-green-900/20 border-green-800/50' :
                          'bg-red-900/20 border-red-800/50'
                        }`}
                      >
                        {/* Poster */}
                        <img
                          src={request.poster}
                          alt={request.title}
                          className="w-16 h-24 object-cover rounded-lg flex-shrink-0"
                        />

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-lg text-white truncate">
                            {request.title} {request.year && `(${request.year})`}
                          </h3>
                          <p className="text-sm text-slate-500">
                            Pedido por: <span className="font-medium">{request.requestedBy}</span>
                          </p>
                          <p className="text-xs text-slate-400">
                            {new Date(request.requestedAt).toLocaleDateString('es-ES', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </p>
                        </div>

                        {/* Estado y acciones */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {requestsReadonly ? (
                            /* Modo solo lectura: mostrar estado como badge */
                            <span className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                              request.status === 'pending' ? 'bg-amber-700/40 text-amber-300' :
                              request.status === 'downloading' ? 'bg-blue-700/40 text-blue-300' :
                              request.status === 'downloaded' ? 'bg-green-700/40 text-green-300' :
                              request.status === 'mp4' ? 'bg-purple-700/40 text-purple-300' :
                              request.status === 'server' ? 'bg-emerald-700/40 text-emerald-300' :
                              'bg-red-700/40 text-red-300'
                            }`}>
                              {request.status === 'pending' ? 'Pendiente' :
                               request.status === 'downloading' ? 'Descargando' :
                               request.status === 'downloaded' ? 'Descargada' :
                               request.status === 'mp4' ? 'Convertida' :
                               request.status === 'server' ? 'En servidor' : 'Rechazada'}
                            </span>
                          ) : (
                            /* Modo normal: select editable */
                            <select
                              value={request.status}
                              onChange={(e) => updateRequestStatus(request.id, e.target.value)}
                              className={`px-3 py-1.5 rounded-lg text-sm font-medium border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                                request.status === 'pending' ? 'bg-amber-600 text-white' :
                                request.status === 'downloading' ? 'bg-blue-600 text-white' :
                                request.status === 'downloaded' ? 'bg-green-600 text-white' :
                                request.status === 'mp4' ? 'bg-purple-600 text-white' :
                                request.status === 'server' ? 'bg-emerald-600 text-white' :
                                'bg-red-600 text-white'
                              }`}
                              style={{ colorScheme: 'dark' }}
                            >
                              <option value="pending" className="bg-slate-800 text-amber-300 font-medium">⏳ Pendiente</option>
                              <option value="downloading" className="bg-slate-800 text-blue-300 font-medium">⬇️ Descargando</option>
                              <option value="downloaded" className="bg-slate-800 text-green-300 font-medium">✅ Descargada</option>
                              <option value="mp4" className="bg-slate-800 text-purple-300 font-medium">🎬 Convertida</option>
                              <option value="server" className="bg-slate-800 text-emerald-300 font-medium">📁 En servidor</option>
                              <option value="rejected" className="bg-slate-800 text-red-300 font-medium">❌ Rechazada</option>
                            </select>
                          )}
                          <button
                            onClick={() => window.open(`https://ok.ru/dk?st.cmd=searchResult&st.mode=Movie&st.query=${encodeURIComponent(request.title)}`, '_blank')}
                            className="p-2 text-slate-400 hover:text-orange-400 hover:bg-orange-900/30 rounded-lg transition-all"
                            title="Buscar en OK.ru"
                          >
                            🔍
                          </button>
                          <button
                            onClick={() => searchTodoTorrents(request.title)}
                            className="p-2 text-slate-400 hover:text-purple-400 hover:bg-purple-900/30 rounded-lg transition-all"
                            title="Buscar en TodoTorrents (Tor)"
                          >
                            🧅
                          </button>
                          {!requestsReadonly && (
                            <button
                              onClick={() => deleteRequest(request.id)}
                              className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-900/30 rounded-lg transition-all"
                              title="Eliminar petición"
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="bg-slate-800 px-6 py-4 flex justify-end flex-shrink-0 border-t border-slate-700">
                <button
                  onClick={() => setRequestsAdminModal(false)}
                  className="px-6 py-2 rounded-xl text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  Cerrar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal de Configuración */}
      <AnimatePresence>
        {settingsModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto my-4 border border-slate-700"
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-4 flex items-center justify-between">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Settings size={24} /> Configuracion
                </h2>
                <button
                  onClick={() => !clearingCache && setSettingsModal(false)}
                  className="text-white/80 hover:text-white transition-colors"
                  disabled={clearingCache}
                >
                  <X size={24} />
                </button>
              </div>

              {/* Content */}
              <div className="p-6 space-y-6">
                {/* Sección Modo de Almacenamiento */}
                <div className="border border-slate-600 rounded-xl p-4">
                  <h3 className="font-semibold text-white mb-2 flex items-center gap-2">
                    <HardDrive size={18} className="text-indigo-600" />
                    Modo de Almacenamiento
                  </h3>
                  <p className="text-sm text-slate-600 mb-4">
                    Selecciona de donde leer las peliculas: disco local conectado al ordenador o disco en red via FTP.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleBrowseLocalFolder}
                      disabled={changingMode}
                      className={`flex-1 py-3 px-4 rounded-xl font-medium transition-all flex items-center justify-center gap-2 ${
                        storageMode === 'local'
                          ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-lg'
                          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      } ${changingMode ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <FolderOpen size={18} />
                      {storageMode === 'local' ? 'LOCAL' : 'Seleccionar Disco'}
                    </button>
                    <button
                      onClick={() => handleStorageModeChange('ftp')}
                      disabled={changingMode}
                      className={`flex-1 py-3 px-4 rounded-xl font-medium transition-all flex items-center justify-center gap-2 ${
                        storageMode === 'ftp'
                          ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-lg'
                          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      } ${changingMode ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <Wifi size={18} />
                      RED (FTP)
                    </button>
                  </div>
                  {changingMode && (
                    <p className="text-sm text-indigo-600 mt-2 flex items-center gap-2">
                      <RefreshCw size={14} className="animate-spin" />
                      Cambiando modo y recargando peliculas...
                    </p>
                  )}

                  {/* Campo para escribir ruta manualmente */}
                  <div className="mt-3">
                    <label className="text-xs text-slate-500 mb-1 block">O escribe la ruta directamente:</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={storagePath}
                        onChange={(e) => setStoragePath(e.target.value)}
                        placeholder="Ej: E:\Peliculas o F:\Videos"
                        className="flex-1 px-3 py-2 text-sm border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                        disabled={changingMode}
                      />
                      <button
                        onClick={async () => {
                          if (!storagePath.trim() || changingMode) return;
                          setChangingMode(true);
                          try {
                            const res = await authFetch(`${API_BASE}/api/storage/mode`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ mode: 'local', localPath: storagePath.trim() })
                            });
                            const data = await res.json();
                            if (data.success) {
                              setStorageMode('local');
                              setLoading(true);
                              setVideos([]);
                              const videosRes = await authFetch(`${API_BASE}/api/videos`);
                              const videosData = await videosRes.json();
                              if (Array.isArray(videosData)) setVideos(videosData);
                              setLoading(false);
                            } else {
                              alert(data.error || 'Error');
                            }
                          } catch (e) {
                            alert('Error: ' + e.message);
                          } finally {
                            setChangingMode(false);
                          }
                        }}
                        disabled={changingMode || !storagePath.trim()}
                        className="px-4 py-2 bg-green-500 text-white text-sm rounded-lg hover:bg-green-600 disabled:opacity-50"
                      >
                        Aplicar
                      </button>
                    </div>
                  </div>

                  {storageMode === 'local' && storagePath && (
                    <div className="mt-3 p-2 bg-green-50 border border-green-200 rounded-lg">
                      <p className="text-sm text-green-700 flex items-center gap-2">
                        <HardDrive size={14} />
                        <span className="font-medium">Ruta activa:</span> {storagePath}
                      </p>
                    </div>
                  )}
                </div>

                {/* Sección Caché */}
                <div className="border border-slate-600 rounded-xl p-4">
                  <h3 className="font-semibold text-white mb-2 flex items-center gap-2">
                    <RefreshCw size={18} className="text-indigo-600" />
                    Cache de Caratulas
                  </h3>
                  <p className="text-sm text-slate-400 mb-4">
                    Borra toda la cache de caratulas y vuelve a buscar la informacion en TMDB.
                    Util si los nombres de las peliculas han cambiado o hay caratulas incorrectas.
                  </p>
                  <button
                    onClick={handleClearCacheAndReload}
                    disabled={clearingCache}
                    className={`w-full py-3 px-4 rounded-xl font-medium transition-all flex items-center justify-center gap-2 ${
                      clearingCache
                        ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-red-500 to-orange-500 text-white hover:from-red-600 hover:to-orange-600 shadow-lg hover:shadow-xl'
                    }`}
                  >
                    {clearingCache ? (
                      <>
                        <RefreshCw size={18} className="animate-spin" />
                        Procesando...
                      </>
                    ) : (
                      <>
                        <Trash2 size={18} />
                        Limpiar Cache y Recargar
                      </>
                    )}
                  </button>

                  {/* Barra de progreso */}
                  {clearingCache && cacheProgress.total > 0 && (
                    <div className="mt-4 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">{cacheProgress.status}</span>
                        <span className="font-medium text-indigo-600">
                          {cacheProgress.current}/{cacheProgress.total}
                        </span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-indigo-500 to-purple-500 h-3 rounded-full transition-all duration-300"
                          style={{ width: `${(cacheProgress.current / cacheProgress.total) * 100}%` }}
                        />
                      </div>
                      <p className="text-xs text-slate-500 text-center">
                        {Math.round((cacheProgress.current / cacheProgress.total) * 100)}% completado
                      </p>
                    </div>
                  )}

                  {/* Estado sin progreso */}
                  {clearingCache && cacheProgress.total === 0 && cacheProgress.status && (
                    <div className="mt-4 text-sm text-slate-600 flex items-center gap-2">
                      <RefreshCw size={14} className="animate-spin" />
                      {cacheProgress.status}
                    </div>
                  )}
                </div>

                {/* Sección Limpiar Duplicados */}
                <div className="border border-amber-200 rounded-xl p-4 bg-amber-50">
                  <h3 className="font-semibold text-amber-800 mb-2 flex items-center gap-2">
                    <Trash2 size={18} className="text-amber-600" />
                    Limpiar Entradas Huerfanas
                  </h3>
                  <p className="text-sm text-amber-700 mb-4">
                    Elimina del cache las peliculas que ya no existen (renombradas, convertidas o eliminadas).
                  </p>
                  <button
                    onClick={async () => {
                      if (clearingCache) return;
                      setClearingCache(true);
                      try {
                        const res = await authFetch(`${API_BASE}/api/cache/cleanup`, { method: 'POST' });
                        const data = await res.json();
                        if (data.success) {
                          alert(`Limpieza completada:\n- ${data.removed} entradas eliminadas\n- ${data.remaining} entradas validas`);
                        } else {
                          alert('Error: ' + (data.error || 'Error desconocido'));
                        }
                      } catch (err) {
                        alert('Error: ' + err.message);
                      } finally {
                        setClearingCache(false);
                      }
                    }}
                    disabled={clearingCache}
                    className={`w-full py-3 px-4 rounded-xl font-medium transition-all flex items-center justify-center gap-2 ${
                      clearingCache
                        ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-amber-500 to-yellow-500 text-white hover:from-amber-600 hover:to-yellow-600 shadow-lg hover:shadow-xl'
                    }`}
                  >
                    <Trash2 size={18} />
                    Limpiar Entradas Huerfanas
                  </button>
                </div>

                {/* Sección Regenerar Sagas */}
                <div className="border border-slate-600 rounded-xl p-4">
                  <h3 className="font-semibold text-white mb-2 flex items-center gap-2">
                    <Layers size={18} className="text-purple-500" />
                    Regenerar Sagas
                  </h3>
                  <p className="text-sm text-slate-400 mb-4">
                    Vuelve a generar las colecciones de sagas buscando en TMDB.
                    Util si has añadido nuevas peliculas o corregido nombres de archivos.
                  </p>
                  <button
                    onClick={async () => {
                      if (generatingCollections) return;
                      setGeneratingCollections(true);
                      try {
                        const res = await authFetch(`${API_BASE}/api/collections/generate`, { method: 'POST' });
                        const data = await res.json();
                        if (data.success) {
                          // Recargar colecciones
                          const collectionsRes = await authFetch(`${API_BASE}/api/collections`);
                          const collectionsData = await collectionsRes.json();
                          if (Array.isArray(collectionsData)) {
                            setCollections(collectionsData);
                          }
                          alert(`Sagas regeneradas correctamente:\n- ${data.collectionsCount || collectionsData.length} sagas encontradas`);
                        } else {
                          alert('Error: ' + (data.error || 'Error desconocido'));
                        }
                      } catch (err) {
                        alert('Error: ' + err.message);
                      } finally {
                        setGeneratingCollections(false);
                      }
                    }}
                    disabled={generatingCollections || clearingCache}
                    className={`w-full py-3 px-4 rounded-xl font-medium transition-all flex items-center justify-center gap-2 ${
                      generatingCollections
                        ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-purple-500 to-indigo-500 text-white hover:from-purple-600 hover:to-indigo-600 shadow-lg hover:shadow-xl'
                    }`}
                  >
                    {generatingCollections ? (
                      <>
                        <RefreshCw size={18} className="animate-spin" />
                        Regenerando sagas...
                      </>
                    ) : (
                      <>
                        <Layers size={18} />
                        Regenerar Sagas
                      </>
                    )}
                  </button>
                </div>

                {/* Info */}
                <div className="bg-blue-900/30 border border-blue-800 rounded-xl p-4">
                  <p className="text-sm text-blue-300">
                    <strong>Nota:</strong> Este proceso puede tardar varios minutos dependiendo del numero de peliculas.
                    Las busquedas en TMDB usan el nombre del archivo y el año entre parentesis para obtener resultados precisos.
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="bg-slate-800 px-6 py-4 flex justify-end border-t border-slate-700">
                <button
                  onClick={() => setSettingsModal(false)}
                  disabled={clearingCache}
                  className="px-6 py-2 rounded-xl text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-50"
                >
                  Cerrar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
