# Plan de Migracion: IsiPrime a LincStation N2

## Resumen

Migrar IsiPrime desde un PC Windows (con almacenamiento en Synology NAS via FTP) a un LincStation N2 NAS ejecutando Debian 12. El resultado final sera una aplicacion autocontenida: sistema operativo, aplicacion y contenido multimedia, todo en un unico dispositivo accesible por internet.

### Hardware del LincStation N2

| Componente | Especificacion |
|-----------|----------------|
| CPU | Intel N100 (4 cores, 3.4 GHz boost) |
| RAM | 16 GB LPDDR5 |
| Almacenamiento OS | 128 GB eMMC |
| NVMe | 4x bahias M.2 |
| SATA | 2x bahias 2.5" |
| Red | 10 GbE + 2.5 GbE |
| GPU integrada | Intel UHD (Quick Sync - transcodificacion hardware) |

### Dependencias actuales del proyecto

```
express@5, basic-ftp, better-sqlite3, axios, fluent-ffmpeg,
cors, dotenv, node-ssdp, nodemon (dev)
```

### Archivos de datos a migrar

```
requests.db          (SQLite - peticiones de usuarios)
cache.json           (cache de metadatos de peliculas)
cache-series.json    (cache de series)
series-episodes.json (episodios de series)
collections.json     (colecciones de peliculas)
download-queue.json  (cola de descargas)
users.json           (usuarios y credenciales)
storage-settings.json (configuracion de almacenamiento)
```

---

## Fase 1: Instalacion de Debian 12 en LincStation N2

**Objetivo**: Sistema operativo base funcionando con todos los discos correctamente montados.

**Tiempo estimado**: 2-3 horas

### Paso 1.1 - Preparar USB bootable

Descargar la imagen de instalacion de Debian 12 Bookworm (netinst):

```
https://www.debian.org/download
Archivo: debian-12-amd64-netinst.iso (~600 MB)
```

Crear el USB bootable desde Windows:

```bash
# Opcion A: Rufus (Windows) - recomendado
# 1. Descargar Rufus desde https://rufus.ie
# 2. Seleccionar USB, seleccionar ISO
# 3. Esquema de particion: GPT
# 4. Sistema destino: UEFI
# 5. Clic en "Empezar"

# Opcion B: dd (desde Linux/WSL)
sudo dd if=debian-12-amd64-netinst.iso of=/dev/sdX bs=4M status=progress
sync
```

### Paso 1.2 - Configurar BIOS del LincStation N2

Conectar teclado y monitor al NAS. Encender y pulsar `DEL` o `F2` para entrar al BIOS.

Configuraciones necesarias:

| Parametro | Valor | Motivo |
|-----------|-------|--------|
| Boot Order | USB primero | Para instalar desde USB |
| Intel VT-x | Enabled | Para contenedores Docker futuros |
| Restore on AC Power Loss | Power On | El NAS se reinicia automaticamente tras un corte de luz |
| Secure Boot | Disabled | Puede interferir con la instalacion |

### Paso 1.3 - Instalar Debian 12

Arrancar desde el USB e instalar con estas opciones:

```
Idioma:            Espanol
Ubicacion:         Espana
Teclado:           Espanol
Hostname:          isiprime-nas
Dominio:           (dejar vacio)
Root password:     (establecer una contrasena segura)
Usuario:           isidro
Disco:             eMMC de 128 GB (NO los NVMe ni SATA)
```

**Esquema de particiones en el eMMC (128 GB)**:

| Particion | Tamano | Tipo | Punto de montaje |
|-----------|--------|------|-----------------|
| EFI | 512 MB | EFI System Partition | /boot/efi |
| swap | 4 GB | Linux swap | - |
| root | ~123 GB | ext4 | / |

**Seleccion de software** (pantalla tasksel):

```
[x] SSH server
[x] Standard system utilities
[ ] Desktop environment     ← NO marcar (sin GUI)
[ ] Web server              ← instalaremos nginx manualmente
[ ] Print server            ← NO
```

### Paso 1.4 - Configurar almacenamiento NVMe

Una vez instalado Debian, identificar los discos:

```bash
lsblk
# Deberia mostrar:
# mmcblk0       (eMMC - sistema operativo)
# nvme0n1       (NVMe slot 1)
# nvme1n1       (NVMe slot 2, si existe)
# sda           (SATA 1, si existe)
# sdb           (SATA 2, si existe)
```

Formatear y montar el NVMe principal para la aplicacion:

```bash
# Formatear NVMe como ext4
sudo mkfs.ext4 -L isiprime-app /dev/nvme0n1

# Crear punto de montaje
sudo mkdir -p /opt/isiprime
sudo mkdir -p /var/lib/isiprime

# Montar temporalmente para verificar
sudo mount /dev/nvme0n1 /opt/isiprime

# Obtener UUID para fstab
blkid /dev/nvme0n1
# Copiar el UUID que aparece
```

Si hay un segundo NVMe, usarlo para datos de la aplicacion:

```bash
sudo mkfs.ext4 -L isiprime-data /dev/nvme1n1
sudo mount /dev/nvme1n1 /var/lib/isiprime
```

### Paso 1.5 - Configurar almacenamiento SATA

Los discos SATA almacenaran las peliculas y series.

**Opcion A: RAID 1 (espejo) - si los 2 discos son del mismo tamano**:

```bash
# Instalar mdadm
sudo apt install -y mdadm

# Crear RAID 1
sudo mdadm --create /dev/md0 --level=1 --raid-devices=2 /dev/sda /dev/sdb

# Formatear
sudo mkfs.ext4 -L media-library /dev/md0

# Montar
sudo mkdir -p /media/library
sudo mount /dev/md0 /media/library

# Crear subdirectorios
sudo mkdir -p /media/library/Peliculas
sudo mkdir -p /media/library/Series

# Crear enlaces simbolicos para comodidad
sudo ln -s /media/library/Peliculas /media/movies
sudo ln -s /media/library/Series /media/series

# Guardar configuracion RAID
sudo mdadm --detail --scan >> /etc/mdadm/mdadm.conf
sudo update-initramfs -u
```

**Opcion B: Discos individuales - si son de diferente tamano**:

```bash
# Formatear cada disco
sudo mkfs.ext4 -L peliculas /dev/sda
sudo mkfs.ext4 -L series /dev/sdb

# Montar
sudo mkdir -p /media/movies /media/series
sudo mount /dev/sda /media/movies
sudo mount /dev/sdb /media/series
```

### Paso 1.6 - Configurar /etc/fstab

Anadir todas las particiones al fstab para montaje automatico al arrancar:

```bash
# Obtener todos los UUIDs
blkid

# Editar fstab
sudo nano /etc/fstab
```

Agregar las lineas correspondientes (reemplazar UUIDs reales):

```fstab
# NVMe - Aplicacion
UUID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx  /opt/isiprime      ext4  defaults,noatime  0  2

# NVMe 2 - Datos (si existe)
UUID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx  /var/lib/isiprime  ext4  defaults,noatime  0  2

# SATA - Media (Opcion A: RAID)
UUID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx  /media/library     ext4  defaults,noatime  0  2

# SATA - Media (Opcion B: Individuales)
# UUID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx  /media/movies    ext4  defaults,noatime  0  2
# UUID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx  /media/series    ext4  defaults,noatime  0  2
```

Verificar que monta correctamente:

```bash
sudo mount -a
# Si no hay errores, todo esta bien
```

### Paso 1.7 - Post-instalacion basica

