import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

export default function EpisodePlayerModal({ selectedEpisode, onMarkWatched, onClose }) {
  return (
    <AnimatePresence>
      {selectedEpisode && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 p-4"
        >
          <motion.div
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            className="bg-slate-900 rounded-3xl w-full max-w-5xl overflow-hidden shadow-2xl border border-emerald-700/30"
          >
            {/* Header */}
            <div className="p-4 flex justify-between items-center bg-slate-800/80 border-b border-slate-700">
              <div>
                <span className="text-emerald-400 text-sm">
                  {selectedEpisode.series?.title} - T{selectedEpisode.season}E{selectedEpisode.episode_number}
                </span>
                <h3 className="font-bold text-white">{selectedEpisode.name}</h3>
              </div>
              <button
                onClick={() => {
                  if (selectedEpisode.series && !selectedEpisode.watched) {
                    onMarkWatched(
                      selectedEpisode.series.tmdb_id,
                      selectedEpisode.season,
                      selectedEpisode.episode_number,
                      true
                    );
                  }
                  onClose();
                }}
                className="p-2 hover:bg-slate-700 rounded-full transition-colors"
              >
                <X size={24} className="text-slate-300" />
              </button>
            </div>

            {/* Video */}
            <div className="relative bg-black aspect-video">
              <video
                key={selectedEpisode.url}
                className="w-full h-full"
                controls
                autoPlay
                src={selectedEpisode.url}
                onEnded={() => {
                  if (selectedEpisode.series) {
                    onMarkWatched(
                      selectedEpisode.series.tmdb_id,
                      selectedEpisode.season,
                      selectedEpisode.episode_number,
                      true
                    );
                  }
                }}
              >
                Tu navegador no soporta el elemento video.
              </video>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
