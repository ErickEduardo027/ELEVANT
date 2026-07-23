# ADR-0001: Usar un monorepositorio

## Estado

Accepted — 2026-07-18.

## Contexto

Elevant tendrá un backend .NET, una aplicación web, una aplicación móvil, un cliente API compartido, automatización de base de datos e infraestructura. Los contratos y cambios funcionales suelen atravesar varias de estas áreas. Repositorios separados introducirían coordinación de versiones y pipelines antes de que el equipo necesite ciclos de entrega independientes.

El repositorio también debe impedir que material privado ubicado fuera de su raíz se incorpore por accidente.

## Decisión

Mantener código, documentación, infraestructura y paquetes de Elevant en un monorepositorio cuya raíz física es `ELEVANT`. Organizar el código por sus dos límites principales: `backend` para la API y sus pruebas, y `frontend` para las aplicaciones web y móvil. Mantener además paquetes compartidos, datos, infraestructura, documentos y scripts en directorios de primer nivel.

Las herramientas se ejecutan desde la raíz y los pipelines usan filtros de rutas cuando una plataforma todavía no está activa. Ningún contenido de carpetas externas se copia automáticamente.

## Consecuencias

- Un pull request puede cambiar backend, contrato y consumidor de forma atómica.
- Las decisiones y procedimientos permanecen junto al código.
- CI debe evitar trabajo innecesario mediante filtros y caché.
- Los equipos comparten reglas de revisión y seguridad.
- Será necesario vigilar límites para que `packages` no se convierta en un depósito acoplado.
- Si una parte requiere ciclo y permisos realmente independientes, podrá extraerse conservando su historial y contrato.

## Alternativas consideradas

- Un repositorio por aplicación: ofrece autonomía, pero añade publicación y coordinación prematuras.
- Repositorio solo para backend y clientes fuera de control de versión común: dificulta trazabilidad de contratos.
- Copiar documentación previa al nuevo repositorio: rechazado por riesgo de datos personales, firmas, grabaciones y material no autorizado.