```bash
# Actualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar herramientas esenciales
sudo apt install -y sudo curl wget git htop ufw nano

# Verificar que el usuario isidro tiene sudo
sudo usermod -aG sudo isidro

# Establecer permisos en los directorios
sudo chown -R isidro:isidro /opt/isiprime
sudo chown -R isidro:isidro /var/lib/isiprime
sudo chown -R isidro:isidro /media/movies /media/series
```

### Paso 1.8 - Configurar IP estatica

**Opcion A: En el router (Livebox) - recomendado**:

```
Livebox Admin (192.168.1.1) → Red → DHCP → Reservar IP
MAC del NAS: xx:xx:xx:xx:xx:xx
IP reservada: 192.168.1.100 (o la que prefieras)
```

**Opcion B: En el NAS directamente**:

```bash
sudo nano /etc/network/interfaces
```

```
auto enp1s0
iface enp1s0 inet static
    address 192.168.1.100
    netmask 255.255.255.0
    gateway 192.168.1.1
    dns-nameservers 8.8.8.8 8.8.4.4
```

```bash
sudo systemctl restart networking
```

### Verificacion de Fase 1

```bash
# Desde el PC Windows, conectar por SSH
ssh isidro@192.168.1.100

# Ya en el NAS, verificar:
# 1. Sistema operativo
cat /etc/debian_version    # Debe mostrar 12.x
uname -a                   # Debe mostrar kernel Linux

# 2. Discos montados
lsblk
df -h
# Verificar que aparecen todos los discos con sus puntos de montaje

# 3. Espacio disponible
df -h /opt/isiprime /var/lib/isiprime /media/movies /media/series

# 4. Red
ip addr show               # Verificar IP asignada
ping -c 3 google.com       # Verificar acceso a internet

# 5. SSH funcionando (ya lo estamos usando)
echo "Fase 1 completada correctamente"
```

---

## Fase 2: Instalar Stack de Software

**Objetivo**: Todas las herramientas necesarias instaladas y funcionando.

**Tiempo estimado**: 1-2 horas

**Dependencia**: Fase 1 completada

> NOTA: Las Fases 2 y 3 pueden ejecutarse en paralelo si hay dos personas disponibles.

### Paso 2.1 - Node.js 20 LTS

```bash
# Instalar Node.js 20 LTS desde NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# Verificar
node --version    # Debe mostrar v20.x.x
npm --version     # Debe mostrar 10.x.x
```

### Paso 2.2 - FFmpeg con soporte VAAPI (aceleracion hardware Intel)

El Intel N100 tiene Intel UHD Graphics con Quick Sync, que permite transcodificar video por hardware:

```bash
# Instalar FFmpeg y drivers de aceleracion Intel
sudo apt install -y ffmpeg vainfo intel-media-va-driver-non-free

# Anadir usuario al grupo video y render (necesario para VAAPI)
sudo usermod -aG video,render isidro

# IMPORTANTE: Cerrar sesion y volver a entrar para que los grupos surtan efecto
exit
ssh isidro@192.168.1.100

# Verificar que VAAPI funciona
vainfo
```

La salida de `vainfo` debe mostrar perfiles como:

```
VAProfileH264Main               : VAEntrypointVLD
VAProfileH264Main               : VAEntrypointEncSlice
VAProfileHEVCMain               : VAEntrypointVLD
VAProfileHEVCMain               : VAEntrypointEncSlice
```

Si `vainfo` falla con "permission denied":

```bash
# Verificar que el dispositivo de render existe
ls -la /dev/dri/
# Debe mostrar card0 y renderD128

# Verificar grupos del usuario
groups isidro
# Debe incluir: video render

# Si sigue fallando, verificar permisos del dispositivo
sudo chmod 666 /dev/dri/renderD128
```

### Paso 2.3 - nginx (proxy inverso)

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx

# Verificar
sudo systemctl status nginx    # Debe mostrar "active (running)"
curl http://localhost           # Debe mostrar pagina por defecto de nginx
```

### Paso 2.4 - PM2 (gestor de procesos Node.js)

```bash
# Instalar PM2 globalmente
sudo npm install -g pm2

# Configurar PM2 para arrancar con el sistema
pm2 startup systemd
# PM2 mostrara un comando sudo que hay que ejecutar, por ejemplo:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u isidro --hp /home/isidro

# Ejecutar el comando que muestre PM2
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u isidro --hp /home/isidro

# Verificar
pm2 --version
```

### Paso 2.5 - Certbot (certificados SSL)

```bash
sudo apt install -y certbot python3-certbot-nginx

# Verificar
certbot --version
```

### Paso 2.6 - SQLite y herramientas de compilacion

```bash
# SQLite CLI (para consultas manuales y backups)
sudo apt install -y sqlite3

# Build tools (necesarios para compilar better-sqlite3 desde npm)
sudo apt install -y build-essential python3

# Verificar
sqlite3 --version
gcc --version
python3 --version
```

### Verificacion de Fase 2

```bash
echo "=== Verificacion de Stack ==="

echo "Node.js:" && node --version
echo "npm:" && npm --version
echo "FFmpeg:" && ffmpeg -version 2>&1 | head -1
echo "VAAPI:" && vainfo 2>&1 | head -5
echo "nginx:" && nginx -v 2>&1
echo "PM2:" && pm2 --version
echo "certbot:" && certbot --version 2>&1
echo "SQLite:" && sqlite3 --version
echo "gcc:" && gcc --version 2>&1 | head -1
echo "Python:" && python3 --version

echo ""
echo "Si todos los comandos muestran version, Fase 2 completada."
```

---

## Fase 3: Migrar Contenido del Synology

**Objetivo**: Todos los archivos multimedia transferidos a los discos del LincStation.

**Tiempo estimado**: 10-12 horas para ~4 TB sobre Gigabit LAN (variable segun tamano)

**Dependencia**: Fase 1 completada (discos montados)

> NOTA: Esta fase puede ejecutarse en paralelo con la Fase 2.

### Paso 3.1 - Elegir metodo de transferencia

| Metodo | Velocidad | Facilidad | Requisitos |
|--------|-----------|-----------|------------|
| rsync via SSH | ~100 MB/s | Alta | SSH habilitado en Synology |
| NFS mount + cp | ~100 MB/s | Media | NFS habilitado en Synology |
| SMB mount + cp | ~80 MB/s | Media | SMB habilitado (por defecto) |
| USB externo | Variable | Baja | Disco USB de suficiente tamano |

**Metodo recomendado: rsync via SSH** (reanudable, verifica integridad)

### Paso 3.2 - Transferir archivos

**Opcion A: rsync via SSH (recomendado)**

Primero, habilitar SSH en el Synology:
```
DSM → Panel de Control → Terminal y SNMP → Habilitar servicio SSH
```

Desde el LincStation N2:

```bash
# Peliculas
rsync -avP --stats \
  usuario@synology-ip:/volume1/Peliculas/ \
  /media/movies/

# Series
rsync -avP --stats \
  usuario@synology-ip:/volume1/Series/ \
  /media/series/
```

Parametros de rsync:
- `-a`: modo archivo (preserva permisos, fechas, etc.)
- `-v`: verbose (muestra progreso)
- `-P`: muestra progreso + permite reanudar transferencias interrumpidas
- `--stats`: muestra estadisticas al final

Si se interrumpe la transferencia, simplemente volver a ejecutar el mismo comando. rsync solo transferira los archivos que faltan.

**Opcion B: Montar recurso NFS del Synology**

Habilitar NFS en el Synology:
```
DSM → Panel de Control → Carpeta Compartida → [Carpeta] → Editar → Permisos NFS
Anadir regla: IP del LincStation, lectura/escritura
```

Desde el LincStation:

```bash
# Instalar cliente NFS
sudo apt install -y nfs-common

