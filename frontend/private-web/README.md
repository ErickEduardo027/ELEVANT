# Elevant AVIAM Web

Aplicación interna que utilizará el personal de AVIAM: OCC, administración, contratos, finanzas, gestión humana y departamentos operativos. El proyecto actual sí es ejecutable y usa Vite 6, React 18, React Router y Tailwind; ya no es un esqueleto con framework pendiente.

## Ejecutar y validar

Desde `frontend/private-web`:

```powershell
npm install
npm run dev
npm test
npm run build
```

Vite sirve por defecto en `http://localhost:5173`. Las entradas históricas `dashboard.html`, `contracts.html` y `finance.html` se conservan además de las rutas del router.

Copie `.env.example` a `.env.local` y configure:

```text
VITE_ELEVANT_API_URL=https://elevant-dev-api.taild2f562.ts.net
VITE_PROTOTYPE_API_URL=http://localhost:4310
```

Ambas variables son públicas. `VITE_ELEVANT_API_URL` configura el cliente OpenAPI compartido y `VITE_PROTOTYPE_API_URL` conserva los adaptadores existentes mientras se migran por módulo. Nunca incluya tokens, contraseñas o cadenas SQL en una variable `VITE_*`.

## Frontera de seguridad

La aplicación puede mostrar información de varias aerolíneas únicamente cuando la cuenta interna tenga roles y scopes de estación explícitos. Esos permisos se validan en el servidor. Filtros, menús ocultos y sesión del prototipo no autorizan datos.

La web consume solo HTTPS/REST y, cuando se implemente, SignalR. No accede directamente a SQL Server, FlightAware ni almacenamiento de objetos. Los servicios en `src/services` mantienen la selección mock/remota fuera de los componentes.

## Módulos observados

- panel OCC y monitoreo de vuelos/turnarounds;
- planificación, posiciones, agentes, equipos y cobertura;
- checklists, incidencias, evidencias y revisión;
- contratos, solicitudes, servicios y tarifas;
- gestión humana, turnos, disponibilidad, habilitaciones y permisos;
- finanzas/reportes, notificaciones y chat aún sujetos a contratos definitivos.

Los mocks de finanzas, notificaciones y chat no son diseño persistente. Facturación documental y comunicación fueron diferidas de DB v1 porque faltan reglas inequívocas.

## Despliegue previsto

Development usará una imagen estática construida en CI y servida por Nginx sin privilegios; no se usará `vite preview` como servidor. La imagen se desplegará separada de API, Public Web y SQL, y consumirá la misma API privada de Development.
