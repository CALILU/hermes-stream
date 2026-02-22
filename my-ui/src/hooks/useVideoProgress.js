import { useRef } from 'react';
import { API_BASE } from '../constants';
import { authFetch } from '../utils/api';

export function useVideoProgress() {
  const videoRef = useRef(null);
  const lastSaveTimeRef = useRef(0);

  // Guardar progreso de reproduccion (localStorage + servidor)
  const saveVideoProgress = (filename, currentTime, duration) => {
    if (!filename || !currentTime || !duration) return;

    const progress = currentTime / duration;
    if (currentTime < 30 || progress > 0.95) {
      if (progress > 0.95) {
        localStorage.removeItem(`video_progress_${filename}`);
        // Notificar al servidor que se completo el video
        authFetch(`${API_BASE}/api/progress`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoPath: filename, position: currentTime, duration })
        }).catch(() => {});
      }
      return;
    }

    // Guardar en localStorage (inmediato, cache offline)
    const data = {
      currentTime,
      duration,
      savedAt: Date.now(),
      progress: Math.round(progress * 100)
    };
    localStorage.setItem(`video_progress_${filename}`, JSON.stringify(data));

    // Guardar en servidor (fire-and-forget)
    authFetch(`${API_BASE}/api/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoPath: filename, position: currentTime, duration })
    }).catch(() => {});
  };

  // Recuperar progreso guardado (localStorage, sincrono)
  const getVideoProgress = (filename) => {
    if (!filename) return null;

    try {
      const saved = localStorage.getItem(`video_progress_${filename}`);
      if (!saved) return null;

      const data = JSON.parse(saved);
      if (Date.now() - data.savedAt > 30 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem(`video_progress_${filename}`);
        return null;
      }

      return data;
    } catch {
      return null;
    }
  };

  // Manejar actualizacion de tiempo del video
  const handleTimeUpdate = (selectedVideo) => {
    const video = videoRef.current;
    if (!video || !selectedVideo) return;

    const now = Date.now();
    if (now - lastSaveTimeRef.current < 10000) return;
    lastSaveTimeRef.current = now;

    saveVideoProgress(selectedVideo.filename, video.currentTime, video.duration);
  };

  // Restaurar posicion al cargar el video
  const handleVideoLoaded = (selectedVideo) => {
    const video = videoRef.current;
    if (!video || !selectedVideo) return;

    // Primero: localStorage (inmediato)
    const saved = getVideoProgress(selectedVideo.filename);
    if (saved && saved.currentTime > 30) {
      video.currentTime = saved.currentTime;
      console.log(`\u{25B6}\u{FE0F} Continuando desde ${Math.floor(saved.currentTime / 60)}:${String(Math.floor(saved.currentTime % 60)).padStart(2, '0')} (${saved.progress}%)`);
    }

    // Luego: servidor (asincrono, puede sobreescribir)
    authFetch(`${API_BASE}/api/progress/${encodeURIComponent(selectedVideo.filename)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && data.position_seconds > 30) {
          const serverTime = data.position_seconds;
          // Solo actualizar si la diferencia es significativa (>5s)
          if (Math.abs(video.currentTime - serverTime) > 5) {
            video.currentTime = serverTime;
            console.log(`\u{25B6}\u{FE0F} Servidor: continuando desde ${Math.floor(serverTime / 60)}:${String(Math.floor(serverTime % 60)).padStart(2, '0')}`);
          }
        }
      })
      .catch(() => {}); // Fallo silencioso
  };

  // Guardar progreso al cerrar el reproductor
  const closeVideoPlayer = (selectedVideo, setSelectedVideo) => {
    const video = videoRef.current;
    if (video && selectedVideo) {
      saveVideoProgress(selectedVideo.filename, video.currentTime, video.duration);
    }
    setSelectedVideo(null);
  };

  // Obtener todos los progresos guardados de localStorage (sincrono, para "Continuar viendo")
  const getAllVideoProgress = () => {
    const result = {};
    const now = Date.now();
    const maxAge = 30 * 24 * 60 * 60 * 1000;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key.startsWith('video_progress_')) continue;
      try {
        const data = JSON.parse(localStorage.getItem(key));
        if (now - data.savedAt > maxAge) {
          localStorage.removeItem(key);
          continue;
        }
        const filename = key.replace('video_progress_', '');
        result[filename] = data;
      } catch { /* ignore */ }
    }
    return result;
  };

  // Obtener progresos desde el servidor (asincrono)
  const fetchServerProgress = async () => {
    try {
      const res = await authFetch(`${API_BASE}/api/progress`);
      if (!res.ok) return [];
      const data = await res.json();
      return data; // Array de { video_path, position_seconds, duration_seconds, ... }
    } catch {
      return [];
    }
  };

  return {
    videoRef,
    saveVideoProgress,
    getVideoProgress,
    getAllVideoProgress,
    fetchServerProgress,
    handleTimeUpdate,
    handleVideoLoaded,
    closeVideoPlayer
  };
}
