import { useState, useCallback } from 'react';
import { API_BASE } from '../constants';
import { authFetch } from '../utils/api';

export function useNewsletter(genres = []) {
  // Helper: convert genreIds to genre names
  const getGenreNames = (genreIds) => {
    if (!Array.isArray(genreIds) || genreIds.length === 0 || genres.length === 0) return '';
    return genreIds
      .map(id => genres.find(g => g.id === id)?.name)
      .filter(Boolean);
  };

  const [newsletterModal, setNewsletterModal] = useState(false);
  const [selectedMovies, setSelectedMovies] = useState([]);
  const [newsletterSubject, setNewsletterSubject] = useState('Nuevas peliculas en IsiPrime');
  const [previewHTML, setPreviewHTML] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sentMovies, setSentMovies] = useState([]);

  const toggleMovie = useCallback((movie) => {
    setSelectedMovies(prev => {
      const exists = prev.find(m => m.filename === movie.filename);
      if (exists) return prev.filter(m => m.filename !== movie.filename);
      return [...prev, movie];
    });
    // Clear preview when selection changes
    setPreviewHTML('');
    setSendResult(null);
  }, []);

  const generatePreview = useCallback(async () => {
    if (selectedMovies.length === 0) return;
    setLoadingPreview(true);
    try {
      const movies = selectedMovies.map(m => ({
        filename: m.filename || '',
        title: m.title || m.filename,
        poster: m.poster || '',
        overview: m.overview || '',
        rating: m.rating || m.vote_average || '',
        year: m.year || '',
        genres: getGenreNames(m.genreIds) || m.genres || ''
      }));
      const res = await authFetch(`${API_BASE}/api/newsletter/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movies, subject: newsletterSubject })
      });
      const data = await res.json();
      if (data.success) {
        setPreviewHTML(data.html);
      }
    } catch (err) {
      console.error('Error generando preview:', err);
    } finally {
      setLoadingPreview(false);
    }
  }, [selectedMovies, newsletterSubject]);

  const sendNewsletter = useCallback(async () => {
    if (selectedMovies.length === 0) return;
    setSending(true);
    setSendResult(null);
    try {
      const movies = selectedMovies.map(m => ({
        filename: m.filename || '',
        title: m.title || m.filename,
        poster: m.poster || '',
        overview: m.overview || '',
        rating: m.rating || m.vote_average || '',
        year: m.year || '',
        genres: getGenreNames(m.genreIds) || m.genres || ''
      }));
      const res = await authFetch(`${API_BASE}/api/newsletter/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movies, subject: newsletterSubject })
      });
      const data = await res.json();
      if (data.success) {
        setSendResult(data.data);
        // Mark sent movies and deselect
        const sentFilenames = selectedMovies.map(m => m.filename);
        setSentMovies(prev => [...new Set([...prev, ...sentFilenames])]);
        setSelectedMovies([]);
        setPreviewHTML('');
      } else {
        setSendResult({ error: data.error });
      }
    } catch (err) {
      setSendResult({ error: 'Error de conexion' });
    } finally {
      setSending(false);
    }
  }, [selectedMovies, newsletterSubject]);

  const sendTest = useCallback(async (testEmail) => {
    if (selectedMovies.length === 0) return;
    setSending(true);
    try {
      const movies = selectedMovies.map(m => ({
        filename: m.filename || '',
        title: m.title || m.filename,
        poster: m.poster || '',
        overview: m.overview || '',
        rating: m.rating || m.vote_average || '',
        year: m.year || '',
        genres: getGenreNames(m.genreIds) || m.genres || ''
      }));
      const res = await authFetch(`${API_BASE}/api/newsletter/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movies, subject: newsletterSubject, testEmail })
      });
      const data = await res.json();
      if (data.success) {
        // Mark sent movies and deselect
        const sentFilenames = selectedMovies.map(m => m.filename);
        setSentMovies(prev => [...new Set([...prev, ...sentFilenames])]);
        setSelectedMovies([]);
        setPreviewHTML('');
      }
      return data;
    } catch (err) {
      return { success: false, error: 'Error de conexion' };
    } finally {
      setSending(false);
    }
  }, [selectedMovies, newsletterSubject]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await authFetch(`${API_BASE}/api/newsletter/history`);
      const data = await res.json();
      if (data.success) setHistory(data.data);
    } catch (err) {
      console.error('Error cargando historial:', err);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  const loadSentMovies = useCallback(async () => {
    try {
      const res = await authFetch(`${API_BASE}/api/newsletter/sent-movies`);
      const data = await res.json();
      if (data.success) setSentMovies(data.data);
    } catch (err) {
      console.error('Error cargando peliculas enviadas:', err);
    }
  }, []);

  const deleteHistory = useCallback(async (id) => {
    try {
      const res = await authFetch(`${API_BASE}/api/newsletter/history/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setHistory(prev => prev.filter(h => h.id !== id));
        loadSentMovies();
      }
    } catch (err) {
      console.error('Error eliminando registro:', err);
    }
  }, [loadSentMovies]);

  const openNewsletter = useCallback(() => {
    setNewsletterModal(true);
    setSelectedMovies([]);
    setPreviewHTML('');
    setSendResult(null);
    setNewsletterSubject('Nuevas peliculas en IsiPrime');
    loadSentMovies();
  }, [loadSentMovies]);

  const closeNewsletter = useCallback(() => {
    setNewsletterModal(false);
    setSelectedMovies([]);
    setPreviewHTML('');
    setSendResult(null);
  }, []);

  return {
    newsletterModal, selectedMovies, newsletterSubject, previewHTML,
    loadingPreview, sending, sendResult, history, loadingHistory, sentMovies,
    setNewsletterSubject,
    toggleMovie, generatePreview, sendNewsletter, sendTest,
    loadHistory, deleteHistory, openNewsletter, closeNewsletter
  };
}
