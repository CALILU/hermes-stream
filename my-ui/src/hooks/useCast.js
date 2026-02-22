import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Hook para gestionar Cast a TV (DLNA)
 * Descubre dispositivos, controla reproduccion remota
 */
export function useCast() {
    const [devices, setDevices] = useState([]);
    const [scanning, setScanning] = useState(false);
    const [activeDevice, setActiveDevice] = useState(null);
    const [castStatus, setCastStatus] = useState({ state: 'idle', currentTime: 0, duration: 0 });
    const [casting, setCasting] = useState(false);
    const statusInterval = useRef(null);

    // Obtener dispositivos
    const fetchDevices = useCallback(async () => {
        try {
            const res = await fetch('/api/dlna/devices');
            const data = await res.json();
            if (data.success) setDevices(data.data || []);
        } catch (e) { /* silencioso */ }
    }, []);

    // Forzar escaneo
    const scanDevices = useCallback(async () => {
        setScanning(true);
        try {
            const res = await fetch('/api/dlna/scan', { method: 'POST' });
            const data = await res.json();
            if (data.success) setDevices(data.data || []);
        } catch (e) { /* silencioso */ }
        setScanning(false);
    }, []);

    // Enviar video a dispositivo
    const castToDevice = useCallback(async (device, video) => {
        try {
            const res = await fetch('/api/dlna/play', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deviceUrl: device.url, video })
            });
            const data = await res.json();
            if (data.success) {
                setActiveDevice(device);
                setCasting(true);
                startStatusPolling();
            }
            return data;
        } catch (e) {
            return { success: false, error: e.message };
        }
    }, []);

    // Pausar
    const pauseCast = useCallback(async () => {
        try {
            await fetch('/api/dlna/pause', { method: 'POST' });
        } catch (e) { /* silencioso */ }
    }, []);

    // Reanudar
    const resumeCast = useCallback(async () => {
        try {
            await fetch('/api/dlna/resume', { method: 'POST' });
        } catch (e) { /* silencioso */ }
    }, []);

    // Detener
    const stopCast = useCallback(async () => {
        try {
            await fetch('/api/dlna/stop', { method: 'POST' });
        } catch (e) { /* silencioso */ }
        setCasting(false);
        setActiveDevice(null);
        setCastStatus({ state: 'idle', currentTime: 0, duration: 0 });
        stopStatusPolling();
    }, []);

    // Seek
    const seekCast = useCallback(async (seconds) => {
        try {
            await fetch('/api/dlna/seek', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ seconds })
            });
        } catch (e) { /* silencioso */ }
    }, []);

    // Volumen
    const setVolume = useCallback(async (level) => {
        try {
            await fetch('/api/dlna/volume', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ level })
            });
        } catch (e) { /* silencioso */ }
    }, []);

    // Añadir dispositivo manual por IP
    const addManualDevice = useCallback(async (ip) => {
        try {
            const res = await fetch('/api/dlna/add-device', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip })
            });
            const data = await res.json();
            if (data.success) {
                await fetchDevices();
            }
            return data;
        } catch (e) {
            return { success: false, error: e.message };
        }
    }, [fetchDevices]);

    // Eliminar dispositivo manual
    const removeManualDevice = useCallback(async (ip) => {
        try {
            const res = await fetch('/api/dlna/remove-device', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip })
            });
            const data = await res.json();
            if (data.success) {
                await fetchDevices();
            }
            return data;
        } catch (e) {
            return { success: false, error: e.message };
        }
    }, [fetchDevices]);

    // Polling de estado
    const startStatusPolling = useCallback(() => {
        stopStatusPolling();
        statusInterval.current = setInterval(async () => {
            try {
                const res = await fetch('/api/dlna/status');
                const data = await res.json();
                if (data.success && data.data) {
                    setCastStatus(data.data);
                    if (data.data.state === 'stopped' || !data.data.active) {
                        setCasting(false);
                        setActiveDevice(null);
                        stopStatusPolling();
                    }
                }
            } catch (e) { /* silencioso */ }
        }, 2000);
    }, []);

    const stopStatusPolling = useCallback(() => {
        if (statusInterval.current) {
            clearInterval(statusInterval.current);
            statusInterval.current = null;
        }
    }, []);

    // Fetch inicial de dispositivos
    useEffect(() => {
        fetchDevices();
        return () => stopStatusPolling();
    }, [fetchDevices, stopStatusPolling]);

    return {
        devices,
        scanning,
        activeDevice,
        castStatus,
        casting,
        fetchDevices,
        scanDevices,
        castToDevice,
        pauseCast,
        resumeCast,
        stopCast,
        seekCast,
        setVolume,
        addManualDevice,
        removeManualDevice
    };
}
