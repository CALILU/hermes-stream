# Quick Start: Desplegar App en GitHub + Railway

Guía rápida de 5 minutos para desplegar una aplicación web.

## Configuración inicial (solo primera vez)

```bash
# Instalar CLIs
npm install -g @railway/cli

# Autenticar
gh auth login
railway login

# Verificar
gh auth status
railway whoami
```

## Desplegar una nueva app

### 1. Preparar código

```javascript
// server.js - IMPORTANTE: usar process.env.PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on ${PORT}`));
```

```json
// package.json
{
  "scripts": {
    "start": "node server.js"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

```gitignore
# .gitignore
node_modules/
.env
*.log
```

### 2. Subir a GitHub

```bash
git init
git add -A
git commit -m "feat: initial commit"
gh repo create mi-app --public --source=. --push
```

### 3. Desplegar en Railway

**Opción A: Desde web** (recomendado)
1. https://railway.app/dashboard
2. New Project → Deploy from GitHub repo
3. Seleccionar repositorio
4. Deploy

**Opción B: Desde CLI**
```bash
railway init
railway up
```

### 4. Configurar variables

```bash
# Desde CLI
railway variables set KEY=value

# O desde web
# Railway Dashboard → Variables → Add
```

### 5. Añadir BD PostgreSQL (opcional)

Railway Dashboard → New → Database → PostgreSQL

### 6. Siguiente despliegue

```bash
git add -A
git commit -m "feat: nueva feature"
git push origin main
# Railway despliega automáticamente
```

## Comandos esenciales

```bash
# Ver logs
railway logs

# Ver estado
railway status

# Abrir dashboard
railway open

# Ver variables
railway variables
```

## Checklist rápido

- [ ] `process.env.PORT` en el código
- [ ] Script `start` en package.json
- [ ] `.env` en .gitignore
- [ ] Push a GitHub
- [ ] Proyecto en Railway conectado al repo
- [ ] Variables de entorno configuradas

## Troubleshooting rápido

| Problema | Solución |
|----------|----------|
| Puerto hardcodeado | Usar `process.env.PORT \|\| 3000` |
| Git pide credenciales | `git remote set-url origin https://TOKEN@github.com/USER/REPO.git` |
| Railway no despliega | Verificar que el repo está conectado en Railway Settings |
| App no arranca | Revisar `railway logs` |

## URLs importantes

- GitHub: https://github.com/CALILU
- Railway: https://railway.app/dashboard
- Crear token GitHub: https://github.com/settings/tokens

---

Para la guía completa ver: `SETUP_GITHUB_RAILWAY.md`
