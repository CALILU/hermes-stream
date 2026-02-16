import React from 'react';
import { Play, Sparkles } from 'lucide-react';

/**
 * Seccion horizontal "Recomendadas para ti"
 * Muestra peliculas con razon personalizada debajo de cada poster.
 */
export default function RecommendationsSection({ recommendations, onPlay }) {
  if (!recommendations || recommendations.length === 0) return null;

  return (
    <section className="mb-8">
      <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
        <Sparkles size={20} className="text-purple-400" />
        Recomendadas para ti
      </h3>
      <div className="flex gap-4 overflow-x-auto pb-3 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
        {recommendations.map(video => (
          <div
            key={video.filename}
            onClick={() => onPlay(video)}
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
                <div className="absolute inset-0 bg-gradient-to-br from-purple-900 to-indigo-900 flex items-center justify-center">
                  <span className="text-3xl">🎬</span>
                </div>
              )}
              {/* Overlay play */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                <Play size={32} className="text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" fill="white" />
              </div>
              {/* Rating badge */}
              {video.rating && (
                <div className="absolute top-2 right-2 bg-black/70 text-amber-400 text-[10px] font-bold px-1.5 py-0.5 rounded-md">
                  {video.rating.toFixed(1)}
                </div>
              )}
            </div>
            <p className="text-xs text-slate-300 mt-2 truncate text-center" title={video.title || video.filename}>
              {video.title || video.filename?.replace(/\.[^.]+$/, '')}
            </p>
            <p className="text-[10px] text-purple-400 text-center truncate" title={video._reason}>
              {video._reason}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
