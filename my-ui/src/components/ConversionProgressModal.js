import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw } from 'lucide-react';

export default function ConversionProgressModal({ conversionProgress, onClose }) {
  return (
    <AnimatePresence>
      {conversionProgress && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/90 backdrop-blur-md p-6"
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            className="bg-slate-900 rounded-3xl p-8 w-full max-w-md shadow-2xl border border-slate-700"
          >
            <div className="text-center mb-6">
              <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 ${
                conversionProgress.status === 'completed' ? 'bg-emerald-100' :
                conversionProgress.status === 'error' ? 'bg-red-100' : 'bg-indigo-100'
              }`}>
                {conversionProgress.status === 'completed' ? (
                  <span className="text-3xl">{'\u{2705}'}</span>
                ) : conversionProgress.status === 'error' ? (
                  <span className="text-3xl">{'\u{274C}'}</span>
                ) : (
                  <RefreshCw className={`text-indigo-500 ${conversionProgress.status !== 'completed' ? 'animate-spin' : ''}`} size={32} />
                )}
              </div>
              <h3 className="text-xl font-bold text-white mb-2">
                {conversionProgress.status === 'completed' ? 'Conversion completada' :
                 conversionProgress.status === 'error' ? 'Error en conversion' :
                 'Convirtiendo a MP4'}
              </h3>
              <p className="text-sm text-slate-500 truncate px-4">
                {conversionProgress.filename}
              </p>
            </div>

            <div className="mb-4">
              <div className="flex justify-between text-sm text-slate-600 mb-2">
                <span>{conversionProgress.message}</span>
                <span className="font-bold">{conversionProgress.progress}%</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                <motion.div
                  className={`h-full rounded-full ${
                    conversionProgress.status === 'completed' ? 'bg-emerald-500' :
                    conversionProgress.status === 'error' ? 'bg-red-500' : 'bg-indigo-500'
                  }`}
                  initial={{ width: 0 }}
                  animate={{ width: `${conversionProgress.progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>

            <div className="grid grid-cols-5 gap-1 text-xs text-center mb-6">
              {['downloading', 'converting', 'uploading', 'deleting', 'completed'].map((stage, idx) => {
                const stages = ['downloading', 'converting', 'uploading', 'deleting', 'completed'];
                const currentIdx = stages.indexOf(conversionProgress.status);
                const isActive = idx <= currentIdx;
                const isCurrent = conversionProgress.status === stage;
                return (
                  <div key={stage} className={`${isActive ? 'text-indigo-600 font-medium' : 'text-slate-400'} ${isCurrent ? 'scale-110' : ''} transition-all`}>
                    <div className={`w-2 h-2 rounded-full mx-auto mb-1 ${isActive ? 'bg-indigo-500' : 'bg-slate-300'}`} />
                    {stage === 'downloading' ? '\u{1F4E5}' : stage === 'converting' ? '\u{1F504}' : stage === 'uploading' ? '\u{1F4E4}' : stage === 'deleting' ? '\u{1F5D1}\u{FE0F}' : '\u{2705}'}
                  </div>
                );
              })}
            </div>

            {(conversionProgress.status === 'completed' || conversionProgress.status === 'error') && (
              <button
                onClick={onClose}
                className={`w-full py-3 rounded-xl font-medium transition-colors ${
                  conversionProgress.status === 'completed'
                    ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                    : 'bg-slate-200 text-slate-200 hover:bg-slate-300'
                }`}
              >
                {conversionProgress.status === 'completed' ? 'Listo' : 'Cerrar'}
              </button>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
