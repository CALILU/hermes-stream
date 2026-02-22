# Networking, Acceso Remoto y HTTPS

Guia completa de configuracion de red para IsiPrime en LincStation N2, sirviendo 5-10 usuarios remotos via HTTPS.

---

## 1. Arquitectura de Red

```
                    Usuarios Remotos (Internet)
                    ┌──────┐ ┌──────┐ ┌──────┐
                    │User 1│ │User 2│ │User N│
                    └──┬───┘ └──┬───┘ └──┬───┘
                       │       │       │
                       ▼       ▼       ▼
              ┌─────────────────────────────┐
              │  calilu.mooo.com (DDNS)     │
              │  Resuelve a IP publica      │
              └─────────────┬───────────────┘
                            │
                            ▼
              ┌─────────────────────────────┐
              │  Livebox 6 (Router)         │
              │  IP publica dinamica        │
              │                             │
              │  NAT/PAT:                   │
              │    80  → 192.168.1.X:80     │
              │    443 → 192.168.1.X:443    │
              └─────────────┬───────────────┘
                            │ LAN 192.168.1.0/24
                            ▼
              ┌─────────────────────────────┐
              │   LincStation N2 NAS        │
              │   IP fija: 192.168.1.X      │
              │                             │
              │  ┌───────────────────────┐  │
              │  │ nginx (:443 / :80)    │  │
              │  │  ├─ HTTPS terminacion │  │
              │  │  ├─ Certificado SSL   │  │
              │  │  ├─ Archivos estaticos│  │
              │  │  │  (React build)     │  │
              │  │  ├─ Proxy → :8080     │  │
              │  │  │  (API + Streaming) │  │
              │  │  └─ Rate limiting     │  │
              │  └───────────┬───────────┘  │
              │              │              │
              │  ┌───────────▼───────────┐  │
              │  │ Node.js/PM2 (:8080)   │  │
              │  │  ├─ API endpoints     │  │
              │  │  ├─ Streaming video   │  │
              │  │  ├─ SSE (eventos)     │  │
              │  │  └─ SQLite (requests) │  │
              │  └───────────────────────┘  │
              │                             │
              │  ┌───────────────────────┐  │
              │  │ Almacenamiento Media  │  │
              │  │  ├─ /media/movies/    │  │
              │  │  └─ /media/series/    │  │
              │  └───────────────────────┘  │
              │                             │
              │  ┌───────────────────────┐  │
              │  │ Tailscale VPN         │  │
              │  │  └─ 100.x.x.x (SSH)  │  │
              │  └───────────────────────┘  │
              └─────────────────────────────┘
```

**Flujo de una peticion:**
1. Usuario abre `https://calilu.mooo.com` en su navegador
2. DNS resuelve a la IP publica del router
3. Livebox reenvía puerto 443 al NAS
4. nginx termina SSL, sirve archivos estaticos o hace proxy a Node.js
5. Node.js procesa la peticion y responde

---

## 2. Configuracion DDNS

### Opcion A: Mantener calilu.mooo.com (FreeDNS / afraid.org)

Ya esta configurado y funciona. El dominio `mooo.com` pertenece a **FreeDNS** (afraid.org), no a NoIP. Mantenerlo es lo mas sencillo.

**Actualizacion automatica de IP desde el NAS** (cron cada 5 minutos):

```bash
# Crear script de actualizacion
cat > /opt/isiprime/scripts/ddns-update.sh << 'EOF'
#!/bin/bash
# Actualizar DDNS de FreeDNS (afraid.org)
# Obtener el update URL desde: https://freedns.afraid.org/dynamic/
# Cada subdominio tiene una URL unica con token

UPDATE_URL="https://freedns.afraid.org/dynamic/update.php?TU_TOKEN_AQUI"

curl -s "$UPDATE_URL" >> /var/log/ddns-update.log 2>&1
echo " [$(date)]" >> /var/log/ddns-update.log
EOF

chmod +x /opt/isiprime/scripts/ddns-update.sh
```

**Agregar al crontab:**

```bash
crontab -e
# Añadir esta linea:
*/5 * * * * /opt/isiprime/scripts/ddns-update.sh
```

**Alternativa: usar el cliente DDNS del Livebox 6:**

1. Acceder a `http://192.168.1.1` (o `http://livebox/`)
2. Ir a **Configuracion avanzada > DynDNS**
3. Seleccionar proveedor FreeDNS/afraid.org (o configurar URL personalizada)
4. Introducir la URL de actualizacion
5. El router actualiza la IP automaticamente

