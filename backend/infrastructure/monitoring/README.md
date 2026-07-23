# Monitoreo

El scaffold solo aporta endpoints y logging estructurado de ASP.NET; no instala una plataforma de observabilidad.

Mínimos antes de Production:

- sonda frecuente a `/health` y alerta por indisponibilidad sostenida;
- sonda a `/health/ready` para detectar pérdida de SQL sin reinicios en bucle;
- alertas de CPU, memoria, disco, presión de I/O y reinicios de contenedor en el KVM 2;
- rotación y retención limitada de logs;
- alerta temprana por crecimiento del volumen SQL y fallo de backups;
- verificación externa del certificado y dominio.

Los logs no deben incluir connection strings, tokens, cuerpos con PII, evidencias ni stack traces públicos. Toda nueva métrica debe tener propietario, umbral y respuesta operativa documentada.