# Montar recurso compartido
sudo mkdir -p /mnt/synology
sudo mount -t nfs synology-ip:/volume1 /mnt/synology

# Copiar con progreso
rsync -avP /mnt/synology/Peliculas/ /media/movies/
rsync -avP /mnt/synology/Series/ /media/series/

# Desmontar cuando termine
sudo umount /mnt/synology
```

**Opcion C: Montar recurso SMB del Synology**

```bash
# Instalar cliente SMB
sudo apt install -y cifs-utils

# Montar
sudo mkdir -p /mnt/synology
sudo mount -t cifs //synology-ip/Peliculas /mnt/synology \
  -o username=usuario,password=contrasena

# Copiar
rsync -avP /mnt/synology/ /media/movies/

# Desmontar
sudo umount /mnt/synology
```

### Paso 3.3 - Verificar integridad de la transferencia

```bash
# Contar archivos en origen (ejecutar en Synology o via SSH)
ssh usuario@synology-ip "find /volume1/Peliculas -type f | wc -l"
ssh usuario@synology-ip "find /volume1/Series -type f | wc -l"

# Contar archivos en destino
find /media/movies -type f | wc -l
find /media/series -type f | wc -l

# Verificar tamano total
du -sh /media/movies
du -sh /media/series

# Comparar con origen
ssh usuario@synology-ip "du -sh /volume1/Peliculas /volume1/Series"

# Los numeros deben coincidir (pequenas diferencias de tamano son normales
# por diferencias en el sistema de archivos)
```

### Paso 3.4 - Establecer permisos

```bash
# Asignar propiedad al usuario isidro
sudo chown -R isidro:isidro /media/movies /media/series

# Permisos: lectura para todos, escritura solo propietario
sudo chmod -R 755 /media/movies /media/series

# Verificar
ls -la /media/movies/ | head -10
ls -la /media/series/ | head -10
```

### Paso 3.5 - Prueba rapida de reproduccion

```bash
# Instalar reproductor de consola para verificar
sudo apt install -y ffplay 2>/dev/null || sudo apt install -y ffmpeg

# Probar que un archivo se puede leer correctamente
# (no necesita monitor, solo verificar que no da error)
ffprobe /media/movies/alguna-pelicula.mp4 2>&1 | head -20

# Verificar que muestra: Duration, Video stream, Audio stream
# Si muestra informacion del video, el archivo esta bien
```

### Paso 3.6 - Mantener Synology como respaldo

**IMPORTANTE**: NO apagar ni borrar nada del Synology hasta completar la Fase 7 y verificar durante al menos 30 dias que todo funciona correctamente en el LincStation.

### Verificacion de Fase 3

```bash
echo "=== Verificacion de Contenido ==="

echo "Peliculas:"
echo "  Archivos: $(find /media/movies -type f -name '*.mp4' -o -name '*.mkv' -o -name '*.avi' | wc -l)"
echo "  Tamano total: $(du -sh /media/movies | cut -f1)"

echo ""
echo "Series:"
echo "  Carpetas de series: $(find /media/series -maxdepth 1 -type d | wc -l)"
echo "  Episodios totales: $(find /media/series -type f -name '*.mp4' -o -name '*.mkv' | wc -l)"
echo "  Tamano total: $(du -sh /media/series | cut -f1)"

echo ""
echo "Espacio libre:"
df -h /media/movies /media/series

echo ""
echo "Prueba de lectura (primera pelicula encontrada):"
FIRST_MOVIE=$(find /media/movies -type f -name '*.mp4' | head -1)
if [ -n "$FIRST_MOVIE" ]; then
    ffprobe "$FIRST_MOVIE" 2>&1 | grep -E "Duration|Stream"
    echo "OK - archivo legible"
else
    echo "ADVERTENCIA: no se encontraron archivos MP4"
fi
```

---

## Fase 4: Adaptar Backend

**Objetivo**: IsiPrime backend ejecutandose en el NAS, leyendo desde disco local, usando SQLite para todo el almacenamiento de datos.

**Tiempo estimado**: 2-3 dias de desarrollo

**Dependencia**: Fases 2 y 3 completadas

### Paso 4.1 - Copiar el codigo fuente al NAS

```bash
# Opcion A: Clonar desde GitHub
cd /opt
git clone https://github.com/CALILU/isiprime.git isiprime
cd /opt/isiprime