> **Nota:** Verificar que el Livebox soporta FreeDNS como proveedor. Si no, usar el cron en el NAS (metodo mas fiable).

### Opcion B: DuckDNS (alternativa gratuita)

DuckDNS es gratuito, sin necesidad de renovacion periodica.

```bash
# Crear subdominio en https://www.duckdns.org (login con cuenta de Google)
# Ejemplo: isiprime.duckdns.org

cat > /opt/isiprime/scripts/ddns-duckdns.sh << 'EOF'
#!/bin/bash
DUCKDNS_TOKEN="tu_token_duckdns"
DUCKDNS_DOMAIN="isiprime"

curl -s "https://www.duckdns.org/update?domains=$DUCKDNS_DOMAIN&token=$DUCKDNS_TOKEN&ip=" \
  >> /var/log/ddns-duckdns.log 2>&1

echo " [$(date)]" >> /var/log/ddns-duckdns.log
EOF

chmod +x /opt/isiprime/scripts/ddns-duckdns.sh

# Cron cada 5 minutos
crontab -e
*/5 * * * * /opt/isiprime/scripts/ddns-duckdns.sh
```

### Opcion C: Dominio propio (recomendado para produccion)

Registrar un dominio como `isiprime.es` (~10 EUR/año) da un aspecto mas profesional.

- Registradores recomendados: Namecheap, Porkbun, OVH, Dinahosting (España)
- Configurar un registro A dinamico con la API del registrador
- O usar Cloudflare DNS (gratuito) como intermediario con actualizacion automatica

### Consideraciones sobre cambio de IP

- La mayoria de fibras en España (Movistar, Orange) mantienen la IP estable durante semanas o meses
- Cuando cambia, el DDNS tarda ~5 minutos en propagarse
- Los usuarios experimentaran un corte breve (~30-60 segundos) durante la propagacion
- Para 5-10 usuarios, esto es perfectamente aceptable

---

## 3. Configuracion nginx

### Archivo principal: `/etc/nginx/sites-available/isiprime`

```nginx
# ============================================================
# IsiPrime - Configuracion nginx
# Reverse proxy con HTTPS para streaming de video
# ============================================================

# --- Redireccion HTTP a HTTPS ---
server {
    listen 80;
    server_name calilu.mooo.com;

    # Excepcion para renovacion de certificados Let's Encrypt
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
        allow all;
    }

    # Redirigir todo lo demas a HTTPS
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# --- Servidor HTTPS principal ---
server {
    listen 443 ssl http2;
    server_name calilu.mooo.com;

    # ===================
    # SSL / Certificados
    # ===================
    ssl_certificate     /etc/letsencrypt/live/calilu.mooo.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/calilu.mooo.com/privkey.pem;

    # Configuracion SSL segura
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # OCSP Stapling (mejora rendimiento SSL)
    ssl_stapling on;
    ssl_stapling_verify on;
    resolver 8.8.8.8 8.8.4.4 valid=300s;
    resolver_timeout 5s;

    # ========================
    # Cabeceras de seguridad
    # ========================
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # ==============
    # Compresion
    # ==============
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_min_length 1000;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/json
        application/javascript
        application/xml
        application/rss+xml
        image/svg+xml;

    # Tamaño maximo de subida (posters, etc.)
    client_max_body_size 50M;

    # ============================
    # Archivos estaticos (React)
    # ============================
    location / {
        root /opt/isiprime/my-ui/build;
        try_files $uri $uri/ /index.html;

        # Cache agresiva para assets estaticos
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 30d;
            add_header Cache-Control "public, immutable";
            access_log off;
        }
    }

    # ============================
    # SSE (Server-Sent Events)
    # Debe ir ANTES de /api/ generico
    # ============================
    location ~ ^/api/(requests/events|convert/progress) {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE: sin buffering, sin cache, timeout largo
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 86400s;  # 24 horas
    }

    # ============================
    # Rate limiting para login
    # ============================
    location /api/auth/login {
        limit_req zone=login burst=5 nodelay;
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # ============================
    # API proxy (general)
    # ============================
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts para llamadas API largas (TMDB, etc.)
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # ============================
    # Streaming de video
    # ============================
    location /stream/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Range $http_range;
        proxy_set_header If-Range $http_if_range;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Streaming: sin buffering, archivos grandes
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_max_temp_file_size 0;

        # Timeout largo para streaming (1 hora)
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # Streaming de series (misma configuracion)
    location /stream-series/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Range $http_range;
        proxy_set_header If-Range $http_if_range;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;
        proxy_request_buffering off;
        proxy_max_temp_file_size 0;

        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # ============================
    # Logs
    # ============================
    access_log /var/log/nginx/isiprime-access.log;
    error_log  /var/log/nginx/isiprime-error.log warn;
}
```

