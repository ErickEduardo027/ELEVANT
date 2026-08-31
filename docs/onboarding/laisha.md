# Onboarding AVIAM Web

`frontend/private-web` es la aplicación interna AVIAM y ya usa Vite 6 + React 18. Lea `AGENTS.md`, `frontend/AGENTS.md`, su README y la guía de consumidores API.

## Primer recorrido

1. Ejecutar `npm install`, tests y build desde `frontend/private-web`.
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

Development se desplegará como build estático/Nginx separado de API/Public Web y accesible por HTTPS privado.
