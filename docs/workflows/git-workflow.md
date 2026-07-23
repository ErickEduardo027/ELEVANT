# Flujo de Git

`main` representa Production y `develop` Testing e integración. El repositorio
inicial no crea ramas remotas ni configura protecciones por sí solo.

## Ramas de trabajo

Usar nombres breves y trazables, por ejemplo:

- `feature/descripcion-corta`
- `fix/descripcion-corta`
- `hotfix/descripcion-corta`

Ejemplos del equipo: `feature/api-flight-sync`, `feature/web-occ-dashboard` y
`feature/mobile-flight-checklist`. No se crean ramas permanentes por persona.

Actualizar la rama con la base acordada antes de solicitar revisión. No reescribir una rama compartida sin coordinación y no mezclar refactors amplios con una corrección funcional.

## Commits

Cada commit debe ser coherente, compilable cuando sea posible y libre de secretos. El mensaje explica la intención; no necesita narrar cada archivo. Los artefactos generados se incluyen solo si su política exige versionarlos y su entrada puede reproducirse.

## Protección recomendada

En el proveedor Git, proteger `main` y, si existe, `develop` con pull request obligatorio, al menos una aprobación, CI requerido, conversaciones resueltas y prohibición de force-push/eliminación. CODEOWNERS se activa únicamente con usuarios o equipos reales confirmados.