# Opcion B: Copiar desde el PC Windows
# Desde el PC:
scp -r /mnt/f/plex/* isidro@192.168.1.100:/opt/isiprime/

# Instalar dependencias
cd /opt/isiprime
npm install

# Verificar que better-sqlite3 compila correctamente
node -e "const db = require('better-sqlite3')(':memory:'); console.log('SQLite OK');"
```

### Paso 4.2 - Eliminar dependencia de FTP

El cambio mas importante: reemplazar todas las llamadas FTP por acceso local a disco.

**Archivos afectados**:

| Archivo | Funcion FTP | Reemplazo |
|---------|------------|-----------|
| `lib/ftp-helper.js` | `withFTPClient()` | Eliminar (ya no necesario) |
| `routes/videos.js` | Listar peliculas via FTP | `fs.readdir()` |
| `routes/streaming.js` | Stream via FTP | `fs.createReadStream()` |
| `routes/series.js` | Listar series via FTP | `fs.readdir()` |
| `routes/movies.js` | Renombrar/borrar via FTP | `fs.rename()` / `fs.unlink()` |
| `routes/downloads.js` | Subir archivo via FTP | `fs.copyFile()` |
| `server.js` | Inicializacion FTP config | Simplificar |

**Crear `lib/local-storage.js`**:

```javascript
// lib/local-storage.js
// Reemplazo de ftp-helper.js para acceso local a disco

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

class LocalStorage {
  constructor(config) {
    this.moviesPath = config.moviesPath || '/media/movies';
    this.seriesPath = config.seriesPath || '/media/series';
  }

  async listMovies() {
    const files = await fsp.readdir(this.moviesPath);
    return files.filter(f => /\.(mp4|mkv|avi)$/i.test(f));
  }

  async listSeries() {
    const entries = await fsp.readdir(this.seriesPath, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  }

  async listEpisodes(seriesName) {
    const seriesDir = path.join(this.seriesPath, seriesName);
    const files = await fsp.readdir(seriesDir);
    return files.filter(f => /\.(mp4|mkv|avi)$/i.test(f));
  }

  getMoviePath(filename) {
    return path.join(this.moviesPath, filename);
  }

  getEpisodePath(seriesName, filename) {
    return path.join(this.seriesPath, seriesName, filename);
  }

  createReadStream(filePath, options) {
    return fs.createReadStream(filePath, options);
  }

  async getFileSize(filePath) {
    const stat = await fsp.stat(filePath);
    return stat.size;
  }

  async fileExists(filePath) {
    try {
      await fsp.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async deleteFile(filePath) {
    await fsp.unlink(filePath);
  }

  async renameFile(oldPath, newPath) {
    await fsp.rename(oldPath, newPath);
  }

  async copyFile(src, dest) {
    await fsp.copyFile(src, dest);
  }
}

module.exports = LocalStorage;
```

**Actualizar `storage-settings.json`**:

```json
{
  "mode": "local",
  "localPath": "/media",
  "moviesPath": "/media/movies",
  "seriesPath": "/media/series"
}
```

**Resumen de cambios por ruta**:

En cada archivo de rutas, reemplazar el patron:

```javascript
// ANTES (FTP)
const client = await withFTPClient();
const list = await client.list('/Peliculas');
// ...
client.close();

// DESPUES (Local)
const files = await storage.listMovies();
```

Para streaming:

```javascript
// ANTES (FTP)
const client = await withFTPClient();
const stream = await client.downloadTo(res, remotePath);

// DESPUES (Local)
const filePath = storage.getMoviePath(filename);
const stat = await storage.getFileSize(filePath);
const stream = storage.createReadStream(filePath, { start, end });
stream.pipe(res);
```

### Paso 4.3 - Migrar archivos JSON a SQLite

Crear el script de migracion que lee los JSON actuales y los inserta en tablas SQLite.

**Crear `scripts/migrate-json-to-sqlite.js`**:

```javascript
// scripts/migrate-json-to-sqlite.js
// Migra todos los archivos JSON a la base de datos SQLite unificada

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || '/var/lib/isiprime/isiprime.db';
const DATA_DIR = path.dirname(process.argv[1]) + '/..';

// Crear base de datos
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// === CREAR TABLAS ===

db.exec(`
  -- Cache de peliculas (reemplaza cache.json)
  CREATE TABLE IF NOT EXISTS movies_cache (
    filename TEXT PRIMARY KEY,
    title TEXT,
    year INTEGER,
    tmdb_id INTEGER,
    poster_path TEXT,
    overview TEXT,
    genres TEXT,           -- JSON array
    vote_average REAL,
    runtime INTEGER,
    director TEXT,
    cast_list TEXT,        -- JSON array
    backdrop_path TEXT,
    original_language TEXT,
    cached_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT
  );

  -- Cache de series (reemplaza cache-series.json)
  CREATE TABLE IF NOT EXISTS series_cache (
    folder_name TEXT PRIMARY KEY,
    title TEXT,
    tmdb_id INTEGER,
    poster_path TEXT,
    overview TEXT,
    genres TEXT,
    vote_average REAL,
    first_air_date TEXT,
    number_of_seasons INTEGER,
    cached_at TEXT DEFAULT (datetime('now'))
  );

  -- Episodios de series (reemplaza series-episodes.json)
  CREATE TABLE IF NOT EXISTS series_episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    series_folder TEXT NOT NULL,
    filename TEXT NOT NULL,
    season INTEGER,
    episode INTEGER,
    title TEXT,
    UNIQUE(series_folder, filename),
    FOREIGN KEY (series_folder) REFERENCES series_cache(folder_name)
  );

  -- Colecciones (reemplaza collections.json)
  CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT DEFAULT 'custom',
    auto_criteria TEXT,     -- JSON para colecciones auto-generadas
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS collection_items (
    collection_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    added_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (collection_id, filename),
    FOREIGN KEY (collection_id) REFERENCES collections(id)
  );

  -- Cola de descargas (reemplaza download-queue.json)
  CREATE TABLE IF NOT EXISTS download_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    filename TEXT,
    status TEXT DEFAULT 'pending',
    progress REAL DEFAULT 0,
    added_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );

  -- Usuarios (reemplaza users.json)
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at TEXT DEFAULT (datetime('now')),
    last_login TEXT
  );
`);

// === MIGRAR DATOS ===

function loadJSON(filename) {
  const filepath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filepath)) {
    console.log(`  [SKIP] ${filename} no encontrado`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    console.log(`  [ERROR] ${filename}: ${e.message}`);
    return null;
  }
}

// 1. Migrar cache.json
console.log('Migrando cache.json...');
const cache = loadJSON('cache.json');
if (cache) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO movies_cache
    (filename, title, year, tmdb_id, poster_path, overview, genres,
     vote_average, runtime, director, cast_list, backdrop_path,
     original_language, cached_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const [filename, movie] of Object.entries(cache)) {
      insert.run(
        filename,
        movie.title || movie.titulo,
        movie.year || movie.anio,
        movie.tmdb_id || movie.tmdbId,
        movie.poster_path || movie.poster,
        movie.overview || movie.sinopsis,
        JSON.stringify(movie.genres || movie.generos || []),
        movie.vote_average || movie.puntuacion,
        movie.runtime || movie.duracion,
        movie.director,
        JSON.stringify(movie.cast || movie.reparto || []),
        movie.backdrop_path || movie.backdrop,
        movie.original_language,
        movie.cached_at || new Date().toISOString()
      );
    }
  });
  tx();
  console.log(`  Migradas ${Object.keys(cache).length} peliculas`);
}

// 2. Migrar cache-series.json
console.log('Migrando cache-series.json...');
const seriesCache = loadJSON('cache-series.json');
if (seriesCache) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO series_cache
    (folder_name, title, tmdb_id, poster_path, overview, genres,
     vote_average, first_air_date, number_of_seasons)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const [folder, series] of Object.entries(seriesCache)) {
      insert.run(
        folder,
        series.title || series.name,
        series.tmdb_id || series.tmdbId,
        series.poster_path,
        series.overview,
        JSON.stringify(series.genres || []),
        series.vote_average,
        series.first_air_date,
        series.number_of_seasons
      );
    }
  });
  tx();
  console.log(`  Migradas ${Object.keys(seriesCache).length} series`);
}

// 3. Migrar series-episodes.json
console.log('Migrando series-episodes.json...');
const episodes = loadJSON('series-episodes.json');
if (episodes) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO series_episodes
    (series_folder, filename, season, episode, title)
    VALUES (?, ?, ?, ?, ?)
  `);

  let count = 0;
  const tx = db.transaction(() => {
    for (const [folder, eps] of Object.entries(episodes)) {
      if (Array.isArray(eps)) {
        for (const ep of eps) {
          insert.run(folder, ep.filename, ep.season, ep.episode, ep.title);
          count++;
        }
      }
    }
  });
  tx();
  console.log(`  Migrados ${count} episodios`);
}

// 4. Migrar collections.json
console.log('Migrando collections.json...');
const collections = loadJSON('collections.json');
if (collections) {
  const insertCol = db.prepare(`
    INSERT OR REPLACE INTO collections (id, name, description, type, auto_criteria)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertItem = db.prepare(`
    INSERT OR IGNORE INTO collection_items (collection_id, filename)
    VALUES (?, ?)
  `);

  let count = 0;
  const tx = db.transaction(() => {
    const cols = Array.isArray(collections) ? collections : Object.values(collections);
    for (const col of cols) {
      insertCol.run(
        col.id,
        col.name || col.nombre,
        col.description || col.descripcion,
        col.type || 'custom',
        col.auto_criteria ? JSON.stringify(col.auto_criteria) : null
      );
      if (col.movies || col.peliculas || col.items) {
        const items = col.movies || col.peliculas || col.items || [];
        for (const item of items) {
          const filename = typeof item === 'string' ? item : item.filename;
          insertItem.run(col.id, filename);
          count++;
        }
      }
    }
  });
  tx();
  console.log(`  Migradas ${count} colecciones`);
}

// 5. Migrar download-queue.json
console.log('Migrando download-queue.json...');
const queue = loadJSON('download-queue.json');
if (queue) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO download_queue (url, filename, status, added_at)
    VALUES (?, ?, ?, ?)
  `);

  const items = Array.isArray(queue) ? queue : Object.values(queue);
  const tx = db.transaction(() => {
    for (const item of items) {
      insert.run(item.url, item.filename, item.status || 'pending', item.added_at);
    }
  });
  tx();
  console.log(`  Migrados ${items.length} items de cola`);
}

// 6. Migrar users.json (SIN hashear passwords aqui, eso se hara en Fase 5)
console.log('Migrando users.json...');
const users = loadJSON('users.json');
if (users) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO users (username, password_hash, role)
    VALUES (?, ?, ?)
  `);

  const userList = Array.isArray(users) ? users : Object.values(users);
  const tx = db.transaction(() => {
    for (const user of userList) {
      // password_hash aqui es temporal, se rehasheara con bcrypt en Fase 5
      insert.run(
        user.username || user.usuario,
        user.password || user.contrasena,
        user.role || user.rol || 'user'
      );
    }
  });
  tx();
  console.log(`  Migrados ${userList.length} usuarios`);
}

db.close();
console.log('\nMigracion completada. Base de datos en:', DB_PATH);
```

**Ejecutar la migracion**:

```bash
cd /opt/isiprime

# Crear directorio para la BD si no existe
sudo mkdir -p /var/lib/isiprime
sudo chown isidro:isidro /var/lib/isiprime

# Ejecutar migracion
node scripts/migrate-json-to-sqlite.js
```

**Actualizar los modulos de la aplicacion** para usar SQLite en vez de JSON:

- `lib/cache.js` → leer/escribir desde tabla `movies_cache`
- `lib/series.js` → leer/escribir desde tablas `series_cache` y `series_episodes`
- `lib/collections.js` → leer/escribir desde tablas `collections` y `collection_items`
- `lib/download-helpers.js` → leer/escribir desde tabla `download_queue`

### Paso 4.4 - Actualizar FFmpeg para VAAPI

Modificar la configuracion de FFmpeg en las rutas de streaming y conversion para usar aceleracion hardware:

```javascript
// Deteccion de VAAPI al arrancar (en server.js o lib/ffmpeg-config.js)
const { execSync } = require('child_process');

let useVAAPI = false;
try {
  execSync('vainfo 2>&1');
  useVAAPI = true;
  console.log('VAAPI detectado: transcodificacion hardware habilitada');
} catch {
  console.log('VAAPI no disponible: usando transcodificacion por software');
}

// Flags de FFmpeg segun disponibilidad
function getFFmpegHWAccelArgs() {
  if (useVAAPI) {
    return [
      '-vaapi_device', '/dev/dri/renderD128',
      '-vf', 'format=nv12|vaapi,hwupload',
      '-c:v', 'h264_vaapi',
      '-qp', '23'
    ];
  }
  return ['-c:v', 'libx264', '-crf', '23'];
}
```

### Paso 4.5 - Crear archivo .env para el NAS

```bash
nano /opt/isiprime/.env
```

```env
# IsiPrime - Configuracion NAS
PORT=8080
NODE_ENV=production

# TMDB
TMDB_API_KEY=tu_clave_tmdb_aqui
TMDB_BACKUP_KEY=tu_clave_backup_aqui

# Rutas de medios
MEDIA_PATH=/media
MOVIES_PATH=/media/movies
SERIES_PATH=/media/series

# Base de datos
DB_PATH=/var/lib/isiprime/isiprime.db

# Seguridad (generar con: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
JWT_SECRET=generar_un_secreto_aleatorio_aqui
SESSION_SECRET=otro_secreto_aleatorio_aqui
```

Generar los secretos:

```bash
# Generar JWT_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Generar SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Copiar los valores generados al .env
```

### Paso 4.6 - Compilar el frontend

```bash
cd /opt/isiprime/my-ui
npm install
npm run build

# Verificar que se creo el directorio build
ls -la /opt/isiprime/my-ui/build/
# Debe contener index.html, static/, etc.
```

### Paso 4.7 - Prueba inicial en el NAS

```bash
cd /opt/isiprime
node server.js
```

Desde el PC, abrir navegador:

```
http://192.168.1.100:8080
```

Comprobar:
- [ ] La pagina carga correctamente
- [ ] Se ven las peliculas en el catalogo
- [ ] Se puede reproducir un video
- [ ] Las series aparecen correctamente
- [ ] Los metadatos de TMDB se cargan

Si algo falla, revisar la consola del servidor para errores.

### Verificacion de Fase 4

```bash
# 1. Verificar que la aplicacion arranca sin errores
cd /opt/isiprime
timeout 10 node server.js 2>&1 || true

# 2. Verificar base de datos
sqlite3 /var/lib/isiprime/isiprime.db "
  SELECT 'Peliculas en cache:', count(*) FROM movies_cache;
  SELECT 'Series en cache:', count(*) FROM series_cache;
  SELECT 'Episodios:', count(*) FROM series_episodes;
  SELECT 'Colecciones:', count(*) FROM collections;
  SELECT 'Usuarios:', count(*) FROM users;
"

# 3. Verificar que no hay imports de FTP en el codigo activo
grep -r "basic-ftp\|withFTPClient\|ftp-helper" /opt/isiprime/routes/ /opt/isiprime/lib/ \
  --include="*.js" -l
# No deberia devolver ningun archivo

# 4. Verificar frontend compilado
ls -la /opt/isiprime/my-ui/build/index.html
```

---

## Fase 5: Sistema de Usuarios (JWT + Perfiles)

**Objetivo**: Autenticacion multi-usuario con seguimiento individual de progreso y favoritos.

**Tiempo estimado**: 3-5 dias de desarrollo

**Dependencia**: Fase 4 completada

### Paso 5.1 - Instalar dependencias adicionales

`jsonwebtoken` y `bcrypt` son paquetes ampliamente establecidos en npm (millones de descargas semanales, mantenidos activamente):

```bash
cd /opt/isiprime
npm install jsonwebtoken bcrypt
```

### Paso 5.2 - Crear modulo de autenticacion

**Crear `lib/auth.js`**:

```javascript
// lib/auth.js
// Modulo de autenticacion JWT + bcrypt

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const JWT_SECRET = process.env.JWT_SECRET;
const ACCESS_TOKEN_EXPIRY = '15m';    // 15 minutos
const REFRESH_TOKEN_EXPIRY = '30d';   // 30 dias

// Generar tokens
function generateAccessToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

function generateRefreshToken(user) {
  return jwt.sign(
    { id: user.id, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );
}

// Verificar token
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// Hash de password
async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

// Verificar password
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Middleware de autenticacion
function authMiddleware(db) {
  return (req, res, next) => {
    // IPs locales sin autenticacion (mantener compatibilidad)
    const ip = req.ip || req.connection.remoteAddress;
    if (/^(192\.168\.|10\.|127\.)/.test(ip)) {
      req.user = { id: 1, username: 'local', role: 'admin' };
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token requerido' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ error: 'Token invalido o expirado' });
    }

    req.user = decoded;
    next();
  };
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  hashPassword,
  verifyPassword,
  authMiddleware
};
```

### Paso 5.3 - Crear tablas SQLite para usuarios

```sql
-- Anadir a la base de datos existente

-- Sesiones (refresh tokens)
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  refresh_token TEXT UNIQUE NOT NULL,
  device_info TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Progreso de visualizacion por usuario
CREATE TABLE IF NOT EXISTS user_progress (
  user_id INTEGER NOT NULL,
  video_path TEXT NOT NULL,
  position REAL NOT NULL DEFAULT 0,
  duration REAL,
  completed INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, video_path),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Favoritos por usuario
CREATE TABLE IF NOT EXISTS user_favorites (
  user_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  added_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, filename),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Invitaciones
CREATE TABLE IF NOT EXISTS invitations (
  code TEXT PRIMARY KEY,
  created_by INTEGER NOT NULL,
  used_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  used_at TEXT,
  expires_at TEXT,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (used_by) REFERENCES users(id)
);

-- Indices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(refresh_token);
CREATE INDEX IF NOT EXISTS idx_progress_user ON user_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON user_favorites(user_id);
```

### Paso 5.4 - Migrar usuarios existentes con bcrypt

**Crear `scripts/migrate-users.js`**:

```bash
cd /opt/isiprime
node scripts/migrate-users.js
```

Este script debe:
1. Leer los usuarios existentes de la tabla `users`
2. Re-hashear cada password con bcrypt (salt rounds = 12)
3. Actualizar la columna `password_hash`

### Paso 5.5 - Crear endpoints de autenticacion

Nuevos endpoints a implementar:

| Metodo | Ruta | Funcion | Auth |
|--------|------|---------|------|
| POST | `/api/auth/login` | Login, devuelve JWT access + refresh | No |
| POST | `/api/auth/refresh` | Renueva access token con refresh token | No |
| DELETE | `/api/auth/logout` | Invalida refresh token | Si |
| POST | `/api/auth/register` | Registro con codigo de invitacion | No |
| POST | `/api/auth/invite` | Genera codigo de invitacion | Admin |
| GET | `/api/auth/me` | Datos del usuario actual | Si |

### Paso 5.6 - Actualizar middleware de autenticacion

Reemplazar el sistema actual de sesiones en memoria por JWT:

```javascript
// En server.js, reemplazar el middleware actual
const { authMiddleware } = require('./lib/auth');
app.use('/api', authMiddleware(db));
```

### Paso 5.7 - Actualizar frontend

**`my-ui/src/hooks/useAuth.js`** - cambios principales:

```javascript
// Almacenar tokens en localStorage
localStorage.setItem('accessToken', response.data.accessToken);
localStorage.setItem('refreshToken', response.data.refreshToken);

// Incluir token en todas las peticiones
axios.defaults.headers.common['Authorization'] =
  `Bearer ${localStorage.getItem('accessToken')}`;

// Auto-refresh cuando el access token expira (401)
axios.interceptors.response.use(
  response => response,
  async error => {
    if (error.response?.status === 401) {
      const refreshToken = localStorage.getItem('refreshToken');
      const { data } = await axios.post('/api/auth/refresh', { refreshToken });
      localStorage.setItem('accessToken', data.accessToken);
      error.config.headers['Authorization'] = `Bearer ${data.accessToken}`;
      return axios(error.config);  // Reintentar peticion original
    }
    throw error;
  }
);
```

### Paso 5.8 - Progreso por usuario

Modificar el hook `useVideoProgress` para enviar el `user_id` con cada actualizacion de progreso:

```javascript
// El backend extrae user_id del JWT automaticamente
// req.user.id esta disponible en todas las rutas protegidas

// Endpoint: PUT /api/progress/:videoPath
// Body: { position, duration }
// El backend guarda: user_id (del JWT) + video_path + position
```

### Paso 5.9 - Favoritos por usuario

Mismo patron que progreso:

```javascript
// POST /api/favorites/:filename   → anadir favorito
// DELETE /api/favorites/:filename → quitar favorito
// GET /api/favorites              → listar favoritos del usuario
```

### Verificacion de Fase 5

```bash
# 1. Verificar que hay usuarios en la BD con passwords hasheados
sqlite3 /var/lib/isiprime/isiprime.db "
  SELECT username, length(password_hash), role FROM users;
"
# password_hash debe tener ~60 caracteres (formato bcrypt)

# 2. Probar login desde curl
curl -X POST http://192.168.1.100:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"tu_password"}'
# Debe devolver: { accessToken: "...", refreshToken: "..." }

# 3. Probar acceso con token
TOKEN=$(curl -s -X POST http://192.168.1.100:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"tu_password"}' | \
  node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).accessToken))")

curl -H "Authorization: Bearer $TOKEN" http://192.168.1.100:8080/api/videos
# Debe devolver la lista de peliculas

# 4. Test multi-usuario
# Abrir dos navegadores distintos (o uno normal + uno incognito)
# Iniciar sesion con dos usuarios diferentes
# Verificar que:
#   - Cada usuario ve su propio progreso
#   - Cada usuario tiene sus propios favoritos
#   - Los datos no se mezclan entre usuarios
```

---

## Fase 6: Configurar Red (DDNS, nginx, SSL, Port Forwarding)

**Objetivo**: IsiPrime accesible desde internet via HTTPS con certificado SSL valido.

**Tiempo estimado**: 3-4 horas

**Dependencia**: Fases 4 y 5 completadas

### Paso 6.1 - Asignar IP estatica al NAS

Si no se hizo en la Fase 1, configurar ahora:

```
Livebox 6 → http://192.168.1.1
→ Red → DHCP → Direcciones estaticas
→ Anadir: MAC del NAS → IP: 192.168.1.100
```

Verificar:

```bash
# Desde el NAS
ip addr show | grep "inet "
# Debe mostrar 192.168.1.100
```

### Paso 6.2 - Port forwarding en el Livebox 6

Configurar en el router para que el trafico externo llegue al NAS:

```
Livebox 6 → http://192.168.1.1
→ Red → NAT/PAT

Regla 1:
  Nombre: HTTPS-IsiPrime
  Puerto externo: 443
  Puerto interno: 443
  IP interna: 192.168.1.100
  Protocolo: TCP

Regla 2:
  Nombre: HTTP-IsiPrime
  Puerto externo: 80
  Puerto interno: 80
  IP interna: 192.168.1.100
  Protocolo: TCP
```

El puerto 80 es necesario para la validacion del certificado SSL de Let's Encrypt y para redirigir automaticamente a HTTPS.

### Paso 6.3 - Configurar DDNS

Verificar que `calilu.mooo.com` apunta a la IP publica actual:

```bash
# Ver IP publica actual
curl -s ifconfig.me

# Ver a donde apunta el dominio
dig +short calilu.mooo.com
# o
nslookup calilu.mooo.com
```

Si las IPs no coinciden, actualizar el registro DDNS.

Configurar actualizacion automatica via cron:

```bash
# Editar crontab
crontab -e

# Anadir (adaptar segun proveedor DDNS):
# Actualizar IP cada 5 minutos
*/5 * * * * curl -s "https://freedns.afraid.org/dynamic/update.php?TU_TOKEN" > /dev/null 2>&1
```

Verificar que funciona:

```bash
# Esperar 5 minutos y comprobar
dig +short calilu.mooo.com
# Debe mostrar tu IP publica actual
```

### Paso 6.4 - Configurar nginx

**Crear archivo de configuracion**:

```bash
sudo nano /etc/nginx/sites-available/isiprime
```

```nginx
# Redirigir HTTP a HTTPS
server {
    listen 80;
    server_name calilu.mooo.com;
    return 301 https://$server_name$request_uri;
}

