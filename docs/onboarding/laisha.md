# Onboarding AVIAM Web

`frontend/private-web` es la aplicación interna AVIAM y usa Vite 6 + React 18.
Lea [`AGENTS.md`](../../AGENTS.md),
[`frontend/AGENTS.md`](../../frontend/AGENTS.md), el
[README propio](../../frontend/private-web/README.md), la
[guía de consumidores API](../api/consumer-guidelines.md) y el
[mapa de Aplicaciones](../../Vault/05-aplicaciones/README.md).

## Primer recorrido

1. Ejecutar `npm ci`, `npm test` y `npm run test:delivery` desde
   `frontend/private-web`; para `npm run build`, configurar primero los dos
   orígenes HTTPS sintéticos `VITE_ELEVANT_API_URL` y
   `VITE_PROTOTYPE_API_URL` con el mismo valor, según su README.
2. Recorrer rutas OCC, planificación, contratos, finanzas y gestión humana.
3. Ubicar servicios/adaptadores que hoy consumen mocks/backend prototipo.
4. Revisar estados loading/empty/error/unauthorized y Problem Details.
5. Entender roles y scopes de estación que la API debe imponer.

## Reglas

- `VITE_*` es público; solo URL/flags no secretos.
- componentes no seleccionan mock vs API;
- no confiar menús/filtros como autorización;
- consumir Elevant API, nunca SQL/FlightAware;
- coordinar OpenAPI y compatibilidad antes de reemplazar mocks.

Development tiene un preview técnico de AVIAM Web como build estático/Nginx
separado de API/Public Web y accesible por HTTPS privado. Health y shell
operativos no prueban que login ni operaciones de negocio del prototipo ya
existan en la API .NET. El despliegue de cada cambio requiere CI, publicación
certificada y aceptación del controlador; consulte
[entrega](../../Vault/07-entrega/README.md).
