import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2 } from 'lucide-react';

export default function RequestsAdminModal({
  requestsAdminModal, allRequests, requestsStats, requestsFilter, requestsReadonly,
  onFilterChange, onUpdateStatus, onDelete, onSearchTorrents, onClose
}) {
  return (
    <AnimatePresence>
      {requestsAdminModal && (
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
            className="bg-slate-900 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-700"
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-4 flex items-center justify-between flex-shrink-0">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                📋 Administrar Peticiones
                {requestsReadonly && (
                  <span className="ml-2 px-2 py-0.5 bg-yellow-500/30 text-yellow-200 text-xs rounded-full font-normal">
                    Solo lectura
                  </span>
                )}
              </h2>
              <button
                onClick={onClose}
                className="text-white/80 hover:text-white transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            {/* Estadísticas - Clicables para filtrar */}
            {requestsStats && (
              <div className="px-6 py-3 bg-slate-800 border-b border-slate-700 flex gap-2 flex-wrap flex-shrink-0">
                <button
                  onClick={() => onFilterChange(null)}
                  className={`text-sm px-2 py-1 rounded transition-all ${requestsFilter === null ? 'bg-slate-600 ring-2 ring-slate-400' : 'hover:bg-slate-700'}`}
                >
                  <span className="font-medium text-slate-200">Total:</span>{' '}
                  <span className="text-slate-400">{requestsStats.total}</span>
                </button>
                <button
                  onClick={() => onFilterChange('pending')}
                  className={`text-sm px-2 py-1 rounded transition-all ${requestsFilter === 'pending' ? 'bg-amber-900/50 ring-2 ring-amber-500' : 'hover:bg-slate-700'}`}
                >
                  <span className="font-medium text-amber-500">Pendientes:</span>{' '}
                  <span className="text-amber-500">{requestsStats.pending}</span>
                </button>
                <button
                  onClick={() => onFilterChange('downloading')}
                  className={`text-sm px-2 py-1 rounded transition-all ${requestsFilter === 'downloading' ? 'bg-blue-900/50 ring-2 ring-blue-500' : 'hover:bg-slate-700'}`}
                >
                  <span className="font-medium text-blue-500">Descargando:</span>{' '}
                  <span className="text-blue-500">{requestsStats.downloading}</span>
                </button>
                <button
                  onClick={() => onFilterChange('downloaded')}
                  className={`text-sm px-2 py-1 rounded transition-all ${requestsFilter === 'downloaded' ? 'bg-green-900/50 ring-2 ring-green-500' : 'hover:bg-slate-700'}`}
                >
                  <span className="font-medium text-green-500">Completadas:</span>{' '}
                  <span className="text-green-500">{requestsStats.downloaded}</span>
                </button>
                <button
                  onClick={() => onFilterChange('mp4')}
                  className={`text-sm px-2 py-1 rounded transition-all ${requestsFilter === 'mp4' ? 'bg-purple-900/50 ring-2 ring-purple-500' : 'hover:bg-slate-700'}`}
                >
                  <span className="font-medium text-purple-500">Convertidas:</span>{' '}
                  <span className="text-purple-500">{requestsStats.mp4 || 0}</span>
                </button>
                <button
                  onClick={() => onFilterChange('server')}
                  className={`text-sm px-2 py-1 rounded transition-all ${requestsFilter === 'server' ? 'bg-emerald-900/50 ring-2 ring-emerald-500' : 'hover:bg-slate-700'}`}
                >
                  <span className="font-medium text-emerald-500">En servidor:</span>{' '}
                  <span className="text-emerald-500">{requestsStats.server || 0}</span>
                </button>
                <button
                  onClick={() => onFilterChange('rejected')}
                  className={`text-sm px-2 py-1 rounded transition-all ${requestsFilter === 'rejected' ? 'bg-red-900/50 ring-2 ring-red-500' : 'hover:bg-slate-700'}`}
                >
                  <span className="font-medium text-red-500">Rechazadas:</span>{' '}
                  <span className="text-red-500">{requestsStats.rejected}</span>
                </button>
              </div>
            )}

            {/* Lista de peticiones */}
            <div className="flex-1 overflow-y-auto p-4">
              {allRequests.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <div className="text-5xl mb-4">📭</div>
                  <p>No hay peticiones pendientes</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {allRequests
                    .filter(r => requestsFilter === null || r.status === requestsFilter)
                    .map(request => (
                    <div
                      key={request.id}
                      className={`flex items-center gap-4 p-4 rounded-xl border ${
                        request.status === 'pending' ? 'bg-amber-900/20 border-amber-800/50' :
                        request.status === 'downloading' ? 'bg-blue-900/20 border-blue-800/50' :
                        request.status === 'downloaded' ? 'bg-green-900/20 border-green-800/50' :
                        'bg-red-900/20 border-red-800/50'
                      }`}
                    >
                      {/* Poster */}
                      <img
                        src={request.poster}
                        alt={request.title}
                        className="w-16 h-24 object-cover rounded-lg flex-shrink-0"
                      />

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-lg text-white truncate">
                          {request.title} {request.year && `(${request.year})`}
                        </h3>
                        <p className="text-sm text-slate-500">
                          Pedido por: <span className="font-medium">{request.requestedBy}</span>
                        </p>
                        <p className="text-xs text-slate-400">
                          {new Date(request.requestedAt).toLocaleDateString('es-ES', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </p>
                      </div>

                      {/* Estado y acciones */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {requestsReadonly ? (
                          /* Modo solo lectura: mostrar estado como badge */
                          <span className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                            request.status === 'pending' ? 'bg-amber-700/40 text-amber-300' :
                            request.status === 'downloading' ? 'bg-blue-700/40 text-blue-300' :
                            request.status === 'downloaded' ? 'bg-green-700/40 text-green-300' :
                            request.status === 'mp4' ? 'bg-purple-700/40 text-purple-300' :
                            request.status === 'server' ? 'bg-emerald-700/40 text-emerald-300' :
                            'bg-red-700/40 text-red-300'
                          }`}>
                            {request.status === 'pending' ? 'Pendiente' :
                             request.status === 'downloading' ? 'Descargando' :
                             request.status === 'downloaded' ? 'Descargada' :
                             request.status === 'mp4' ? 'Convertida' :
                             request.status === 'server' ? 'En servidor' : 'Rechazada'}
                          </span>
                        ) : (
                          /* Modo normal: select editable */
                          <select
                            value={request.status}
                            onChange={(e) => onUpdateStatus(request.id, e.target.value)}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                              request.status === 'pending' ? 'bg-amber-600 text-white' :
                              request.status === 'downloading' ? 'bg-blue-600 text-white' :
                              request.status === 'downloaded' ? 'bg-green-600 text-white' :
                              request.status === 'mp4' ? 'bg-purple-600 text-white' :
                              request.status === 'server' ? 'bg-emerald-600 text-white' :
                              'bg-red-600 text-white'
                            }`}
                            style={{ colorScheme: 'dark' }}
                          >
                            <option value="pending" className="bg-slate-800 text-amber-300 font-medium">⏳ Pendiente</option>
                            <option value="downloading" className="bg-slate-800 text-blue-300 font-medium">⬇️ Descargando</option>
                            <option value="downloaded" className="bg-slate-800 text-green-300 font-medium">✅ Descargada</option>
                            <option value="mp4" className="bg-slate-800 text-purple-300 font-medium">🎬 Convertida</option>
                            <option value="server" className="bg-slate-800 text-emerald-300 font-medium">📁 En servidor</option>
                            <option value="rejected" className="bg-slate-800 text-red-300 font-medium">❌ Rechazada</option>
                          </select>
                        )}
                        <button
                          onClick={() => window.open(`https://ok.ru/dk?st.cmd=searchResult&st.mode=Movie&st.query=${encodeURIComponent(request.title)}`, '_blank')}
                          className="p-2 text-slate-400 hover:text-orange-400 hover:bg-orange-900/30 rounded-lg transition-all"
                          title="Buscar en OK.ru"
                        >
                          🔍
                        </button>
                        <button
                          onClick={() => onSearchTorrents(request.title)}
                          className="p-2 text-slate-400 hover:text-purple-400 hover:bg-purple-900/30 rounded-lg transition-all"
                          title="Buscar en TodoTorrents (Tor)"
                        >
                          🧅
                        </button>
                        {!requestsReadonly && (
                          <button
                            onClick={() => onDelete(request.id)}
                            className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-900/30 rounded-lg transition-all"
                            title="Eliminar petición"
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="bg-slate-800 px-6 py-4 flex justify-end flex-shrink-0 border-t border-slate-700">
              <button
                onClick={onClose}
                className="px-6 py-2 rounded-xl text-slate-300 hover:bg-slate-700 transition-colors"
              >
                Cerrar
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