# Servidor HTTPS principal
server {
    listen 443 ssl http2;
    server_name calilu.mooo.com;

    # SSL (certbot rellenara estas lineas)
    # ssl_certificate /etc/letsencrypt/live/calilu.mooo.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/calilu.mooo.com/privkey.pem;

    # Seguridad SSL
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    # Headers de seguridad
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Tamano maximo de subida (para uploads de peliculas)
    client_max_body_size 10G;

    # Timeouts para streaming de video
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_connect_timeout 60s;

    # Buffering optimizado para video
    proxy_buffering on;
    proxy_buffer_size 16k;
    proxy_buffers 8 16k;

    # Proxy a Node.js
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # SSE (Server-Sent Events) - sin buffering
    location ~ ^/api/(requests/events|convert/progress) {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
    }

    # Streaming de video - sin buffering de proxy
    location ~ ^/stream {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Range $http_range;
        proxy_set_header If-Range $http_if_range;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
        proxy_cache off;
    }

    # Archivos estaticos del frontend - servidos directamente por nginx
    location /static/ {
        alias /opt/isiprime/my-ui/build/static/;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # Otros archivos estaticos del build de React
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|json|manifest)$ {
        root /opt/isiprime/my-ui/build;
        expires 7d;
        add_header Cache-Control "public, immutable";
        try_files $uri @backend;
    }

    location @backend {
        proxy_pass http://127.0.0.1:8080;
    }
}
```

**Activar la configuracion**:

```bash
# Crear enlace simbolico
sudo ln -s /etc/nginx/sites-available/isiprime /etc/nginx/sites-enabled/

