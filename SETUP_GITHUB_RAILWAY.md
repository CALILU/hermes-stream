# Guía de Configuración: GitHub + Railway

Esta guía explica cómo conectar cualquier aplicación web a GitHub y Railway para despliegue automático.

## Requisitos Previos

- Node.js instalado (versión 18 o superior)
- Git instalado
- Cuenta en GitHub (usuario: CALILU)
- Cuenta en Railway conectada a GitHub
- Terminal con acceso a comandos bash

## Paso 1: Instalar CLIs necesarias

### GitHub CLI

```bash
# Verificar si está instalado
gh --version

# Si no está instalado, descargar de:
# https://cli.github.com/
```

### Railway CLI

```bash
# Instalar globalmente
npm install -g @railway/cli

# Verificar instalación
railway --version
```

## Paso 2: Autenticar servicios (solo primera vez)

### GitHub CLI

```bash
# Iniciar sesión
gh auth login

# Seleccionar opciones:
# ✓ GitHub.com
# ✓ HTTPS
# ✓ Yes (authenticate Git with GitHub credentials)
# ✓ Login with a web browser

# Verificar autenticación
gh auth status
```

### Railway CLI

```bash
# Iniciar sesión (abre navegador automáticamente)
railway login

# Verificar autenticación
railway whoami
```

## Paso 3: Preparar tu aplicación

### Estructura mínima requerida

```
tu-proyecto/
├── package.json          # Con script "start"
├── server.js            # O index.js, app.js
├── .gitignore           # Excluir node_modules, .env
├── .env.example         # Plantilla de variables (sin secretos)
└── README.md
```

### Configurar package.json

Asegúrate de tener:

```json
{
  "name": "tu-proyecto",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

### Configurar .gitignore

```gitignore
# Dependencias
node_modules/
package-lock.json

# Variables de entorno
.env
.env.local

# Logs
*.log
npm-debug.log*

# Sistema operativo
.DS_Store
Thumbs.db

# Uploads (si hay)
uploads/
```

### Configurar puerto dinámico

**IMPORTANTE**: Railway asigna el puerto automáticamente.

```javascript
// server.js
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor en puerto ${PORT}`);
});
```

## Paso 4: Crear repositorio en GitHub

### Opción A: Usando GitHub CLI (recomendado)

```bash
# En el directorio de tu proyecto
cd tu-proyecto

# Inicializar git (si no está inicializado)
git init

# Hacer commit inicial
git add -A
git commit -m "feat: initial commit"

# Crear repositorio en GitHub y hacer push
gh repo create tu-proyecto --public --source=. --remote=origin --push
```

### Opción B: Manual

```bash
# Inicializar git
git init
git add -A
git commit -m "feat: initial commit"

# Crear repo en GitHub desde web: https://github.com/new

# Añadir remote con token
git remote add origin https://ghp_TOKEN@github.com/CALILU/tu-proyecto.git

# Push
git push -u origin main
```

### Token de GitHub

Si necesitas un nuevo token:

1. Ve a: https://github.com/settings/tokens
2. "Generate new token" → "Classic"
3. Nombre: `Deploy tu-proyecto`
4. Scopes: Selecciona `repo` (acceso completo a repositorios)
5. "Generate token"
6. **Copia el token** (solo se muestra una vez): `ghp_xxxxxxxxxxxx`

## Paso 5: Desplegar en Railway

### Desde la web (recomendado)

1. Ve a: https://railway.app/dashboard
2. Click en "New Project"
3. Selecciona "Deploy from GitHub repo"
4. Busca y selecciona tu repositorio: `CALILU/tu-proyecto`
5. Railway detecta automáticamente Node.js
6. Click en "Deploy"

### Desde Railway CLI (alternativa)

```bash
# En el directorio de tu proyecto
cd tu-proyecto

# Inicializar proyecto Railway
railway init

# Se creará un nuevo proyecto en tu cuenta
# Railway vincula automáticamente con el repo de GitHub

# Ver estado
railway status
```

## Paso 6: Configurar variables de entorno

### Desde Railway Dashboard

1. Ve a tu proyecto en https://railway.app
2. Click en el servicio de tu app
3. Pestaña "Variables"
4. Añade las variables necesarias:

```
NODE_ENV=production
SESSION_SECRET=tu_secreto_seguro_aqui
DB_HOST=valor
DB_PORT=valor
DB_NAME=valor
DB_USER=valor
DB_PASSWORD=valor
```

