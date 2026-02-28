#!/bin/bash
# ============================================
# IsiPrime - Setup nginx + HTTPS (Let's Encrypt)
# Ejecutar en el NAS (LincStation N2)
# ============================================

set -e

# Colores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

DOMAIN="calilu.mooo.com"
BACKEND_PORT=8080
EMAIL=""  # Certbot pedirá email si está vacío

echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  IsiPrime - Setup nginx + HTTPS${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

# Verificar root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}ERROR: Ejecutar como root (sudo)${NC}"
    exit 1
fi

# Verificar que IsiPrime está corriendo
if ! curl -s http://localhost:$BACKEND_PORT/api/auth/status > /dev/null 2>&1; then
    echo -e "${YELLOW}AVISO: IsiPrime no parece estar corriendo en puerto $BACKEND_PORT${NC}"
    echo -e "${YELLOW}Asegurate de que el servidor esté activo antes de probar HTTPS${NC}"
    echo ""
fi

# ============================================
# 1. Instalar nginx y certbot
# ============================================
echo -e "${GREEN}[1/5] Instalando nginx y certbot...${NC}"
apt update
apt install -y nginx certbot python3-certbot-nginx

# ============================================
# 2. Configurar nginx (HTTP primero)
# ============================================
echo -e "${GREEN}[2/5] Configurando nginx...${NC}"

cat > /etc/nginx/sites-available/isiprime << 'NGINX_CONF'
# IsiPrime - Reverse Proxy
# HTTP → redirige a HTTPS (certbot lo configura automaticamente)

server {
    listen 80;
    server_name calilu.mooo.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts largos para streaming de video
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_connect_timeout 60s;

        # Sin limite de tamaño para streaming
        client_max_body_size 0;

        # Buffering desactivado para streaming
        proxy_buffering off;
        proxy_request_buffering off;
    }

    # SSE (Server-Sent Events) - requests y conversiones
    location /api/requests/events {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }

    location /api/convert/progress {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }
}
NGINX_CONF

# Activar sitio y desactivar default
ln -sf /etc/nginx/sites-available/isiprime /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Verificar config
nginx -t
systemctl restart nginx
echo -e "${GREEN}   nginx configurado y activo${NC}"

# ============================================
# 3. Obtener certificado SSL
# ============================================
echo -e "${GREEN}[3/5] Obteniendo certificado SSL con Let's Encrypt...${NC}"
echo ""
echo -e "${YELLOW}IMPORTANTE: Antes de continuar, asegurate de que:${NC}"
echo -e "${YELLOW}  1. El dominio ${DOMAIN} apunta a tu IP publica${NC}"
echo -e "${YELLOW}  2. El puerto 80 está abierto en el router (port forwarding → IP NAS)${NC}"
echo -e "${YELLOW}  3. El puerto 443 está abierto en el router (port forwarding → IP NAS)${NC}"
echo ""
read -p "¿Continuar con la obtención del certificado? (s/n): " CONFIRM
if [ "$CONFIRM" != "s" ] && [ "$CONFIRM" != "S" ]; then
    echo -e "${YELLOW}Certificado no obtenido. Puedes ejecutar manualmente:${NC}"
    echo -e "${CYAN}  sudo certbot --nginx -d ${DOMAIN}${NC}"
    echo ""
else
    if [ -z "$EMAIL" ]; then
        certbot --nginx -d "$DOMAIN"
    else
        certbot --nginx -d "$DOMAIN" --email "$EMAIL" --agree-tos --no-eff-email
    fi
    echo -e "${GREEN}   Certificado SSL instalado${NC}"
fi

# ============================================
# 4. Renovación automática
# ============================================
echo -e "${GREEN}[4/5] Configurando renovación automática...${NC}"

# Certbot ya instala un timer de systemd o cron, verificar
if systemctl is-active --quiet certbot.timer 2>/dev/null; then
    echo -e "${GREEN}   Timer de renovación ya activo (systemd)${NC}"
elif crontab -l 2>/dev/null | grep -q certbot; then
    echo -e "${GREEN}   Cron de renovación ya configurado${NC}"
else
    # Añadir cron de renovación (2 veces al dia, como recomienda Let's Encrypt)
    (crontab -l 2>/dev/null; echo "0 3,15 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'") | crontab -
    echo -e "${GREEN}   Cron de renovación añadido (3:00 y 15:00)${NC}"
fi

# ============================================
# 5. Verificación
# ============================================
echo -e "${GREEN}[5/5] Verificando configuración...${NC}"
echo ""

# Estado de nginx
if systemctl is-active --quiet nginx; then
    echo -e "${GREEN}  ✓ nginx activo${NC}"
else
    echo -e "${RED}  ✗ nginx NO activo${NC}"
fi

# Verificar certificado
if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
    EXPIRY=$(openssl x509 -enddate -noout -in "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" 2>/dev/null | cut -d= -f2)
    echo -e "${GREEN}  ✓ Certificado SSL instalado (expira: $EXPIRY)${NC}"
else
    echo -e "${YELLOW}  ! Certificado SSL pendiente${NC}"
fi

# Verificar backend
if curl -s http://localhost:$BACKEND_PORT/api/auth/status > /dev/null 2>&1; then
    echo -e "${GREEN}  ✓ Backend IsiPrime respondiendo en puerto $BACKEND_PORT${NC}"
else
    echo -e "${YELLOW}  ! Backend no responde (asegurate de arrancarlo)${NC}"
fi

echo ""
echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  Configuración completada${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""
echo -e "  URL HTTPS:  ${GREEN}https://${DOMAIN}${NC}"
echo -e "  URL LAN:    ${GREEN}http://$(hostname -I | awk '{print $1}'):${BACKEND_PORT}${NC}"
echo ""
echo -e "${YELLOW}Pasos manuales pendientes:${NC}"
echo -e "  1. Configurar DDNS en tu router para que ${DOMAIN} apunte a tu IP publica"
echo -e "     (O usa un cliente DDNS como ddclient si tu router no lo soporta)"
echo -e "  2. Port forwarding en el router:"
echo -e "     - Puerto 80  → $(hostname -I | awk '{print $1}'):80  (renovación certificado)"
echo -e "     - Puerto 443 → $(hostname -I | awk '{print $1}'):443 (HTTPS)"
echo -e "  3. Probar: curl https://${DOMAIN}/api/auth/status"
echo ""
