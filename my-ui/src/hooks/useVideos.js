import { useState, useEffect, useMemo, useRef } from 'react';
import { API_BASE, LOAD_MORE_COUNT } from '../constants';
import { authFetch } from '../utils/api';
import { loadCache, saveCache } from '../utils/cache';
import { normalizeText } from '../utils/text';

export function useVideos({ authState, setAuthState }) {
  const [videos, setVideos] = useState([]);
  const [genres, setGenres] = useState([]);
  const [loading, setLoading] = useState(true);
  const enrichmentDone = useRef(false);

  // Filter states
  const [selectedGenre, setSelectedGenre] = useState(null);
  const [selectedLetter, setSelectedLetter] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Collections
  const [collections, setCollections] = useState([]);
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [showCollections, setShowCollections] = useState(false);
  const [generatingCollections, setGeneratingCollections] = useState(false);

  // Decades/years
  const [selectedDecade, setSelectedDecade] = useState(null);
  const [selectedYear, setSelectedYear] = useState(null);
  const [showDecades, setShowDecades] = useState(false);
  const [showRecent, setShowRecent] = useState(false);

  // Favorites
  const [favorites, setFavorites] = useState(() => {
    try {
      const saved = localStorage.getItem('isiprime_favorites');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const [showFavorites, setShowFavorites] = useState(false);

  // Fetch server favorites and merge (runs after mount)
  useEffect(() => {
    if (authState.checking || authState.requiresLogin) return;

    authFetch(`${API_BASE}/api/favorites`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && data.favorites && data.favorites.length > 0) {
          setFavorites(prev => {
            const merged = new Set([...prev, ...data.favorites]);
            try { localStorage.setItem('isiprime_favorites', JSON.stringify([...merged])); } catch {}
            return merged;
          });
        }
      })
      .catch(() => {}); // Silently fail if server unavailable
  }, [authState.checking, authState.requiresLogin]);

  const toggleFavorite = (filename) => {
    setFavorites(prev => {
      const next = new Set(prev);
      const adding = !next.has(filename);
      if (adding) {
        next.add(filename);
        // Sync to server
        authFetch(`${API_BASE}/api/favorites`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoPath: filename })
        }).catch(() => {});
      } else {
        next.delete(filename);
        // Sync to server
        authFetch(`${API_BASE}/api/favorites`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoPath: filename })
        }).catch(() => {});
      }
      try { localStorage.setItem('isiprime_favorites', JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  // Pagination
  const [visibleCount, setVisibleCount] = useState(LOAD_MORE_COUNT);

  // Gallery actor search
  const [galleryActorQuery, setGalleryActorQuery] = useState('');
  const [galleryActorMovieIds, setGalleryActorMovieIds] = useState(null);
  const [galleryActorLoading, setGalleryActorLoading] = useState(false);
  const [galleryActorName, setGalleryActorName] = useState('');

  // Cargar películas
  useEffect(() => {
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
          const cache = loadCache();

          const videosWithAllPosters = data.map(video => {
            if (video.poster) return video;
            const cached = cache[video.filename];
            if (cached && cached.poster) {
              return {
                ...video,
                tmdbId: cached.tmdbId || video.tmdbId,
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

          // Detectar películas nuevas y regenerar sagas
          const currentFilenames = videosWithAllPosters.map(v => v.filename);
          const savedFilenames = JSON.parse(localStorage.getItem('isiprime_filenames') || '[]');
          const newFilenames = currentFilenames.filter(f => !savedFilenames.includes(f));

          if (newFilenames.length > 0 && savedFilenames.length > 0) {
            console.log(`🆕 ${newFilenames.length} películas nuevas detectadas, actualizando sagas...`);
            authFetch(`${API_BASE}/api/collections/generate`, { method: 'POST' })
              .then(res => res.json())
              .then(result => {
                if (result.success) {
                  console.log(`📚 Sagas actualizadas: ${result.totalCollections} colecciones`);
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

  // Cargar géneros
  useEffect(() => {
    if (authState.checking || authState.requiresLogin) return;

    authFetch(`${API_BASE}/api/genres`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setGenres(data);
      })
      .catch(error => console.error('Error cargando géneros:', error));
  }, [authState.checking, authState.requiresLogin]);

  // Cargar colecciones
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
  }, [selectedGenre, authState.checking, authState.requiresLogin]);

  // Generar colecciones
  const generateCollections = async () => {
    setGeneratingCollections(true);
    try {
      const response = await authFetch(`${API_BASE}/api/collections/generate`, { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        console.log(`✅ ${data.message}`);
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

  // Enriquecer películas sin poster
  useEffect(() => {
    const BATCH_SIZE = 30;

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
        .filter(video => !video.poster || !video.tmdbId)
        .map(video => video.filename);

      if (videosToEnrich.length === 0) {
        console.log('✅ Todas las películas ya tienen carátulas y tmdbId');
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

            setVideos(prevVideos => {
              const newVideos = [...prevVideos];

              data.results.forEach(result => {
                if (result.success && result.metadata) {
                  const index = newVideos.findIndex(v => v.filename === result.filename);
                  if (index !== -1) {
                    const metadata = {
                      tmdbId: result.metadata.tmdbId,
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

        if (i + BATCH_SIZE < videosToEnrich.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      saveCache(cache);
      console.log(`💾 Caché guardado: ${Object.keys(cache).length} películas`);
      console.log(`✅ Enriquecimiento completado: ${totalSuccess}/${videosToEnrich.length}`);

      // Recargar colecciones - el enriquecimiento pudo crear/actualizar colecciones en el backend
      if (totalSuccess > 0) {
        try {
          const colsRes = await authFetch(`${API_BASE}/api/collections`);
          const colsData = await colsRes.json();
          if (Array.isArray(colsData)) {
            setCollections(colsData);
            console.log(`📚 Colecciones recargadas tras enriquecimiento: ${colsData.length}`);
          }
        } catch (err) {
          console.error('Error recargando colecciones:', err);
        }
      }
    };

    if (videos.length > 0 && !loading) {
      enrichMovies();
    }
  }, [videos.length, loading]);

  // Búsqueda por actor en galería
  const handleGalleryActorSearch = async () => {
    if (!galleryActorQuery.trim() || galleryActorLoading) return;

    setGalleryActorLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/tmdb/actor?query=${encodeURIComponent(galleryActorQuery)}`);
      const data = await res.json();

      if (data.success && data.actor && data.movies) {
        const movieIds = data.movies.map(m => m.tmdbId);
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

  const clearGalleryActorSearch = () => {
    setGalleryActorQuery('');
    setGalleryActorMovieIds(null);
    setGalleryActorName('');
  };

  // Filtrado combinado
  const filteredVideos = useMemo(() => {
    let result = videos;

    if (searchQuery.trim()) {
      const normalizedQuery = normalizeText(searchQuery);
      result = result.filter(v =>
        normalizeText(v.title).includes(normalizedQuery) ||
        normalizeText(v.filename).includes(normalizedQuery)
      );
    }

    if (selectedCollection) {
      const collection = collections.find(c => c.name === selectedCollection);
      if (collection && collection.movies) {
        const collectionFilenames = collection.movies.map(m => m.filename);
        result = result.filter(v => collectionFilenames.includes(v.filename));
      }
    } else if (selectedGenre) {
      result = result.filter(v =>
        v.genreIds && v.genreIds.includes(selectedGenre)
      );
    }

    if (selectedLetter) {
      result = result.filter(v => {
        const firstChar = normalizeText(v.title.charAt(0)).toUpperCase();
        return firstChar === selectedLetter.toLowerCase() || firstChar === selectedLetter;
      });
    }

    if (selectedDecade) {
      result = result.filter(v => {
        const year = v.releaseDate ? parseInt(v.releaseDate.substring(0, 4)) : null;
        if (!year) return false;
        const decade = Math.floor(year / 10) * 10;
        return decade === selectedDecade;
      });
    }

    if (selectedYear) {
      result = result.filter(v => {
        const year = v.releaseDate ? parseInt(v.releaseDate.substring(0, 4)) : null;
        return year === selectedYear;
      });
    }

    if (galleryActorMovieIds && galleryActorMovieIds.length > 0) {
      result = result.filter(v => v.tmdbId && galleryActorMovieIds.includes(v.tmdbId));
    }

    if (showRecent) {
      result = [...result]
        .filter(v => v.addedDate)
        .sort((a, b) => new Date(b.addedDate) - new Date(a.addedDate));
    }

    if (showFavorites) {
      result = result.filter(v => favorites.has(v.filename));
    }

    return result;
  }, [videos, searchQuery, selectedGenre, selectedLetter, selectedCollection, collections, selectedDecade, selectedYear, galleryActorMovieIds, showRecent, showFavorites, favorites]);

  // Reset pagination when filters change
  useEffect(() => {
    setVisibleCount(50);
  }, [searchQuery, selectedGenre, selectedLetter, selectedCollection, selectedDecade, selectedYear, galleryActorMovieIds, showRecent, showFavorites]);

  // Displayed videos (paginated)
  const displayedVideos = useMemo(() => {
    return filteredVideos.slice(0, visibleCount);
  }, [filteredVideos, visibleCount]);

  const hasMoreVideos = filteredVideos.length > visibleCount;

  // Infinite scroll ref
  const loadMoreRef = useRef(null);

  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element || !hasMoreVideos) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount(prev => prev + LOAD_MORE_COUNT);
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [hasMoreVideos]);

  // Letters with movies
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

  // Decades data
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
    return Array.from(decadesMap.entries())
      .map(([decade, yearsSet]) => ({
        decade,
        years: Array.from(yearsSet).sort((a, b) => b - a),
        count: yearsSet.size
      }))
      .sort((a, b) => b.decade - a.decade);
  }, [videos]);

  return {
    // State
    videos, genres, loading, collections, generatingCollections,
    selectedGenre, selectedLetter, searchQuery,
    selectedCollection, showCollections,
    selectedDecade, selectedYear, showDecades, showRecent,
    favorites, showFavorites,
    galleryActorQuery, galleryActorMovieIds, galleryActorLoading, galleryActorName,
    filteredVideos, displayedVideos, hasMoreVideos, loadMoreRef,
    lettersWithMovies, decadesData,
    // Setters
    setVideos, setGenres, setLoading,
    setSelectedGenre, setSelectedLetter, setSearchQuery,
    setCollections, setSelectedCollection, setShowCollections,
    setSelectedDecade, setSelectedYear, setShowDecades, setShowRecent,
    setShowFavorites,
    setGalleryActorQuery,
    // Refs
    enrichmentDone,
    // Functions
    toggleFavorite,
    generateCollections, handleGalleryActorSearch, clearGalleryActorSearch
  };
}
