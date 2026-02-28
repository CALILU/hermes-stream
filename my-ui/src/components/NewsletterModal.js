import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Mail, Send, Eye, Clock, Search, Check, Film, AlertCircle, Trash2 } from 'lucide-react';

export default function NewsletterModal({
  newsletterModal, videos, selectedMovies, newsletterSubject,
  previewHTML, loadingPreview, sending, sendResult,
  history, loadingHistory, sentMovies = [],
  onSubjectChange, onToggleMovie, onGeneratePreview, onSendNewsletter,
  onSendTest, onLoadHistory, onDeleteHistory, onClose
}) {
  const [activeTab, setActiveTab] = useState('select');
  const [searchQuery, setSearchQuery] = useState('');
  const [testEmailInput, setTestEmailInput] = useState('');

  // Load history when switching to that tab
  useEffect(() => {
    if (activeTab === 'history') onLoadHistory();
  }, [activeTab, onLoadHistory]);

  // Auto-generate preview when switching to preview tab
  useEffect(() => {
    if (activeTab === 'preview' && selectedMovies.length > 0 && !previewHTML) {
      onGeneratePreview();
    }
  }, [activeTab, selectedMovies, previewHTML, onGeneratePreview]);

  const filteredVideos = (videos || []).filter(v => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (v.title || v.filename || '').toLowerCase().includes(q);
  });

  const isSelected = (movie) => selectedMovies.some(m => m.filename === movie.filename);
  const wasSent = (movie) => sentMovies.includes(movie.filename);

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('es-ES', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  const handleSendTest = async () => {
    const email = testEmailInput || window.prompt('Email para test:');
    if (!email) return;
    setTestEmailInput(email);
    const result = await onSendTest(email);
    if (result?.success) {
      alert(result.message || 'Email de prueba enviado');
    } else {
      alert(result?.error || 'Error enviando email de prueba');
    }
  };

  return (
    <AnimatePresence>
      {newsletterModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-hidden"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={e => e.stopPropagation()}
            className="bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-700"
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-4 flex items-center justify-between flex-shrink-0">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Mail size={22} />
                Newsletter
              </h2>
              <button onClick={onClose} className="text-white/80 hover:text-white transition-colors">
                <X size={24} />
              </button>
            </div>

            {/* Tab Bar */}
            <div className="flex border-b border-slate-700 flex-shrink-0">
              <button
                onClick={() => setActiveTab('select')}
                className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                  activeTab === 'select'
                    ? 'text-indigo-400 border-b-2 border-indigo-400 bg-slate-800/50'
                    : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                <Film size={16} /> Peliculas ({selectedMovies.length})
              </button>
              <button
                onClick={() => setActiveTab('preview')}
                className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                  activeTab === 'preview'
                    ? 'text-indigo-400 border-b-2 border-indigo-400 bg-slate-800/50'
                    : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                <Eye size={16} /> Preview
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                  activeTab === 'history'
                    ? 'text-indigo-400 border-b-2 border-indigo-400 bg-slate-800/50'
                    : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                <Clock size={16} /> Historial
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {activeTab === 'select' && (
                <div className="space-y-4">
                  {/* Subject */}
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Asunto del email</label>
                    <input
                      type="text"
                      value={newsletterSubject}
                      onChange={e => onSubjectChange(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 rounded-lg border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Nuevas peliculas en IsiPrime"
                    />
                  </div>

                  {/* Search */}
                  <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 bg-slate-800 rounded-lg border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Buscar peliculas..."
                    />
                  </div>

                  {/* Selected count */}
                  {selectedMovies.length > 0 && (
                    <div className="flex items-center justify-between bg-indigo-900/30 border border-indigo-700/50 rounded-lg px-4 py-2">
                      <span className="text-indigo-300 text-sm font-medium">
                        {selectedMovies.length} {selectedMovies.length === 1 ? 'pelicula seleccionada' : 'peliculas seleccionadas'}
                      </span>
                      <button
                        onClick={() => setActiveTab('preview')}
                        className="text-sm text-indigo-400 hover:text-indigo-300 font-medium"
                      >
                        Ver preview &rarr;
                      </button>
                    </div>
                  )}

                  {/* Movie Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[50vh] overflow-y-auto pr-1">
                    {filteredVideos.map(video => {
                      const selected = isSelected(video);
                      const previouslySent = wasSent(video);
                      const borderClass = selected
                        ? 'border-indigo-500 shadow-lg shadow-indigo-500/20'
                        : previouslySent
                          ? 'border-red-500/70 shadow-sm shadow-red-500/10'
                          : 'border-transparent hover:border-slate-600';
                      return (
                        <div
                          key={video.filename}
                          onClick={() => onToggleMovie(video)}
                          className={`relative cursor-pointer rounded-xl overflow-hidden border-2 transition-all ${borderClass}`}
                        >
                          {video.poster ? (
                            <img
                              src={video.poster}
                              alt={video.title || video.filename}
                              className="w-full aspect-[2/3] object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full aspect-[2/3] bg-slate-800 flex items-center justify-center">
                              <Film size={32} className="text-slate-600" />
                            </div>
                          )}
                          {selected && (
                            <div className="absolute top-2 right-2 bg-indigo-600 rounded-full p-1">
                              <Check size={14} className="text-white" />
                            </div>
                          )}
                          {previouslySent && !selected && (
                            <div className="absolute top-2 right-2 bg-red-600/80 rounded-full px-1.5 py-0.5">
                              <span className="text-white text-[9px] font-bold">ENVIADA</span>
                            </div>
                          )}
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-2">
                            <p className="text-white text-xs font-medium truncate">{video.title || video.filename}</p>
                            {video.year && <p className="text-slate-400 text-[10px]">{video.year}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeTab === 'preview' && (
                <div className="space-y-4">
                  {selectedMovies.length === 0 ? (
                    <div className="text-center py-12 text-slate-400">
                      <Film size={48} className="mx-auto mb-3 opacity-50" />
                      <p>Selecciona peliculas primero</p>
                    </div>
                  ) : loadingPreview ? (
                    <div className="text-center py-12 text-slate-400">
                      <span className="animate-spin inline-block text-2xl mb-2">&#9203;</span>
                      <p>Generando preview...</p>
                    </div>
                  ) : previewHTML ? (
                    <>
                      {/* Send Result Banner */}
                      {sendResult && (
                        <div className={`p-3 rounded-lg border ${
                          sendResult.error
                            ? 'bg-red-900/30 border-red-700/50 text-red-300'
                            : 'bg-green-900/30 border-green-700/50 text-green-300'
                        }`}>
                          {sendResult.error ? (
                            <p className="flex items-center gap-2 text-sm"><AlertCircle size={16} /> {sendResult.error}</p>
                          ) : (
                            <p className="text-sm">Newsletter enviado: {sendResult.sent} enviados, {sendResult.failed} fallidos de {sendResult.total} totales</p>
                          )}
                        </div>
                      )}

                      {/* Action Buttons */}
                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={onSendNewsletter}
                          disabled={sending}
                          className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-medium rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all disabled:opacity-50 flex items-center gap-2"
                        >
                          <Send size={16} /> {sending ? 'Enviando...' : 'Enviar Newsletter'}
                        </button>
                        <button
                          onClick={handleSendTest}
                          disabled={sending}
                          className="px-5 py-2.5 bg-slate-700 text-slate-300 text-sm font-medium rounded-xl hover:bg-slate-600 transition-all disabled:opacity-50 flex items-center gap-2"
                        >
                          <Mail size={16} /> Enviar Test
                        </button>
                        <button
                          onClick={onGeneratePreview}
                          disabled={loadingPreview}
                          className="px-5 py-2.5 bg-slate-700 text-slate-300 text-sm font-medium rounded-xl hover:bg-slate-600 transition-all disabled:opacity-50 flex items-center gap-2"
                        >
                          <Eye size={16} /> Regenerar
                        </button>
                      </div>

                      {/* Preview iframe */}
                      <div className="bg-slate-950 rounded-xl border border-slate-700 overflow-hidden">
                        <iframe
                          srcDoc={previewHTML}
                          title="Newsletter Preview"
                          className="w-full border-0"
                          style={{ height: '600px' }}
                          sandbox=""
                        />
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-12">
                      <button
                        onClick={onGeneratePreview}
                        className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-all"
                      >
                        Generar Preview
                      </button>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'history' && (
                <div className="space-y-3">
                  {loadingHistory ? (
                    <div className="text-center py-12 text-slate-400">
                      <span className="animate-spin inline-block text-2xl mb-2">&#9203;</span>
                      <p>Cargando historial...</p>
                    </div>
                  ) : history.length === 0 ? (
                    <div className="text-center py-12 text-slate-400">
                      <Clock size={48} className="mx-auto mb-3 opacity-50" />
                      <p>No hay envios anteriores</p>
                    </div>
                  ) : (
                    history.map(entry => (
                      <div key={entry.id} className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-white text-sm font-medium">{entry.subject}</h3>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            entry.status === 'sent' ? 'bg-green-900/30 text-green-400' :
                            entry.status === 'test' ? 'bg-blue-900/30 text-blue-400' :
                            entry.status === 'partial' ? 'bg-yellow-900/30 text-yellow-400' :
                            'bg-red-900/30 text-red-400'
                          }`}>
                            {entry.status === 'sent' ? 'Enviado' : entry.status === 'test' ? 'Test' : entry.status === 'partial' ? 'Parcial' : entry.status}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4 text-xs text-slate-500">
                            <span>{formatDate(entry.sent_at)}</span>
                            <span>{entry.movie_count} peliculas</span>
                            <span>{entry.recipients_count} destinatarios</span>
                            {entry.sent_by_username && <span>por {entry.sent_by_username}</span>}
                          </div>
                          <button
                            onClick={() => onDeleteHistory(entry.id)}
                            className="text-slate-500 hover:text-red-400 transition-colors p-1"
                            title="Eliminar registro"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