# Eliminar configuracion por defecto
sudo rm -f /etc/nginx/sites-enabled/default

# Verificar sintaxis
sudo nginx -t
# Debe mostrar: syntax is ok / test is successful

# Recargar nginx
sudo systemctl reload nginx
```

### Paso 6.5 - Obtener certificado SSL

```bash
# Obtener certificado (certbot modifica automaticamente la config de nginx)
sudo certbot --nginx -d calilu.mooo.com

# Seguir instrucciones:
# - Email: tu_email@ejemplo.com
# - Aceptar terminos: Y
# - Redirigir HTTP a HTTPS: 2 (Redirect)

# Verificar renovacion automatica
sudo certbot renew --dry-run
# Debe mostrar: "Congratulations, all simulated renewals succeeded"
```

La renovacion automatica se instala via cron o systemd timer:

```bash
# Verificar que el timer existe
sudo systemctl status certbot.timer
# Debe mostrar "active"
```

### Paso 6.6 - Configurar firewall (ufw)

```bash
# Configurar reglas
sudo ufw default deny incoming
sudo ufw default allow outgoing

# SSH solo desde red local
sudo ufw allow from 192.168.1.0/24 to any port 22

# HTTP y HTTPS desde cualquier lugar
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Activar firewall
sudo ufw enable

