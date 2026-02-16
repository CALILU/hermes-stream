import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Settings, Search, HardDrive, ListFilter, X, Layers, FolderOpen, RefreshCw, Lock, User, LogOut, Heart, Shuffle } from 'lucide-react';
import { API_BASE, CACHE_KEY, ALPHABET, genreEmojis } from './constants';
import { authFetch, getSessionToken } from './utils/api';
import { loadCache, saveCache } from './utils/cache';

import { useAuth } from './hooks/useAuth';
import { useVolumeBoost } from './hooks/useVolumeBoost';
import { useVideoProgress } from './hooks/useVideoProgress';
import { useVideos } from './hooks/useVideos';
import { useSeries } from './hooks/useSeries';
import { useRequests } from './hooks/useRequests';
import { useCast } from './hooks/useCast';
import ContextMenu from './components/ContextMenu';
import DeleteConfirmModal from './components/DeleteConfirmModal';
import ConversionProgressModal from './components/ConversionProgressModal';
import AudioSelectionModal from './components/AudioSelectionModal';
import PosterSearchModal from './components/PosterSearchModal';
import VideoPlayer from './components/VideoPlayer';
import RequestFormModal from './components/RequestFormModal';
import RequestDetailModal from './components/RequestDetailModal';
import RequestsAdminModal from './components/RequestsAdminModal';
import SeriesDetailModal from './components/SeriesDetailModal';
import EpisodePlayerModal from './components/EpisodePlayerModal';
import RenameEpisodesModal from './components/RenameEpisodesModal';
import SettingsModal from './components/SettingsModal';
import CastDeviceModal from './components/CastDeviceModal';
import RandomPickerModal from './components/RandomPickerModal';
import RecommendationsSection from './components/RecommendationsSection';
import { useRecommendations } from './hooks/useRecommendations';

