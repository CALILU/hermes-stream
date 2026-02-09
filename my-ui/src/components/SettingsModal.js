import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, X, HardDrive, FolderOpen, Wifi, RefreshCw, Trash2, Layers } from 'lucide-react';

export default function SettingsModal({
  settingsModal, storageMode, storagePath, changingMode, clearingCache, cacheProgress,
  generatingCollections,
  onStorageModeChange, onBrowseLocalFolder, onApplyLocalPath, onStoragePathChange,
  onClearCache, onCleanupOrphans, onRegenerateSagas, onClose
}) {
  return (
    <AnimatePresence>
      {settingsModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={e => e.stopPropagation()}
            className="bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto my-4 border border-slate-700"
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Settings size={24} /> Configuracion
              </h2>
              <button
                onClick={() => !clearingCache && onClose()}
                className="text-white/80 hover:text-white transition-colors"
                disabled={clearingCache}
              >
                <X size={24} />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Seccion Modo de Almacenamiento */}
              <div className="border border-slate-600 rounded-xl p-4">
                <h3 className="font-semibold text-white mb-2 flex items-center gap-2">
                  <HardDrive size={18} className="text-indigo-600" />
                  Modo de Almacenamiento
                </h3>
                <p className="text-sm text-slate-600 mb-4">
                  Selecciona de donde leer las peliculas: disco local conectado al ordenador o disco en red via FTP.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={onBrowseLocalFolder}
                    disabled={changingMode}
                    className={`flex-1 py-3 px-4 rounded-xl font-medium transition-all flex items-center justify-center gap-2 ${
                      storageMode === 'local'
                        ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-lg'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    } ${changingMode ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <FolderOpen size={18} />
                    {storageMode === 'local' ? 'LOCAL' : 'Seleccionar Disco'}
                  </button>
                  <button
                    onClick={() => onStorageModeChange('ftp')}
                    disabled={changingMode}
                    className={`flex-1 py-3 px-4 rounded-xl font-medium transition-all flex items-center justify-center gap-2 ${
                      storageMode === 'ftp'
                        ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-lg'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    } ${changingMode ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <Wifi size={18} />
                    RED (FTP)
                  </button>
                </div>
                {changingMode && (
                  <p className="text-sm text-indigo-600 mt-2 flex items-center gap-2">
                    <RefreshCw size={14} className="animate-spin" />
                    Cambiando modo y recargando peliculas...
                  </p>
                )}

                {/* Campo para escribir ruta manualmente */}
                <div className="mt-3">
                  <label className="text-xs text-slate-500 mb-1 block">O escribe la ruta directamente:</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={storagePath}
                      onChange={(e) => onStoragePathChange(e.target.value)}
                      placeholder="Ej: E:\Peliculas o F:\Videos"
                      className="flex-1 px-3 py-2 text-sm border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                      disabled={changingMode}
                    />
                    <button
                      onClick={() => {
                        if (!storagePath.trim() || changingMode) return;
                        onApplyLocalPath(storagePath.trim());
                      }}
                      disabled={changingMode || !storagePath.trim()}
                      className="px-4 py-2 bg-green-500 text-white text-sm rounded-lg hover:bg-green-600 disabled:opacity-50"
                    >
                      Aplicar
                    </button>
                  </div>
                </div>

                {storageMode === 'local' && storagePath && (
                  <div className="mt-3 p-2 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-sm text-green-700 flex items-center gap-2">
                      <HardDrive size={14} />
                      <span className="font-medium">Ruta activa:</span> {storagePath}
                    </p>
                  </div>
                )}
              </div>

              {/* Seccion Cache */}
              <div className="border border-slate-600 rounded-xl p-4">
                <h3 className="font-semibold text-white mb-2 flex items-center gap-2">
                  <RefreshCw size={18} className="text-indigo-600" />
                  Cache de Caratulas
                </h3>
                <p className="text-sm text-slate-400 mb-4">
                  Borra toda la cache de caratulas y vuelve a buscar la informacion en TMDB.
                  Util si los nombres de las peliculas han cambiado o hay caratulas incorrectas.
                </p>
                <button
                  onClick={onClearCache}
                  disabled={clearingCache}
                  className={`w-full py-3 px-4 rounded-xl font-medium transition-all flex items-center justify-center gap-2 ${
                    clearingCache
                      ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                      : 'bg-gradient-to-r from-red-500 to-orange-500 text-white hover:from-red-600 hover:to-orange-600 shadow-lg hover:shadow-xl'
                  }`}
                >
                  {clearingCache ? (
                    <>
                      <RefreshCw size={18} className="animate-spin" />
                      Procesando...
                    </>
                  ) : (
                    <>
                      <Trash2 size={18} />
                      Limpiar Cache y Recargar
                    </>
                  )}
                </button>

                {/* Barra de progreso */}
                {clearingCache && cacheProgress.total > 0 && (
                  <div className="mt-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">{cacheProgress.status}</span>
                      <span className="font-medium text-indigo-600">
                        {cacheProgress.current}/{cacheProgress.total}
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-indigo-500 to-purple-500 h-3 rounded-full transition-all duration-300"
                        style={{ width: `${(cacheProgress.current / cacheProgress.total) * 100}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-500 text-center">
                      {Math.round((cacheProgress.current / cacheProgress.total) * 100)}% completado
                    </p>
                  </div>
                )}

                {/* Estado sin progreso */}
                {clearingCache && cacheProgress.total === 0 && cacheProgress.status && (
                  <div className="mt-4 text-sm text-slate-600 flex items-center gap-2">
                    <RefreshCw size={14} className="animate-spin" />
                    {cacheProgress.status}
                  </div>
                )}
              </div>

              {/* Seccion Limpiar Duplicados */}
              <div className="border border-amber-200 rounded-xl p-4 bg-amber-50">
                <h3 className="font-semibold text-amber-800 mb-2 flex items-center gap-2">
                  <Trash2 size={18} className="text-amber-600" />
                  Limpiar Entradas Huerfanas
                </h3>
                <p className="text-sm text-amber-700 mb-4">
                  Elimina del cache las peliculas que ya no existen (renombradas, convertidas o eliminadas).
                </p>
                <button
                  onClick={() => {
                    if (clearingCache) return;
                    onCleanupOrphans();
                  }}
                  disabled={clearingCache}
                  className={`w-full py-3 px-4 rounded-xl font-medium transition-all flex items-center justify-center gap-2 ${
                    clearingCache
                      ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                      : 'bg-gradient-to-r from-amber-500 to-yellow-500 text-white hover:from-amber-600 hover:to-yellow-600 shadow-lg hover:shadow-xl'
                  }`}
                >
                  <Trash2 size={18} />
                  Limpiar Entradas Huerfanas
                </button>
              </div>

              {/* Seccion Regenerar Sagas */}
              <div className="border border-slate-600 rounded-xl p-4">
                <h3 className="font-semibold text-white mb-2 flex items-center gap-2">
                  <Layers size={18} className="text-purple-500" />
                  Regenerar Sagas
                </h3>
                <p className="text-sm text-slate-400 mb-4">
                  Vuelve a generar las colecciones de sagas buscando en TMDB.
                  Util si has añadido nuevas peliculas o corregido nombres de archivos.
                </p>
                <button
                  onClick={() => {
                    if (generatingCollections) return;
                    onRegenerateSagas();
                  }}
                  disabled={generatingCollections || clearingCache}
                  className={`w-full py-3 px-4 rounded-xl font-medium transition-all flex items-center justify-center gap-2 ${
                    generatingCollections
                      ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                      : 'bg-gradient-to-r from-purple-500 to-indigo-500 text-white hover:from-purple-600 hover:to-indigo-600 shadow-lg hover:shadow-xl'
                  }`}
                >
                  {generatingCollections ? (
                    <>
                      <RefreshCw size={18} className="animate-spin" />
                      Regenerando sagas...
                    </>
                  ) : (
                    <>
                      <Layers size={18} />
                      Regenerar Sagas
                    </>
                  )}
                </button>
              </div>

              {/* Info */}
              <div className="bg-blue-900/30 border border-blue-800 rounded-xl p-4">
                <p className="text-sm text-blue-300">
                  <strong>Nota:</strong> Este proceso puede tardar varios minutos dependiendo del numero de peliculas.
                  Las busquedas en TMDB usan el nombre del archivo y el año entre parentesis para obtener resultados precisos.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-slate-800 px-6 py-4 flex justify-end border-t border-slate-700">
              <button
                onClick={() => onClose()}
                disabled={clearingCache}
                className="px-6 py-2 rounded-xl text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-50"
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
