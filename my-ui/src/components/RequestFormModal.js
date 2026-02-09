import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, RefreshCw } from 'lucide-react';

export default function RequestFormModal({
  requestsModal, requestSearchQuery, requestSearchResults, requestSearchLoading,
  actorSearchQuery, actorSearchResult, actorSearchLoading,
  selectedRequests, submittingRequests,
  onSearchQueryChange, onActorQueryChange, onSearch, onActorSearch,
  onToggleSelection, onClearSelection, onSubmit, onClose,
  onClearActorSearch, onSetDetailMovie,
  isMovieRequested, isMovieInCatalog
}) {
  return (
    <AnimatePresence>
      {requestsModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-hidden"
          onWheel={(e) => e.stopPropagation()}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={e => e.stopPropagation()}
            className="bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-700"
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4 flex items-center justify-between flex-shrink-0">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                {'\u{1F3AC}'} Pedir Pel{'\u00ED'}culas
              </h2>
              <button
                onClick={() => !submittingRequests && onClose()}
                className="text-white/80 hover:text-white transition-colors"
                disabled={submittingRequests}
              >
                <X size={24} />
              </button>
            </div>

            {/* Barras de busqueda */}
            <div className="p-4 border-b border-slate-700 flex-shrink-0 space-y-3">
              {/* Busqueda por titulo */}
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={requestSearchQuery}
                    onChange={(e) => onSearchQueryChange(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && onSearch()}
                    placeholder={'\u{1F3AC} Buscar por t\u00EDtulo de pel\u00EDcula...'}
                    className="w-full pl-4 pr-10 py-3 bg-slate-800 rounded-xl border border-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500 text-slate-200"
                    autoFocus
                  />
                  {requestSearchQuery && (
                    <button
                      onClick={() => { onSearchQueryChange(''); }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1 hover:bg-slate-700 rounded-full"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                <button
                  onClick={onSearch}
                  disabled={requestSearchLoading}
                  className="px-5 py-3 bg-amber-500 text-white rounded-xl font-medium hover:bg-amber-600 transition-colors disabled:opacity-50"
                >
                  {requestSearchLoading ? '...' : 'Buscar'}
                </button>
              </div>

              {/* Busqueda por actor */}
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={actorSearchQuery}
                    onChange={(e) => onActorQueryChange(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && onActorSearch()}
                    placeholder={'\u{1F3AD} Buscar por nombre de actor...'}
                    className="w-full pl-4 pr-10 py-3 bg-slate-800 rounded-xl border border-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-200"
                  />
                  {actorSearchQuery && (
                    <button
                      onClick={onClearActorSearch}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-purple-300 p-1 hover:bg-purple-900 rounded-full"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                <button
                  onClick={onActorSearch}
                  disabled={actorSearchLoading}
                  className="px-5 py-3 bg-purple-500 text-white rounded-xl font-medium hover:bg-purple-600 transition-colors disabled:opacity-50"
                >
                  {actorSearchLoading ? '...' : 'Buscar'}
                </button>
              </div>
            </div>

            {/* Info del actor encontrado */}
            {actorSearchResult?.actor && (
              <div className="px-4 py-3 bg-purple-50 border-b border-purple-200 flex items-center gap-3 flex-shrink-0">
                {actorSearchResult.actor.photo && (
                  <img src={actorSearchResult.actor.photo} alt={actorSearchResult.actor.name} className="w-12 h-12 rounded-full object-cover" />
                )}
                <div>
                  <p className="font-semibold text-purple-800">{actorSearchResult.actor.name}</p>
                  <p className="text-sm text-purple-600">{actorSearchResult.movies.length} pel{'\u00ED'}culas encontradas</p>
                </div>
                <button
                  onClick={onClearActorSearch}
                  className="ml-auto text-purple-400 hover:text-purple-600"
                >
                  <X size={20} />
                </button>
              </div>
            )}

            {/* Seleccionadas */}
            {selectedRequests.length > 0 && (
              <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex-shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-amber-800">
                    {selectedRequests.length} pel{'\u00ED'}cula(s) seleccionada(s)
                  </span>
                  <button
                    onClick={onClearSelection}
                    className="text-xs text-amber-600 hover:text-amber-800"
                  >
                    Limpiar selecci{'\u00F3'}n
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedRequests.map(movie => (
                    <span
                      key={movie.tmdbId}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-amber-200 text-amber-800 rounded-lg text-xs"
                    >
                      {movie.title} {movie.year && `(${movie.year})`}
                      <button
                        onClick={() => onToggleSelection(movie)}
                        className="hover:text-red-600"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Resultados */}
            <div className="p-4 overflow-y-auto flex-1">
              {(requestSearchLoading || actorSearchLoading) ? (
                <div className="grid grid-cols-3 md:grid-cols-5 gap-4">
                  {[1,2,3,4,5,6,7,8,9,10].map(i => (
                    <div key={i} className="aspect-[2/3] bg-slate-200 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : (actorSearchResult?.movies?.length > 0) ? (
                /* Mostrar peliculas del actor */
                <div className="grid grid-cols-3 md:grid-cols-5 gap-4">
                  {actorSearchResult.movies.map((movie) => {
                    const isSelected = selectedRequests.some(m => m.tmdbId === movie.tmdbId);
                    const alreadyRequested = isMovieRequested(movie.tmdbId);
                    const inCatalog = isMovieInCatalog(movie.tmdbId);
                    const isUnavailable = alreadyRequested || inCatalog;
                    return (
                      <motion.div
                        key={movie.tmdbId}
                        whileHover={{ scale: isUnavailable ? 1 : 1.03 }}
                        onClick={() => !isUnavailable && onToggleSelection(movie)}
                        className={`group relative ${isUnavailable ? 'cursor-default' : 'cursor-pointer'} ${
                          isUnavailable ? 'ring-4 ring-red-500 rounded-xl' :
                          isSelected ? 'ring-4 ring-amber-500 rounded-xl' : ''
                        }`}
                      >
                        <div className="aspect-[2/3] rounded-xl overflow-hidden bg-slate-200 relative">
                          <img src={movie.poster} alt={movie.title} className={`w-full h-full object-cover ${isUnavailable ? 'opacity-60' : ''}`} />
                          {/* Sinopsis en hover con boton para ver mas */}
                          {movie.overview && (
                            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 p-3 flex flex-col justify-end">
                              <p className="text-white text-xs leading-relaxed pointer-events-none" style={{
                                display: '-webkit-box',
                                WebkitLineClamp: 4,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden'
                              }}>{movie.overview}</p>
                              <button
                                onClick={(e) => { e.stopPropagation(); onSetDetailMovie(movie); }}
                                className="mt-2 text-xs text-amber-400 hover:text-amber-300 font-medium self-start"
                              >
                                Ver sinopsis completa {'\u2192'}
                              </button>
                            </div>
                          )}
                          {/* Indicadores de estado */}
                          {isUnavailable && (
                            <div className="absolute top-2 right-2 z-10">
                              <span className="bg-red-500 text-white rounded-lg px-2 py-1 text-xs font-bold shadow-lg">
                                {inCatalog ? 'EN CAT\u00C1LOGO' : 'SOLICITADA'}
                              </span>
                            </div>
                          )}
                          {isSelected && !isUnavailable && (
                            <div className="absolute top-2 right-2 z-10">
                              <span className="bg-amber-500 text-white rounded-full p-1.5 shadow-lg">{'\u2713'}</span>
                            </div>
                          )}
                        </div>
                        <p className="mt-2 text-sm font-medium text-slate-200 truncate">{movie.title}</p>
                        <p className="text-xs text-slate-400">
                          {movie.year && `(${movie.year})`}
                          {movie.rating && ` \u2B50 ${movie.rating.toFixed(1)}`}
                        </p>
                        {movie.character && (
                          <p className="text-xs text-purple-500 truncate">como {movie.character}</p>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              ) : requestSearchResults.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <div className="text-5xl mb-4">{'\u{1F50D}'}</div>
                  <p>Busca pel{'\u00ED'}culas por t{'\u00ED'}tulo o por nombre de actor</p>
                  <p className="text-sm mt-2">Ejemplo: "Matrix", "Mel Gibson", "El Padrino"</p>
                </div>
              ) : (
                /* Mostrar resultados de busqueda por titulo */
                <div className="grid grid-cols-3 md:grid-cols-5 gap-4">
                  {requestSearchResults.map((movie) => {
                    const isSelected = selectedRequests.some(m => m.tmdbId === movie.tmdbId);
                    const alreadyRequested = isMovieRequested(movie.tmdbId);
                    const inCatalog = isMovieInCatalog(movie.tmdbId);
                    const isUnavailable = alreadyRequested || inCatalog;
                    return (
                      <motion.div
                        key={movie.tmdbId}
                        whileHover={{ scale: isUnavailable ? 1 : 1.03 }}
                        onClick={() => !isUnavailable && onToggleSelection(movie)}
                        className={`group relative ${isUnavailable ? 'cursor-default' : 'cursor-pointer'} ${
                          isUnavailable ? 'ring-4 ring-red-500 rounded-xl' :
                          isSelected ? 'ring-4 ring-amber-500 rounded-xl' : ''
                        }`}
                      >
                        <div className="aspect-[2/3] rounded-xl overflow-hidden bg-slate-700 relative">
                          {movie.poster ? (
                            <img
                              src={movie.poster}
                              alt={movie.title}
                              className={`w-full h-full object-cover ${isUnavailable ? 'opacity-60' : ''}`}
                              onError={(e) => {
                                e.target.onerror = null;
                                e.target.src = `https://via.placeholder.com/342x513/374151/9ca3af?text=${encodeURIComponent(movie.title?.substring(0,20) || '?')}`;
                              }}
                            />
                          ) : (
                            <div className="w-full h-full bg-slate-700 flex items-center justify-center text-slate-400 text-xs text-center p-2">
                              <span>{'\u{1F3AC}'}<br/>{movie.title}</span>
                            </div>
                          )}
                          {/* Sinopsis en hover con boton para ver mas */}
                          {movie.overview && (
                            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 p-3 flex flex-col justify-end">
                              <p className="text-white text-xs leading-relaxed pointer-events-none" style={{
                                display: '-webkit-box',
                                WebkitLineClamp: 4,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden'
                              }}>{movie.overview}</p>
                              <button
                                onClick={(e) => { e.stopPropagation(); onSetDetailMovie(movie); }}
                                className="mt-2 text-xs text-amber-400 hover:text-amber-300 font-medium self-start"
                              >
                                Ver sinopsis completa {'\u2192'}
                              </button>
                            </div>
                          )}
                          {/* Indicadores de estado */}
                          {isUnavailable && (
                            <div className="absolute top-2 right-2 z-10">
                              <span className="bg-red-500 text-white rounded-lg px-2 py-1 text-xs font-bold shadow-lg">
                                {inCatalog ? 'EN CAT\u00C1LOGO' : 'SOLICITADA'}
                              </span>
                            </div>
                          )}
                          {isSelected && !isUnavailable && (
                            <div className="absolute top-2 right-2 z-10">
                              <span className="bg-amber-500 text-white rounded-full p-1.5 shadow-lg">{'\u2713'}</span>
                            </div>
                          )}
                        </div>
                        <p className="mt-2 text-sm font-medium text-slate-200 truncate">{movie.title}</p>
                        <p className="text-xs text-slate-400">
                          {movie.year && `(${movie.year})`}
                          {movie.rating && ` \u2B50 ${movie.rating.toFixed(1)}`}
                        </p>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="bg-slate-800 px-6 py-4 flex justify-between items-center flex-shrink-0 border-t border-slate-700">
              <button
                onClick={onClose}
                disabled={submittingRequests}
                className="px-6 py-2 rounded-xl text-slate-600 hover:bg-slate-200 transition-colors"
              >
                Cerrar
              </button>
              <button
                onClick={onSubmit}
                disabled={selectedRequests.length === 0 || submittingRequests}
                className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-medium hover:from-amber-600 hover:to-orange-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {submittingRequests ? (
                  <>
                    <RefreshCw size={18} className="animate-spin" />
                    Enviando...
                  </>
                ) : (
                  <>Enviar Petici{'\u00F3'}n ({selectedRequests.length})</>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
