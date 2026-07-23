# Onboarding de Laisha — aplicación web

La aplicación web es todavía un esqueleto neutral. No se debe inicializar un framework hasta registrar la decisión y fijar las versiones de Node/pnpm.

## Primer recorrido

1. Leer `frontend/web/README.md` y `docs/api/consumer-guidelines.md`.
2. Revisar el contrato de ping y Problem Details en OpenAPI.
3. Entender el flujo OpenAPI → generador → `packages/api-client`.
4. Revisar los estados obligatorios de carga, éxito, vacío, error y acceso.
5. Confirmar que las variables públicas solo contienen URL y flags no secretos.

## Al iniciar la web

- registrar elección entre Next.js/Astro con sus razones;
- extender configuraciones TypeScript/ESLint cuando existan;
- encapsular mocks detrás del mismo adaptador que el cliente real;
- añadir accesibilidad, pruebas y pipeline desde la primera feature;
- consumir solo la API, nunca SQL Server o FlightAware.

## Verificación

Poder cambiar entre mock y API sin modificar componentes de presentación, regenerar el cliente sin editar `generated` y representar Problem Details sin mostrar detalles internos.
