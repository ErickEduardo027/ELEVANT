# Colaboración del equipo

El trabajo se coordina mediante issues, ramas cortas y pull requests revisables. Cada cambio tiene una persona responsable de llevarlo hasta una validación reproducible; la propiedad no elimina la revisión cruzada.

## Propiedad inicial

- Erick coordina `backend`, `database`, `ops/dokploy` y `.github`: la solución
  .NET y sus pruebas están en `backend`, la persistencia EF y el tooling SQL en
  `database/DevelopmentDB`, y las plantillas/runbooks del servidor en
  `ops/dokploy`. La operación del VPS se ejecuta manualmente por el operador
  con checkpoints; versionar una plantilla no autoriza desplegarla.
- Laisha mantiene `frontend/private-web`; puede validar su cliente contra la
  API remota de Development sin instalar SQL Server ni ejecutar el backend
  localmente. Los flujos de negocio heredados siguen siendo prototípicos.
- Eliezer mantiene `frontend/mobile-agent`; su integración de negocio con la
  API remota de Development está pendiente. No necesita instalar SQL Server
  ni ejecutar el backend localmente para explorar el prototipo.

`frontend/public-web` es un cliente separado; esta asignación inicial no
designa aquí un responsable individual para ese subárbol. Su cambio requiere
revisar el `AGENTS.md` y README propios, además de coordinar el contrato API.

## Acuerdos

- Aclarar objetivo, criterio de aceptación y límites antes de implementar.
- Preferir cambios pequeños que compilen y puedan revertirse.
- Solicitar temprano revisión de contratos, esquema y seguridad.
- Registrar decisiones duraderas en ADR, no solo en conversaciones.
- Comunicar un bloqueo con evidencia, intentos y la decisión requerida.
- No compartir secretos, datos personales ni documentos privados en issues, commits o capturas.

## Coordinación entre plataformas

Backend publica un contrato OpenAPI compatible antes de que web o móvil dependan de él. Los clientes informan sus necesidades mediante escenarios, no pidiendo acceso a tablas o al proveedor externo. Un cambio de API incluye ventana de compatibilidad y regeneración del cliente.

Actualmente Mobile Agent conserva adaptadores del prototipo y no tiene
integración de negocio con la API .NET ni entrega APK automatizada. El
[diseño de CI/CD móvil](../../Vault/07-entrega/mobile-apk-ci-cd.md) es futuro;
los checks existentes del cliente compartido no equivalen a una APK firmada.

Para una entrega conjunta se acuerdan orden de despliegue, feature flags si existen, migración compatible y rollback. Development no comparte datos, credenciales ni recursos persistentes con Production.

## Definition of done común

El comportamiento cumple aceptación, tiene validación proporcional al riesgo, respeta arquitectura y seguridad, actualiza documentación y pasa CI. “Terminado” incluye operación y errores, no solo el camino exitoso.
