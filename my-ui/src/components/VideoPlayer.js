import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Volume2 } from 'lucide-react';
import { normalizeText } from '../utils/text';
import { getSessionToken } from '../utils/api';

export default function VideoPlayer({
  selectedVideo, videoRef, videos,
  volumeBoost, setVolumeBoost, showVolumeBoost, setShowVolumeBoost,
  allRequests, existingRequests,
  onTimeUpdate, onVideoLoaded, onClose,
  onSaveVideoProgress, onChangeAudio, onPlayClick,
  onAddRecommendationToRequests, onActorClick
}) {
  return (
    <AnimatePresence>
      {selectedVideo && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/90 backdrop-blur-md p-6 gap-4"
        >
          {/* Panel izquierdo vacío para centrar */}
          <div className="hidden md:block w-44 flex-shrink-0" />

          <motion.div
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            className="bg-slate-900 rounded-[3rem] w-full max-w-5xl overflow-hidden shadow-2xl border border-slate-700"
          >
            <div className="p-6 flex justify-between items-center bg-slate-800 border-b border-slate-700">
              <span className="font-bold text-slate-200">{selectedVideo.title}</span>
              <div className="flex items-center gap-3">
                {/* Botón cambiar audio */}
                {selectedVideo.availableTracks && selectedVideo.availableTracks.length > 1 && (
                  <button
                    onClick={() => {
                      const video = videoRef.current;
                      if (video && selectedVideo) {
                        onSaveVideoProgress(selectedVideo.filename, video.currentTime, video.duration);
                      }
                      onChangeAudio(selectedVideo);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-100 text-indigo-600 rounded-xl hover:bg-indigo-200 transition-colors"
                    title={`Cambiar idioma (${selectedVideo.availableTracks.length} pistas)`}
                  >
                    <Volume2 size={18} />
                    <span className="text-sm font-medium">Audio ({selectedVideo.availableTracks.length})</span>
                  </button>
                )}
                {/* Botón amplificar volumen */}
                <div className="relative">
                  <button
                    onClick={() => setShowVolumeBoost(!showVolumeBoost)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-colors ${
                      volumeBoost > 100
                        ? 'bg-green-100 text-green-600 hover:bg-green-200'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                    title="Amplificar volumen"
                  >
                    {'🔊'}
                    {volumeBoost > 100 && (
                      <span className="text-xs font-bold">{volumeBoost}%</span>
                    )}
                  </button>
                  {showVolumeBoost && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setShowVolumeBoost(false)}
                      />
                      <div className="absolute top-full right-0 mt-2 bg-slate-900 rounded-xl shadow-xl border border-slate-600 p-4 z-50 w-64">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm font-medium text-slate-200">Amplificar Volumen</span>
                          <span className={`text-sm font-bold ${volumeBoost > 100 ? 'text-green-600' : 'text-slate-500'}`}>
                            {volumeBoost}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="100"
                          max="600"
                          step="10"
                          value={volumeBoost}
                          onChange={(e) => setVolumeBoost(parseInt(e.target.value))}
                          className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-green-500"
                        />
                        <div className="flex justify-between text-xs text-slate-400 mt-1">
                          <span>100%</span>
                          <span>300%</span>
                          <span>600%</span>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-3">
                          {[
                            { label: 'Normal', value: 100, cls: 'bg-slate-700 text-slate-200 hover:bg-slate-600' },
                            { label: '2x', value: 200, cls: 'bg-green-900 text-green-400 hover:bg-green-800' },
                            { label: '3x', value: 300, cls: 'bg-green-900 text-green-400 hover:bg-green-800' },
                            { label: '4x', value: 400, cls: 'bg-green-900 text-green-400 hover:bg-green-800' },
                            { label: '5x', value: 500, cls: 'bg-orange-900 text-orange-400 hover:bg-orange-800' },
                            { label: '6x', value: 600, cls: 'bg-red-900 text-red-400 hover:bg-red-800' },
                          ].map(btn => (
                            <button
                              key={btn.value}
                              onClick={() => setVolumeBoost(btn.value)}
                              className={`flex-1 px-2 py-1.5 text-xs rounded-lg ${btn.cls}`}
                            >
                              {btn.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
                {/* Duración */}
                {selectedVideo.runtime && (
                  <span className="text-sm text-slate-500 px-2">
                    {Math.floor(selectedVideo.runtime / 60)}h {selectedVideo.runtime % 60}m
                  </span>
                )}
                <button
                  onClick={onClose}
                  className="text-slate-400 hover:text-red-500 transition-colors text-xl p-2"
                >
                  {'✕'}
                </button>
              </div>
            </div>
            <div className="relative">
              <video
                key={selectedVideo.filename}
                ref={videoRef}
                src={(() => {
                  const token = getSessionToken();
                  const params = new URLSearchParams();
                  if (selectedVideo.audioTrack !== undefined) params.set('audio', selectedVideo.audioTrack);
                  if (token) params.set('session', token);
                  const queryString = params.toString();
                  return `${selectedVideo.url}${queryString ? '?' + queryString : ''}`;
                })()}
                controls
                autoPlay
                className="w-full aspect-video bg-black"
                onTimeUpdate={onTimeUpdate}
                onLoadedMetadata={onVideoLoaded}
              />
              {/* Overlay con sinopsis */}
              {selectedVideo.overview && (
                <div
                  className="absolute top-0 left-0 right-0 h-32 group z-10"
                  onMouseEnter={(e) => {
                    const overlay = e.currentTarget.querySelector('.synopsis-overlay');
                    if (overlay) overlay.style.opacity = '1';
                  }}
                  onMouseLeave={(e) => {
                    const overlay = e.currentTarget.querySelector('.synopsis-overlay');
                    if (overlay) overlay.style.opacity = '0';
                  }}
                >
                  <div
                    className="synopsis-overlay absolute top-0 left-0 right-0 bg-gradient-to-b from-black/95 via-black/80 to-transparent p-6 pb-16 transition-opacity duration-300 pointer-events-none"
                    style={{ opacity: 0 }}
                  >
                    <h4 className="text-white font-bold text-lg mb-2 drop-shadow-lg">Sinopsis</h4>
                    <p
                      className="text-white/90 text-sm leading-relaxed drop-shadow-md"
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden'
                      }}
                    >
                      {selectedVideo.overview}
                    </p>
                  </div>
                </div>
              )}
            </div>
            {/* Películas Recomendadas */}
            {selectedVideo.recommendations && selectedVideo.recommendations.length > 0 && (
              <div className="p-4 bg-slate-800 border-t border-slate-700">
                <h4 className="text-sm font-bold text-slate-600 mb-3">Pel{'í'}culas similares</h4>
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {selectedVideo.recommendations.map((rec) => {
                    const isInLibrary = videos.some(v => v.tmdbId === rec.tmdbId);
                    const isRequested = allRequests.some(r => r.tmdbId === rec.tmdbId) ||
                                        existingRequests.some(r => r.tmdbId === rec.tmdbId);
                    return (
                      <div
                        key={rec.tmdbId}
                        className={`relative flex-shrink-0 w-20 cursor-pointer hover:opacity-80 transition-all ${
                          isInLibrary ? 'ring-2 ring-green-500 ring-offset-2 rounded-lg' :
                          isRequested ? 'ring-2 ring-amber-500 ring-offset-2 rounded-lg' : ''
                        }`}
                        onClick={() => {
                          let found = videos.find(v => v.tmdbId === rec.tmdbId);
                          if (!found) {
                            const recTitleLower = normalizeText(rec.title);
                            found = videos.find(v => v.title === rec.title);
                            if (!found) {
                              found = videos.find(v => {
                                const vTitleLower = normalizeText(v.title);
                                return vTitleLower === recTitleLower || vTitleLower.includes(recTitleLower) || recTitleLower.includes(vTitleLower);
                              });
                            }
                          }

                          if (found) {
                            onClose();
                            setTimeout(() => onPlayClick(found), 400);
                          } else {
                            alert(`"${rec.title}" no est\u00E1 en tu biblioteca`);
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          onAddRecommendationToRequests(rec);
                        }}
                        title={`${rec.title} (${rec.releaseDate?.split('-')[0] || '?'}) - \u2B50 ${rec.rating?.toFixed(1) || '?'}${rec.overview ? '\n\n' + rec.overview : ''}\n\n\uD83D\uDCA1 Clic izq: reproducir | Clic der: a\u00F1adir a peticiones`}
                      >
                        {rec.poster ? (
                          <img
                            src={rec.poster}
                            alt={rec.title}
                            className="w-20 h-28 object-cover rounded-lg shadow"
                          />
                        ) : (
                          <div className="w-20 h-28 bg-slate-200 rounded-lg flex items-center justify-center">
                            <span className="text-xs text-slate-400">Sin imagen</span>
                          </div>
                        )}
                        <p className="text-xs text-slate-600 mt-1 truncate">{rec.title}</p>
                        {isInLibrary && (
                          <div className="absolute -top-1 -right-1 bg-green-500 text-white text-[8px] px-1 rounded-full">
                            {'\u2713'}
                          </div>
                        )}
                        {!isInLibrary && isRequested && (
                          <div className="absolute -top-1 -right-1 bg-amber-500 text-white text-[8px] px-1 rounded-full">
                            {'\u23F3'}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>

          {/* Panel de Actores - Derecha */}
          {selectedVideo.cast && selectedVideo.cast.length > 0 && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="hidden md:flex flex-col w-44 flex-shrink-0 bg-slate-900/95 backdrop-blur rounded-2xl shadow-xl max-h-[80vh] overflow-hidden"
            >
              <div className="p-3 bg-slate-800 border-b border-slate-700">
                <h3 className="font-bold text-slate-200 text-sm">{'\uD83C\uDFAD'} Reparto</h3>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {selectedVideo.cast.map((actor) => (
                  <div
                    key={actor.id}
                    onClick={() => onActorClick(actor)}
                    className="flex items-center gap-2 p-2 rounded-xl hover:bg-indigo-50 cursor-pointer transition-colors group"
                    title={`Ver pel\u00EDculas de ${actor.name}`}
                  >
                    {actor.photo ? (
                      <img
                        src={actor.photo}
                        alt={actor.name}
                        className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                        <span className="text-slate-400 text-xs">{'\uD83D\uDC64'}</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-200 truncate group-hover:text-indigo-600">
                        {actor.name}
                      </p>
                      {actor.character && (
                        <p className="text-[10px] text-slate-400 truncate">
                          {actor.character}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
