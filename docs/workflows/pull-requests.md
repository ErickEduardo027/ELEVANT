# Pull requests

Un pull request debe ser pequeño, verificable y describir el riesgo real.

## Contenido mínimo

- problema y resultado esperado;
- alcance y elementos deliberadamente excluidos;
- pruebas ejecutadas y resultado;
- cambios de contrato, esquema, configuración o despliegue;
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
- CI compila y ejecuta pruebas en Release.

No se aprueba basándose únicamente en que “funciona en mi equipo”. Una excepción urgente se registra, limita y corrige después mediante una tarea visible.

