# Colaboración del equipo

El trabajo se coordina mediante issues, ramas cortas y pull requests revisables. Cada cambio tiene una persona responsable de llevarlo hasta una validación reproducible; la propiedad no elimina la revisión cruzada.

## Propiedad inicial

- Erick mantiene `backend` y `.github`, además de SQL Server, secretos y
  despliegues. La solución, código, pruebas, infraestructura y automatización del
  servidor permanecen juntos dentro de `backend`.
- Laisha mantiene `frontend/web` y consume la API remota de Testing sin instalar SQL
  Server ni ejecutar el backend localmente.
- Eliezer mantiene `frontend/mobile-agent` y consume la API remota de Testing sin
  instalar SQL Server ni ejecutar el backend localmente.

## Acuerdos

- Aclarar objetivo, criterio de aceptación y límites antes de implementar.
- Preferir cambios pequeños que compilen y puedan revertirse.
- Solicitar temprano revisión de contratos, esquema y seguridad.
- Registrar decisiones duraderas en ADR, no solo en conversaciones.
- Comunicar un bloqueo con evidencia, intentos y la decisión requerida.
- No compartir secretos, datos personales ni documentos privados en issues, commits o capturas.

## Coordinación entre plataformas

Backend publica un contrato OpenAPI compatible antes de que web o móvil dependan de él. Los clientes informan sus necesidades mediante escenarios, no pidiendo acceso a tablas o al proveedor externo. Un cambio de API incluye ventana de compatibilidad y regeneración del cliente.

Para una entrega conjunta se acuerdan orden de despliegue, feature flags si existen, migración compatible y rollback. Testing no comparte datos, credenciales ni recursos persistentes con Production.

## Definition of done común

El comportamiento cumple aceptación, tiene validación proporcional al riesgo, respeta arquitectura y seguridad, actualiza documentación y pasa CI. “Terminado” incluye operación y errores, no solo el camino exitoso.
