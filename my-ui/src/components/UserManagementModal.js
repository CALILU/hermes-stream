import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, Copy, Check, UserPlus, Mail, Shield, ChevronDown, ChevronRight, Monitor, Plus, User, Wifi, Play } from 'lucide-react';

function movieNameFromPath(videoPath) {
  if (!videoPath) return '';
  const name = videoPath.split('/').pop().replace(/\.\w+$/, '');
  return name;
}

function UserCard({ user, authState, onDeleteUser, onUpdateUser, onAddUserTV, onDeleteUserTV, formatDate }) {
  const [expanded, setExpanded] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailValue, setEmailValue] = useState(user.email || '');
  const [showAddTV, setShowAddTV] = useState(false);
  const [tvForm, setTvForm] = useState({ brand: 'LG', model: '', ipAddress: '', connectionType: '', year: '', webosVersion: '', aresDeviceName: '', notes: '' });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isSelf = user.id === authState?.user?.id;

  const handleEmailSave = () => {
    onUpdateUser(user.id, { email: emailValue });
    setEditingEmail(false);
  };

  const handleEmailKeyDown = (e) => {
    if (e.key === 'Enter') handleEmailSave();
    if (e.key === 'Escape') { setEditingEmail(false); setEmailValue(user.email || ''); }
  };

  const handleToggleNotifications = () => {
    onUpdateUser(user.id, { emailNotifications: !user.email_notifications });
  };

  const handleAddTV = () => {
    if (!tvForm.model.trim()) return;
    onAddUserTV(user.id, tvForm);
    setTvForm({ brand: 'LG', model: '', ipAddress: '', connectionType: '', year: '', webosVersion: '', aresDeviceName: '', notes: '' });
    setShowAddTV(false);
    setShowAdvanced(false);
  };

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
      {/* Header — always visible */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-800/80 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${user.active ? 'bg-green-400' : 'bg-red-400'} ${user.watching ? 'animate-pulse' : ''}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-white font-medium text-sm truncate">{user.display_name || user.username}</span>
              {user.display_name && user.display_name !== user.username && (
                <span className="text-slate-500 text-xs">@{user.username}</span>
              )}
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                user.role === 'admin' ? 'bg-purple-900/50 text-purple-300' : 'bg-slate-700 text-slate-300'
              }`}>
                {user.role}
              </span>
              {user.tvs && user.tvs.length > 0 && (
                <span className="text-slate-500 text-xs flex items-center gap-0.5">
                  <Monitor size={10} /> {user.tvs.length}
                </span>
              )}
            </div>
            {user.watching ? (
              <p className="text-xs mt-0.5 text-green-400 flex items-center gap-1">
                <Play size={10} className="fill-green-400" />
                <span className="truncate max-w-[250px]">Viendo: {movieNameFromPath(user.watching.video_path)}</span>
              </p>
            ) : (
              <p className="text-slate-500 text-xs mt-0.5">
                {user.last_login ? `Ultimo acceso: ${formatDate(user.last_login)}` : 'Sin acceso'}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm(`Eliminar usuario "${user.username}"?`)) {
                onDeleteUser(user.id);
              }
            }}
            disabled={isSelf}
            className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
            title={isSelf ? 'No puedes eliminarte a ti mismo' : 'Eliminar usuario'}
          >
            <Trash2 size={16} />
          </button>
          {expanded ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronRight size={18} className="text-slate-400" />}
        </div>
      </div>

      {/* Expandable body */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4 border-t border-slate-700/50 pt-3">
              {/* Section: User Data */}
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <User size={12} /> Datos de usuario
                </h4>
                <div className="space-y-2 text-sm">
                  {/* Email */}
                  <div className="flex items-center gap-2">
                    <Mail size={13} className="text-slate-500 flex-shrink-0" />
                    {editingEmail ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          type="email"
                          value={emailValue}
                          onChange={e => setEmailValue(e.target.value)}
                          onKeyDown={handleEmailKeyDown}
                          onBlur={handleEmailSave}
                          autoFocus
                          className="px-2 py-1 bg-slate-700 rounded border border-slate-600 text-white text-sm flex-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          placeholder="email@ejemplo.com"
                        />
                      </div>
                    ) : (
                      <span
                        className="text-slate-300 cursor-pointer hover:text-indigo-400 transition-colors"
                        onClick={() => { setEmailValue(user.email || ''); setEditingEmail(true); }}
                        title="Click para editar"
                      >
                        {user.email || <span className="text-slate-600 italic">Sin email — click para añadir</span>}
                      </span>
                    )}
                  </div>
                  {/* Created */}
                  <div className="flex items-center gap-2 text-slate-500">
                    <span className="text-xs">Creado: {formatDate(user.created_at)}</span>
                  </div>
                  {/* Email notifications toggle */}
                  {user.email && (
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 text-xs">Notificaciones email:</span>
                      <button
                        onClick={handleToggleNotifications}
                        className={`relative w-9 h-5 rounded-full transition-colors ${
                          user.email_notifications ? 'bg-indigo-600' : 'bg-slate-600'
                        }`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                          user.email_notifications ? 'left-[18px]' : 'left-0.5'
                        }`} />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Section: TVs */}
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Monitor size={12} /> TVs asociadas
                </h4>

                {/* TV List */}
                {user.tvs && user.tvs.length > 0 ? (
                  <div className="space-y-2 mb-2">
                    {user.tvs.map(tv => (
                      <div key={tv.id} className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50">
                        <div className="flex items-start justify-between">
                          <div className="min-w-0">
                            <div className="text-white text-sm font-medium">
                              {tv.brand || 'LG'} {tv.model}
                              {tv.year ? <span className="text-slate-500 font-normal"> ({tv.year})</span> : null}
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-slate-400">
                              {tv.webos_version && <span>webOS {tv.webos_version}</span>}
                              {tv.ip_address && <span>{tv.ip_address}</span>}
                              {tv.connection_type && (
                                <span className="flex items-center gap-0.5">
                                  <Wifi size={10} /> {tv.connection_type}
                                </span>
                              )}
                              {tv.ares_device_name && <span>ares: {tv.ares_device_name}</span>}
                            </div>
                            {tv.notes && <p className="text-slate-500 text-xs mt-1 italic">{tv.notes}</p>}
                          </div>
                          <button
                            onClick={() => {
                              if (window.confirm(`Eliminar TV "${tv.model}"?`)) {
                                onDeleteUserTV(user.id, tv.id);
                              }
                            }}
                            className="p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-900/20 rounded transition-all flex-shrink-0"
                            title="Eliminar TV"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-600 text-xs mb-2 italic">Sin TVs registradas</p>
                )}

                {/* Add TV */}
                {showAddTV ? (
                  <div className="bg-slate-900/50 rounded-lg p-3 border border-indigo-700/30 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Marca (ej: LG)"
                        value={tvForm.brand}
                        onChange={e => setTvForm({ ...tvForm, brand: e.target.value })}
                        className="px-2 py-1.5 bg-slate-700 rounded border border-slate-600 text-white text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                      <input
                        type="text"
                        placeholder="Modelo *"
                        value={tvForm.model}
                        onChange={e => setTvForm({ ...tvForm, model: e.target.value })}
                        className="px-2 py-1.5 bg-slate-700 rounded border border-slate-600 text-white text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                      <input
                        type="text"
                        placeholder="IP (ej: 192.168.1.94)"
                        value={tvForm.ipAddress}
                        onChange={e => setTvForm({ ...tvForm, ipAddress: e.target.value })}
                        className="px-2 py-1.5 bg-slate-700 rounded border border-slate-600 text-white text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                      <select
                        value={tvForm.connectionType}
                        onChange={e => setTvForm({ ...tvForm, connectionType: e.target.value })}
                        className="px-2 py-1.5 bg-slate-700 rounded border border-slate-600 text-white text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="">Conexion...</option>
                        <option value="Wired">Wired</option>
                        <option value="WiFi">WiFi</option>
                      </select>
                      <input
                        type="number"
                        placeholder="Año (ej: 2021)"
                        value={tvForm.year}
                        onChange={e => setTvForm({ ...tvForm, year: e.target.value })}
                        className="px-2 py-1.5 bg-slate-700 rounded border border-slate-600 text-white text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                      <input
                        type="text"
                        placeholder="webOS (ej: 6.0)"
                        value={tvForm.webosVersion}
                        onChange={e => setTvForm({ ...tvForm, webosVersion: e.target.value })}
                        className="px-2 py-1.5 bg-slate-700 rounded border border-slate-600 text-white text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>

                    {/* Advanced fields */}
                    <button
                      type="button"
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
                    >
                      {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      Campos avanzados
                    </button>
                    {showAdvanced && (
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          placeholder="Nombre ares (ej: miLGTV)"
                          value={tvForm.aresDeviceName}
                          onChange={e => setTvForm({ ...tvForm, aresDeviceName: e.target.value })}
                          className="px-2 py-1.5 bg-slate-700 rounded border border-slate-600 text-white text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                        <input
                          type="text"
                          placeholder="Notas"
                          value={tvForm.notes}
                          onChange={e => setTvForm({ ...tvForm, notes: e.target.value })}
                          className="px-2 py-1.5 bg-slate-700 rounded border border-slate-600 text-white text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={handleAddTV}
                        disabled={!tvForm.model.trim()}
                        className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Guardar
                      </button>
                      <button
                        onClick={() => { setShowAddTV(false); setShowAdvanced(false); }}
                        className="px-3 py-1.5 bg-slate-700 text-slate-300 text-xs rounded hover:bg-slate-600 transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowAddTV(true)}
                    className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    <Plus size={13} /> Añadir TV
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function UserManagementModal({
  userManagementModal, users, invitations, loadingUsers, activeTab,
  createUserForm, creatingUser, createUserError,
  invitationForm, creatingInvitation, lastCreatedInvitation,
  authState,
  onTabChange, onCreateUserFormChange, onInvitationFormChange,
  onCreateUser, onDeleteUser, onUpdateUser, onUpdateUserEmail, onAddUserTV, onDeleteUserTV,
  onCreateInvitation, onDeleteInvitation,
  onDismissInvitation, onClose
}) {
  const [copiedId, setCopiedId] = useState(null);

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const getInvitationStatus = (inv) => {
    if (inv.used_by) return { label: 'Usada', color: 'text-slate-400 bg-slate-700/50' };
    if (new Date(inv.expires_at) < new Date()) return { label: 'Expirada', color: 'text-red-400 bg-red-900/30' };
    return { label: 'Disponible', color: 'text-green-400 bg-green-900/30' };
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <AnimatePresence>
      {userManagementModal && (
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
            className="bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-700"
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-4 flex items-center justify-between flex-shrink-0">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Shield size={22} />
                Gestion de Usuarios
              </h2>
              <button onClick={onClose} className="text-white/80 hover:text-white transition-colors">
                <X size={24} />
              </button>
            </div>

            {/* Tab Bar */}
            <div className="flex border-b border-slate-700 flex-shrink-0">
              <button
                onClick={() => onTabChange('users')}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'users'
                    ? 'text-indigo-400 border-b-2 border-indigo-400 bg-slate-800/50'
                    : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                Usuarios ({users.length})
              </button>
              <button
                onClick={() => onTabChange('invitations')}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'invitations'
                    ? 'text-indigo-400 border-b-2 border-indigo-400 bg-slate-800/50'
                    : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                Invitaciones ({invitations.length})
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {loadingUsers ? (
                <div className="text-center py-12 text-slate-400">
                  <span className="animate-spin inline-block text-2xl mb-2">&#9203;</span>
                  <p>Cargando...</p>
                </div>
              ) : activeTab === 'users' ? (
                <>
                  {/* Create User Form */}
                  <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                    <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                      <UserPlus size={16} /> Crear Usuario
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <input
                        type="text"
                        placeholder="Nombre de usuario"
                        value={createUserForm.username}
                        onChange={e => onCreateUserFormChange({ ...createUserForm, username: e.target.value })}
                        className="px-3 py-2 bg-slate-700 rounded-lg border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <input
                        type="password"
                        placeholder="Contrasena (min. 8 caracteres)"
                        value={createUserForm.password}
                        onChange={e => onCreateUserFormChange({ ...createUserForm, password: e.target.value })}
                        className="px-3 py-2 bg-slate-700 rounded-lg border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <input
                        type="text"
                        placeholder="Nombre para mostrar (opcional)"
                        value={createUserForm.displayName}
                        onChange={e => onCreateUserFormChange({ ...createUserForm, displayName: e.target.value })}
                        className="px-3 py-2 bg-slate-700 rounded-lg border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <input
                        type="email"
                        placeholder="Email (opcional)"
                        value={createUserForm.email}
                        onChange={e => onCreateUserFormChange({ ...createUserForm, email: e.target.value })}
                        className="px-3 py-2 bg-slate-700 rounded-lg border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <select
                        value={createUserForm.role}
                        onChange={e => onCreateUserFormChange({ ...createUserForm, role: e.target.value })}
                        className="px-3 py-2 bg-slate-700 rounded-lg border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    {createUserError && (
                      <p className="text-red-400 text-sm mt-2">{createUserError}</p>
                    )}
                    <button
                      onClick={onCreateUser}
                      disabled={creatingUser || !createUserForm.username || !createUserForm.password}
                      className="mt-3 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {creatingUser ? 'Creando...' : 'Crear Usuario'}
                    </button>
                  </div>

                  {/* Users List — Expandable Cards */}
                  <div className="space-y-2">
                    {users.map(user => (
                      <UserCard
                        key={user.id}
                        user={user}
                        authState={authState}
                        onDeleteUser={onDeleteUser}
                        onUpdateUser={onUpdateUser}
                        onAddUserTV={onAddUserTV}
                        onDeleteUserTV={onDeleteUserTV}
                        formatDate={formatDate}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <>
                  {/* Create Invitation Form */}
                  <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                    <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                      <Mail size={16} /> Crear Invitacion
                    </h3>
                    <div className="flex flex-wrap gap-3 items-end">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Expira en (dias)</label>
                        <input
                          type="number"
                          min="1"
                          max="90"
                          value={invitationForm.expiresInDays}
                          onChange={e => onInvitationFormChange({ ...invitationForm, expiresInDays: parseInt(e.target.value) || 7 })}
                          className="w-24 px-3 py-2 bg-slate-700 rounded-lg border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Rol</label>
                        <select
                          value={invitationForm.role}
                          onChange={e => onInvitationFormChange({ ...invitationForm, role: e.target.value })}
                          className="px-3 py-2 bg-slate-700 rounded-lg border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="viewer">Viewer</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                      <button
                        onClick={onCreateInvitation}
                        disabled={creatingInvitation}
                        className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                      >
                        {creatingInvitation ? 'Generando...' : 'Generar Invitacion'}
                      </button>
                    </div>

                    {/* Last Created Invitation Banner */}
                    {lastCreatedInvitation && (
                      <div className="mt-4 p-3 bg-green-900/30 border border-green-700/50 rounded-lg">
                        <p className="text-green-300 text-sm font-medium mb-2">Invitacion creada</p>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            readOnly
                            value={lastCreatedInvitation.link}
                            className="flex-1 px-3 py-2 bg-slate-800 rounded-lg border border-slate-600 text-white text-xs font-mono"
                          />
                          <button
                            onClick={() => copyToClipboard(lastCreatedInvitation.link, 'new-inv')}
                            className="p-2 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors text-white flex-shrink-0"
                            title="Copiar enlace"
                          >
                            {copiedId === 'new-inv' ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                          </button>
                        </div>
                        <p className="text-slate-400 text-xs mt-1">
                          Expira: {formatDate(lastCreatedInvitation.expiresAt)}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Invitations List */}
                  <div className="space-y-2">
                    {invitations.length === 0 ? (
                      <p className="text-center text-slate-500 py-8">No hay invitaciones</p>
                    ) : invitations.map(inv => {
                      const status = getInvitationStatus(inv);
                      return (
                        <div key={inv.id} className="flex items-center justify-between bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <code className="text-indigo-300 text-sm font-mono">{inv.code}</code>
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                inv.role === 'admin' ? 'bg-purple-900/50 text-purple-300' : 'bg-slate-700 text-slate-300'
                              }`}>
                                {inv.role || 'viewer'}
                              </span>
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                                {status.label}
                              </span>
                            </div>
                            <p className="text-slate-500 text-xs mt-1">
                              Expira: {formatDate(inv.expires_at)}
                              {inv.used_by_username && ` | Usada por: ${inv.used_by_username}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {!inv.used_by && new Date(inv.expires_at) >= new Date() && (
                              <button
                                onClick={() => copyToClipboard(`${window.location.origin}/register?code=${inv.code}`, `inv-${inv.id}`)}
                                className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-all"
                                title="Copiar enlace"
                              >
                                {copiedId === `inv-${inv.id}` ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                              </button>
                            )}
                            {!inv.used_by && (
                              <button
                                onClick={() => onDeleteInvitation(inv.id)}
                                className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-all"
                                title="Eliminar invitacion"
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
