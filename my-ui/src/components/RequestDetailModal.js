import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

export default function RequestDetailModal({
  requestDetailMovie, selectedRequests,
  onToggleSelection, onClose,
  isMovieRequested, isMovieInCatalog
}) {
  return (
    <AnimatePresence>
      {requestDetailMovie && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            onClick={e => e.stopPropagation()}
            className="bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden border border-slate-700"
          >
            {/* Header con poster y título */}
            <div className="flex gap-4 p-4 bg-gradient-to-r from-slate-800 to-slate-900 border-b border-slate-700">
              {requestDetailMovie.poster && (
                <img
                  src={requestDetailMovie.poster}
                  alt={requestDetailMovie.title}
                  className="w-24 h-36 object-cover rounded-lg shadow-lg flex-shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <h3 className="text-xl font-bold text-white leading-tight">
                  {requestDetailMovie.title}
                </h3>
                <p className="text-slate-400 mt-1">
                  {requestDetailMovie.year && `(${requestDetailMovie.year})`}
                  {requestDetailMovie.rating && ` \u{2022} \u{2B50} ${requestDetailMovie.rating.toFixed(1)}`}
                </p>
                {requestDetailMovie.character && (
                  <p className="text-purple-400 text-sm mt-2">
                    {'\u{1F3AD}'} como {requestDetailMovie.character}
                  </p>
                )}
              </div>
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-white transition-colors self-start"
              >
                <X size={24} />
              </button>
            </div>

            {/* Sinopsis con scroll */}
            <div className="flex-1 overflow-y-auto p-4">
              <h4 className="text-sm font-semibold text-amber-500 mb-2">Sinopsis</h4>
              <p className="text-slate-300 leading-relaxed whitespace-pre-line">
                {requestDetailMovie.overview || 'Sin sinopsis disponible.'}
              </p>
            </div>

            {/* Footer con botón para seleccionar */}
            <div className="p-4 bg-slate-800 border-t border-slate-700 flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-xl text-slate-400 hover:bg-slate-700 transition-colors"
              >
                Cerrar
              </button>
              {!isMovieInCatalog(requestDetailMovie.tmdbId) && !isMovieRequested(requestDetailMovie.tmdbId) && (
                <button
                  onClick={() => {
                    onToggleSelection(requestDetailMovie);
                    onClose();
                  }}
                  className={`flex-1 px-4 py-2.5 rounded-xl font-medium transition-colors ${
                    selectedRequests.some(m => m.tmdbId === requestDetailMovie.tmdbId)
                      ? 'bg-red-500 text-white hover:bg-red-600'
                      : 'bg-amber-500 text-white hover:bg-amber-600'
                  }`}
                >
                  {selectedRequests.some(m => m.tmdbId === requestDetailMovie.tmdbId)
                    ? '\u{2715} Quitar de la lista'
                    : '\u{2713} Añadir a la lista'
                  }
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
