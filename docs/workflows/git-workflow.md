# Flujo de Git

`main` representa Production y `Development` el desarrollo remoto e integración. El repositorio
inicial no crea ramas remotas ni configura protecciones por sí solo.

## Ramas de trabajo

Usar nombres breves y trazables, por ejemplo:

- `feature/descripcion-corta`
- `fix/descripcion-corta`
- `hotfix/descripcion-corta`

Ejemplos del equipo: `feature/api-flight-sync`, `feature/web-occ-dashboard` y
`feature/mobile-flight-checklist`. No se crean ramas permanentes por persona.

Para una entrega transversal grande puede existir una rama feature de integración
y subramas acotadas. La DB v1 usó históricamente `feature/database-v1` con
subramas `feature/db-v1-<orden>-<modulo>`; cada subrama se integró primero allí y
la rama completa se fusionó manualmente en `Development`. Ningún agente debe
saltarse esa revisión ni desplegar una rama feature.

Actualizar la rama con la base acordada antes de solicitar revisión. No reescribir una rama compartida sin coordinación y no mezclar refactors amplios con una corrección funcional.

## Commits

Cada commit debe ser coherente, compilable cuando sea posible y libre de secretos. El mensaje explica la intención; no necesita narrar cada archivo. Los artefactos generados se incluyen solo si su política exige versionarlos y su entrada puede reproducirse.

## Protección recomendada

En el proveedor Git, proteger `main` y `Development` con pull request obligatorio, al menos una aprobación, CI requerido, conversaciones resueltas y prohibición de force-push/eliminación. CODEOWNERS se activa únicamente con usuarios o equipos reales confirmados.
