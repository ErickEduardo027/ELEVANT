# Límite de integración con FlightAware

Esta carpeta reserva el adaptador futuro de `IFlightInformationProvider`. El
scaffold actual solo enlaza opciones con namespace propio; no registra un
adaptador, `HttpClient`, headers, reintentos, endpoints ni respuestas ficticias.

Cuando se implemente la integración se deberá verificar el contrato oficial
vigente, guardar la clave únicamente en el almacén de secretos del despliegue,
transformar los modelos externos a tipos neutrales de Application y añadir timeout,
resiliencia y pruebas de contrato. La clave y los modelos del proveedor nunca se
expondrán a web o móvil.
