import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Play, User, RefreshCw } from 'lucide-react';

export default function SeriesDetailModal({
  selectedSeries, selectedSeason, seasonEpisodes, loadingEpisodes,
  onSelectSeason, onPlayEpisode, onMarkWatched, onClose
}) {
  return (
    <AnimatePresence>
      {selectedSeries && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            onClick={e => e.stopPropagation()}
            className="bg-slate-900 rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden border border-emerald-700/30 flex flex-col"
          >
            {/* Header del modal */}
            <div className="relative h-48 bg-gradient-to-b from-emerald-900/50 to-slate-900 flex-shrink-0">
              {selectedSeries.backdrop && (
                <img
                  src={selectedSeries.backdrop}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover opacity-30"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/50 to-transparent" />
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-2 bg-slate-800/80 hover:bg-slate-700 rounded-full transition-colors z-10"
              >
                <X size={20} className="text-slate-300" />
              </button>
              <div className="absolute bottom-4 left-4 right-4 flex gap-4">
                {selectedSeries.poster && (
                  <img
                    src={selectedSeries.poster}
                    alt={selectedSeries.title}
                    className="w-24 h-36 object-cover rounded-xl shadow-lg border border-emerald-500/30"
                  />
                )}
                <div className="flex-1 flex flex-col justify-end">
                  <h2 className="text-2xl font-bold text-white">{selectedSeries.title || selectedSeries.folder_name}</h2>
                  <div className="flex items-center gap-3 text-sm text-slate-400 mt-1">
                    {selectedSeries.vote_average && (
                      <span className="flex items-center gap-1">
                        <span className="text-yellow-500">&#11088;</span> {selectedSeries.vote_average.toFixed(1)}
                      </span>
                    )}
                    {selectedSeries.first_air_date && (
                      <span>{selectedSeries.first_air_date.split('-')[0]}</span>
                    )}
                    {selectedSeries.number_of_seasons && (
                      <span>{selectedSeries.number_of_seasons} temporadas</span>
                    )}
                    {selectedSeries.status && (
                      <span className={`px-2 py-0.5 rounded-full text-xs ${
                        selectedSeries.status === 'Ended' ? 'bg-red-900/50 text-red-400' :
                        selectedSeries.status === 'Returning Series' ? 'bg-green-900/50 text-green-400' :
                        'bg-yellow-900/50 text-yellow-400'
                      }`}>
                        {selectedSeries.status === 'Ended' ? 'Finalizada' :
                         selectedSeries.status === 'Returning Series' ? 'En emision' : 'Cancelada'}
                      </span>
                    )}
                  </div>
                  {selectedSeries.genres && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {selectedSeries.genres.map(genre => (
                        <span key={genre} className="px-2 py-0.5 bg-emerald-900/50 text-emerald-400 rounded-full text-xs">
                          {genre}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Contenido scrollable */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Sinopsis */}
              {selectedSeries.overview && (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Sinopsis</h3>
                  <p className="text-slate-300 text-sm leading-relaxed">{selectedSeries.overview}</p>
                </div>
              )}

              {/* Cast */}
              {selectedSeries.cast && selectedSeries.cast.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Reparto</h3>
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {selectedSeries.cast.slice(0, 8).map(actor => (
                      <div key={actor.id} className="flex-shrink-0 text-center w-16">
                        {actor.photo ? (
                          <img src={actor.photo} alt={actor.name} className="w-14 h-14 rounded-full object-cover mx-auto" />
                        ) : (
                          <div className="w-14 h-14 rounded-full bg-slate-700 flex items-center justify-center mx-auto">
                            <User size={24} className="text-slate-500" />
                          </div>
                        )}
                        <p className="text-xs text-slate-300 mt-1 truncate">{actor.name}</p>
                        <p className="text-xs text-slate-500 truncate">{actor.character}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Selector de temporadas */}
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Temporadas</h3>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {(selectedSeries.seasons_info || []).map(season => (
                    <button
                      key={season.season_number}
                      onClick={() => onSelectSeason(season.season_number)}
                      className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex-shrink-0 ${
                        selectedSeason === season.season_number
                          ? 'bg-emerald-500 text-white shadow-md'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      T{season.season_number}
                      <span className="ml-1 text-xs opacity-70">({season.episode_count})</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Lista de episodios */}
              <div>
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Episodios {selectedSeason && `- Temporada ${selectedSeason}`}
                </h3>
                {loadingEpisodes ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw size={24} className="animate-spin text-emerald-500" />
                    <span className="ml-2 text-slate-400">Cargando episodios...</span>
                  </div>
                ) : seasonEpisodes && seasonEpisodes.episodes ? (
                  <div className="space-y-2">
                    {seasonEpisodes.episodes.map(ep => (
                      <div
                        key={ep.episode_number}
                        className={`p-3 rounded-xl border transition-all ${
                          ep.available
                            ? 'bg-slate-800/50 border-slate-700 hover:border-emerald-500/50 cursor-pointer'
                            : 'bg-slate-900/50 border-slate-800 opacity-50'
                        } ${ep.watched ? 'border-emerald-500/30' : ''}`}
                        onClick={() => {
                          if (ep.available && ep.filename) {
                            onPlayEpisode(ep);
                          }
                        }}
                      >
                        <div className="flex items-start gap-3">
                          {/* Thumbnail o numero */}
                          <div className="flex-shrink-0 w-24 h-14 bg-slate-700 rounded-lg overflow-hidden relative">
                            {ep.still ? (
                              <img src={ep.still} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-500">
                                <span className="text-2xl font-bold">{ep.episode_number}</span>
                              </div>
                            )}
                            {ep.watched && (
                              <div className="absolute top-1 right-1 bg-emerald-500 rounded-full p-0.5">
                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                            )}
                          </div>

                          {/* Info del episodio */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-emerald-400 font-medium">E{ep.episode_number}</span>
                              <h4 className="text-sm font-medium text-white truncate">{ep.name}</h4>
                            </div>
                            {ep.overview && (
                              <p className="text-xs text-slate-400 line-clamp-2 mt-1">{ep.overview}</p>
                            )}
                            <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                              {ep.runtime && <span>{ep.runtime} min</span>}
                              {ep.air_date && <span>{ep.air_date}</span>}
                              {!ep.available && <span className="text-red-400">No disponible</span>}
                            </div>
                          </div>

                          {/* Botones de accion */}
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {ep.available && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onPlayEpisode(ep);
                                }}
                                className="p-2 bg-emerald-500 hover:bg-emerald-600 rounded-full text-white transition-colors"
                                title="Reproducir"
                              >
                                <Play size={16} fill="white" />
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onMarkWatched(selectedSeries.tmdb_id, selectedSeason, ep.episode_number, !ep.watched);
                              }}
                              className={`p-2 rounded-full transition-colors ${
                                ep.watched
                                  ? 'bg-emerald-900/50 text-emerald-400 hover:bg-emerald-900'
                                  : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                              }`}
                              title={ep.watched ? 'Marcar como no visto' : 'Marcar como visto'}
                            >
                              {ep.watched ? '\u2713' : '\u25CB'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    <p>Selecciona una temporada para ver los episodios</p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
