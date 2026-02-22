# Dependencies - Historial de Cambios

---

## Sesion: 2026-02-16 15:00

### Cambios Realizados
- Instaladas 2 nuevas dependencias npm para DLNA Cast a TV

### Paquetes Anadidos
| Paquete | Version | Proposito |
|---------|---------|-----------|
| `node-ssdp` | 4.0.1 | Descubrimiento SSDP de dispositivos UPnP/DLNA en la red local |
| `upnp-mediarenderer-client` | 1.4.0 | Control de MediaRenderers UPnP (play, pause, stop, seek, volume) |

### Comando de Instalacion
```bash
npm install node-ssdp upnp-mediarenderer-client
```

### Notas
- Instaladas desde PowerShell (mas rapido que WSL para npm)
- Usadas unicamente en `lib/dlna.js` (backend)
- No requieren configuracion adicional
- `node-ssdp` usa multicast UDP (no abre puertos TCP adicionales)

---