# Verificar reglas
sudo ufw status verbose
```

Salida esperada:

```
Status: active

To                         Action      From
--                         ------      ----
22                         ALLOW       192.168.1.0/24
80/tcp                     ALLOW       Anywhere
443/tcp                    ALLOW       Anywhere
```

### Paso 6.7 - Configurar PM2 para produccion

**Crear `ecosystem.config.js`**:

```bash
nano /opt/isiprime/ecosystem.config.js
```

```javascript
module.exports = {
  apps: [{
    name: 'isiprime',
    script: 'server.js',
    cwd: '/opt/isiprime',
    instances: 4,       // Aprovechar los 4 cores del N100 (cluster mode)
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: 8080
    },
    error_file: '/var/log/isiprime/error.log',
    out_file: '/var/log/isiprime/out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
```

```bash
# Crear directorio de logs
sudo mkdir -p /var/log/isiprime
sudo chown isidro:isidro /var/log/isiprime

# Arrancar con PM2
cd /opt/isiprime
pm2 start ecosystem.config.js

# Guardar configuracion para auto-arranque
pm2 save

# Verificar
pm2 status
pm2 logs isiprime --lines 20
```

### Paso 6.8 - Probar acceso externo

**Desde el telefono movil (datos 4G/5G, NO WiFi)**:

1. Abrir navegador
2. Ir a `https://calilu.mooo.com`
3. Verificar:
   - [ ] El candado verde (SSL) aparece
   - [ ] La pagina carga correctamente
   - [ ] Se puede iniciar sesion
   - [ ] Se puede reproducir un video
   - [ ] El video no se corta ni tiene buffering excesivo

**Desde otro PC fuera de la red local** (si es posible):

```bash
# Verificar SSL
curl -I https://calilu.mooo.com
# Debe mostrar: HTTP/2 200

# Verificar redireccion HTTP→HTTPS
curl -I http://calilu.mooo.com
# Debe mostrar: HTTP/1.1 301 Moved Permanently
# Location: https://calilu.mooo.com/
```

### Verificacion de Fase 6

```bash
echo "=== Verificacion de Red ==="

# 1. nginx funcionando
echo "nginx:" && sudo systemctl is-active nginx

# 2. PM2 funcionando
echo "PM2:" && pm2 status | grep isiprime

# 3. SSL valido
echo "SSL:" && sudo certbot certificates 2>&1 | grep -E "Domains|Expiry"

# 4. Firewall activo
echo "Firewall:" && sudo ufw status | head -5

# 5. Puerto 443 escuchando
echo "Puerto 443:" && ss -tlnp | grep ":443"

# 6. Puerto 8080 escuchando (Node.js)
echo "Puerto 8080:" && ss -tlnp | grep ":8080"

# 7. DNS resuelve correctamente
echo "DNS:" && dig +short calilu.mooo.com

# 8. IP publica
echo "IP publica:" && curl -s ifconfig.me

echo ""
echo "Verificar desde movil (4G): https://calilu.mooo.com"
```

---

## Fase 7: Testing con Usuarios Reales + Cutover

**Objetivo**: Validar con usuarios reales y migrar definitivamente desde la configuracion antigua.

**Tiempo estimado**: 2-3 semanas (incluyendo periodo beta)

**Dependencia**: Fase 6 completada

### Paso 7.1 - Beta testing (semanas 1-2)

**Semana 1: 2-3 usuarios de confianza**

1. Generar codigos de invitacion:
   ```bash
   # Desde el NAS o via API
   curl -X POST https://calilu.mooo.com/api/auth/invite \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json"
   # Devuelve: { code: "ABC123" }
   ```

2. Enviar instrucciones a los beta testers:
   ```
   1. Abre https://calilu.mooo.com
   2. Clic en "Registrarse"
   3. Introduce tu nombre de usuario, contrasena, y el codigo: ABC123
   4. Ya puedes explorar el catalogo y ver peliculas
   ```

3. Pedir feedback sobre:
   - Velocidad de carga del catalogo
   - Calidad y fluidez del video
   - Funcionamiento en movil vs PC
   - Cualquier error o problema encontrado

**Semana 2: 5 usuarios**

Ampliar si la semana 1 fue exitosa.

### Paso 7.2 - Monitorizacion durante beta

**Comandos de monitorizacion en tiempo real**:

```bash
# CPU y memoria
htop

# Estadisticas de PM2
pm2 monit

# Logs de la aplicacion en tiempo real
pm2 logs isiprime

# Logs de nginx (accesos)
sudo tail -f /var/log/nginx/access.log

# Logs de nginx (errores)
sudo tail -f /var/log/nginx/error.log

# Uso de disco
df -h

# I/O de disco (si hay buffering)
iostat -x 5

# Trafico de red
sudo apt install -y iftop
sudo iftop -i enp1s0

# Conexiones activas
ss -s
```

**Metricas a vigilar**:

| Metrica | Valor normal | Problema si... |
|---------|-------------|----------------|
| CPU (Node.js) | <30% con 1-2 streams | >80% sostenido |
| RAM (Node.js) | <300 MB | >512 MB o creciendo |
| Disco I/O | <50% utilizacion | >90% = cuello de botella |
| Latencia de red | <100ms (LAN) | >500ms = problema DNS/red |
| Errores nginx | 0 errores 5xx | Cualquier 502/503/504 |

### Paso 7.3 - Resolver problemas encontrados

Problemas comunes y soluciones:

| Problema | Causa probable | Solucion |
|----------|---------------|----------|
| Video se corta | Disco lento / buffer pequeno | Aumentar buffer nginx |
| 502 Bad Gateway | Node.js crasheo | `pm2 logs`, corregir error |
| SSL error | Certificado expirado | `sudo certbot renew` |
| Lentitud general | Demasiados streams | Limitar streams simultaneos |
| Login falla | JWT secret mal configurado | Verificar .env |

### Paso 7.4 - Rollout gradual

| Semana | Usuarios | Accion |
|--------|----------|--------|
| 1 | 2-3 (beta) | Generar invitaciones, monitorizar intensivamente |
| 2 | 5 | Ampliar si no hay problemas criticos |
| 3 | 10 (todos) | Abrir a todos los usuarios finales |

### Paso 7.5 - Checklist de cutover (corte final)

Antes de declarar la migracion como completa:

```
INFRAESTRUCTURA
[ ] Todos los archivos multimedia transferidos y verificados
[ ] Base de datos SQLite funcionando correctamente
[ ] Backups automaticos configurados
[ ] PM2 arranca automaticamente al reiniciar el NAS
[ ] nginx configurado y SSL valido
[ ] Firewall activo con reglas correctas
[ ] DDNS actualiza la IP correctamente
[ ] IP estatica asignada al NAS

APLICACION
[ ] Todas las peliculas visibles en el catalogo
[ ] Todas las series visibles con episodios
[ ] Streaming funciona sin cortes (probado con 3+ streams simultaneos)
[ ] Metadatos TMDB se cargan correctamente
[ ] Busqueda funciona
[ ] Colecciones funcionan

USUARIOS
[ ] Todos los usuarios creados con cuentas individuales
[ ] Login/logout funciona correctamente
[ ] Progreso de visualizacion se guarda por usuario
[ ] Favoritos se guardan por usuario
[ ] Registro con codigo de invitacion funciona

ACCESO EXTERNO
[ ] https://calilu.mooo.com accesible desde internet
[ ] SSL valido (candado verde)
[ ] Redireccion HTTP→HTTPS funciona
[ ] Video se reproduce desde movil (4G)
[ ] Video se reproduce desde PC externo
```

### Paso 7.6 - Desmantelar configuracion antigua

Solo despues de verificar durante 30+ dias que todo funciona:

1. **Parar servicio FTP en Synology**:
   ```
   DSM → Panel de Control → Servicios de Archivos → FTP → Deshabilitar
   ```

2. **Eliminar port forwarding del puerto 21** en el router

3. **Archivar IsiPrime-Install/**:
   ```bash
   # En el PC Windows
   # Comprimir y mover a almacenamiento de archivo
   # Ya no se necesita porque los usuarios acceden via web
   ```

4. **Actualizar CLAUDE.md**:
   - Reflejar nueva arquitectura (sin FTP, sin PC Windows)
   - Actualizar rutas y configuraciones
   - Documentar nueva estructura de la BD

5. **Decidir que hacer con el Synology**:
   - Opcion A: Mantener como backup (copiar DB diariamente)
   - Opcion B: Reutilizar para otro proposito
   - Opcion C: Apagar

### Paso 7.7 - Mantenimiento continuo

**Tareas semanales**:

```bash
# Verificar estado de PM2
pm2 status

# Verificar espacio en disco
df -h

# Verificar logs de errores
pm2 logs isiprime --err --lines 50
```

**Tareas mensuales**:

```bash
# Actualizar sistema operativo
sudo apt update && sudo apt upgrade -y

# Revisar logs de nginx
sudo cat /var/log/nginx/error.log | tail -50

# Verificar certificado SSL
sudo certbot certificates

# Verificar tamano de la BD
ls -lh /var/lib/isiprime/isiprime.db
```

**Tareas cada 60 dias**:

```bash
# Verificar renovacion automatica de SSL
sudo certbot renew --dry-run
```

**Backup automatico diario (cron)**:

```bash
# Editar crontab
crontab -e

# Backup de la BD SQLite a las 3:00 AM cada dia
0 3 * * * sqlite3 /var/lib/isiprime/isiprime.db ".backup '/media/backups/isiprime-$(date +\%Y\%m\%d).db'"

# Limpiar backups de mas de 30 dias
0 4 * * * find /media/backups -name "isiprime-*.db" -mtime +30 -delete
```

Crear el directorio de backups:

```bash
sudo mkdir -p /media/backups
sudo chown isidro:isidro /media/backups
```

### Verificacion de Fase 7

```bash
echo "=== Verificacion Final ==="

# 1. Aplicacion funcionando
echo "PM2:" && pm2 status | grep -E "name|isiprime"

# 2. SSL valido
echo "SSL:" && curl -sI https://calilu.mooo.com | head -3

# 3. API responde
echo "API:" && curl -s https://calilu.mooo.com/api/videos | head -c 100
echo ""

# 4. Base de datos
echo "BD:" && sqlite3 /var/lib/isiprime/isiprime.db "
  SELECT 'Peliculas:', count(*) FROM movies_cache
  UNION ALL
  SELECT 'Series:', count(*) FROM series_cache
  UNION ALL
  SELECT 'Usuarios:', count(*) FROM users;
"

# 5. Backups
echo "Ultimo backup:" && ls -la /media/backups/ | tail -3

# 6. Espacio en disco
echo "Disco:" && df -h /media/movies /media/series /var/lib/isiprime

# 7. Uptime
echo "Uptime:" && uptime

echo ""
echo "=== MIGRACION COMPLETADA ==="
```

---

## Resumen de Timeline

| Fase | Descripcion | Tiempo estimado | Dependencias |
|------|-------------|----------------|--------------|
| 1 | Instalar Debian 12 en LincStation N2 | 2-3 horas | Hardware disponible |
| 2 | Instalar stack de software | 1-2 horas | Fase 1 |
| 3 | Migrar contenido del Synology | 10-12 horas | Fase 1 |
| 4 | Adaptar backend (eliminar FTP, migrar a SQLite) | 2-3 dias | Fases 2 y 3 |
| 5 | Sistema de usuarios (JWT + perfiles) | 3-5 dias | Fase 4 |
| 6 | Configurar red (DDNS, nginx, SSL) | 3-4 horas | Fases 4 y 5 |
| 7 | Testing con usuarios reales + cutover | 2-3 semanas | Fase 6 |

**Total estimado: ~3-4 semanas** (incluyendo desarrollo y periodo beta)

> NOTA: Las Fases 2 y 3 pueden ejecutarse en paralelo. La Fase 4 es la mas compleja y requiere mas tiempo de desarrollo.

---

## Plan de Rollback

Si algo sale mal durante la migracion, hay multiples niveles de seguridad:

| Situacion | Accion de rollback | Tiempo de recuperacion |
|-----------|-------------------|----------------------|
| Fallo en Fase 1-3 | El Synology sigue funcionando tal cual | Inmediato |
| Fallo en Fase 4-5 | IsiPrime en PC Windows sigue sirviendo via FTP | 5 minutos (arrancar PC) |
| Fallo en Fase 6 | Apuntar DNS a IP antigua | 5 minutos |
| Fallo en Fase 7 | Revertir DNS + arrancar servidor antiguo | 10 minutos |

**Principios del plan de rollback**:

1. El Synology NAS antiguo permanece encendido y con datos intactos durante **toda** la migracion
2. IsiPrime en el PC Windows puede seguir sirviendo como antes en cualquier momento
3. Los paquetes IsiPrime-Install/ siguen funcionando (apuntan al FTP del Synology)
4. El DNS (calilu.mooo.com) puede redirigirse a la IP antigua en minutos
5. **No se borra nada del Synology hasta 30+ dias despues de verificar** que todo funciona en el LincStation
