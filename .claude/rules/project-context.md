# Contexto del Proyecto PLEX

Este directorio contiene documentación portable para configurar despliegues de aplicaciones web en GitHub y Railway.

## Información general

- **Directorio**: F:\plex
- **Propósito**: Almacenar guías de configuración reutilizables para nuevos proyectos
- **Usuario GitHub**: CALILU
- **Plataforma de despliegue**: Railway
- **Flujo**: Local → GitHub → Railway (auto-deploy)

## Archivos importantes

- `SETUP_GITHUB_RAILWAY.md` - Guía completa paso a paso para conectar cualquier app a GitHub y Railway
- `QUICKSTART_DEPLOY.md` - Guía rápida de 5 minutos para despliegue

## Uso

Cuando crees un nuevo proyecto web:

1. Copia las guías de este directorio al nuevo proyecto
2. Sigue los pasos de `SETUP_GITHUB_RAILWAY.md`
3. El despliegue será automático con cada `git push`

## CLIs necesarias

- GitHub CLI (`gh`) - Para crear repositorios
- Railway CLI (`railway`) - Para gestionar despliegues
- Git - Para control de versiones

## Autenticación

Una vez autenticado `gh` y `railway` (con `gh auth login` y `railway login`), la sesión es global para todos los proyectos.

## Proyecto de referencia

Ver: `/mnt/f/profes` (ausencias-profesores) - ejemplo completo funcionando

## Desarrollador

- Usuario: ISIDRO
- GitHub: CALILU
- Fecha creación: 31/12/2024
