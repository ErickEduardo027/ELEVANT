ELEVANT
|-- .github
|   |-- ISSUE_TEMPLATE
|   |   `-- README.md
|   |-- workflows
|   |   |-- backend-ci.yml
|   |   |-- mobile-ci.yml.template
|   |   `-- web-ci.yml.template
|   |-- BRANCH_PROTECTION.md
|   |-- CODEOWNERS.template
|   `-- pull_request_template.md
|-- backend
|   |-- database
|   |   |-- diagrams
|   |   |   `-- README.md
|   |   |-- documentation
|   |   |   `-- README.md
|   |   |-- scripts
|   |   |   |-- administration
|   |   |   |   `-- README.md
|   |   |   |-- backup
|   |   |   |   `-- README.md
|   |   |   |-- bootstrap
|   |   |   |   `-- initialize-development.sql
|   |   |   |-- diagnostics
|   |   |   |   `-- README.md
|   |   |   |-- recovery
|   |   |   |   `-- README.md
|   |   |   `-- README.md
|   |   |-- seeds
|   |   |   `-- README.md
|   |   |-- test-data
|   |   |   `-- README.md
|   |   `-- README.md
|   |-- infrastructure
|   |   |-- backups
|   |   |   `-- README.md
|   |   |-- database
|   |   |   `-- README.md
|   |   |-- docker
|   |   |   |-- compose.development.yml
|   |   |   |-- compose.local.yml
|   |   |   |-- compose.production.yml.example
|   |   |   `-- README.md
|   |   |-- dokploy
|   |   |   `-- README.md
|   |   |-- environments
|   |   |   `-- README.md
|   |   |-- monitoring
|   |   |   `-- README.md
|   |   |-- reverse-proxy
|   |   |   `-- README.md
|   |   `-- README.md
|   |-- scripts
|   |   |-- database
|   |   |   `-- README.md
|   |   |-- deployment
|   |   |   `-- README.md
|   |   |-- add-migration.ps1
|   |   |-- restore-build-test.ps1
|   |   `-- update-database.ps1
|   |-- src
|   |   |-- Elevant.Api
|   |   |   |-- Configuration
|   |   |   |   `-- ApiConfiguration.cs
|   |   |   |-- Controllers
|   |   |   |   `-- V1
|   |   |   |       `-- SystemController.cs
|   |   |   |-- ErrorHandling
|   |   |   |-- ExceptionHandling
|   |   |   |   `-- GlobalExceptionHandler.cs
|   |   |   |-- Extensions
|   |   |   |   |-- ApplicationBuilderExtensions.cs
|   |   |   |   `-- ServiceCollectionExtensions.cs
|   |   |   |-- Health
|   |   |   |-- HealthChecks
|   |   |   |   `-- HealthCheckResponseWriter.cs
|   |   |   |-- Hubs
|   |   |   |   |-- NotificationsHub.cs
|   |   |   |   |-- OperationsHub.cs
|   |   |   |   `-- README.md
|   |   |   |-- Middleware
|   |   |   |   `-- README.md
|   |   |   |-- OpenApi
|   |   |   |   |-- README.md
|   |   |   |   `-- SwaggerConfiguration.cs
|   |   |   |-- Properties
|   |   |   |   `-- launchSettings.json
|   |   |   |-- .env.example
|   |   |   |-- appsettings.Development.json
|   |   |   |-- appsettings.json
|   |   |   |-- appsettings.Production.json
|   |   |   |-- appsettings.Testing.json
|   |   |   |-- Elevant.Api.csproj
|   |   |   |-- Elevant.Api.http
|   |   |   |-- packages.lock.json
|   |   |   `-- Program.cs
|   |   |-- Elevant.Application
|   |   |   |-- Abstractions
|   |   |   |   |-- Authentication
|   |   |   |   |   `-- README.md
|   |   |   |   |-- Authorization
|   |   |   |   |   `-- README.md
|   |   |   |   |-- Clock
|   |   |   |   |   `-- README.md
|   |   |   |   |-- FileStorage
|   |   |   |   |   `-- README.md
|   |   |   |   |-- Integrations
|   |   |   |   |   `-- IFlightInformationProvider.cs
|   |   |   |   |-- Messaging
|   |   |   |   |   `-- README.md
|   |   |   |   |-- Notifications
|   |   |   |   |   `-- README.md
|   |   |   |   `-- Persistence
|   |   |   |       `-- README.md
|   |   |   |-- Behaviors
|   |   |   |   `-- README.md
|   |   |   |-- Common
|   |   |   |   |-- Abstractions
|   |   |   |   |   `-- ExternalServices
|   |   |   |   `-- README.md
|   |   |   |-- DependencyInjection
|   |   |   |-- Exceptions
|   |   |   |   `-- README.md
|   |   |   |-- Features
|   |   |   |   |-- AgentAssignments
|   |   |   |   |   `-- README.md
|   |   |   |   |-- Aircraft
|   |   |   |   |   `-- README.md
|   |   |   |   |-- Airlines
|   |   |   |   |   `-- README.md
|   |   |   |   |-- Airports
|   |   |   |   |   `-- README.md
|   |   |   |   |-- Audit
|   |   |   |   |   `-- README.md
|   |   |   |   |-- Authentication
|   |   |   |   |   `-- README.md
|   |   |   |   |-- Contracts
|   |   |   |   |   `-- README.md
|   |   |   |   |-- Evidence
|   |   |   |   |   `-- README.md
|   |   |   |   |-- ExecutedServices
|   |   |   |   |   `-- README.md
|   |   |   |   |-- Flights
|   |   |   |   |   `-- README.md
|   |   |   |   |-- FlightSchedules
|   |   |   |   |   `-- README.md
|   |   |   |   |-- Incidents
|   |   |   |   |   `-- README.md
|   |   |   |   |-- Invoices
|   |   |   |   |   `-- README.md
|   |   |   |   |-- OperationalPlanning
|   |   |   |   |   `-- README.md
|   |   |   |   |-- Permissions
|   |   |   |   |   `-- README.md
|   |   |   |   |-- PreBilling
|   |   |   |   |   `-- README.md
|   |   |   |   |-- RampOperations
|   |   |   |   |   `-- README.md
|   |   |   |   |-- Reconciliations
|   |   |   |   |   `-- README.md
|   |   |   |   |-- Reports
|   |   |   |   |   `-- README.md
|   |   |   |   |-- Roles
|   |   |   |   |   `-- README.md
|   |   |   |   |-- Services
|   |   |   |   |   `-- README.md
|   |   |   |   `-- Users
|   |   |   |       `-- README.md
|   |   |   |-- DependencyInjection.cs
|   |   |   |-- Elevant.Application.csproj
|   |   |   |-- packages.lock.json
|   |   |   `-- README.md
|   |   |-- Elevant.Contracts
|   |   |   |-- Authentication
|   |   |   |   `-- README.md
|   |   |   |-- Billing
|   |   |   |   `-- README.md
|   |   |   |-- Common
|   |   |   |   |-- PagedResponse.cs
|   |   |   |   `-- PaginationRequest.cs
|   |   |   |-- Contracts
|   |   |   |   `-- README.md
|   |   |   |-- Flights
|   |   |   |   `-- README.md
|   |   |   |-- Operations
|   |   |   |   `-- README.md
|   |   |   |-- Reports
|   |   |   |   `-- README.md
|   |   |   |-- System
|   |   |   |   `-- SystemPingResponse.cs
|   |   |   |-- Elevant.Contracts.csproj
|   |   |   |-- packages.lock.json
|   |   |   `-- README.md
|   |   |-- Elevant.Domain
|   |   |   |-- Common
|   |   |   |   `-- README.md
|   |   |   |-- DomainEvents
|   |   |   |   |-- IDomainEvent.cs
|   |   |   |   `-- README.md
|   |   |   |-- Entities
|   |   |   |   `-- Entity.cs
|   |   |   |-- Enumerations
|   |   |   |   `-- README.md
|   |   |   |-- Exceptions
|   |   |   |   `-- DomainException.cs
|   |   |   |-- Specifications
|   |   |   |   `-- README.md
|   |   |   |-- ValueObjects
|   |   |   |   `-- README.md
|   |   |   |-- Elevant.Domain.csproj
|   |   |   `-- packages.lock.json
|   |   `-- Elevant.Infrastructure
|   |       |-- Authentication
|   |       |   `-- README.md
|   |       |-- Authorization
|   |       |   `-- README.md
|   |       |-- BackgroundJobs
|   |       |   `-- README.md
|   |       |-- Caching
|   |       |   `-- README.md
|   |       |-- ExternalServices
|   |       |   `-- FlightAware
|   |       |-- FileStorage
|   |       |   `-- README.md
|   |       |-- Integrations
|   |       |   `-- FlightAware
|   |       |       |-- FlightAwareClient.cs
|   |       |       |-- FlightAwareOptions.cs
|   |       |       |-- FlightAwareServiceCollectionExtensions.cs
|   |       |       `-- README.md
|   |       |-- Logging
|   |       |   `-- README.md
|   |       |-- Notifications
|   |       |   `-- README.md
|   |       |-- Persistence
|   |       |   |-- Configurations
|   |       |   |   `-- README.md
|   |       |   |-- Interceptors
|   |       |   |   `-- README.md
|   |       |   |-- Migrations
|   |       |   |   `-- .gitkeep
|   |       |   |-- Repositories
|   |       |   |   `-- README.md
|   |       |   |-- Seed
|   |       |   |   `-- README.md
|   |       |   |-- ElevantDbContext.cs
|   |       |   `-- ElevantDbContextFactory.cs
|   |       |-- SignalR
|   |       |   `-- README.md
|   |       |-- DependencyInjection.cs
|   |       |-- Elevant.Infrastructure.csproj
|   |       `-- packages.lock.json
|   |-- tests
|   |   |-- Elevant.ArchitectureTests
|   |   |   |-- Architecture
|   |   |   |   `-- ProjectDependencyTests.cs
|   |   |   |-- Elevant.ArchitectureTests.csproj
|   |   |   `-- packages.lock.json
|   |   |-- Elevant.IntegrationTests
|   |   |   |-- Api
|   |   |   |   |-- DiagnosticsEndpointsTests.cs
|   |   |   |   `-- SystemPingTests.cs
|   |   |   |-- Elevant.IntegrationTests.csproj
|   |   |   |-- ElevantApiFactory.cs
|   |   |   `-- packages.lock.json
|   |   `-- Elevant.UnitTests
|   |       |-- Domain
|   |       |   `-- EntityTests.cs
|   |       |-- Elevant.UnitTests.csproj
|   |       `-- packages.lock.json
|   |-- .dockerignore
|   |-- .env.example
|   |-- Directory.Build.props
|   |-- Directory.Packages.props
|   |-- Dockerfile
|   |-- dotnet-tools.json
|   |-- Elevant.sln
|   |-- global.json
|   |-- NuGet.config
|   `-- README.md
|-- docs
|   |-- adr
|   |   |-- 0001-use-monorepo.md
|   |   |-- 0002-use-dotnet-10.md
|   |   |-- 0003-use-modular-monolith.md
|   |   |-- 0004-centralize-external-api-access.md
|   |   |-- 0005-use-remote-development-api.md
|   |   |-- 0006-separate-development-and-production.md
|   |   `-- 0007-api-client-generation-pending.md
|   |-- api
|   |   |-- consumer-guidelines.md
|   |   |-- http-status-codes.md
|   |   `-- openapi-contract.md
|   |-- architecture
|   |   |-- backend-architecture.md
|   |   |-- dependency-rules.md
|   |   |-- external-integrations.md
|   |   |-- generated-repository-tree.md
|   |   |-- integration-boundaries.md
|   |   |-- modular-monolith.md
|   |   |-- overview.md
|   |   |-- realtime.md
|   |   |-- repository-structure.md
|   |   |-- system-overview.md
|   |   `-- vertical-slices.md
|   |-- database
|   |   |-- database-ownership.md
|   |   `-- migrations.md
|   |-- deployment
|   |   |-- dokploy.md
|   |   |-- environments.md
|   |   |-- kvm2-considerations.md
|   |   `-- rollback.md
|   |-- diagrams
|   |   `-- README.md
|   |-- interviews
|   |   `-- README.md
|   |-- onboarding
|   |   |-- eliezer.md
|   |   |-- erick.md
|   |   `-- laisha.md
|   |-- requirements
|   |   `-- README.md
|   |-- security
|   |   |-- database-access.md
|   |   `-- secrets-management.md
|   |-- workflows
|   |   |-- api-request-process.md
|   |   |-- backend-workflow.md
|   |   |-- git-workflow.md
|   |   |-- local-development.md
|   |   |-- mobile-workflow.md
|   |   |-- pull-requests.md
|   |   |-- release-workflow.md
|   |   |-- team-collaboration.md
|   |   `-- web-workflow.md
|   `-- README.md
|-- frontend
|   |-- mobile-agent
|   |   |-- src
|   |   |   |-- app
|   |   |   |   `-- README.md
|   |   |   |-- assets
|   |   |   |   `-- README.md
|   |   |   |-- components
|   |   |   |   `-- README.md
|   |   |   |-- config
|   |   |   |   `-- README.md
|   |   |   |-- database
|   |   |   |   `-- README.md
|   |   |   |-- features
|   |   |   |   `-- README.md
|   |   |   |-- hooks
|   |   |   |   `-- README.md
|   |   |   |-- services
|   |   |   |   `-- README.md
|   |   |   |-- storage
|   |   |   |   `-- README.md
|   |   |   |-- synchronization
|   |   |   |   `-- README.md
|   |   |   `-- types
|   |   |       `-- README.md
|   |   |-- tests
|   |   |   `-- README.md
|   |   |-- .env.example
|   |   `-- README.md
|   |-- web
|   |   |-- public
|   |   |   `-- .gitkeep
|   |   |-- src
|   |   |   |-- app
|   |   |   |   `-- README.md
|   |   |   |-- components
|   |   |   |   `-- README.md
|   |   |   |-- config
|   |   |   |   `-- README.md
|   |   |   |-- features
|   |   |   |   `-- README.md
|   |   |   |-- hooks
|   |   |   |   `-- README.md
|   |   |   |-- lib
|   |   |   |   `-- README.md
|   |   |   |-- services
|   |   |   |   `-- README.md
|   |   |   `-- types
|   |   |       `-- README.md
|   |   |-- tests
|   |   |   `-- README.md
|   |   |-- .env.example
|   |   `-- README.md
|   `-- README.md
|-- packages
|   |-- api-client
|   |   |-- generated
|   |   |   `-- .gitkeep
|   |   |-- openapi
|   |   |   `-- .gitkeep
|   |   `-- README.md
|   |-- eslint-config
|   |   `-- README.md
|   |-- typescript-config
|   |   `-- README.md
|   `-- README.md
|-- scripts
|   |-- repository
|   |   |-- check-secrets.ps1
|   |   `-- show-tree.ps1
|   |-- setup
|   |   `-- verify-prerequisites.ps1
|   `-- README.md
|-- .editorconfig
|-- .gitattributes
|-- .gitignore
|-- CONTRIBUTING.md
|-- LICENSE.md
|-- package.json
|-- pnpm-workspace.yaml
|-- README.md
|-- SECURITY.md
`-- SETUP_REPORT.md
