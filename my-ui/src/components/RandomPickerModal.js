import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Play, RefreshCw, Star } from 'lucide-react';

/**
 * Seleccion aleatoria ponderada:
 * - rating >= 7: +0.5 peso, >= 8: +1.0
 * - No visto (sin progreso): +1.0
 * - No favorito: +0.3
 */
function weightedRandom(videos, favorites, allProgress, excludeFilename) {
  let pool = videos;
  if (excludeFilename && pool.length > 1) {
    pool = pool.filter(v => v.filename !== excludeFilename);
  }
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0];

  const weights = pool.map(v => {
    let w = 1.0;
    const r = v.rating || 0;
    if (r >= 7) w += 0.5;
    if (r >= 8) w += 0.5;
    if (!allProgress[v.filename]) w += 1.0;
    if (!favorites.has(v.filename)) w += 0.3;
    return w;
  });

  const total = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export default function RandomPickerModal({
  show,
  onClose,
  videos,
  favorites,
  allProgress,
  onPlay
}) {
  const [phase, setPhase] = useState('idle'); // idle | spinning | result
  const [result, setResult] = useState(null);
  const [spinPosters, setSpinPosters] = useState([]);
  const spinInterval = useRef(null);
  const lastResult = useRef(null);

  const startPick = useCallback(() => {
    if (!videos || videos.length === 0) return;

    setPhase('spinning');
    setResult(null);

    // Posters aleatorios para la animacion
    let speed = 100;
    let count = 0;
    const maxSpins = 20;

    const tick = () => {
      const idx = Math.floor(Math.random() * videos.length);
      setSpinPosters([videos[idx]]);
      count++;

      if (count >= maxSpins) {
        clearTimeout(spinInterval.current);
        const pick = weightedRandom(videos, favorites, allProgress, lastResult.current);
        lastResult.current = pick?.filename;
        setResult(pick);
        setPhase('result');
        return;
      }

      // Desacelerar progresivamente
      speed = 100 + (count / maxSpins) * 300;
      spinInterval.current = setTimeout(tick, speed);
    };

    spinInterval.current = setTimeout(tick, speed);
  }, [videos, favorites, allProgress]);

  // Auto-start al abrir
  useEffect(() => {
    if (show && videos && videos.length > 0) {
      startPick();
    }
    if (!show) {
      setPhase('idle');
      setResult(null);
      clearTimeout(spinInterval.current);
    }
    return () => clearTimeout(spinInterval.current);
  }, [show]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!show) return null;

  const displayed = phase === 'result' ? result : spinPosters[0];
  const year = result?.releaseDate ? result.releaseDate.substring(0, 4) : null;
  const hours = result?.runtime ? Math.floor(result.runtime / 60) : null;
  const mins = result?.runtime ? result.runtime % 60 : null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="bg-slate-800 rounded-2xl w-full max-w-sm mx-4 shadow-2xl border border-slate-700 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
          <h3 className="text-white font-bold text-lg">Sorprendeme</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 flex flex-col items-center">
          {/* Poster */}
          <div className={`w-48 aspect-[3/4] rounded-xl overflow-hidden shadow-lg border-2 transition-all duration-500 ${
            phase === 'result' ? 'border-amber-400 scale-105' : 'border-slate-600'
          }`}>
            {displayed?.poster ? (
              <img
                src={displayed.poster}
                alt=""
                className={`w-full h-full object-cover transition-all duration-300 ${
                  phase === 'spinning' ? 'blur-sm scale-110' : ''
                }`}
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-indigo-900 to-purple-900 flex items-center justify-center">
                <span className="text-5xl">🎬</span>
              </div>
            )}
          </div>

          {/* Spinning indicator */}
          {phase === 'spinning' && (
            <div className="mt-4 flex items-center gap-2 text-slate-400">
              <RefreshCw size={16} className="animate-spin" />
              <span className="text-sm">Eligiendo...</span>
            </div>
          )}

          {/* Result info */}
          {phase === 'result' && result && (
            <div className="mt-4 w-full text-center">
              <h4 className="text-white font-bold text-lg">{result.title}</h4>
              <div className="flex items-center justify-center gap-3 mt-1 text-sm text-slate-400">
                {result.rating && (
                  <span className="flex items-center gap-1 text-amber-400">
                    <Star size={14} fill="currentColor" /> {result.rating.toFixed(1)}
                  </span>
                )}
                {year && <span>{year}</span>}
                {hours !== null && <span>{hours}h {mins}m</span>}
              </div>
              {result.overview && (
                <p className="text-slate-400 text-xs mt-3 leading-relaxed line-clamp-3">
                  {result.overview}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        {phase === 'result' && result && (
          <div className="px-5 pb-5 flex gap-3">
            <button
              onClick={() => { onPlay(result); onClose(); }}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl font-medium hover:from-indigo-600 hover:to-purple-600 transition-all"
            >
              <Play size={18} fill="white" /> Reproducir
            </button>
            <button
              onClick={startPick}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-700 text-slate-200 rounded-xl font-medium hover:bg-slate-600 transition-all"
            >
              <RefreshCw size={16} /> Otra
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
