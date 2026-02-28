---
name: documenta
description: Genera documentacion automatica de todo el trabajo realizado en la sesion actual, organizando por categorias en archivos MD separados
---

# Workflow de Documentacion Automatica de Sesion

Este workflow analiza toda la conversacion actual y documenta el trabajo realizado de forma estructurada.

## PASO 1: Analisis de la Conversacion Actual

Analiza toda la conversacion desde el inicio de la sesion:

1. **Identifica el objetivo principal** - Que se intentaba lograr?
2. **Lista archivos modificados** - Creados, editados o eliminados
3. **Tecnologias usadas** - Frameworks, librerias, lenguajes
4. **Problemas y soluciones** - Bugs encontrados y como se resolvieron
5. **Decisiones tecnicas** - Decisiones importantes tomadas y por que
6. **Comandos ejecutados** - Comandos importantes usados
7. **Tareas pendientes** - TODOs, FIXMEs, trabajo por hacer

## PASO 2: Crear estructura de directorios

Ejecuta estos comandos para crear la estructura necesaria:

```bash
mkdir -p docs/sessions
mkdir -p docs/categories
```

## PASO 3: Categorizar el trabajo

Clasifica todo el trabajo en las siguientes categorias (solo las que apliquen):

- **database** - Cambios en base de datos, esquemas, migraciones, queries
- **frontend** - Componentes UI, estilos, interfaces de usuario, HTML, CSS, JS
- **backend** - API, logica de negocio, servicios, controladores, rutas
- **infrastructure** - Configuracion, deployment, CI/CD, Docker, servidores
- **testing** - Tests unitarios, integracion, E2E
- **bugs** - Bugs encontrados y solucionados
- **dependencies** - Paquetes instalados, actualizados o removidos
- **security** - Cambios relacionados con seguridad
- **performance** - Optimizaciones de rendimiento
- **refactoring** - Refactorizaciones de codigo

## PASO 4: Generar docs/CONTEXT.md

Este es el archivo PRINCIPAL que se lee al retomar el trabajo. Debe contener:

```markdown
# Contexto del Proyecto - Ultima Actualizacion: {FECHA_ACTUAL}

## En que estabamos trabajando?
{Descripcion clara y concisa del ultimo trabajo realizado}

## Estado Actual
- Completado: {lista de tareas terminadas}
- En progreso: {lista de tareas en curso}
- Pendiente: {lista de tareas por hacer}

## Archivos Clave Modificados
- `{ruta/archivo}`: {descripcion breve del cambio}

## Comandos Rapidos para Empezar
```bash
# Comandos necesarios para retomar el trabajo
```

## Problemas Conocidos
- {problema}: {descripcion y contexto}

## Documentacion Detallada
- [Ultima sesion](./sessions/{nombre-archivo-sesion}.md)
- [Categoria relevante](./categories/{categoria}.md)
```

## PASO 5: Generar archivo de sesion

Crea `docs/sessions/session-{YYYYMMDD}-{HHMM}.md` con:

```markdown
# Sesion: {FECHA} {HORA}

## Objetivo de la Sesion
{Que se intentaba lograr}

## Trabajo Realizado

### Resumen
{Descripcion general del trabajo}

### Cambios Detallados
1. {Cambio 1}: {descripcion, archivos afectados}
2. {Cambio 2}: {descripcion, archivos afectados}

### Codigo Relevante
```{lenguaje}
// Snippets importantes de codigo nuevo o modificado
```

### Decisiones Tecnicas
- {Decision}: {Razon por la que se tomo}

### Problemas Encontrados y Soluciones
- **Problema**: {descripcion}
  **Solucion**: {como se resolvio}

### Comandos Ejecutados
```bash
# Comandos importantes usados durante la sesion
```

## Archivos Modificados
| Archivo | Accion | Descripcion |
|---------|--------|-------------|
| {ruta} | {creado/editado/eliminado} | {que se hizo} |

## Proximos Pasos
- [ ] {Tarea pendiente 1}
- [ ] {Tarea pendiente 2}
- [ ] {Tarea pendiente 3}

## Notas Importantes
{Cualquier cosa importante a recordar para la proxima sesion}
```

## PASO 6: Generar archivos por categoria

Para CADA categoria relevante, crea o actualiza `docs/categories/{categoria}.md`:

```markdown
# {Categoria} - Historial de Cambios

---

## Sesion: {FECHA} {HORA}

### Cambios Realizados
- {Cambio detallado 1}
- {Cambio detallado 2}

### Archivos Afectados
- `{archivo1}`: {que se cambio}
- `{archivo2}`: {que se cambio}

### Codigo Relevante
```{lenguaje}
// Codigo importante de esta categoria
```

### Notas
{Notas especificas de esta categoria}

---
```

**IMPORTANTE**: Si el archivo de categoria ya existe, AGREGA la nueva seccion al principio (despues del titulo), no sobreescribas el contenido anterior. Asi se mantiene el historial.

## PASO 7: Mostrar resumen final

Al terminar, muestra un resumen como este:

```
===================================
  DOCUMENTACION GENERADA
===================================

Archivos actualizados:
  - docs/CONTEXT.md
  - docs/sessions/session-{fecha}.md
  - docs/categories/{cat1}.md
  - docs/categories/{cat2}.md

Estadisticas:
  - Categorias documentadas: X
  - Archivos modificados registrados: Y
  - Tareas pendientes: Z

Para retomar el trabajo:
  1. Lee docs/CONTEXT.md
  2. Revisa docs/sessions/ para detalles
  3. Consulta docs/categories/ segun necesites
===================================
```

## INSTRUCCIONES CRITICAS

1. **Usa informacion REAL** de la conversacion actual. No inventes datos.
2. **Se especifico y detallado** - Incluye nombres de archivos reales, codigo real, errores reales.
3. **Incluye fechas y horas** actuales en todos los documentos.
4. **No sobreescribas** archivos de categorias existentes - agrega nuevas secciones.
5. **CONTEXT.md siempre se sobreescribe** con el estado mas reciente.
6. **Archivos de sesion** son unicos por fecha/hora, nunca se sobreescriben.
7. **Si una categoria no tiene cambios**, no crees el archivo.
8. **Incluye snippets de codigo** cuando sean relevantes para entender los cambios.
9. **Las tareas pendientes** deben ser accionables y claras.
10. **Lee CLAUDE.md** del proyecto si existe, para entender mejor el contexto.
