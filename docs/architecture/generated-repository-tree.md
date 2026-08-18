# Árbol resumido del repositorio

Este archivo no enumera cada fixture/asset/migración porque se volvería obsoleto. Para consultar la fuente real use `rg --files` o:

```powershell
./scripts/repository/show-tree.ps1 -MaxDepth 4
```

```text
ELEVANT
|-- AGENTS.md
|-- backend
|   |-- AGENTS.md
|   |-- Elevant.sln
|   |-- Dockerfile
|   |-- Dockerfile.database-release
|   |-- database
|   |   |-- Dockerfile.ops
|   |   `-- scripts
|   |-- infrastructure
|   |   `-- docker
|   |       |-- compose.local.yml
|   |       |-- compose.development.database.yml
|   |       `-- compose.development.release.yml
|   |-- src
|   |   |-- Elevant.Api
|   |   |-- Elevant.Application
|   |   |-- Elevant.Contracts
|   |   |-- Elevant.DatabaseTool
|   |   |-- Elevant.Domain
|   |   `-- Elevant.Infrastructure
|   `-- tests
|-- frontend
|   |-- AGENTS.md
|   |-- web
|   |-- public-web
|   `-- mobile-agent
|-- packages
|-- docs
|   |-- architecture
|   |-- database
|   |-- deployment
|   `-- workflows
|-- scripts
`-- .github/workflows/backend-ci.yml
```

`backend-prototipo` es una referencia temporal del prototipo mock, no parte del runtime objetivo ni fuente de datos para SQL Server.
