# Pull requests

Un pull request debe ser pequeño, verificable y describir el riesgo real.

## Contenido mínimo

- problema y resultado esperado;
- alcance y elementos deliberadamente excluidos;
- pruebas ejecutadas y resultado;
- cambios de contrato, esquema, configuración o despliegue;
- nota del Vault afectada por un cambio durable, o explicación de por qué no
  necesita actualización;
- evidencia visual solo para interfaces, usando datos ficticios;
- plan de reversión cuando el cambio afecte Production.

## Lista de revisión

- El cambio respeta el grafo de dependencias.
- No aparecen secretos, datos personales ni documentación privada.
- Los endpoints están versionados y devuelven contratos, no entidades.
- Los errores externos no filtran detalles.
- Las migraciones son explícitas, revisables y compatibles con el despliegue.
- Hay estados de carga/error/vacío en clientes afectados.
- La documentación y OpenAPI coinciden con el comportamiento.
- El estado actual, prototipo y trabajo diferido no se confunden en el Vault.
- CI compila y ejecuta pruebas en Release.

No se aprueba basándose únicamente en que “funciona en mi equipo”. Un PR sin
conflictos no garantiza CI verde y, en el plan privado vigente, los checks no
están impuestos por [branch protection](../../.github/BRANCH_PROTECTION.md):
la revisión humana sigue siendo una norma de equipo. Un merge tampoco prueba
que la publicación posterior o el controlador de Development hayan aceptado
el artefacto. Una excepción urgente se registra, limita y corrige después
mediante una tarea visible. Consulte el
[flujo completo del Vault](../../Vault/06-desarrollo/flujo-de-rama-y-pull-request.md).
