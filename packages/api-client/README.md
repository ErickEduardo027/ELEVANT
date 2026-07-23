# Cliente API compartido

Espacio reservado para un cliente TypeScript generado desde el documento OpenAPI de Elevant. Todavía no se publica ni contiene una implementación manual porque la herramienta de generación se decidirá en ADR-0007.

## Flujo esperado

1. Compilar y arrancar la API en un ambiente de desarrollo controlado.
2. Descargar `/swagger/v1/swagger.json` o recuperar el artefacto OpenAPI producido por CI.
3. Validar que el documento corresponda a la versión esperada.
4. Guardar la entrada reproducible en `openapi`.
5. Ejecutar el generador con versión fijada y salida en `generated`.
6. Ejecutar format, type-check y pruebas de consumidores.
7. Revisar el diff del contrato y del código generado.

## Reglas

- `generated` es solo salida: no se edita manualmente.
- Los errores se modelan a partir de RFC Problem Details expuesto por la API.
- La URL del servidor se inyecta en tiempo de ejecución; no se hornea una URL de Production.
- Los tokens se reciben mediante un callback o middleware del consumidor y nunca se almacenan en el paquete.
- Un cambio incompatible exige versionar el endpoint o coordinar una migración de consumidores.
- El documento OpenAPI no debe contener ejemplos con datos personales, claves o hosts internos sensibles.

Las alternativas iniciales son Kiota, NSwag y Orval. La selección debe medir soporte del documento generado por ASP.NET, ergonomía para web y Expo, reproducibilidad, tamaño de salida y mantenimiento; no se decide por preferencia sin una prueba pequeña.

