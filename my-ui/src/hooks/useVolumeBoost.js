import { useState, useEffect, useRef } from 'react';

export function useVolumeBoost(videoRef, selectedVideo) {
  const [volumeBoost, setVolumeBoost] = useState(100);
  const [showVolumeBoost, setShowVolumeBoost] = useState(false);
  const audioContextRef = useRef(null);
  const gainNodeRef = useRef(null);
  const sourceNodeRef = useRef(null);

  // Configurar Web Audio API para amplificacion de volumen
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selectedVideo) return;

    const setupAudioBoost = () => {
      if (!audioContextRef.current) {
        try {
          audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
          sourceNodeRef.current = audioContextRef.current.createMediaElementSource(video);
          gainNodeRef.current = audioContextRef.current.createGain();

          sourceNodeRef.current.connect(gainNodeRef.current);
          gainNodeRef.current.connect(audioContextRef.current.destination);

          console.log('\u{1F50A} Audio boost configurado');
        } catch (error) {
          console.error('Error configurando audio boost:', error);
        }
      }
    };

    video.addEventListener('play', setupAudioBoost, { once: true });

    return () => {
      video.removeEventListener('play', setupAudioBoost);
    };
  }, [selectedVideo, videoRef]);

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
    }
  }, [selectedVideo]);

  return {
    volumeBoost, setVolumeBoost,
    showVolumeBoost, setShowVolumeBoost
  };
}
