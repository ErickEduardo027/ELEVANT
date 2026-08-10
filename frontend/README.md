# Frontend

Este directorio contiene los puntos de entrada para usuarios de Elevant. Los clientes consumen exclusivamente la API del backend; no acceden de forma directa a SQL Server, FlightAware ni otros proveedores externos.

- `frontend/public-web`: aplicación Next.js pública con la landing de ELEVANT, acceso demostrativo y portal de consulta para aerolíneas.
- `frontend/web`: aplicación interna para Administración/OCC y departamentos operativos, actualmente basada en vistas y datos de demostración.
- `frontend/mobile-agent`: prototipo Expo para los flujos del agente de rampa y la operación con conectividad intermitente.

Cada aplicación mantiene sus comandos, dependencias, variables públicas y alcance en su propio `README.md`. Los prototipos usan datos simulados mientras no exista un contrato de API integrado; esa condición debe mantenerse visible en la interfaz y en la documentación.

El workspace de la raíz incluye `frontend/*`, pero las instalaciones y validaciones se ejecutan dentro de cada aplicación con el gestor indicado por su archivo de bloqueo. Ningún frontend debe contener secretos ni conectarse directamente a la base de datos o a proveedores externos.
