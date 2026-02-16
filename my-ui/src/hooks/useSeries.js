import { useState, useEffect, useMemo, useRef } from 'react';
import { API_BASE } from '../constants';
import { authFetch } from '../utils/api';

export function useSeries({ authState }) {
  const [viewMode, setViewMode] = useState('movies');
  const [series, setSeries] = useState([]);
  const [seriesGenres, setSeriesGenres] = useState([]);
  const [selectedSeriesGenre, setSelectedSeriesGenre] = useState(null);
  const [seriesStatusFilter, setSeriesStatusFilter] = useState(null);
  const [loadingSeries, setLoadingSeries] = useState(false);
  const [selectedSeries, setSelectedSeries] = useState(null);
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [seasonEpisodes, setSeasonEpisodes] = useState(null);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [selectedEpisode, setSelectedEpisode] = useState(null);
  const [seriesSearchQuery, setSeriesSearchQuery] = useState('');
  const seriesEnrichmentDone = useRef(false);

  // Cargar lista de series
  const loadSeries = async () => {
    if (authState.checking || authState.requiresLogin) return;

    setLoadingSeries(true);
    try {
      const res = await authFetch(`${API_BASE}/api/series`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setSeries(data);
        console.log(`📺 Series cargadas: ${data.length}`);

        const needsEnrichment = data.filter(s => s.needs_enrichment).map(s => s.folder_name);
        if (needsEnrichment.length > 0 && !seriesEnrichmentDone.current) {
          seriesEnrichmentDone.current = true;
          console.log(`📺 Enriqueciendo ${needsEnrichment.length} series...`);
          authFetch(`${API_BASE}/api/series/enrich`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folders: needsEnrichment })
          }).then(res => res.json()).then(result => {
            if (result.success) {
              loadSeries();
            }
          }).catch(err => console.error('Error enriqueciendo series:', err));
        }
      }
    } catch (error) {
      console.error('Error cargando series:', error);
    } finally {
      setLoadingSeries(false);
    }
  };

  // Cargar géneros de series
  useEffect(() => {
    if (authState.checking || authState.requiresLogin) return;

    authFetch(`${API_BASE}/api/series/genres`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setSeriesGenres(data);
        }
      })
      .catch(error => console.error('Error cargando géneros de series:', error));
  }, [authState.checking, authState.requiresLogin]);

  // Cargar series cuando cambiamos a la vista de series
  useEffect(() => {
    if (viewMode === 'series' && series.length === 0 && !loadingSeries) {
      loadSeries();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  // Cargar episodios de una temporada
  const loadSeasonEpisodes = async (tmdbId, seasonNumber) => {
    setLoadingEpisodes(true);
    try {
      const res = await authFetch(`${API_BASE}/api/series/${tmdbId}/season/${seasonNumber}`);
      const data = await res.json();
      setSeasonEpisodes(data);
    } catch (error) {
      console.error('Error cargando episodios:', error);
      setSeasonEpisodes(null);
    } finally {
      setLoadingEpisodes(false);
    }
  };

  // Seleccionar una serie y cargar sus detalles
  const selectSeries = async (serie) => {
    if (serie.seasons_info && serie.seasons_info.length > 0) {
      setSelectedSeries(serie);
      setSelectedSeason(serie.seasons_info[0]?.season_number || 1);
      return;
    }

    if (serie.tmdb_id) {
      try {
        const res = await authFetch(`${API_BASE}/api/series/${serie.tmdb_id}`);
        const data = await res.json();
        if (data.seasons_info) {
          setSelectedSeries({ ...serie, ...data });
          setSelectedSeason(data.seasons_info[0]?.season_number || 1);
        } else {
          const numSeasons = serie.number_of_seasons || 1;
          const basicSeasons = Array.from({ length: numSeasons }, (_, i) => ({
            season_number: i + 1,
            episode_count: '?'
          }));
          setSelectedSeries({ ...serie, seasons_info: basicSeasons });
          setSelectedSeason(1);
        }
      } catch (error) {
        console.error('Error cargando detalles de serie:', error);
        setSelectedSeries(serie);
        setSelectedSeason(1);
      }
    } else {
      setSelectedSeries({ ...serie, seasons_info: [{ season_number: 1, episode_count: '?' }] });
      setSelectedSeason(1);
    }
  };

  // Cargar episodios directamente del filesystem
  const loadSeasonEpisodesFromFiles = async (folderName, seasonNumber) => {
    setLoadingEpisodes(true);
    try {
      const res = await authFetch(`${API_BASE}/api/series/folder/${encodeURIComponent(folderName)}/season/${seasonNumber}`);
      const data = await res.json();
      setSeasonEpisodes(data);
    } catch (error) {
      console.error('Error cargando episodios del filesystem:', error);
      setSeasonEpisodes(null);
    } finally {
      setLoadingEpisodes(false);
    }
  };

  // Cuando se selecciona una serie o cambia la temporada
  useEffect(() => {
    if (selectedSeries && selectedSeason) {
      if (selectedSeries.tmdb_id) {
        loadSeasonEpisodes(selectedSeries.tmdb_id, selectedSeason);
      } else {
        loadSeasonEpisodesFromFiles(selectedSeries.folder_name, selectedSeason);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSeries, selectedSeason]);

  // Marcar episodio como visto
  const markEpisodeWatched = async (tmdbId, season, episode, watched) => {
    try {
      const res = await authFetch(`${API_BASE}/api/series/${tmdbId}/episode/${season}/${episode}/watched`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ watched })
      });
      const data = await res.json();
      if (data.success) {
        setSeasonEpisodes(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            episodes: prev.episodes.map(ep =>
              ep.episode_number === episode ? { ...ep, watched, watched_at: watched ? Date.now() : null } : ep
            )
          };
        });
        loadSeries();
      }
    } catch (error) {
      console.error('Error marcando episodio:', error);
    }
  };

  // Filtrar series
  const filteredSeries = useMemo(() => {
    let result = [...series];

    if (seriesSearchQuery) {
      const query = seriesSearchQuery.toLowerCase();
      result = result.filter(s =>
        (s.title || s.folder_name).toLowerCase().includes(query)
      );
    }

    if (selectedSeriesGenre) {
      result = result.filter(s =>
        s.genre_ids && s.genre_ids.includes(selectedSeriesGenre)
      );
    }

    if (seriesStatusFilter) {
      result = result.filter(s => s.status === seriesStatusFilter);
    }

    return result;
  }, [series, seriesSearchQuery, selectedSeriesGenre, seriesStatusFilter]);

  // Cerrar detalle de serie
  const closeSeriesDetail = () => {
    setSelectedSeries(null);
    setSeasonEpisodes(null);
    setSelectedEpisode(null);
  };

  return {
    // State
    viewMode, series, seriesGenres, selectedSeriesGenre, seriesStatusFilter,
    loadingSeries, selectedSeries, selectedSeason, seasonEpisodes,
    loadingEpisodes, selectedEpisode, seriesSearchQuery, filteredSeries,
    // Setters
    setViewMode, setSeries, setSelectedSeriesGenre, setSeriesStatusFilter,
    setSelectedSeason, setSelectedEpisode, setSeriesSearchQuery,
    // Functions
    loadSeries, selectSeries, markEpisodeWatched, closeSeriesDetail
  };
}