**NOTA**: Railway asigna automáticamente la variable `PORT`, no la configures manualmente.

### Desde Railway CLI

```bash
# Añadir una variable
railway variables set SESSION_SECRET=valor

# Ver todas las variables
railway variables
```

## Paso 7: Añadir base de datos (si necesario)

### PostgreSQL

1. En Railway Dashboard → Tu proyecto
2. Click "New" → "Database" → "PostgreSQL"
3. Railway crea automáticamente las variables:
   - `DATABASE_URL` (URL completa de conexión)
   - `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`

### Conectar la BD a tu app

Railway vincula automáticamente el servicio de BD con tu app.

## Paso 8: Despliegue automático

Una vez configurado, cada `git push` despliega automáticamente:

```bash
# Hacer cambios en tu código
git add -A
git commit -m "feat: nueva funcionalidad"
git push origin main

# Railway detecta el push automáticamente
# Construye y despliega la nueva versión
```

## Comandos útiles

### Git + GitHub

```bash
# Ver estado
git status

# Hacer commit
git add -A
git commit -m "mensaje"

# Push a GitHub (despliega automáticamente en Railway)
git push origin main

# Ver repositorios de GitHub
gh repo list
```

### Railway CLI

```bash
# Ver logs en tiempo real
railway logs

# Ver estado del deployment
railway status

# Abrir dashboard en navegador
railway open

# Ver variables de entorno
railway variables

# Listar todos tus proyectos
railway list

# SSH al contenedor (debugging)
railway run bash
```

## Verificar que todo funciona

1. **Local**:
   ```bash
   npm install
   npm start
   # Visita http://localhost:3000
   ```

2. **GitHub**:
   ```bash
   git log --oneline -5
   # Deberías ver tus commits
   ```

3. **Railway**:
   ```bash
   railway logs
   # Deberías ver los logs del servidor
   ```

4. **Producción**:
   - Abre tu app en: `https://tu-proyecto-production.up.railway.app`

## Troubleshooting

### Error: "Port already in use"

```javascript
// Asegúrate de usar process.env.PORT
const PORT = process.env.PORT || 3000;
```

### Error: "Module not found"

```bash
# Verifica que package.json tiene todas las dependencias
npm install
```

### Deployment falla en Railway

1. Revisa logs: `railway logs`
2. Verifica que `npm start` funciona localmente
3. Verifica variables de entorno en Railway Dashboard

### Git push pide usuario/contraseña

```bash
# Configura el token en la URL del remote
git remote set-url origin https://ghp_TOKEN@github.com/CALILU/repo.git
```

### Railway no detecta cambios

1. Verifica que Railway está conectado al repo de GitHub
2. En Railway Dashboard → Settings → verifica "Source Repo"
3. Haz un commit vacío: `git commit --allow-empty -m "trigger deploy"`

## Checklist de configuración

- [ ] GitHub CLI instalado y autenticado
- [ ] Railway CLI instalado y autenticado
- [ ] package.json con script `start`
- [ ] Puerto usa `process.env.PORT`
- [ ] .gitignore excluye `.env` y `node_modules`
- [ ] Repositorio creado en GitHub
- [ ] Proyecto creado en Railway
- [ ] Variables de entorno configuradas
- [ ] Base de datos añadida (si aplica)
- [ ] `git push` despliega automáticamente

## Flujo completo resumido

```bash
# 1. Preparar proyecto
npm init -y
# Crear server.js, .gitignore, etc.

# 2. Crear repo en GitHub
git init
git add -A
git commit -m "feat: initial commit"
gh repo create mi-app --public --source=. --push

# 3. Crear proyecto en Railway (desde web)
# https://railway.app → New Project → Deploy from GitHub

# 4. Configurar variables (desde web)
# Railway Dashboard → Variables → Añadir

# 5. Cada cambio despliega automáticamente
git add -A
git commit -m "feat: nueva feature"
git push origin main
```

## Recursos

- GitHub del usuario: https://github.com/CALILU
- Railway Dashboard: https://railway.app/dashboard
- Railway Docs: https://docs.railway.app
- GitHub CLI: https://cli.github.com/
- Railway CLI: https://docs.railway.app/develop/cli

## Contacto y soporte

- Para issues de GitHub: https://github.com/CALILU
- Para issues de Railway: https://railway.app/help
- Documentación Railway: https://docs.railway.app

---

**Última actualización**: 31/12/2024
**Proyecto de referencia**: ausencias-profesores
