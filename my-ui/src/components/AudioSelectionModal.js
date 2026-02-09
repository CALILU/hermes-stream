import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Volume2, Play } from 'lucide-react';

export default function AudioSelectionModal({ audioSelectionModal, selectedAudioTrack, onSelectTrack, onPlay, onCancel }) {
  return (
    <AnimatePresence>
      {audioSelectionModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/90 backdrop-blur-md p-6"
          onClick={() => !audioSelectionModal.loading && onCancel()}
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-900 rounded-3xl p-8 w-full max-w-md shadow-2xl border border-slate-700"
          >
            {audioSelectionModal.loading ? (
              <div className="text-center py-8">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-100 mb-4">
                  <Volume2 className="text-indigo-500 animate-pulse" size={32} />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Analizando audio...</h3>
                <p className="text-slate-500">Detectando pistas de audio disponibles</p>
              </div>
            ) : (
              <>
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-100 mb-4">
                    <Volume2 className="text-indigo-500" size={32} />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">Seleccionar audio</h3>
                  <p className="text-sm text-slate-500 truncate px-4">{audioSelectionModal.video?.title}</p>
                </div>

                <div className="space-y-2 mb-6 max-h-64 overflow-y-auto">
                  {audioSelectionModal.tracks.map((track, idx) => (
                    <button
                      key={idx}
                      onClick={() => onSelectTrack(idx)}
                      className={`w-full p-4 rounded-xl text-left transition-all ${
                        selectedAudioTrack === idx
                          ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-200'
                          : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          selectedAudioTrack === idx ? 'border-white' : 'border-slate-400'
                        }`}>
                          {selectedAudioTrack === idx && (
                            <div className="w-2.5 h-2.5 rounded-full bg-white" />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium">{track.label}</div>
                          {track.bitrate && (
                            <div className={`text-xs ${selectedAudioTrack === idx ? 'text-indigo-200' : 'text-slate-400'}`}>
                              {track.bitrate}
                            </div>
                          )}
                        </div>
                        {track.default && (
                          <span className={`text-xs px-2 py-1 rounded-full ${
                            selectedAudioTrack === idx ? 'bg-indigo-400 text-white' : 'bg-slate-200 text-slate-500'
                          }`}>
                            Por defecto
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={onCancel}
                    className="flex-1 px-4 py-3 bg-slate-700 text-slate-200 rounded-xl font-medium hover:bg-slate-600 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={onPlay}
                    className="flex-1 px-4 py-3 bg-indigo-500 text-white rounded-xl font-medium hover:bg-indigo-600 transition-colors flex items-center justify-center gap-2"
                  >
                    <Play size={18} />
                    Reproducir
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
