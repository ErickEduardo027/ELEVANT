# Frontend

Este directorio contiene los puntos de entrada para usuarios de Elevant. Los clientes consumen exclusivamente la API del backend; no acceden de forma directa a SQL Server, FlightAware ni otros proveedores externos.

- `frontend/web`: aplicación web por seleccionar e inicializar cuando se acuerde el framework.
- `frontend/mobile-agent`: aplicación móvil de agentes por inicializar con Expo.

Los esqueletos son deliberadamente neutrales: documentan límites, configuración y flujos sin fijar prematuramente dependencias de frontend.
