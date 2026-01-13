# PLEX - Documentación de Despliegue

Directorio con guías portables para configurar GitHub + Railway en cualquier proyecto web.

## ¿Qué hay aquí?

- **SETUP_GITHUB_RAILWAY.md** - Guía completa (todos los detalles)
- **QUICKSTART_DEPLOY.md** - Guía rápida (5 minutos)

## Uso rápido

```bash
# 1. Copia las guías a tu nuevo proyecto
cp /mnt/f/plex/*.md /tu-proyecto/docs/

# 2. Sigue QUICKSTART_DEPLOY.md para empezar rápido
# 3. Consulta SETUP_GITHUB_RAILWAY.md para detalles
```

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

## Flujo de despliegue

```
Tu código → git push → GitHub → Railway (auto-deploy)
```

## Usuario

- GitHub: CALILU
- Railway: Conectado a GitHub

## Más información

Lee `SETUP_GITHUB_RAILWAY.md` para instrucciones completas.

---

**Directorio**: F:\plex
**Actualizado**: 31/12/2024
