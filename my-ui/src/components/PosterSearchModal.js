import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search } from 'lucide-react';

export default function PosterSearchModal({
  posterSearchModal, posterSearchQuery, posterSearchResults, posterSearchLoading,
  onQueryChange, onSearch, onSelect, onClose
}) {
  return (
    <AnimatePresence>
      {posterSearchModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/90 backdrop-blur-md p-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-900 rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col border border-slate-700"
          >
            <div className="p-6 bg-slate-800 border-b border-slate-700 flex-shrink-0">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-white">
                  Cambiar caratula: <span className="text-indigo-500">{posterSearchModal.title}</span>
                </h3>
                <button
                  onClick={onClose}
                  className="text-slate-400 hover:text-red-500 transition-colors text-2xl"
                >
                  {'\u{2715}'}
                </button>
              </div>

              <div className="flex gap-3">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={posterSearchQuery}
                    onChange={(e) => onQueryChange(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && onSearch(posterSearchQuery)}
                    placeholder="Buscar pelicula en TMDB..."
                    className="w-full pl-10 pr-4 py-3 bg-slate-800 rounded-xl border border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-200"
                    autoFocus
                  />
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18}/>
                </div>
                <button
                  onClick={() => onSearch(posterSearchQuery)}
                  disabled={posterSearchLoading}
                  className="px-6 py-3 bg-indigo-500 text-white rounded-xl font-medium hover:bg-indigo-600 transition-colors disabled:opacity-50"
                >
                  {posterSearchLoading ? 'Buscando...' : 'Buscar'}
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {posterSearchLoading ? (
                <div className="grid grid-cols-3 md:grid-cols-4 gap-4">
                  {[1,2,3,4,5,6,7,8].map(i => (
                    <div key={i} className="aspect-[2/3] bg-slate-200 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : posterSearchResults.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <div className="text-5xl mb-4">{'\u{1F50D}'}</div>
                  <p>Escribe un titulo y presiona Enter o Buscar</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 md:grid-cols-4 gap-4">
                  {posterSearchResults.map((result) => (
                    <motion.div
                      key={result.tmdbId}
                      whileHover={{ scale: 1.05 }}
                      onClick={() => onSelect(posterSearchModal, result)}
                      className="cursor-pointer group"
                    >
                      <div className="aspect-[2/3] rounded-xl overflow-hidden bg-slate-200 relative">
                        {result.poster ? (
                          <img
                            src={result.poster}
                            alt={result.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-400">
                            Sin imagen
                          </div>
                        )}
                        <div className="absolute inset-0 bg-indigo-500/0 group-hover:bg-indigo-500/30 transition-colors flex items-center justify-center">
                          <span className="text-white opacity-0 group-hover:opacity-100 font-bold text-lg">
                            Seleccionar
                          </span>
                        </div>
                      </div>
                      <p className="mt-2 text-sm font-medium text-slate-200 truncate">{result.title}</p>
                      <p className="text-xs text-slate-400">
                        {result.year && `(${result.year})`}
                        {result.rating && ` \u{2B50} ${result.rating.toFixed(1)}`}
                      </p>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
