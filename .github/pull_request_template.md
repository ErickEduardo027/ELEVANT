## Resumen

Explique qué cambia, por qué y qué resultado obtiene el usuario o el equipo.

## Tipo de cambio

- [ ] Funcionalidad
- [ ] Corrección
- [ ] Refactorización o mantenimiento
- [ ] Documentación
- [ ] Infraestructura o CI/CD
- [ ] Hotfix

## Carpeta afectada

Indique las áreas principales, por ejemplo `backend`, `database/DevelopmentDB`,
`frontend/private-web` o `frontend/mobile-agent`.

## Evidencia

Adjunte capturas, respuestas HTTP, logs sanitizados o enlaces a evidencia de
Development. No incluya secretos, PII ni información interna de Production.

## Pruebas realizadas

Enumere los comandos y resultados relevantes.

## Contrato API

- [ ] No cambia el contrato público.
- [ ] Cambia el contrato y se actualizó OpenAPI/documentación/cliente afectado.

Describa endpoints, payloads o códigos HTTP modificados, si corresponde.

## Base de datos

- [ ] No cambia la base de datos.
- [ ] Incluye migración revisada, compatibilidad y plan de reversión.

## Variables nuevas o modificadas

Liste solo los nombres y propósito de las variables. Nunca escriba sus valores
reales. Escriba `Ninguna` cuando no aplique.

## Impacto en el Vault

- [ ] Actualicé las páginas del Vault afectadas y verifiqué sus fuentes.
- [ ] El cambio no altera conocimiento duradero; explico el motivo a continuación.

Explique la opción seleccionada. No marque ambas.

## Checklist de seguridad

- [ ] No se incluyeron secretos, credenciales, certificados, PII ni archivos `.env`.
- [ ] Web y móvil no acceden directamente a SQL Server ni FlightAware.
- [ ] Los errores y logs no revelan datos sensibles.
- [ ] Se aplicó mínimo privilegio a nuevos accesos.
- [ ] Se ejecutó `scripts/repository/check-secrets.ps1`.
- [ ] Se ejecutó `npm run vault:generate` cuando cambió el inventario derivado.
- [ ] Se ejecutó `npm run vault:check`.
- [ ] El cambio está limitado al alcance de esta PR.
- [ ] La documentación y las pruebas están actualizadas.
