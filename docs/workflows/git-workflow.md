# Flujo de Git

`main` representa la frontera de Production y `Development` la integración de
Development. El trabajo ordinario parte de una rama corta creada desde
`Development` y llega mediante un PR revisado. Es una norma de equipo, no una
barrera técnica vigente: la [protección de ramas pendiente](../../.github/BRANCH_PROTECTION.md)
documenta que, en el repositorio privado actual, un colaborador con permiso de
escritura aún puede hacer push directo a `Development`.

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

Cuando el plan del proveedor lo permita, proteger `main` y `Development` con
pull request obligatorio, al menos una aprobación, CI requerido, conversaciones
resueltas y prohibición de force-push/eliminación. Hasta entonces, un PR sin
conflictos no prueba que CI vaya a pasar ni impide un push directo. CODEOWNERS
solo se activa con usuarios o equipos reales confirmados. Para el recorrido
paso a paso, consulta el [flujo de rama y PR del Vault](../../Vault/06-desarrollo/flujo-de-rama-y-pull-request.md).
