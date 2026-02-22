import React, { useState } from 'react';
import { X, Tv, RefreshCw, Loader2, Play, Pause, Square, Volume2, Airplay, Plus, Trash2 } from 'lucide-react';

/**
 * Modal para seleccionar dispositivo DLNA y controlar reproduccion
 */
export default function CastDeviceModal({
    show,
    onClose,
    devices,
    scanning,
    casting,
    activeDevice,
    castStatus,
    onScan,
    onCast,
    onPause,
    onResume,
    onStop,
    onSeek,
    onVolume,
    onAddManualDevice,
    onRemoveManualDevice,
    videoTitle
}) {
    const [manualIp, setManualIp] = useState('');
    const [manualName, setManualName] = useState('');
    const [addingDevice, setAddingDevice] = useState(false);
    const [addError, setAddError] = useState('');

    if (!show) return null;

    const formatTime = (s) => {
        if (!s || isNaN(s)) return '0:00';
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
        return `${m}:${String(sec).padStart(2, '0')}`;
    };

    const progress = castStatus.duration > 0
        ? (castStatus.currentTime / castStatus.duration) * 100
        : 0;

    const handleAddManualDevice = async () => {
        if (!manualIp.trim()) return;
        setAddingDevice(true);
        setAddError('');
        const result = await onAddManualDevice(manualIp.trim(), manualName.trim() || null);
        if (!result.success) {
            setAddError(result.error || 'No se pudo conectar');
        } else {
            setManualIp('');
            setManualName('');
        }
        setAddingDevice(false);
    };

    const handleRemoveManualDevice = async (e, ip) => {
        e.stopPropagation();
        await onRemoveManualDevice(ip);
    };

    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
            onClick={onClose}
        >
            <div
                className="bg-slate-800 rounded-xl w-full max-w-md mx-4 shadow-2xl border border-slate-700"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-700">
                    <div className="flex items-center gap-2">
                        <Airplay size={20} className="text-blue-400" />
                        <h3 className="text-white font-semibold">Enviar a TV</h3>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Controles de cast activo */}
                {casting && activeDevice && (
                    <div className="p-4 border-b border-slate-700 bg-slate-700/50">
                        <div className="flex items-center gap-2 mb-3">
                            <Tv size={16} className="text-blue-400" />
                            <span className="text-blue-300 text-sm font-medium">{activeDevice.name}</span>
                            <span className="text-xs text-slate-400 ml-auto">
                                {castStatus.state === 'playing' ? 'Reproduciendo' :
                                 castStatus.state === 'paused' ? 'Pausado' :
                                 castStatus.state === 'loading' ? 'Cargando...' :
                                 castStatus.state || 'Conectado'}
                            </span>
                        </div>

                        {videoTitle && (
                            <p className="text-white text-sm mb-3 truncate">{videoTitle}</p>
                        )}

                        {/* Barra de progreso */}
                        <div className="mb-2">
                            <div
                                className="w-full h-1.5 bg-slate-600 rounded-full cursor-pointer"
                                onClick={(e) => {
                                    if (!castStatus.duration) return;
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const pct = (e.clientX - rect.left) / rect.width;
                                    onSeek(Math.floor(pct * castStatus.duration));
                                }}
                            >
                                <div
                                    className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <div className="flex justify-between text-xs text-slate-400 mt-1">
                                <span>{formatTime(castStatus.currentTime)}</span>
                                <span>{formatTime(castStatus.duration)}</span>
                            </div>
                        </div>

                        {/* Controles de reproduccion */}
                        <div className="flex items-center justify-center gap-4">
                            {castStatus.state === 'playing' ? (
                                <button
                                    onClick={onPause}
                                    className="p-2 bg-slate-600 hover:bg-slate-500 rounded-full text-white transition-colors"
                                >
                                    <Pause size={20} />
                                </button>
                            ) : (
                                <button
                                    onClick={onResume}
                                    className="p-2 bg-blue-600 hover:bg-blue-500 rounded-full text-white transition-colors"
                                >
                                    <Play size={20} />
                                </button>
                            )}
                            <button
                                onClick={onStop}
                                className="p-2 bg-red-600/80 hover:bg-red-500 rounded-full text-white transition-colors"
                            >
                                <Square size={16} />
                            </button>
                            <div className="flex items-center gap-2 ml-4">
                                <Volume2 size={16} className="text-slate-400" />
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    defaultValue="50"
                                    onChange={(e) => onVolume(parseInt(e.target.value))}
                                    className="w-20 h-1 accent-blue-500"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* Lista de dispositivos */}
                <div className="p-4">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-slate-300 text-sm">
                            {devices.length > 0
                                ? `${devices.length} dispositivo${devices.length > 1 ? 's' : ''} encontrado${devices.length > 1 ? 's' : ''}`
                                : 'Buscando dispositivos...'}
                        </span>
                        <button
                            onClick={onScan}
                            disabled={scanning}
                            className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
                        >
                            {scanning ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            {scanning ? 'Buscando...' : 'Buscar'}
                        </button>
                    </div>

                    {devices.length === 0 && !scanning && (
                        <div className="text-center py-4">
                            <Tv size={40} className="mx-auto text-slate-600 mb-2" />
                            <p className="text-slate-400 text-sm">No se encontraron TVs en la red</p>
                            <p className="text-slate-500 text-xs mt-1">
                                Introduce la IP de tu TV manualmente
                            </p>
                        </div>
                    )}

                    {scanning && devices.length === 0 && (
                        <div className="text-center py-4">
                            <Loader2 size={32} className="mx-auto text-blue-400 animate-spin mb-2" />
                            <p className="text-slate-400 text-sm">Buscando dispositivos DLNA...</p>
                        </div>
                    )}

                    <div className="space-y-2 max-h-48 overflow-y-auto">
                        {devices.map((device, idx) => {
                            const isActive = activeDevice && activeDevice.url === device.url;
                            return (
                                <button
                                    key={device.url || idx}
                                    onClick={() => !isActive && onCast(device)}
                                    disabled={isActive}
                                    className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all ${
                                        isActive
                                            ? 'bg-blue-600/20 border border-blue-500/50 cursor-default'
                                            : 'bg-slate-700/50 hover:bg-slate-700 border border-transparent'
                                    }`}
                                >
                                    <Tv size={20} className={isActive ? 'text-blue-400' : 'text-slate-400'} />
                                    <div className="flex-1 text-left min-w-0">
                                        <p className={`text-sm font-medium ${isActive ? 'text-blue-300' : 'text-white'}`}>
                                            {device.name}
                                            {device.manual && (
                                                <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-amber-600/30 text-amber-400 rounded">Manual</span>
                                            )}
                                        </p>
                                        <p className="text-xs text-slate-500">{device.address}</p>
                                    </div>
                                    {device.manual && !isActive && (
                                        <button
                                            onClick={(e) => handleRemoveManualDevice(e, device.address)}
                                            className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                                            title="Eliminar dispositivo manual"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                    {isActive ? (
                                        <span className="text-xs text-blue-400">Conectado</span>
                                    ) : !device.manual ? (
                                        <Play size={16} className="text-slate-500" />
                                    ) : null}
                                </button>
                            );
                        })}
                    </div>

                    {/* Añadir dispositivo manual */}
                    <div className="mt-4 pt-3 border-t border-slate-700">
                        <p className="text-slate-500 text-xs mb-2">
                            Si tu TV no aparece, introduce su IP manualmente
                        </p>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={manualIp}
                                onChange={(e) => { setManualIp(e.target.value); setAddError(''); }}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddManualDevice()}
                                placeholder="192.168.1.100"
                                disabled={addingDevice}
                                className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                            />
                            <button
                                onClick={handleAddManualDevice}
                                disabled={addingDevice || !manualIp.trim()}
                                className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:opacity-50 rounded-lg text-white text-sm transition-colors"
                            >
                                {addingDevice ? (
                                    <Loader2 size={14} className="animate-spin" />
                                ) : (
                                    <Plus size={14} />
                                )}
                                {addingDevice ? 'Probando...' : 'Añadir'}
                            </button>
                        </div>
                        <input
                            type="text"
                            value={manualName}
                            onChange={(e) => setManualName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddManualDevice()}
                            placeholder="Nombre (opcional, ej: TV Salon)"
                            disabled={addingDevice}
                            className="w-full mt-2 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                        />
                        {addError && (
                            <p className="text-red-400 text-xs mt-2">{addError}</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