export default function HermesApp() {
  // ========== HOOKS EXTRAIDOS ==========
  const { authState, setAuthState, loginForm, setLoginForm, loginError, loginLoading, handleLogin, handleLogout } = useAuth();
  const { videoRef, saveVideoProgress, getAllVideoProgress, handleTimeUpdate: _handleTimeUpdate, handleVideoLoaded: _handleVideoLoaded, closeVideoPlayer: _closeVideoPlayer } = useVideoProgress();

  const {
    videos, genres, loading, collections, generatingCollections,
    selectedGenre, selectedLetter, searchQuery,
    selectedCollection, showCollections,
    selectedDecade, selectedYear, showDecades, showRecent,
    favorites, showFavorites,
    galleryActorQuery, galleryActorMovieIds, galleryActorLoading, galleryActorName,
    filteredVideos, displayedVideos, hasMoreVideos, loadMoreRef,
    lettersWithMovies, decadesData,
    setVideos, setLoading,
    setSelectedGenre, setSelectedLetter, setSearchQuery,
    setSelectedCollection, setShowCollections,
    setSelectedDecade, setSelectedYear, setShowDecades, setShowRecent,
    setShowFavorites,
    setGalleryActorQuery,
    enrichmentDone,
    toggleFavorite,
    generateCollections, handleGalleryActorSearch, clearGalleryActorSearch
  } = useVideos({ authState, setAuthState });

  const {
    viewMode, series, seriesGenres, selectedSeriesGenre, seriesStatusFilter,
    loadingSeries, selectedSeries, selectedSeason, seasonEpisodes,
    loadingEpisodes, selectedEpisode, seriesSearchQuery, filteredSeries,
    setViewMode, setSeries, setSelectedSeriesGenre, setSeriesStatusFilter,
    setSelectedSeason, setSelectedEpisode, setSeriesSearchQuery,
    selectSeries, markEpisodeWatched, closeSeriesDetail
  } = useSeries({ authState });

  const {
    requestsModal, requestsAdminModal, requestSearchQuery, requestSearchResults,
    requestSearchLoading, selectedRequests, submittingRequests, allRequests,
    existingRequests, actorSearchQuery, actorSearchResult, actorSearchLoading,
    requestsStats, requestsReadonly, requestsFilter, requestDetailMovie,
    setRequestSearchQuery, setActorSearchQuery, setActorSearchResult,
    setSelectedRequests, setRequestsFilter, setRequestDetailMovie,
    setRequestsAdminModal, setAllRequests,
    handleRequestSearch, handleActorSearch, toggleRequestSelection,
    submitRequests, addRecommendationToRequests,
    updateRequestStatus, deleteRequest, searchTodoTorrents,
    openRequestsAdmin, openRequestsModal,
    closeRequestsModal, isMovieInCatalog, isMovieRequested
  } = useRequests({ authState, videos });

  const [selectedVideo, setSelectedVideo] = useState(null);
  const [loadingVideo, setLoadingVideo] = useState(null);

  const { volumeBoost, setVolumeBoost, showVolumeBoost, setShowVolumeBoost } = useVolumeBoost(videoRef, selectedVideo);

  // DLNA Cast a TV
  const {
    devices: castDevices, scanning: castScanning, activeDevice: castActiveDevice,
    castStatus, casting, scanDevices: castScanDevices,
    castToDevice, pauseCast, resumeCast, stopCast, seekCast, setVolume: setCastVolume
  } = useCast();
  const [showCastModal, setShowCastModal] = useState(false);

  const handleCastToDevice = async (device) => {
    if (!selectedVideo) return;
    await castToDevice(device, selectedVideo);
  };

  // Wrappers para pasar selectedVideo a los handlers de useVideoProgress
  const handleTimeUpdate = () => _handleTimeUpdate(selectedVideo);
  const handleVideoLoaded = () => _handleVideoLoaded(selectedVideo);
  const closeVideoPlayer = () => _closeVideoPlayer(selectedVideo, setSelectedVideo);

  // "Continuar viendo" - peliculas con progreso parcial
  const continueWatching = useMemo(() => {
    if (!videos || videos.length === 0) return [];
    const allProgress = getAllVideoProgress();
    return videos
      .map(video => {
        const prog = allProgress[video.filename];
        if (!prog || prog.progress < 5 || prog.progress > 95) return null;
        return { ...video, _progress: prog.progress, _savedAt: prog.savedAt, _currentTime: prog.currentTime, _duration: prog.duration };
      })
      .filter(Boolean)
      .sort((a, b) => b._savedAt - a._savedAt)
      .slice(0, 10);
  }, [videos, selectedVideo, getAllVideoProgress]); // selectedVideo como dependencia para refrescar al cerrar el player

  // Recomendaciones IA personalizadas
  const aiRecommendations = useRecommendations(videos, favorites, getAllVideoProgress(), genres);

  // Estados para menú contextual
  const [contextMenu, setContextMenu] = useState(null);

  // Estados para modal de búsqueda de carátula
  const [posterSearchModal, setPosterSearchModal] = useState(null);
  const [posterSearchQuery, setPosterSearchQuery] = useState('');
  const [posterSearchResults, setPosterSearchResults] = useState([]);
  const [posterSearchLoading, setPosterSearchLoading] = useState(false);

  // Estados para modal de búsqueda de carátula de SERIES
  const [seriesPosterSearchModal, setSeriesPosterSearchModal] = useState(null);
  const [seriesPosterSearchQuery, setSeriesPosterSearchQuery] = useState('');
  const [seriesPosterSearchResults, setSeriesPosterSearchResults] = useState([]);
  const [seriesPosterSearchLoading, setSeriesPosterSearchLoading] = useState(false);

  // Estado para modal de renombrado de episodios
  const [renameEpisodesModal, setRenameEpisodesModal] = useState(null);

  // Estado para confirmación de borrado
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Estado para conversión de AVI/MKV a MP4
  const [conversionProgress, setConversionProgress] = useState(null);

  // Estado para selección de pista de audio
  const [audioSelectionModal, setAudioSelectionModal] = useState(null);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState(0);
  const [, setPreferredLanguage] = useState(() => {
    return localStorage.getItem('preferredAudioLanguage') || 'spa';
  });

  // Estado para modal de configuración
  const [settingsModal, setSettingsModal] = useState(false);
  const [showRandomModal, setShowRandomModal] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheProgress, setCacheProgress] = useState({ current: 0, total: 0, status: '' });

  // Estado para modo de almacenamiento
  const [storageMode, setStorageMode] = useState('ftp');
  const [storagePath, setStoragePath] = useState('');
  const [changingMode, setChangingMode] = useState(false);

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
        // Resetear flag para que el useEffect procese las películas sin poster
        enrichmentDone.current = false;
        setVideos(data);
        setCacheProgress({ current: 0, total: data.length, status: 'Películas cargadas. Enriqueciendo automáticamente...' });
      }

      setCacheProgress(p => ({ ...p, status: '¡Caché limpiado! Las carátulas se descargarán automáticamente.' }));
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
          poster: finalMetadata.poster || newVideos[index].poster,
          backdrop: finalMetadata.backdrop || newVideos[index].backdrop,
          overview: finalMetadata.overview,
          rating: finalMetadata.rating || newVideos[index].rating,
          releaseDate: finalMetadata.releaseDate || newVideos[index].releaseDate,
          genreIds: finalMetadata.genreIds || [],
          runtime: finalMetadata.runtime,
          videos: finalMetadata.videos || [],
          recommendations: finalMetadata.recommendations || [],
          cast: finalMetadata.cast || [],
          tmdbId: finalMetadata.tmdbId || newVideos[index].tmdbId
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
      tmdbId: finalMetadata.tmdbId || finalMetadata.id,
      title: finalMetadata.title,
      poster: finalMetadata.poster,
      backdrop: finalMetadata.backdrop,
      overview: finalMetadata.overview,
      rating: finalMetadata.rating,
      releaseDate: finalMetadata.releaseDate,
      genreIds: finalMetadata.genreIds || [],
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

  // === FUNCIONES DE CARÁTULA PARA SERIES ===

  // Buscar series en TMDB
  const searchSeriesPosters = async (query) => {
    if (!query || query.trim().length < 2) return;

    setSeriesPosterSearchLoading(true);
    setSeriesPosterSearchResults([]);

    try {
      const res = await authFetch(`${API_BASE}/api/tmdb/search-tv?query=${encodeURIComponent(query)}`);
      const data = await res.json();

      if (data.success && data.results) {
        setSeriesPosterSearchResults(data.results);
      }
    } catch (error) {
      console.error('Error buscando carátulas de series:', error);
    } finally {
      setSeriesPosterSearchLoading(false);
    }
  };

  // Seleccionar nueva carátula para serie
  const selectSeriesPoster = async (serie, newMetadata) => {
    console.log(`🎨 Actualizando carátula de serie: ${serie.folder_name}`);

    try {
      const response = await authFetch(`${API_BASE}/api/series/update-poster`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderName: serie.folder_name,
          metadata: newMetadata
        })
      });
      const result = await response.json();
      if (result.success && result.metadata) {
        const m = result.metadata;
        // Actualizar estado local con datos completos del backend
        setSeries(prevSeries => prevSeries.map(s =>
          s.folder_name === serie.folder_name
            ? {
                ...s,
                tmdb_id: m.tmdb_id || newMetadata.tmdbId || s.tmdb_id,
                title: m.title || newMetadata.title || s.title,
                poster: m.poster || newMetadata.poster || s.poster,
                backdrop: m.backdrop || newMetadata.backdrop || s.backdrop,
                overview: m.overview || newMetadata.overview || s.overview,
                vote_average: m.vote_average || newMetadata.rating || s.vote_average,
                genre_ids: m.genre_ids || newMetadata.genreIds || s.genre_ids,
                status: m.status || s.status,
                number_of_seasons: m.number_of_seasons || s.number_of_seasons,
                number_of_episodes: m.number_of_episodes || s.number_of_episodes,
                cast: m.cast || s.cast,
                seasons_info: m.seasons_info || s.seasons_info,
                first_air_date: m.first_air_date || s.first_air_date,
                needs_enrichment: false
              }
            : s
        ));
        console.log(`✅ Carátula de serie actualizada: ${serie.folder_name} (${m.cast?.length || 0} actores)`);
      }
    } catch (error) {
      console.error('Error actualizando carátula de serie:', error);
    }

    // Cerrar modal
    setSeriesPosterSearchModal(null);
    setSeriesPosterSearchQuery('');
    setSeriesPosterSearchResults([]);
  };

  // Manejar clic derecho en carátula de serie
  const handleSeriesContextMenu = (e, serie) => {
    e.preventDefault();
    e.stopPropagation();
    // Abrir directamente el modal de búsqueda (sin menú contextual intermedio)
    setSeriesPosterSearchModal(serie);
    setSeriesPosterSearchQuery(serie.title || serie.folder_name);
    setSeriesPosterSearchResults([]);
    searchSeriesPosters(serie.title || serie.folder_name);
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

  // Audio boost useEffects ahora viven en useVolumeBoost hook

  // Cargar peticiones existentes al abrir un video (para mostrar indicadores)
  useEffect(() => {
    if (selectedVideo) {
      authFetch(`${API_BASE}/api/requests`)
        .then(res => res.json())
        .then(data => {
          if (data.requests) {
            setAllRequests(data.requests);
          }
        })
        .catch(() => {});
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

    // Si no tiene cast, cargar los actores (por tmdbId o por título)
    let videoWithCast = video;
    if (!video.cast || video.cast.length === 0) {
      try {
        console.log(`🎭 Cargando actores para: ${video.title}`);
        let castData;

        if (video.tmdbId) {
          // Si tiene tmdbId, buscar directamente
          const castRes = await authFetch(`${API_BASE}/api/tmdb/cast/${video.tmdbId}?filename=${encodeURIComponent(video.filename)}`);
          castData = await castRes.json();
        } else {
          // Si no tiene tmdbId, buscar por título
          console.log(`🔍 Sin tmdbId, buscando por título: ${video.title}`);
          const title = video.title || video.filename.replace(/\.(mp4|mkv|avi)$/i, '');
          const yearMatch = title.match(/\((\d{4})\)/);
          const year = yearMatch ? yearMatch[1] : '';
          const cleanTitle = title.replace(/\s*\(\d{4}\)\s*$/, '').trim();

          const castRes = await authFetch(
            `${API_BASE}/api/tmdb/cast-by-title?title=${encodeURIComponent(cleanTitle)}&year=${year}&filename=${encodeURIComponent(video.filename)}`
          );
          castData = await castRes.json();

          // Si encontró la película, también actualizar el tmdbId local
          if (castData.success && castData.tmdbId) {
            video.tmdbId = castData.tmdbId;
          }
        }

        if (castData.success && castData.cast?.length > 0) {
          videoWithCast = { ...video, cast: castData.cast };
          // Actualizar en el estado global de videos
          setVideos(prev => prev.map(v => v.filename === video.filename ? { ...v, cast: castData.cast, tmdbId: castData.tmdbId || v.tmdbId } : v));
          console.log(`✅ ${castData.cast.length} actores cargados`);
        }
      } catch (castError) {
        console.error('Error cargando actores:', castError);
      }
    }

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
          setAudioSelectionModal({ video: videoWithCast, tracks: data.tracks, loading: false });
          setLoadingVideo(null);
          console.log(`🎬 Múltiples pistas de audio detectadas - mostrando selector`);
          return; // No reproducir aún, esperar selección del usuario
        }

        // Si solo hay una pista o se encontró español, reproducir directamente
        setSelectedVideo({ ...videoWithCast, audioTrack: trackToUse, availableTracks: data.tracks });

        if (spanishIndex >= 0) {
          console.log(`🎬 Audio español detectado (pista ${spanishIndex + 1})`);
        } else {
          console.log(`🎬 Audio: usando única pista disponible`);
        }
      } else {
        // No se detectaron pistas, reproducir con la predeterminada
        setSelectedVideo({ ...videoWithCast, audioTrack: 0 });
      }
    } catch (error) {
      console.error('Error detectando pistas de audio:', error);
      // En caso de error, reproducir con la predeterminada
      setSelectedVideo({ ...videoWithCast, audioTrack: 0 });
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

  // Letras del alfabeto (referencia local para el JSX)
  const alphabet = ALPHABET;

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
        <div className="flex items-center gap-4 mb-4 md:mb-0">
          <img
            src="/logo.jpg"
            alt="IsiPrime"
            className="h-10 md:h-12 lg:h-14 w-auto object-cover rounded-xl"
            style={{
              filter: 'drop-shadow(0 4px 12px rgba(99, 102, 241, 0.3))',
              borderRadius: '1rem'
            }}
          />
          {/* Tabs Películas / Series */}
          <div className="hidden md:flex bg-slate-800 p-1 rounded-xl">
            <button
              onClick={() => setViewMode('movies')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                viewMode === 'movies'
                  ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              🎬 Películas
            </button>
            <button
              onClick={() => setViewMode('series')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                viewMode === 'series'
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              📺 Series
            </button>
          </div>
        </div>

        {/* Tabs Películas/Series para móviles */}
        <div className="flex w-full lg:hidden mb-3 bg-slate-800 p-1 rounded-xl">
          <button
            onClick={() => setViewMode('movies')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
              viewMode === 'movies'
                ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-md'
                : 'text-slate-400'
            }`}
          >
            🎬 Películas
          </button>
          <button
            onClick={() => setViewMode('series')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
              viewMode === 'series'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md'
                : 'text-slate-400'
            }`}
          >
            📺 Series
          </button>
        </div>

        {/* Búsqueda para móviles (visible solo en pantallas pequeñas) */}
        <div className="flex gap-4 w-full lg:hidden">
          <div className="relative flex-1">
            <input
              type="text"
              value={viewMode === 'movies' ? searchQuery : seriesSearchQuery}
              onChange={(e) => viewMode === 'movies' ? setSearchQuery(e.target.value) : setSeriesSearchQuery(e.target.value)}
              placeholder={viewMode === 'movies' ? "Buscar películas..." : "Buscar series..."}
              className={`w-full pl-10 pr-10 py-2.5 bg-slate-800/80 rounded-xl border focus:outline-none focus:ring-2 focus:border-transparent text-white placeholder-slate-400 ${
                viewMode === 'movies' ? 'border-slate-600 focus:ring-indigo-500' : 'border-emerald-600/50 focus:ring-emerald-500'
              }`}
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18}/>
            {(viewMode === 'movies' ? searchQuery : seriesSearchQuery) && (
              <button
                onClick={() => viewMode === 'movies' ? setSearchQuery('') : setSeriesSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full p-1 transition-all"
                aria-label="Limpiar búsqueda"
              >
                <X size={16}/>
              </button>
            )}
          </div>
          {/* Botón Recientes (móvil) - Solo visible en modo películas */}
          {viewMode === 'movies' && (
            <button
              onClick={() => {
                setShowRecent(!showRecent);
                if (!showRecent) {
                  setShowFavorites(false);
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
          )}
          {/* Botón Favoritos (móvil) - Solo visible en modo películas */}
          {viewMode === 'movies' && (
            <button
              onClick={() => {
                setShowFavorites(!showFavorites);
                if (!showFavorites) {
                  setShowRecent(false);
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
                showFavorites
                  ? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white'
                  : 'bg-slate-800/80 text-white border border-slate-600'
              }`}
              title="Películas favoritas"
            >
              <Heart size={18} fill={showFavorites ? "white" : "none"} />
            </button>
          )}
          {/* Botón Sorprendeme (móvil) - Solo visible en modo películas */}
          {viewMode === 'movies' && filteredVideos.length > 0 && (
            <button
              onClick={() => setShowRandomModal(true)}
              className="p-3 bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-xl hover:shadow-md transition-all text-white"
              title="Pelicula aleatoria"
            >
              <Shuffle size={18} />
            </button>
          )}
          {/* Botón Pedir Película (móvil) - Solo visible en modo películas */}
          {viewMode === 'movies' && (
            <button
              onClick={openRequestsModal}
              className="p-3 bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl hover:shadow-md transition-all text-white"
              title="Pedir película"
            >
              🎬
            </button>
          )}
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
                setShowFavorites(false);
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
          {/* Botón Favoritos (desktop) */}
          <button
            onClick={() => {
              setShowFavorites(!showFavorites);
              if (!showFavorites) {
                setShowRecent(false);
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
              showFavorites
                ? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white'
                : 'bg-slate-800/80 text-slate-200 border border-slate-600 hover:bg-slate-700'
            }`}
            title="Películas favoritas"
          >
            <Heart size={16} fill={showFavorites ? "white" : "none"} /> Favoritos
          </button>
          {/* Botón Sorprendeme (desktop) */}
          {viewMode === 'movies' && filteredVideos.length > 0 && (
            <button
              onClick={() => setShowRandomModal(true)}
              className="px-4 py-2.5 rounded-xl font-medium transition-all shadow-md hover:shadow-lg flex items-center gap-2 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:from-violet-600 hover:to-fuchsia-600"
              title="Pelicula aleatoria"
            >
              <Shuffle size={16} /> Sorprendeme
            </button>
          )}
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

      {/* Panel Izquierdo (Géneros/Colecciones para Películas, Filtros para Series) */}
      <div className={`fixed left-0 top-24 w-56 h-[calc(100vh-7rem)] bg-slate-900/80 backdrop-blur-md border rounded-r-3xl shadow-sm z-20 hidden lg:flex flex-col ${
        viewMode === 'movies' ? 'border-slate-700' : 'border-emerald-700/50'
      }`}>
        {/* Parte fija: tabs */}
        <div className="p-4 pb-2 flex-shrink-0">
          {viewMode === 'movies' ? (
            /* Tabs para Películas: Géneros / Colecciones / Décadas */
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
          ) : (
            /* Título para panel de Series */
            <div className="text-emerald-400 font-semibold text-sm flex items-center gap-2">
              📺 Filtros de Series
            </div>
          )}
        </div>

        {/* Parte scrollable: lista de géneros/sagas/décadas (películas) o filtros (series) */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
        {viewMode === 'series' ? (
          /* ========== FILTROS DE SERIES ========== */
          <div className="space-y-4">
            {/* Filtro por género de series */}
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Género</div>
              <button
                onClick={() => setSelectedSeriesGenre(null)}
                className={`w-full text-left px-3 py-2 rounded-lg transition-all mb-1 text-sm ${
                  selectedSeriesGenre === null
                    ? 'bg-emerald-500 text-white shadow-md'
                    : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/80'
                }`}
              >
                🏠 Todos los géneros
              </button>
              {seriesGenres.map(genre => (
                <button
                  key={genre.id}
                  onClick={() => setSelectedSeriesGenre(genre.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-all mb-1 text-sm ${
                    selectedSeriesGenre === genre.id
                      ? 'bg-emerald-500 text-white shadow-md'
                      : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/80'
                  }`}
                >
                  {genreEmojis[genre.name] || '📺'} {genre.name}
                </button>
              ))}
            </div>

            {/* Filtro por estado */}
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Estado</div>
              <button
                onClick={() => setSeriesStatusFilter(null)}
                className={`w-full text-left px-3 py-2 rounded-lg transition-all mb-1 text-sm ${
                  seriesStatusFilter === null
                    ? 'bg-emerald-500 text-white shadow-md'
                    : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/80'
                }`}
              >
                🌐 Todas
              </button>
              <button
                onClick={() => setSeriesStatusFilter('Ended')}
                className={`w-full text-left px-3 py-2 rounded-lg transition-all mb-1 text-sm ${
                  seriesStatusFilter === 'Ended'
                    ? 'bg-emerald-500 text-white shadow-md'
                    : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/80'
                }`}
              >
                🔴 Finalizadas
              </button>
              <button
                onClick={() => setSeriesStatusFilter('Returning Series')}
                className={`w-full text-left px-3 py-2 rounded-lg transition-all mb-1 text-sm ${
                  seriesStatusFilter === 'Returning Series'
                    ? 'bg-emerald-500 text-white shadow-md'
                    : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/80'
                }`}
              >
                🟢 En emisión
              </button>
              <button
                onClick={() => setSeriesStatusFilter('Canceled')}
                className={`w-full text-left px-3 py-2 rounded-lg transition-all mb-1 text-sm ${
                  seriesStatusFilter === 'Canceled'
                    ? 'bg-emerald-500 text-white shadow-md'
                    : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/80'
                }`}
              >
                🟡 Canceladas
              </button>
            </div>

            {/* Estadísticas */}
            <div className="mt-4 p-3 bg-slate-800/50 rounded-xl">
              <div className="text-xs text-slate-500 mb-2">Biblioteca</div>
              <div className="text-2xl font-bold text-emerald-400">{series.length}</div>
              <div className="text-xs text-slate-400">series disponibles</div>
            </div>
          </div>
        ) : showDecades ? (
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
        {viewMode === 'movies' ? (
          /* ========== VISTA DE PELÍCULAS ========== */
          <>
            {/* ===== CONTINUAR VIENDO ===== */}
            {continueWatching.length > 0 && !selectedGenre && !selectedCollection && !selectedLetter && !searchQuery && (
              <section className="mb-8">
                <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                  <Play size={20} className="text-amber-400" />
                  Continuar viendo
                </h3>
                <div className="flex gap-4 overflow-x-auto pb-3 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                  {continueWatching.map(video => (
                    <div
                      key={video.filename}
                      onClick={() => handlePlayClick(video)}
                      className="flex-shrink-0 w-36 md:w-40 cursor-pointer group transition-transform duration-200 hover:-translate-y-1"
                    >
                      <div className="aspect-[3/4] rounded-2xl bg-slate-800 border border-slate-700 shadow-lg relative overflow-hidden">
                        {video.poster ? (
                          <img
                            src={video.poster}
                            alt={video.title || video.filename}
                            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                        ) : (
                          <div className="absolute inset-0 bg-gradient-to-br from-indigo-900 to-purple-900 flex items-center justify-center">
                            <span className="text-3xl">🎬</span>
                          </div>
                        )}
                        {/* Overlay con play */}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                          <Play size={32} className="text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" fill="white" />
                        </div>
                        {/* Barra de progreso */}
                        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/60">
                          <div
                            className="h-full bg-amber-400 rounded-r-full"
                            style={{ width: `${video._progress}%` }}
                          />
                        </div>
                      </div>
                      <p className="text-xs text-slate-300 mt-2 truncate text-center" title={video.title || video.filename}>
                        {video.title || video.filename?.replace(/\.[^.]+$/, '')}
                      </p>
                      <p className="text-[10px] text-slate-500 text-center">
                        {video._progress}% · {Math.floor(video._currentTime / 60)}:{String(Math.floor(video._currentTime % 60)).padStart(2, '0')}
                        /{Math.floor(video._duration / 60)}:{String(Math.floor(video._duration % 60)).padStart(2, '0')}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ===== RECOMENDADAS PARA TI ===== */}
            {!selectedGenre && !selectedCollection && !selectedLetter && !searchQuery && (
              <RecommendationsSection recommendations={aiRecommendations} onPlay={handlePlayClick} />
            )}

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
                        className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
                        loading={idx < 10 ? "eager" : "lazy"}
                        decoding="async"
                        style={{ opacity: 0 }}
                        onLoad={(e) => { e.target.style.opacity = '1'; }}
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
                    {/* Botón Favorito en esquina superior izquierda */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(video.filename);
                      }}
                      className={`absolute top-3 left-3 p-2 rounded-full shadow-lg transition-all z-20 hover:scale-110 ${
                        favorites.has(video.filename)
                          ? 'bg-pink-600 text-white opacity-100'
                          : 'bg-black/40 text-white opacity-0 group-hover:opacity-70 hover:!opacity-100'
                      }`}
                      title={favorites.has(video.filename) ? 'Quitar de favoritos' : 'Añadir a favoritos'}
                    >
                      <Heart size={16} fill={favorites.has(video.filename) ? "white" : "none"} />
                    </button>
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
                  Mostrando {displayedVideos.length} de {filteredVideos.length}
                </span>
              </div>
            )}
          </>
        )}
          </>
        ) : (
          /* ========== VISTA DE SERIES ========== */
          <>
            <h2 className="text-3xl font-bold text-white mb-8 flex items-center gap-3">
              <span className="text-emerald-400">📺</span>
              {selectedSeriesGenre
                ? seriesGenres.find(g => g.id === selectedSeriesGenre)?.name
                : seriesSearchQuery
                  ? 'Resultados de búsqueda'
                  : 'Mis Series'
              }
              <span className="text-sm font-normal text-slate-500">({filteredSeries.length})</span>
            </h2>

            {loadingSeries ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-8 animate-pulse">
                {[1,2,3,4,5].map(i => <div key={i} className="w-full aspect-[2/3] bg-slate-800 rounded-[2.5rem]" />)}
              </div>
            ) : filteredSeries.length === 0 ? (
              <div className="text-center py-20">
                <div className="text-slate-300 text-6xl mb-4">📺</div>
                <p className="text-slate-400 text-lg">No se encontraron series</p>
                <p className="text-slate-300 text-sm mt-2">
                  {series.length === 0
                    ? 'Crea una carpeta "Series" en tu almacenamiento y añade series'
                    : 'Intenta con otro filtro o búsqueda'
                  }
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-8">
                {filteredSeries.map((serie, idx) => (
                  <div
                    key={serie.folder_name}
                    onClick={() => selectSeries(serie)}
                    onContextMenu={(e) => handleSeriesContextMenu(e, serie)}
                    className="cursor-pointer group transition-transform duration-200 hover:-translate-y-2"
                    title="Clic derecho para cambiar caratula"
                  >
                    <div className={`aspect-[2/3] rounded-[2.5rem] ${
                      !serie.poster
                        ? `bg-gradient-to-br ${idx % 2 === 0 ? 'from-emerald-900 to-teal-900' : 'from-slate-800 to-slate-700'}`
                        : 'bg-slate-800'
                    } border border-emerald-700/30 shadow-lg flex items-center justify-center relative overflow-hidden`}>
                      {serie.poster ? (
                        <img
                          src={serie.poster}
                          alt={serie.title || serie.folder_name}
                          className="absolute inset-0 w-full h-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <span className="text-6xl">📺</span>
                      )}
                      <Play className="text-white opacity-0 group-hover:opacity-100 transition-opacity scale-150 z-10 drop-shadow-lg" fill="white" />
                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity" />

                      {/* Badge de temporadas */}
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-emerald-400 font-medium">
                            {serie.number_of_seasons || '?'} temp.
                          </span>
                          {serie.status === 'Ended' && <span className="text-red-400">🔴</span>}
                          {serie.status === 'Returning Series' && <span className="text-green-400">🟢</span>}
                        </div>
                        {/* Barra de progreso */}
                        {serie.progress_percent > 0 && (
                          <div className="mt-2 h-1 bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full"
                              style={{ width: `${serie.progress_percent}%` }}
                            />
                          </div>
                        )}
                      </div>

                      {/* Sinopsis en hover */}
                      {serie.overview && (
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-black/40 opacity-0 group-hover:opacity-100 transition-all duration-300 p-4 flex flex-col justify-end z-10 pointer-events-none">
                          <div className="overflow-y-auto max-h-[70%] overscroll-contain scrollbar-thin scrollbar-thumb-white/40 scrollbar-track-transparent pointer-events-auto" onWheel={(e) => e.stopPropagation()}>
                            <p className="text-white text-xs leading-relaxed pr-1">{serie.overview}</p>
                          </div>
                        </div>
                      )}
                    </div>
                    <h3 className="mt-4 font-bold text-white truncate px-2">{serie.title || serie.folder_name}</h3>
                    <div className="flex items-center gap-2 px-2 text-sm text-slate-400">
                      {serie.vote_average && (
                        <>
                          <span className="text-yellow-500">⭐</span>
                          <span>{serie.vote_average.toFixed(1)}</span>
                        </>
                      )}
                      {serie.first_air_date && (
                        <>
                          <span>•</span>
                          <span>{serie.first_air_date.split('-')[0]}</span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
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
      <VideoPlayer
        selectedVideo={selectedVideo}
        videoRef={videoRef}
        videos={videos}
        volumeBoost={volumeBoost}
        setVolumeBoost={setVolumeBoost}
        showVolumeBoost={showVolumeBoost}
        setShowVolumeBoost={setShowVolumeBoost}
        allRequests={allRequests}
        existingRequests={existingRequests}
        onTimeUpdate={handleTimeUpdate}
        onVideoLoaded={handleVideoLoaded}
        onClose={closeVideoPlayer}
        onSaveVideoProgress={saveVideoProgress}
        onChangeAudio={(currentVideo) => {
          setSelectedVideo(null);
          setSelectedAudioTrack(currentVideo.audioTrack || 0);
          setAudioSelectionModal({ video: currentVideo, tracks: currentVideo.availableTracks, loading: false });
        }}
        onPlayClick={handlePlayClick}
        onAddRecommendationToRequests={addRecommendationToRequests}
        casting={casting}
        onCastClick={() => setShowCastModal(true)}
        onActorClick={(actor) => {
          closeVideoPlayer();
          setActorSearchResult(null);
          setActorSearchQuery(actor.name);
          openRequestsModal();
        }}
      />

      {/* Aleatorio inteligente */}
      <RandomPickerModal
        show={showRandomModal}
        onClose={() => setShowRandomModal(false)}
        videos={filteredVideos}
        favorites={favorites}
        allProgress={getAllVideoProgress()}
        onPlay={handlePlayClick}
      />

      {/* Cast a TV (DLNA) */}
      <CastDeviceModal
        show={showCastModal}
        onClose={() => setShowCastModal(false)}
        devices={castDevices}
        scanning={castScanning}
        casting={casting}
        activeDevice={castActiveDevice}
        castStatus={castStatus}
        onScan={castScanDevices}
        onCast={handleCastToDevice}
        onPause={pauseCast}
        onResume={resumeCast}
        onStop={stopCast}
        onSeek={seekCast}
        onVolume={setCastVolume}
        videoTitle={selectedVideo?.title}
      />

      {/* Menú Contextual */}
      <ContextMenu
        contextMenu={contextMenu}
        onPosterSearch={openPosterSearch}
        onConvert={startConversion}
        onDelete={confirmDelete}
        isConvertible={isConvertible(contextMenu?.video?.filename)}
      />

      {/* Modal Confirmación de Borrado */}
      <DeleteConfirmModal
        deleteConfirm={deleteConfirm}
        deleting={deleting}
        onDelete={deleteFile}
        onCancel={() => setDeleteConfirm(null)}
      />

      {/* Modal Progreso de Conversión */}
      <ConversionProgressModal
        conversionProgress={conversionProgress}
        onClose={() => setConversionProgress(null)}
      />

      {/* Modal Selección de Audio */}
      <AudioSelectionModal
        audioSelectionModal={audioSelectionModal}
        selectedAudioTrack={selectedAudioTrack}
        onSelectTrack={setSelectedAudioTrack}
        onPlay={playWithSelectedAudio}
        onCancel={() => setAudioSelectionModal(null)}
      />

      {/* Modal Búsqueda de Carátula */}
      <PosterSearchModal
        posterSearchModal={posterSearchModal}
        posterSearchQuery={posterSearchQuery}
        posterSearchResults={posterSearchResults}
        posterSearchLoading={posterSearchLoading}
        onQueryChange={setPosterSearchQuery}
        onSearch={searchPosters}
        onSelect={selectPoster}
        onClose={() => setPosterSearchModal(null)}
      />

      {/* Modal Búsqueda de Carátula de Serie */}
      <PosterSearchModal
        posterSearchModal={seriesPosterSearchModal}
        posterSearchQuery={seriesPosterSearchQuery}
        posterSearchResults={seriesPosterSearchResults}
        posterSearchLoading={seriesPosterSearchLoading}
        onQueryChange={setSeriesPosterSearchQuery}
        onSearch={searchSeriesPosters}
        onSelect={selectSeriesPoster}
        onClose={() => setSeriesPosterSearchModal(null)}
        mode="series"
      />

      <RequestFormModal
        requestsModal={requestsModal}
        requestSearchQuery={requestSearchQuery}
        requestSearchResults={requestSearchResults}
        requestSearchLoading={requestSearchLoading}
        actorSearchQuery={actorSearchQuery}
        actorSearchResult={actorSearchResult}
        actorSearchLoading={actorSearchLoading}
        selectedRequests={selectedRequests}
        submittingRequests={submittingRequests}
        onSearchQueryChange={setRequestSearchQuery}
        onActorQueryChange={setActorSearchQuery}
        onSearch={handleRequestSearch}
        onActorSearch={handleActorSearch}
        onToggleSelection={toggleRequestSelection}
        onClearSelection={() => setSelectedRequests([])}
        onSubmit={submitRequests}
        onClose={closeRequestsModal}
        onClearActorSearch={() => { setActorSearchResult(null); setActorSearchQuery(''); }}
        onSetDetailMovie={setRequestDetailMovie}
        isMovieRequested={isMovieRequested}
        isMovieInCatalog={isMovieInCatalog}
      />

      <RequestDetailModal
        requestDetailMovie={requestDetailMovie}
        selectedRequests={selectedRequests}
        onToggleSelection={toggleRequestSelection}
        onClose={() => setRequestDetailMovie(null)}
        isMovieRequested={isMovieRequested}
        isMovieInCatalog={isMovieInCatalog}
      />

      <RequestsAdminModal
        requestsAdminModal={requestsAdminModal}
        allRequests={allRequests}
        requestsStats={requestsStats}
        requestsFilter={requestsFilter}
        requestsReadonly={requestsReadonly}
        onFilterChange={setRequestsFilter}
        onUpdateStatus={updateRequestStatus}
        onDelete={deleteRequest}
        onSearchTorrents={searchTodoTorrents}
        onClose={() => setRequestsAdminModal(false)}
      />

      <SeriesDetailModal
        selectedSeries={selectedSeries}
        selectedSeason={selectedSeason}
        seasonEpisodes={seasonEpisodes}
        loadingEpisodes={loadingEpisodes}
        onSelectSeason={setSelectedSeason}
        onPlayEpisode={(ep) => {
          setSelectedEpisode({
            ...ep,
            series: selectedSeries,
            season: selectedSeason,
            url: `/stream-series/${encodeURIComponent(selectedSeries.folder_name)}/${encodeURIComponent(ep.filename)}`
          });
        }}
        onMarkWatched={markEpisodeWatched}
        onRenameEpisodes={() => setRenameEpisodesModal(selectedSeries)}
        onClose={closeSeriesDetail}
      />

      <EpisodePlayerModal
        selectedEpisode={selectedEpisode}
        onMarkWatched={markEpisodeWatched}
        onClose={() => setSelectedEpisode(null)}
      />

      {/* Modal Renombrar Episodios */}
      {renameEpisodesModal && (
        <RenameEpisodesModal
          series={renameEpisodesModal}
          onClose={() => setRenameEpisodesModal(null)}
          onRenamed={() => {
            // Recargar episodios de la temporada actual
            if (selectedSeries?.tmdb_id && selectedSeason) {
              // Forzar recarga cerrando el modal
            }
          }}
        />
      )}

      <SettingsModal
        settingsModal={settingsModal}
        storageMode={storageMode}
        storagePath={storagePath}
        changingMode={changingMode}
        clearingCache={clearingCache}
        cacheProgress={cacheProgress}
        generatingCollections={generatingCollections}
        onStorageModeChange={handleStorageModeChange}
        onBrowseLocalFolder={handleBrowseLocalFolder}
        onApplyLocalPath={async () => {
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
        onStoragePathChange={setStoragePath}
        onClearCache={handleClearCacheAndReload}
        onCleanupOrphans={async () => {
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
        onRegenerateSagas={generateCollections}
        onClose={() => setSettingsModal(false)}
      />
    </div>
  );
}
