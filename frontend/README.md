# Frontends de ELEVANT

Los tres clientes comparten `Elevant.Api` y la base lógica de su ambiente. Sus diferencias son de audiencia, autorización, interfaz y ciclo de distribución; no justifican backends o bases paralelas.

| Carpeta | Audiencia | Ejecución/entrega |
| --- | --- | --- |
| `private-web` | Personal interno AVIAM | Vite/React; sitio desplegable en Development |
| `public-web` | Visitantes y clientes/aerolíneas | Next.js; sitio desplegable en Development |
| `mobile-agent` | Agentes de rampa | Expo/React Native; APK inicial y tiendas más adelante |

Actualmente consumen el backend prototipo y/o adaptadores mock. Esos objetos describen necesidades de producto, no tablas definitivas. La migración a la API .NET se hará mediante contratos OpenAPI y adaptadores reemplazables.

Reglas comunes:

- jamás conectarse a SQL Server o FlightAware desde el cliente;
- no colocar secretos en variables `VITE_*`, `NEXT_PUBLIC_*` o `EXPO_PUBLIC_*`;
- no confiar en `localStorage`, AsyncStorage o filtros de UI para autorización;
- derivar tenant, roles y estaciones de la sesión validada por la API;
- manejar carga, vacío, error, no autorizado y reintento;
- conservar compatibilidad cuando los clientes se desplieguen de manera independiente.

Cada aplicación usa npm y su propio `package-lock.json`. Lea [AGENTS.md](AGENTS.md), el README de la aplicación y cualquier `AGENTS.md` más cercano antes de cambiar código.
