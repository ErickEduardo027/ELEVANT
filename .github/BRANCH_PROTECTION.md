# Protección de ramas

Estas reglas deben activarse manualmente cuando el plan de GitHub del
repositorio permita aplicarlas y se conozcan los equipos reales. El repositorio
privado ELEVANT usa actualmente GitHub Free: en ese plan GitHub no permite
exigir branch protection/rulesets para repositorios privados. GitHub Actions y
GHCR sí siguen disponibles, por lo que esta limitación no impide CI/CD, pero
tampoco existe una barrera técnica que obligue a usar pull request antes de un
push a `Development`. Consulte la
[disponibilidad oficial de protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

## `main`

- Requerir pull request y al menos una aprobación.
- Invalidar aprobaciones cuando cambie el código.
- Requerir que las conversaciones estén resueltas.
- Requerir el check `Restore, build and test` cuando el backend esté en alcance.
- Requerir rama actualizada antes de fusionar.
- Bloquear force-push y eliminación.
- Restringir excepciones a administradores designados y auditables.

## `Development`

- Requerir pull request y el check correspondiente al área modificada.
- Bloquear force-push y eliminación.
- Mantener revisión humana para migraciones, seguridad e infraestructura.

## Estado temporal en GitHub Free

Hasta actualizar a GitHub Pro/Team o hacer público el repositorio:

- los colaboradores con permiso de escritura pueden hacer push directo a
  `Development` y modificar workflows;
- un push directo que cambie artefactos de base puede iniciar la promoción
  automática de Development después de superar CI;
- la revisión humana de migraciones es una norma de equipo, no un control
  obligatorio del proveedor;
- la entrega compensa parcialmente el riesgo con imágenes inmutables, un bundle
  OCI v1 de manifiesto + dos Compose publicado al final, backup previo,
  verificación posterior, lock exclusivo y ausencia de reintento/rollback
  destructivo automático.

Esta compensación no equivale a branch protection. Al habilitar un plan que la
soporte, se deben activar las reglas anteriores sin cambiar el contrato de
artefactos ni el controlador de despliegue.

No se configuran nombres de usuarios ficticios ni reglas mediante API desde
este repositorio.
