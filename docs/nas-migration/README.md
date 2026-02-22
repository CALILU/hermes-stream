# IsiPrime Server — Migración a NAS

Migración de IsiPrime desde un PC con Windows (acceso FTP a Synology NAS) a un servidor autónomo en LincStation N2, capaz de servir contenido de streaming a 5-10 usuarios remotos vía HTTPS.

---

## IsiPrime Local vs IsiPrime Server

| Aspecto | IsiPrime Local (actual) | IsiPrime Server (objetivo) |
|---------|------------------------|---------------------------|
| **Plataforma** | PC con Windows 10/11 | LincStation N2 (Debian 12) |
| **Almacenamiento** | Synology NAS vía FTP | Discos locales SATA del propio NAS |
| **Usuarios** | 1 usuario en LAN | 5-10 usuarios remotos vía HTTPS |
| **Acceso** | Red local (192.168.x.x) | Internet (dominio + certificado SSL) |
| **Frontend** | React 19 + Tailwind CSS | Mismo frontend sin cambios |
| **Backend** | Express en Node.js | Mismo código base adaptado |
| **Inicio** | Manual (VBS launcher) | Siempre encendido (PM2 + systemd) |
| **Transcodificación** | FFmpeg por software | FFmpeg con Intel Quick Sync (VAAPI/QSV) |
| **Proxy** | Ninguno | nginx (HTTPS, archivos estáticos, WebSocket) |
| **Autenticación** | Auto-login en red local | Cuentas individuales con JWT |

---

## Hardware — LincStation N2

| Componente | Especificación | Uso en IsiPrime Server |
|------------|---------------|------------------------|
| CPU | Intel N100 (4 cores, 3.4 GHz burst, TDP 6W) | Servidor Node.js + transcodificación por hardware (Quick Sync Video) |
| RAM | 16 GB DDR5 | Node.js + FFmpeg + nginx + SO (margen de sobra) |
| eMMC | 128 GB | Arranque del SO (Debian 12) |
| NVMe | 4x M.2 (2x 2280, 2x 2242) | SO + aplicación, base de datos SQLite, caché de transcodificación |
| SATA | 2x bahías 2.5" | Almacenamiento de medios (películas, series) |
| Red | 10 GbE + 2.5 GbE | Transferencias LAN (irrelevante para streaming remoto) |
| HDMI | 2.0 | Reproducción local opcional |
| USB | 2x USB-A 3.2 | Discos externos, conexión serial UPS |

---

## Objetivos

- Servir a 5-10 usuarios de forma remota desde sus hogares
- Compatibilidad con PC (navegador), Smart TV (navegador/DLNA) y móvil (navegador)
- HTTPS con certificado SSL válido (Let's Encrypt)
- Cuentas de usuario individuales con seguimiento de progreso de visualización
- Transcodificación por hardware para formatos incompatibles (AVI, MKV con codecs no soportados)
- Servidor siempre encendido, inicio automático tras arranque o corte de luz

---

## Stack Tecnológico

| Capa | Tecnología | Notas |
|------|-----------|-------|
| **SO** | Debian 12 Bookworm (headless) | Estable, soporte largo, compatible con Intel N100 |
| **Runtime** | Node.js 20 LTS | Mismo runtime que la versión actual |
| **Backend** | Express 5 | Código base actual adaptado |
| **Frontend** | React 19 + Tailwind CSS | Sin cambios, se sirve como build estático |
| **Base de datos** | SQLite (better-sqlite3, modo WAL) | Usuarios, sesiones, progreso, peticiones |
| **Reverse Proxy** | nginx | Terminación HTTPS, archivos estáticos, WebSocket |
| **Transcodificación** | FFmpeg con VAAPI/QSV | Intel Quick Sync Video del N100 |
| **Gestor de procesos** | PM2 (modo cluster, 4 instancias) | Auto-restart, logs, monitorización |
| **SSL** | Let's Encrypt vía certbot | Renovación automática cada 90 días |
| **DDNS** | calilu.mooo.com (o dominio nuevo) | IP dinámica del router del NAS |

---

## Documentos del Proyecto

| Documento | Contenido |
|-----------|-----------|
| [`architecture.md`](architecture.md) | Arquitectura técnica, componentes, diseño de base de datos |
| [`authentication.md`](authentication.md) | Sistema multi-usuario, JWT, roles, seguridad |
| [`streaming.md`](streaming.md) | Estrategia de streaming, transcodificación por hardware, compatibilidad multi-dispositivo |
| [`networking.md`](networking.md) | DDNS, HTTPS, nginx, port forwarding, firewall |
| [`migration-plan.md`](migration-plan.md) | Plan de migración paso a paso en 7 fases |

---

## Compatibilidad Multi-Dispositivo

Se ha verificado que el stack tecnológico elegido es compatible con todos los dispositivos objetivo:

| Dispositivo | Método de Acceso | Compatibilidad |
|-------------|-----------------|----------------|
| PC (Chrome, Edge, Firefox) | Navegador web | Total — React 19, Tailwind, Framer Motion, video HTML5 |
| Smart TV 2021+ (WebOS 6+, Tizen 5+) | Navegador web | Total — Chromium 79+ soporta todo el stack |
| Smart TV 2018-2020 | DLNA (en LAN local del NAS) | Total — MP4 H.264 vía UPnP, sin necesidad de navegador |
| Android TV / Fire TV | Navegador o app | Total — Chrome 80+ en Android TV |
| iPhone / iPad (Safari) | Navegador web | Total — WebKit iOS 15+ |
| Móvil Android (Chrome) | Navegador web | Total — Chrome mobile |
| Chromecast | DLNA/Cast desde la app | Total — MP4 H.264 es el formato nativo |

**Formato universal**: MP4 con H.264 + AAC funciona en el 100% de los dispositivos. La estrategia de transcodificar AVI on-the-fly y remuxear MKV a MP4 garantiza compatibilidad total.

**Detalles técnicos**: ver [`streaming.md` sección 12](streaming.md#12-verificacion-de-compatibilidad-multi-dispositivo).

---

## Código Base Actual

El proyecto consiste en un backend Node.js/Express (`server.js` + 12 archivos de rutas + 10 módulos de librería) con un frontend React (`my-ui/`).

**Dependencias principales**: express, basic-ftp, better-sqlite3, axios, fluent-ffmpeg, cors, dotenv.

**Estado actual**: utiliza FTP para leer contenido de la Synology NAS y archivos JSON para la mayoría de los datos (caché de metadatos, colecciones, episodios de series, cola de descargas, usuarios). SQLite se usa únicamente para las peticiones de películas.

La migración adapta este código base para funcionar de forma autónoma en el NAS, eliminando la dependencia de FTP y ampliando el sistema de autenticación para múltiples usuarios remotos.
