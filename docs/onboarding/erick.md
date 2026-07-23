# Onboarding de Erick — backend y coordinación técnica

Esta guía resume el recorrido inicial para trabajar en el backend y coordinar contratos. No concede acceso por sí sola; las credenciales y permisos se entregan por canales autorizados.

## Primer recorrido

1. Leer `docs/architecture/system-overview.md`, `backend-architecture.md` y los ADR aceptados.
2. Entrar a `backend`, instalar el SDK resuelto por `backend/global.json` y
   restaurar las herramientas locales desde esa carpeta.
3. Ejecutar restore bloqueado, build y tests Release.
4. Arrancar la API y comprobar ping y liveness sin depender de una migración.
5. Levantar SQL local solo para pruebas que lo requieran.
6. Revisar procedimientos de migración, secretos y despliegue.

## Responsabilidades iniciales

- proteger el grafo de proyectos y mantener controllers delgados;
- coordinar cambios OpenAPI con consumidores;
- revisar migraciones y operación segura;
- evitar entidades o integraciones ficticias;
- mantener CI y documentación alineados con comandos reales.

## Verificación

Poder explicar por qué Domain no referencia Infrastructure, por qué la API no migra al arrancar, la diferencia entre `/health` y `/health/ready`, y cómo se revoca un secreto expuesto.
