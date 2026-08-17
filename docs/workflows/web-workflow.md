# Flujo de desarrollo web

Existen dos aplicaciones:

- `frontend/web`: AVIAM interno, Vite 6 + React 18.
- `frontend/public-web`: clientes/aerolíneas, Next.js 16 + React 19.

Ambas usan npm/`package-lock.json` y la misma Elevant API. No comparten necesariamente framework, sesión UI o ciclo de deployment.

1. Seleccionar una capability y su contrato OpenAPI.
2. Definir tenant/roles/station scopes que la API aplicará.
3. Actualizar/generar el cliente compartido cuando se habilite.
4. Mantener adaptador mock/remoto reemplazable fuera de componentes.
5. Diseñar carga, éxito, vacío, error recuperable y no autorizado.
6. Probar aislamiento y accesibilidad además del happy path.
7. Ejecutar los scripts declarados en el `package.json` de esa app.
8. Desplegar solo con API/esquema backward-compatible.

Los mocks son evidencia de workflow, no una base paralela. Variables `VITE_*`/`NEXT_PUBLIC_*` son públicas y de build-time. Public Web no confía un tenant enviado por navegador; AVIAM Web no obtiene privilegios por esconder/mostrar menús.

Development alojará ambas webs en deployables Dokploy separados. AVIAM Web será un build estático servido por Nginx; Public Web usará Next standalone. Ninguna se conecta a la red SQL.
