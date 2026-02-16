import { useRef } from 'react';

export function useVideoProgress() {
  const videoRef = useRef(null);
  const lastSaveTimeRef = useRef(0);

  // Guardar progreso de reproduccion
  const saveVideoProgress = (filename, currentTime, duration) => {
    if (!filename || !currentTime || !duration) return;

    const progress = currentTime / duration;
    if (currentTime < 30 || progress > 0.95) {
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

    const saved = getVideoProgress(selectedVideo.filename);
    if (saved && saved.currentTime > 30) {
      video.currentTime = saved.currentTime;
      console.log(`\u{25B6}\u{FE0F} Continuando desde ${Math.floor(saved.currentTime / 60)}:${String(Math.floor(saved.currentTime % 60)).padStart(2, '0')} (${saved.progress}%)`);
    }
  };

  // Guardar progreso al cerrar el reproductor
  const closeVideoPlayer = (selectedVideo, setSelectedVideo) => {
    const video = videoRef.current;
    if (video && selectedVideo) {
      saveVideoProgress(selectedVideo.filename, video.currentTime, video.duration);
    }
    setSelectedVideo(null);
  };

  // Obtener todos los progresos guardados (para "Continuar viendo")
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

  return {
    videoRef,
    saveVideoProgress,
    getVideoProgress,
    getAllVideoProgress,
    handleTimeUpdate,
    handleVideoLoaded,
    closeVideoPlayer
  };
}
