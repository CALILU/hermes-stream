import { useState, useEffect } from 'react';
import { API_BASE } from '../constants';
import { authFetch } from '../utils/api';

export function useRequests({ authState, videos }) {
  const [requestsModal, setRequestsModal] = useState(false);
  const [requestsAdminModal, setRequestsAdminModal] = useState(false);
  const [requestSearchQuery, setRequestSearchQuery] = useState('');
  const [requestSearchResults, setRequestSearchResults] = useState([]);
  const [requestSearchLoading, setRequestSearchLoading] = useState(false);
  const [selectedRequests, setSelectedRequests] = useState([]);
  const [submittingRequests, setSubmittingRequests] = useState(false);
  const [allRequests, setAllRequests] = useState([]);
  const [existingRequests, setExistingRequests] = useState([]);
  const [actorSearchQuery, setActorSearchQuery] = useState('');
  const [actorSearchResult, setActorSearchResult] = useState(null);
  const [actorSearchLoading, setActorSearchLoading] = useState(false);
  const [requestsStats, setRequestsStats] = useState(null);
  const [requestsReadonly, setRequestsReadonly] = useState(false);
  const [requestsFilter, setRequestsFilter] = useState(null);
  const [requestDetailMovie, setRequestDetailMovie] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [downloadQueueStatus, setDownloadQueueStatus] = useState(null);
  const [pendingShowRequests, setPendingShowRequests] = useState(false);

  // Detectar parámetro showRequests en URL (desde extensión Chrome)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('showRequests') === 'true') {
      setPendingShowRequests(true);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Abrir modal de peticiones cuando los videos estén cargados
  useEffect(() => {
    if (pendingShowRequests && videos.length > 0) {
      setRequestsAdminModal(true);
      setPendingShowRequests(false);
      console.log('📋 Abriendo modal de peticiones (desde extensión Chrome)');
    }
  }, [pendingShowRequests, videos.length]);

  // SSE para actualizaciones de peticiones en tiempo real
  useEffect(() => {
    if (!requestsAdminModal) return;

    const eventSource = new EventSource(`${API_BASE}/api/requests/events`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'update' && data.request) {
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

  // Buscar películas en TMDB para peticiones
  const handleRequestSearch = async () => {
    if (!requestSearchQuery.trim() || requestSearchLoading) return;

    setRequestSearchLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/tmdb/search?query=${encodeURIComponent(requestSearchQuery)}`);
      const data = await res.json();
      console.log('🔍 Respuesta TMDB:', data);

      if (data.results) {
        const movies = data.results.filter(m => m.poster).map(m => ({
          tmdbId: m.tmdbId,
          title: m.title,
          originalTitle: m.originalTitle,
          year: m.year,
          poster: m.poster,
          overview: m.overview,
          rating: m.rating
        }));
        console.log('🎬 Películas procesadas:', movies.length, movies[0]?.poster);
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
        const movies = data.movies.map(m => ({
          tmdbId: m.tmdbId,
          title: m.title,
          originalTitle: m.originalTitle,
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
        setExistingRequests(prev => [
          ...prev,
          ...selectedRequests.map(m => ({ tmdbId: m.tmdbId, title: m.title }))
        ]);
        setSelectedRequests([]);
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

  // Añadir película recomendada directamente a peticiones
  const addRecommendationToRequests = async (rec) => {
    try {
      const requestedBy = authState.user?.username || 'Usuario local';
      const movie = {
        tmdbId: rec.tmdbId,
        title: rec.title,
        year: rec.releaseDate?.split('-')[0] || '',
        poster: rec.poster,
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
        setExistingRequests(prev => [...prev, { tmdbId: rec.tmdbId, title: rec.title }]);
        setAllRequests(prev => [...prev, {
          tmdbId: rec.tmdbId,
          title: rec.title,
          year: rec.releaseDate?.split('-')[0] || '',
          poster: rec.poster,
          status: 'pending',
          requestedBy: authState.user?.username || 'Usuario local'
        }]);
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

  // Cargar todas las peticiones (admin)
  const loadAllRequests = async () => {
    try {
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
        const requestsToUpdate = [];

        for (const request of data.requests) {
          if (request.status === 'pending' || request.status === 'downloading') {
            const inCatalog = videos.some(v => {
              if (request.tmdbId && v.tmdbId) {
                return request.tmdbId === v.tmdbId;
              }
              const requestTitle = request.title?.toLowerCase().trim();
              const videoTitle = v.title?.toLowerCase().trim();
              const requestYear = request.year?.toString();
              const videoYear = v.year?.toString();

              if (requestTitle && videoTitle) {
                if (requestTitle === videoTitle && requestYear === videoYear) return true;
                if (videoTitle.includes(requestTitle) && requestYear === videoYear) return true;
              }
              return false;
            });

            if (inCatalog) {
              requestsToUpdate.push(request.id);
            }
          }
        }

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

      const statsRes = await authFetch(`${API_BASE}/api/requests/stats`);
      const statsData = await statsRes.json();
      setRequestsStats(statsData);
    } catch (error) {
      console.error('Error cargando peticiones:', error);
    }
  };

  // Cargar peticiones cuando se abre el modal de admin
  useEffect(() => {
    if (requestsAdminModal && allRequests.length === 0) {
      loadAllRequests();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestsAdminModal]);

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

  // Eliminar una petición (admin)
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

  // Buscar película en TodoTorrents
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

  // Añadir URL a cola de descargas
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

  // Abrir modal de peticiones
  const openRequestsModal = async () => {
    setRequestsModal(true);
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

  // Verificar si una película ya está en el catálogo
  const isMovieInCatalog = (tmdbId) => {
    if (!videos.length || !tmdbId) {
      console.log(`⚠️ isMovieInCatalog: videos=${videos.length}, tmdbId=${tmdbId}`);
      return false;
    }

    const numericId = Number(tmdbId);
    const found = videos.find(v => Number(v.tmdbId) === numericId);
    if (found) {
      console.log(`✅ EN CATÁLOGO: tmdbId=${numericId} → ${found.filename}`);
    } else {
      const similar = videos.filter(v => v.tmdbId && String(v.tmdbId).includes(String(numericId).substring(0,3)));
      if (similar.length > 0 && similar.length < 5) {
        console.log(`❌ NO en catálogo: tmdbId=${numericId}. Similares:`, similar.map(v => `${v.filename}(${v.tmdbId})`));
      }
    }
    return !!found;
  };

  // Verificar si una película ya fue solicitada
  const isMovieRequested = (tmdbId) => {
    if (!tmdbId) return false;
    const numericId = Number(tmdbId);
    return existingRequests.some(r =>
      Number(r.tmdbId) === numericId && r.status !== 'server'
    );
  };

  // Cerrar modal de peticiones
  const closeRequestsModal = () => {
    setSelectedRequests([]);
    setRequestSearchResults([]);
    setRequestSearchQuery('');
    setActorSearchQuery('');
    setActorSearchResult(null);
    setRequestsModal(false);
  };

  return {
    // State
    requestsModal, requestsAdminModal, requestSearchQuery, requestSearchResults,
    requestSearchLoading, selectedRequests, submittingRequests, allRequests,
    existingRequests, actorSearchQuery, actorSearchResult, actorSearchLoading,
    requestsStats, requestsReadonly, requestsFilter, requestDetailMovie,
    downloadUrl, downloadQueueStatus,
    // Setters
    setRequestSearchQuery, setActorSearchQuery, setActorSearchResult,
    setSelectedRequests, setRequestsFilter, setRequestDetailMovie,
    setRequestsAdminModal, setAllRequests, setDownloadUrl,
    // Functions
    handleRequestSearch, handleActorSearch, toggleRequestSelection,
    submitRequests, addRecommendationToRequests, loadAllRequests,
    updateRequestStatus, deleteRequest, searchTodoTorrents,
    addToDownloadQueue, openRequestsAdmin, openRequestsModal,
    closeRequestsModal, isMovieInCatalog, isMovieRequested
  };
}
