# ADR-0005: Usar una API remota de Testing para integración de clientes

## Estado

Accepted — 2026-07-18.

## Contexto

Web y móvil necesitan integrar contra un backend accesible desde navegadores, emuladores y tablets. Obligar a cada persona a ejecutar SQL Server e integraciones completas ralentiza el trabajo; usar Production para pruebas pondría datos y disponibilidad en riesgo. Los mocks siguen siendo útiles para estados deterministas, pero no validan red, CORS, serialización ni despliegue.

## Decisión

Proveer una API remota de Testing aislada como destino común de integración. Los ejemplos de cliente usan `https://api-test.elevant.example` como placeholder hasta configurar el dominio real. Los clientes conservan adaptadores mock reemplazables para desarrollo y pruebas específicas.

Testing usa datos sintéticos, credenciales propias, CORS explícito y observabilidad etiquetada. No comparte base, volumen, uploads, backups o secretos con Production.

## Consecuencias

- Web y tablets pueden validar el contrato sin ejecutar todo el backend localmente.
- El equipo detecta problemas reales de HTTPS, CORS y serialización.
- El ambiente requiere mantenimiento, datos sintéticos estables y coordinación ante cambios incompatibles.
- Los mocks continúan necesarios para fallos y estados difíciles de reproducir.
- La disponibilidad de Testing no convierte el ambiente en una dependencia de tests unitarios o CI determinista.

## Alternativas consideradas

- Solo backend local: útil para backend, insuficiente para colaboración y dispositivos remotos.
- Solo mocks: rápido, pero oculta incompatibilidades de transporte y contrato.
- Usar Production: rechazado por riesgo de seguridad, datos y operación.

