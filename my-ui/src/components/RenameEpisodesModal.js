import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Check, AlertTriangle, X, Edit3 } from 'lucide-react';
import { API_BASE } from '../constants';
import { authFetch } from '../utils/api';

export default function RenameEpisodesModal({ series, onClose, onRenamed }) {
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState([]);
  const [subfolders, setSubfolders] = useState([]);
  const [seriesTitle, setSeriesTitle] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [results, setResults] = useState(null);

  // Analizar episodios al abrir
  useEffect(() => {
    if (!series) return;

    setLoading(true);
    authFetch(`${API_BASE}/api/series/analyze-episodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderName: series.folder_name })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setFiles(data.files.map(f => ({
            ...f,
            season: f.season || 1,
            episode: f.episode || 0,
            include: f.confidence !== 'none' || true,
            subfolder: f.subfolder || null
          })));
          setSubfolders(data.subfolders || []);
          setSeriesTitle(data.seriesTitle || series.folder_name);
        }
      })
      .catch(err => console.error('Error analizando:', err))
      .finally(() => setLoading(false));
  }, [series]);

  const updateFile = (index, field, value) => {
    setFiles(prev => prev.map((f, i) =>
      i === index ? { ...f, [field]: field === 'include' ? value : parseInt(value) || 0 } : f
    ));
  };

  // Asignar episodios secuencialmente (por subcarpeta si las hay)
  const autoNumber = () => {
    setFiles(prev => {
      if (subfolders.length > 0) {
        // Numerar por subcarpeta: cada una reinicia episodio en 1, temporada se detecta del nombre
        const counters = {};
        return prev.map(f => {
          const key = f.subfolder || '__root__';
          if (!counters[key]) counters[key] = { ep: 1 };
          return {
            ...f,
            season: f.season || 1,
            episode: counters[key].ep++,
            include: true
          };
        });
      } else {
        let ep = 1;
        return prev.map(f => ({
          ...f,
          season: 1,
          episode: ep++,
          include: true
        }));
      }
    });
  };

  const removeAccents = (str) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const getNewFilename = (file) => {
    if (!file.include || !file.season || !file.episode) return null;
    const cleanTitle = removeAccents(seriesTitle).replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim();
    const s = String(file.season).padStart(2, '0');
    const e = String(file.episode).padStart(2, '0');
    return `${cleanTitle} S${s}E${e}${file.extension}`;
  };

  const handleRename = async () => {
    const mappings = files
      .filter(f => f.include && f.season && f.episode)
      .map(f => ({ filename: f.filename, season: f.season, episode: f.episode, subfolder: f.subfolder || null }));

    if (mappings.length === 0) return;

    setRenaming(true);
    try {
      const res = await authFetch(`${API_BASE}/api/series/rename-episodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderName: series.folder_name,
          seriesTitle: seriesTitle,
          mappings
        })
      });
      const data = await res.json();
      if (data.success) {
        setResults(data.results);
        if (onRenamed) onRenamed();
      }
    } catch (err) {
      console.error('Error renombrando:', err);
    } finally {
      setRenaming(false);
    }
  };

  if (!series) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-md p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.9, y: 20 }}
          onClick={e => e.stopPropagation()}
          className="bg-slate-900 rounded-3xl w-full max-w-5xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col border border-emerald-700/30"
        >
          {/* Header */}
          <div className="p-5 bg-slate-800 border-b border-slate-700 flex-shrink-0">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Edit3 size={20} className="text-emerald-400" />
                Renombrar episodios
              </h3>
              <button onClick={onClose} className="text-slate-400 hover:text-red-500 transition-colors text-2xl">
                <X size={22} />
              </button>
            </div>

            {/* Nombre de serie editable */}
            <div className="flex gap-3 items-center">
              <label className="text-sm text-slate-400 flex-shrink-0">Titulo serie:</label>
              <input
                type="text"
                value={seriesTitle}
                onChange={e => setSeriesTitle(e.target.value)}
                className="flex-1 px-3 py-2 bg-slate-700 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white text-sm"
              />
              <button
                onClick={() => autoNumber()}
                className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium transition-colors flex-shrink-0"
                title={subfolders.length > 0 ? "Numerar cada subcarpeta desde E01" : "Numerar todos como T1 desde E01"}
              >
                Auto numerar
              </button>
            </div>
          </div>

          {/* Contenido */}
          <div className="flex-1 overflow-y-auto p-5">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw size={24} className="animate-spin text-emerald-500" />
                <span className="ml-2 text-slate-400">Analizando archivos...</span>
              </div>
            ) : results ? (
              /* Resultados del renombrado */
              <div className="space-y-2">
                <div className="text-center mb-4">
                  <div className="text-4xl mb-2">{results.every(r => r.success) ? '\u2705' : '\u26A0\uFE0F'}</div>
                  <p className="text-lg text-white font-medium">
                    {results.filter(r => r.success && !r.skipped).length} archivos renombrados
                  </p>
                </div>
                {results.map((r, i) => (
                  <div key={i} className={`p-3 rounded-xl text-sm ${
                    r.success ? 'bg-emerald-900/30 border border-emerald-700/30' : 'bg-red-900/30 border border-red-700/30'
                  }`}>
                    <div className="flex items-center gap-2">
                      {r.success ? <Check size={16} className="text-emerald-400" /> : <AlertTriangle size={16} className="text-red-400" />}
                      <span className="text-slate-400 truncate">{r.subfolder ? `${r.subfolder}/` : ''}{r.filename}</span>
                    </div>
                    {r.newFilename && r.filename !== r.newFilename && (
                      <div className="ml-6 text-emerald-400 truncate">{'\u2192'} {r.newFilename}</div>
                    )}
                    {r.error && <div className="ml-6 text-red-400">{r.error}</div>}
                    {r.skipped && <div className="ml-6 text-slate-500">Sin cambios</div>}
                  </div>
                ))}
              </div>
            ) : files.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <p>No se encontraron archivos de video en esta carpeta</p>
              </div>
            ) : (
              /* Tabla de previsualización */
              <div className="space-y-1">
                {/* Cabecera */}
                <div className="grid grid-cols-[auto_1fr_60px_60px_1fr] gap-2 px-3 py-2 text-xs text-slate-500 font-semibold uppercase tracking-wider">
                  <div className="w-5"></div>
                  <div>Archivo original</div>
                  <div className="text-center">Temp</div>
                  <div className="text-center">Ep</div>
                  <div>Nuevo nombre</div>
                </div>

                {files.map((file, idx) => {
                  const newName = getNewFilename(file);
                  const prevFile = idx > 0 ? files[idx - 1] : null;
                  const showSubfolderHeader = file.subfolder && (!prevFile || prevFile.subfolder !== file.subfolder);

                  return (
                    <React.Fragment key={idx}>
                      {/* Separador de subcarpeta */}
                      {showSubfolderHeader && (
                        <div className="flex items-center gap-2 px-3 py-2 mt-2 first:mt-0">
                          <div className="h-px flex-1 bg-slate-700" />
                          <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                            {'\uD83D\uDCC1'} {file.subfolder}
                          </span>
                          <div className="h-px flex-1 bg-slate-700" />
                        </div>
                      )}

                      <div className={`grid grid-cols-[auto_1fr_60px_60px_1fr] gap-2 px-3 py-2 rounded-lg items-center ${
                        file.include ? 'bg-slate-800/50' : 'bg-slate-900/50 opacity-50'
                      }`}>
                        {/* Checkbox */}
                        <input
                          type="checkbox"
                          checked={file.include}
                          onChange={e => updateFile(idx, 'include', e.target.checked)}
                          className="w-4 h-4 rounded accent-emerald-500"
                        />

                        {/* Nombre original */}
                        <div className="text-sm text-slate-300 truncate" title={file.subfolder ? `${file.subfolder}/${file.filename}` : file.filename}>
                          {file.filename}
                          {file.confidence === 'high' && <span className="ml-1 text-emerald-400 text-xs" title="Patron detectado con confianza alta">{'\u2713'}</span>}
                          {file.confidence === 'medium' && <span className="ml-1 text-yellow-400 text-xs" title="Patron detectado con confianza media">~</span>}
                        </div>

                        {/* Temporada */}
                        <input
                          type="number"
                          min="1"
                          max="99"
                          value={file.season || ''}
                          onChange={e => updateFile(idx, 'season', e.target.value)}
                          className="w-14 px-2 py-1 bg-slate-700 rounded border border-slate-600 text-center text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />

                        {/* Episodio */}
                        <input
                          type="number"
                          min="1"
                          max="999"
                          value={file.episode || ''}
                          onChange={e => updateFile(idx, 'episode', e.target.value)}
                          className="w-14 px-2 py-1 bg-slate-700 rounded border border-slate-600 text-center text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />

                        {/* Nombre nuevo */}
                        <div className="text-sm truncate" title={newName}>
                          {newName ? (
                            <span className="text-emerald-400">{newName}</span>
                          ) : (
                            <span className="text-slate-600 italic">sin cambio</span>
                          )}
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 bg-slate-800 border-t border-slate-700 flex justify-between items-center flex-shrink-0">
            <div className="text-sm text-slate-400">
              {!results && files.length > 0 && (
                <span>{files.filter(f => f.include && f.episode > 0).length} de {files.length} archivos seleccionados</span>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-5 py-2 bg-slate-700 text-slate-300 rounded-xl hover:bg-slate-600 transition-colors text-sm font-medium"
              >
                {results ? 'Cerrar' : 'Cancelar'}
              </button>
              {!results && (
                <button
                  onClick={handleRename}
                  disabled={renaming || files.filter(f => f.include && f.episode > 0).length === 0}
                  className="px-5 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors text-sm font-medium disabled:opacity-50 flex items-center gap-2"
                >
                  {renaming ? (
                    <><RefreshCw size={16} className="animate-spin" /> Renombrando...</>
                  ) : (
                    <><Edit3 size={16} /> Renombrar</>
                  )}
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
