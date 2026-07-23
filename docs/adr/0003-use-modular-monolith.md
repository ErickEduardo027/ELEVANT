# ADR-0003: Usar un monolito modular

## Estado

Accepted — 2026-07-18.

## Contexto

El producto está en etapa inicial y necesita transacciones, reglas e integraciones todavía por definir. Microservicios exigirían red, observabilidad distribuida, despliegues y consistencia eventual antes de contar con límites de negocio comprobados. Un monolito sin reglas, en cambio, produciría acoplamiento difícil de separar.

## Decisión

Construir un único backend desplegable con Clean Architecture y preparación para vertical slices. Mantener proyectos Domain, Application, Contracts, Infrastructure y Api con un grafo de referencias automatizado. Domain y Application no conocen detalles externos; Api compone las implementaciones de Infrastructure. Los módulos se comunican mediante interfaces y casos de uso, no leyendo detalles internos.

## Consecuencias

- Despliegue y transacciones iniciales son más sencillos.
- Las fronteras se aplican mediante proyectos, namespaces, revisión y pruebas de arquitectura.
- Se evita infraestructura distribuida prematura.
- Un fallo del proceso puede afectar varias capacidades, por lo que health checks y aislamiento interno siguen siendo necesarios.
- Extraer un servicio futuro requerirá una necesidad medida y un contrato estable, pero las fronteras reducen ese costo.

## Alternativas consideradas

- Microservicios desde el inicio: rechazados por costo operativo y límites de dominio todavía inciertos.
- Monolito por capas sin módulos/features: rechazado porque favorece cambios transversales y dependencias circulares.
- Serverless por función: no resuelve por sí mismo las fronteras y añade una plataforma no requerida.
