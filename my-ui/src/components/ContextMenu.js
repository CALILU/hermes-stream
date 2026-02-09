import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Image, RefreshCw, Trash2 } from 'lucide-react';

export default function ContextMenu({ contextMenu, onPosterSearch, onConvert, onDelete, isConvertible }) {
  if (!contextMenu) return null;

  return (
    <AnimatePresence>
      {contextMenu && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.1 }}
          style={{
            position: 'fixed',
            left: Math.min(contextMenu.x, window.innerWidth - 200),
            top: Math.min(contextMenu.y, window.innerHeight - 120),
            zIndex: 100
          }}
          className="bg-slate-900 rounded-xl shadow-2xl border border-slate-600 overflow-hidden min-w-[180px]"
        >
          <div className="p-2">
            <button
              onClick={onPosterSearch}
              className="w-full flex items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-indigo-900 hover:text-indigo-300 rounded-lg transition-colors"
            >
              <Image size={18} />
              <span className="font-medium">Cambiar caratula</span>
            </button>
            {isConvertible && (
              <button
                onClick={onConvert}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-emerald-900 hover:text-emerald-300 rounded-lg transition-colors"
              >
                <RefreshCw size={18} />
                <span className="font-medium">Convertir a MP4</span>
              </button>
            )}
            <button
              onClick={onDelete}
              className="w-full flex items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors"
            >
              <Trash2 size={18} />
              <span className="font-medium">Eliminar archivo</span>
            </button>
          </div>
          <div className="px-4 py-2 bg-slate-800 border-t border-slate-700 text-xs text-slate-400 truncate">
            {contextMenu.video?.filename}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