### Zona de rate limiting en `/etc/nginx/nginx.conf`

Añadir dentro del bloque `http { }`:

```nginx
# Rate limiting para login: maximo 5 intentos por minuto por IP
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;

# Opcional: rate limiting general para API (100 req/s por IP)
limit_req_zone $binary_remote_addr zone=api:10m rate=100r/s;
```

### Activar la configuracion

```bash
# Crear enlace simbolico para activar el sitio
ln -s /etc/nginx/sites-available/isiprime /etc/nginx/sites-enabled/

# Eliminar sitio por defecto (si existe)
rm -f /etc/nginx/sites-enabled/default

# Verificar sintaxis
nginx -t

# Recargar nginx
systemctl reload nginx
```

### Notas importantes sobre nginx

- **SSE antes de /api/**: El bloque de SSE debe estar antes del bloque general `/api/` porque nginx usa la primera coincidencia para expresiones regulares
- **proxy_buffering off** en streaming: esencial para que los range requests funcionen correctamente y el video no se quede en buffer
- **proxy_max_temp_file_size 0** en streaming: evita que nginx escriba archivos temporales de video a disco
- **/stream-series/**: no olvidar incluir esta ruta, que es independiente de `/stream/`

---

## 4. SSL/HTTPS con Let's Encrypt

### Requisitos previos

- El dominio (calilu.mooo.com) debe resolver a la IP publica del router
- Los puertos 80 y 443 deben estar reenviados al NAS
- nginx debe estar instalado y corriendo

### Paso 1: Instalar certbot

```bash
apt update
apt install certbot python3-certbot-nginx -y
```

### Paso 2: Crear directorio para el desafio ACME

```bash
mkdir -p /var/www/certbot
```

### Paso 3: Obtener el certificado

```bash
# Metodo recomendado: plugin nginx (configura todo automaticamente)
certbot --nginx -d calilu.mooo.com

# Alternativa: metodo standalone (detiene nginx temporalmente)
# systemctl stop nginx
# certbot certonly --standalone -d calilu.mooo.com
# systemctl start nginx
```

Certbot pedira:
- Email para notificaciones de expiracion
- Aceptar terminos de servicio
- Opcionalmente compartir email con EFF

### Paso 4: Verificar renovacion automatica

```bash
# Certbot instala un timer de systemd automaticamente
systemctl list-timers | grep certbot

# Probar renovacion (sin renovar realmente)
certbot renew --dry-run
```

### Paso 5: Configurar hook de recarga de nginx

```bash
# Crear hook para recargar nginx despues de renovar
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh << 'EOF'
#!/bin/bash
systemctl reload nginx
EOF

chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
```

### Informacion importante sobre Let's Encrypt

| Aspecto | Detalle |
|---------|---------|
| Validez del certificado | 90 dias |
| Renovacion automatica | A los 60 dias (30 dias antes de expirar) |
| Limite de certificados | 50 por dominio registrado por semana |
| Wildcard | No disponible con HTTP challenge (necesita DNS challenge) |
| Coste | Gratuito |

### Verificar que HTTPS funciona

```bash
# Comprobar el certificado
openssl s_client -connect calilu.mooo.com:443 -servername calilu.mooo.com < /dev/null 2>/dev/null | openssl x509 -noout -dates

# O desde un navegador: abrir https://calilu.mooo.com y verificar el candado
```

---

## 5. Port Forwarding en Livebox 6

### Acceso al panel de administracion

1. Abrir navegador y acceder a `http://192.168.1.1` (o `http://livebox/`)
2. Introducir contraseña del router (esta en la etiqueta inferior del Livebox)

### Asignar IP fija al NAS (DHCP Reservation)

Antes de crear las reglas de reenvio, asegurar que el NAS siempre recibe la misma IP:

1. Ir a **Informacion > DHCP** (o **Red > DHCP**)
2. Buscar el NAS en la lista de dispositivos conectados
3. Anotar su **direccion MAC**
4. Ir a **Red > DHCP > Reserva de direcciones**
5. Añadir reserva:
   - **MAC**: la del NAS
   - **IP**: `192.168.1.100` (o la que se prefiera)
   - **Nombre**: `LincStation-N2`

### Crear reglas NAT/PAT

1. Ir a **Red > NAT/PAT** (o **Configuracion avanzada > NAT/PAT**)
2. Añadir las siguientes reglas:

| Nombre | Protocolo | Puerto externo | IP destino | Puerto interno |
|--------|-----------|----------------|------------|----------------|
| IsiPrime-HTTPS | TCP | 443 | 192.168.1.100 | 443 |
| IsiPrime-HTTP | TCP | 80 | 192.168.1.100 | 80 |

3. Guardar y aplicar

### Puertos que NO se deben abrir

| Puerto | Servicio | Motivo |
|--------|----------|--------|
| 22 | SSH | Acceso remoto via Tailscale VPN en su lugar |
| 8080 | Node.js directo | nginx hace de proxy, no exponer directamente |
| 21 | FTP | Eliminado en la migracion (acceso local directo) |
| 3306/5432 | Base de datos | Nunca exponer bases de datos a internet |

### Verificar que funciona

```bash
# Desde fuera de la red local (movil con datos, por ejemplo):
curl -I https://calilu.mooo.com

# O usar un servicio online:
# https://www.yougetsignal.com/tools/open-ports/
# Comprobar puerto 443
```

---

## 6. Firewall (ufw)

### Instalacion y configuracion

```bash
# Instalar ufw
apt install ufw -y

# Politica por defecto: denegar entrada, permitir salida
ufw default deny incoming
ufw default allow outgoing

# ================================
# Reglas de acceso
# ================================

# SSH: solo desde la red local
ufw allow from 192.168.1.0/24 to any port 22 proto tcp comment "SSH LAN"

# HTTP: desde cualquier lugar (redireccion a HTTPS + Let's Encrypt)
ufw allow 80/tcp comment "HTTP - Redireccion y ACME"

# HTTPS: desde cualquier lugar
ufw allow 443/tcp comment "HTTPS - IsiPrime"

# ================================
# Activar firewall
# ================================
ufw enable

# Verificar estado
ufw status verbose
```

### Resultado esperado de `ufw status verbose`

```
Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), disabled (routed)
New profiles: skip

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW IN    192.168.1.0/24         # SSH LAN
80/tcp                     ALLOW IN    Anywhere               # HTTP
443/tcp                    ALLOW IN    Anywhere               # HTTPS
80/tcp (v6)                ALLOW IN    Anywhere (v6)          # HTTP
443/tcp (v6)               ALLOW IN    Anywhere (v6)          # HTTPS
```

### Notas sobre el firewall

- Node.js escucha en `:8080` solo en `127.0.0.1` (localhost). No necesita regla de firewall porque nginx hace de proxy desde la misma maquina
- Si se instala Tailscale, este gestiona sus propias reglas de firewall automaticamente
- No abrir mas puertos de los necesarios. Cada puerto abierto es una superficie de ataque

---

## 7. Analisis de Ancho de Banda

### Consumo tipico de streaming

| Calidad | Resolucion | Bitrate tipico | Bitrate alto |
|---------|------------|----------------|--------------|
| SD | 480p | 1.5 Mbps | 3 Mbps |
| HD | 720p | 4 Mbps | 6 Mbps |
| Full HD | 1080p | 8 Mbps | 12 Mbps |
| 4K UHD | 2160p | 25 Mbps | 40 Mbps |

> **Nota:** El bitrate depende de la codificacion del archivo. Las peliculas de IsiPrime son tipicamente 1080p con H.264, entre 5-12 Mbps.

### Capacidad segun conexion de fibra

| Plan de fibra | Subida | Streams 1080p (8 Mbps) | Streams 720p (4 Mbps) |
|---------------|--------|------------------------|-----------------------|
| 100 Mbps simetrico | 100 Mbps | ~12 | ~25 |
| 300 Mbps simetrico | 300 Mbps | ~37 | ~75 |
| 500 Mbps simetrico | 500 Mbps | ~62 | ~125 |
| 600 Mbps simetrico | 600 Mbps | ~75 | ~150 |
| 1 Gbps simetrico | 1000 Mbps | ~125 | ~250 |

### Escenario real: 5-10 usuarios

```
Caso tipico:  5 usuarios simultaneos x 8 Mbps = 40 Mbps de subida
Caso extremo: 10 usuarios simultaneos x 8 Mbps = 80 Mbps de subida
```

**Con fibra 300 Mbps simetrica (Movistar/Orange):**
- 40 Mbps = 13% de la capacidad de subida (sobra de sobra)
- 80 Mbps = 27% de la capacidad de subida (holgado)
- Queda ancho de banda para navegacion normal del hogar

**Conclusion:** Para 5-10 usuarios, cualquier fibra simetrica de 300 Mbps o superior es mas que suficiente.

### Formula rapida

```
usuarios_maximos = velocidad_subida_mbps / bitrate_por_stream_mbps

Ejemplo: 300 Mbps / 8 Mbps = 37 usuarios simultaneos en 1080p
```

### Importante: velocidad de subida

En España, la fibra es tipicamente **simetrica** (misma velocidad de subida y bajada). Esto es critico para un servidor de streaming, ya que lo que importa es la **subida**, no la bajada.

Verificar la velocidad real:
```bash
# Desde el NAS (instalar speedtest-cli si no esta)
apt install speedtest-cli -y
speedtest-cli --simple
```

---

## 8. VPN para Administracion (Tailscale)

### Por que Tailscale

- **No expone SSH a internet**: el puerto 22 solo es accesible desde la LAN o via Tailscale
- **Zero-config**: no necesita configurar el router ni abrir puertos adicionales
- **WireGuard**: protocolo VPN moderno, rapido y seguro
- **Plan gratuito**: hasta 3 usuarios y 100 dispositivos

### Instalacion en el NAS

```bash
# Instalar Tailscale
curl -fsSL https://tailscale.com/install.sh | sh

# Iniciar y autenticar
tailscale up

# Se mostrara un enlace para autenticar en el navegador
# Abrir el enlace e iniciar sesion con cuenta de Google/GitHub/etc.

# Verificar conexion
tailscale status
```

### Instalacion en el PC de administracion

1. Descargar desde https://tailscale.com/download
2. Instalar y autenticar con la misma cuenta
3. Ambos dispositivos reciben una IP `100.x.x.x`

### Uso

```bash
# Desde el PC, conectar al NAS via Tailscale
ssh usuario@100.x.x.x

# La IP de Tailscale del NAS se puede ver con:
tailscale ip -4
```

### Que NO pasar por Tailscale

- **El streaming de video**: los usuarios deben conectar directamente via HTTPS, no por VPN. Pasar video por Tailscale añade latencia y reduce calidad
- **Cualquier trafico de usuarios**: Tailscale es solo para administracion

### Alternativa: SSH solo con clave publica

Si no se quiere usar Tailscale, se puede asegurar SSH con claves:

```bash
# En el PC de admin, generar clave (si no existe)
ssh-keygen -t ed25519

# Copiar clave al NAS
ssh-copy-id usuario@192.168.1.100

# En el NAS, deshabilitar login con password
# /etc/ssh/sshd_config:
# PasswordAuthentication no
# PubkeyAuthentication yes

systemctl restart sshd
```

---

## 9. DNS y Resiliencia de Red

### Frecuencia de actualizacion DDNS

```bash
# Usando systemd timer (alternativa mas robusta que cron)

# Crear servicio
cat > /etc/systemd/system/ddns-update.service << 'EOF'
[Unit]
Description=Actualizar DDNS
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/opt/isiprime/scripts/ddns-update.sh
User=root
EOF

# Crear timer
cat > /etc/systemd/system/ddns-update.timer << 'EOF'
[Unit]
Description=Actualizar DDNS cada 5 minutos

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
AccuracySec=30s

[Install]
WantedBy=timers.target
EOF

# Activar
systemctl daemon-reload
systemctl enable --now ddns-update.timer

# Verificar
systemctl list-timers | grep ddns
```

### Comportamiento ante cambio de IP

| Evento | Duracion del corte | Accion necesaria |
|--------|-------------------|------------------|
| IP cambia (raro en fibra) | 30-60 segundos | DDNS se actualiza automaticamente |
| Router reinicia | 1-3 minutos | NAS arranca automaticamente, DDNS se actualiza |
| Corte de luz breve | 2-5 minutos (con UPS) | UPS mantiene NAS activo |
| Corte de luz largo | Hasta que vuelva la luz | NAS arranca automaticamente al volver la corriente |

### Configurar inicio automatico del NAS

- En la BIOS/UEFI del LincStation N2: habilitar **"Restore on AC Power Loss"** (o equivalente)
- Esto asegura que el NAS arranca automaticamente cuando vuelve la corriente
- PM2 se encarga de arrancar Node.js automaticamente al iniciar el sistema

### UPS recomendado

Un SAI/UPS basico (400-600 VA) es suficiente para un NAS:
- Protege contra micro-cortes (evita corrupcion de datos)
- Da ~15-30 minutos para apagado limpio en cortes largos
- Modelos recomendados: APC Back-UPS 600VA, Salicru SPS 500 ONE

---

## 10. Cambios Necesarios en IsiPrime (Backend)

### Actualizar autenticacion para confiar en el proxy

El backend actual auto-autentica IPs locales. Con nginx como proxy, todas las peticiones llegan desde `127.0.0.1`. Hay que configurar Express para leer la IP real del header `X-Real-IP`:

```javascript
// En server.js, añadir al inicio
app.set('trust proxy', 'loopback');  // Confiar en proxy desde localhost

// La logica de autenticacion ya usa req.ip, que con trust proxy
// leera X-Forwarded-For automaticamente
```

### Eliminar dependencia de FTP

Con almacenamiento local directo, se puede eliminar la logica de FTP:

```javascript
// storage-settings.json - configurar modo local permanente
{
  "mode": "local",
  "localPath": "/media"
}
```

---

## 11. Checklist de Seguridad

### Antes de poner en produccion

- [ ] Solo puertos 80 y 443 reenviados en el router
- [ ] Puerto 22 (SSH) accesible solo desde LAN (regla ufw)
- [ ] Certificado SSL valido y renovacion automatica funcionando
- [ ] nginx rate limiting activo en endpoint de login
- [ ] Header HSTS habilitado (Strict-Transport-Security)
- [ ] Sin puertos FTP abiertos (FTP eliminado)
- [ ] Firewall ufw activo con politica deny por defecto
- [ ] Contraseñas de usuarios cambiadas (no usar las por defecto de users.json)
- [ ] Actualizaciones de seguridad automaticas configuradas

### Mantenimiento periodico

- [ ] `apt update && apt upgrade` al menos 1 vez al mes
- [ ] Revisar logs de nginx: `tail -f /var/log/nginx/isiprime-error.log`
- [ ] Verificar certificado SSL: `certbot certificates`
- [ ] Verificar espacio en disco: `df -h`
- [ ] Revisar estado de PM2: `pm2 status`

### Instalar Fail2ban (proteccion adicional)

```bash
# Instalar
apt install fail2ban -y

# Configurar para nginx
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5

[nginx-http-auth]
enabled = true

[nginx-limit-req]
enabled = true
logpath = /var/log/nginx/isiprime-error.log
EOF

# Iniciar
systemctl enable --now fail2ban

# Ver estado
fail2ban-client status
```

### Configurar actualizaciones automaticas de seguridad

```bash
# Instalar unattended-upgrades
apt install unattended-upgrades -y

# Activar
dpkg-reconfigure -plow unattended-upgrades
# Seleccionar "Si"

# Esto instalara automaticamente parches de seguridad
```

---

## 12. Resumen de la Configuracion Final

```
Internet
    │
    ▼
calilu.mooo.com ──► IP publica (DDNS cada 5 min)
    │
    ▼
Livebox 6 ──► NAT: 80→NAS:80, 443→NAS:443
    │
    ▼
LincStation N2 (192.168.1.100)
    ├── ufw: solo 80, 443, SSH-LAN
    ├── nginx :443 (SSL + proxy + static)
    │     ├── / → React build (cache 30d)
    │     ├── /api/ → Node.js :8080
    │     ├── /stream/ → Node.js :8080 (sin buffer)
    │     └── /api/auth/login → rate limit 5/min
    ├── Node.js :8080 (PM2, solo localhost)
    ├── Let's Encrypt (renovacion auto 60d)
    ├── Tailscale (SSH remoto seguro)
    └── Fail2ban (proteccion fuerza bruta)
```

**Puertos abiertos al exterior:** Solo 80 (redireccion) y 443 (HTTPS).
Todo lo demas esta protegido por firewall.
