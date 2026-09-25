using System.Data;
using System.Linq.Expressions;
using Elevant.Domain.Entities;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Seed;

/// <summary>Creates deterministic, synthetic fixtures in a marked Development database.</summary>
public sealed class DevelopmentDataSeeder(ElevantDbContext context)
{
    private static readonly DateTimeOffset FixtureInstant = new(2026, 8, 17, 12, 0, 0, TimeSpan.Zero);
    private static readonly DateOnly FixtureDate = new(2026, 8, 18);
    private static readonly DateOnly SecondFixtureDate = new(2026, 8, 19);
    private static readonly ChecklistFixtureItem[] TurnaroundChecklistV2Items =
    [
        new("PREUSE-EXTERIOR", "Chequeo preuso", "Exterior completo del puente"),
        new("PREUSE-SERVICE-STAIR", "Chequeo preuso", "Escalera de servicio"),
        new("PREUSE-BAGGAGE-SLIDE", "Chequeo preuso", "Tobogán de equipaje"),
        new("PREUSE-CABLES-HOSES", "Chequeo preuso", "Cables y mangueras en posición"),
        new("PREUSE-INTERIOR", "Chequeo preuso", "Interior completo del puente"),
        new("PREUSE-AUTOLEVEL", "Chequeo preuso", "Prueba del autonivelador"),
        new("PREUSE-LAMP-TEST", "Chequeo preuso", "Botón de prueba de lámparas"),
        new("PREUSE-LIGHTS", "Chequeo preuso", "Luces del puente"),
        new("PREUSE-SAFETY-CHAIN", "Chequeo preuso", "Cadena de seguridad"),
        new("PREUSE-SLIDING-DOOR", "Chequeo preuso", "Puerta corrediza del puente"),
        new("PREUSE-EXTEND-RETRACT", "Chequeo preuso", "Extender y retraer puente"),
        new("PREUSE-RAISE-LOWER", "Chequeo preuso", "Subida y bajada del puente"),
        new("PREUSE-CABIN-ROTATION", "Chequeo preuso", "Giro izquierdo y derecho de cabina"),
        new("ARRIVAL-CANOPY", "Antes de la llegada", "Canopy retraído"),
        new("ARRIVAL-AUTOLEVEL", "Antes de la llegada", "Autonivelador retraído"),
        new("ARRIVAL-LAMP-TEST", "Antes de la llegada", "Botón de prueba de lámparas"),
        new("ARRIVAL-LIGHTS", "Antes de la llegada", "Luces encendidas"),
        new("ARRIVAL-PARKING", "Antes de la llegada", "Puente en posición de parqueo"),
        new("ARRIVAL-AIRCRAFT-LEVEL", "Antes de la llegada", "Nivelar puente al tipo de avión"),
        new("ARRIVAL-CABLES-HOSES", "Antes de la llegada", "Cables y mangueras en posición"),
        new("ARRIVAL-EQUIPMENT-CLEAR", "Antes de la llegada", "Equipos fuera del alcance del puente"),
        new("ARRIVAL-CHAIN", "Antes de la llegada", "Cadena en posición"),
        new("ARRIVAL-ROLLING-DOOR", "Antes de la llegada", "Puerta enrollable abierta"),
        new("ARRIVAL-RAMP-CONFIRM", "Antes de la llegada", "Confirmación de rampa"),
        new("ARRIVAL-BELL", "Antes de la llegada", "Sonar timbre del puente"),
        new("ARRIVAL-DOCK", "Antes de la llegada", "Mover puente al avión"),
        new("DEPARTURE-RAMP-CONFIRM", "Antes de la salida", "Confirmación de rampa"),
        new("DEPARTURE-GPU-OFF", "Antes de la salida", "Cable GPU desactivado"),
        new("DEPARTURE-AIR-HOSE-OFF", "Antes de la salida", "Manguera de aire desactivada"),
        new("DEPARTURE-GPU-CABLES", "Antes de la salida", "Subida y bajada de cables GPU"),
        new("DEPARTURE-BUMPERS", "Antes de la salida", "Gomas perpendiculares al avión"),
        new("DEPARTURE-AIRCRAFT-DOOR", "Antes de la salida", "Puerta del avión cerrada"),
        new("DEPARTURE-AUTOLEVEL", "Antes de la salida", "Retraer autonivelador"),
        new("DEPARTURE-CANOPY", "Antes de la salida", "Retraer canopy"),
        new("DEPARTURE-BELL", "Antes de la salida", "Sonar timbre del puente"),
        new("DEPARTURE-UNDOCK", "Antes de la salida", "Retirar el puente"),
        new("POSTDEPARTURE-BELL", "Después de la salida", "Sonar timbre del puente"),
        new("POSTDEPARTURE-CABIN", "Después de la salida", "Girar cabina a posición"),
        new("POSTDEPARTURE-PARKING", "Después de la salida", "Posicionar puente en parqueo"),
        new("POSTDEPARTURE-CHAIN", "Después de la salida", "Cadena en posición"),
        new("POSTDEPARTURE-ROLLING-DOOR", "Después de la salida", "Cerrar puerta enrollable"),
        new("POSTDEPARTURE-A320-LEVEL", "Después de la salida", "Nivelar puente al A320"),
        new("POSTDEPARTURE-KEY-OFF", "Después de la salida", "Colocar llave en OFF"),
        new("POSTDEPARTURE-KEY-STORED", "Después de la salida", "Quitar y guardar llave"),
        new("POSTDEPARTURE-LIGHTS-OFF", "Después de la salida", "Apagar luces del puente"),
    ];

    public async Task SeedAsync(
        DevelopmentAccountPasswords accountPasswords,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(accountPasswords);

        await DatabaseInstanceVerifier.RequireEnvironmentAsync(context, "Development", cancellationToken);

        var strategy = context.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(
                IsolationLevel.Serializable,
                cancellationToken);

            await SeedInsideTransactionAsync(accountPasswords, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        });
    }

    private async Task SeedInsideTransactionAsync(
        DevelopmentAccountPasswords accountPasswords,
        CancellationToken cancellationToken)
    {
        var aviam = await GetOrAddAsync(
            context.Organizations,
            organization => organization.Code == "AVIAM",
            () => Stamp(new Organization
            {
                Code = "AVIAM",
                LegalName = "AVIAM DEVELOPMENT OPERATOR S.A.",
                DisplayName = "AVIAM Development",
                Type = OrganizationType.AviamOperator,
                Status = OrganizationStatus.Active,
            }, "10000000-0000-7000-8000-000000000001"),
            cancellationToken);

        var airlineOrganization = await GetOrAddAsync(
            context.Organizations,
            organization => organization.Code == "DEMO-AIR",
            () => Stamp(new Organization
            {
                Code = "DEMO-AIR",
                LegalName = "DEMO AIRLINES TEST ORGANIZATION",
                DisplayName = "Demo Airlines",
                Type = OrganizationType.AirlineCustomer,
                Status = OrganizationStatus.Active,
            }, "10000000-0000-7000-8000-000000000002"),
            cancellationToken);

        var puj = await GetOrAddAsync(
            context.Airports,
            airport => airport.IataCode == "PUJ",
            () => Stamp(new Airport
            {
                IataCode = "PUJ",
                IcaoCode = "MDPC",
                Name = "Punta Cana Development Airport",
                City = "Punta Cana",
                CountryCode = "DO",
            }, "20000000-0000-7000-8000-000000000001"),
            cancellationToken);

        var mia = await GetOrAddAsync(
            context.Airports,
            airport => airport.IataCode == "MIA",
            () => Stamp(new Airport
            {
                IataCode = "MIA",
                IcaoCode = "KMIA",
                Name = "Miami Development Airport",
                City = "Miami",
                CountryCode = "US",
            }, "20000000-0000-7000-8000-000000000002"),
            cancellationToken);

        var station = await GetOrAddAsync(
            context.Stations,
            item => item.Code == "PUJ",
            () => Stamp(new Station
            {
                AirportId = puj.Id,
                Code = "PUJ",
                Name = "AVIAM PUJ Development",
                IanaTimeZone = "America/Santo_Domingo",
                IsActive = true,
            }, "20000000-0000-7000-8000-000000000003"),
            cancellationToken);

        var terminal = await GetOrAddAsync(
            context.Terminals,
            item => item.StationId == station.Id && item.Code == "A",
            () => Stamp(new Terminal
            {
                StationId = station.Id,
                Code = "A",
                Name = "Terminal A",
                IsActive = true,
            }, "20000000-0000-7000-8000-000000000004"),
            cancellationToken);

        var stand = await GetOrAddAsync(
            context.Stands,
            item => item.StationId == station.Id && item.Code == "A01",
            () => Stamp(new Stand
            {
                StationId = station.Id,
                TerminalId = terminal.Id,
                Code = "A01",
                StandType = "Contact",
                IsActive = true,
            }, "20000000-0000-7000-8000-000000000005"),
            cancellationToken);

        var secondStand = await GetOrAddAsync(
            context.Stands,
            item => item.StationId == station.Id && item.Code == "A02",
            () => Stamp(new Stand
            {
                StationId = station.Id,
                TerminalId = terminal.Id,
                Code = "A02",
                StandType = "Contact",
                IsActive = true,
            }, "20000000-0000-7000-8000-000000000011"),
            cancellationToken);

        var baggageService = await GetOrAddAsync(
            context.ServiceDefinitions,
            service => service.Code == "BAGGAGE",
            () => Stamp(new ServiceDefinition
            {
                Code = "BAGGAGE",
                Name = "Baggage handling",
                Description = "Synthetic Development service.",
                DefaultBillingUnit = "operation",
                IsActive = true,
            }, "20000000-0000-7000-8000-000000000006"),
            cancellationToken);

        var passengerBridgeService = await GetOrAddAsync(
            context.ServiceDefinitions,
            service => service.Code == "PASSENGER-BRIDGE",
            () => Stamp(new ServiceDefinition
            {
                Code = "PASSENGER-BRIDGE",
                Name = "Passenger boarding bridge operation",
                Description = "Synthetic Development service exercised by the ramp checklist.",
                DefaultBillingUnit = "operation",
                IsActive = true,
            }, DeterministicGuid("service-definition:PASSENGER-BRIDGE").ToString("D")),
            cancellationToken);

        var gpuType = await GetOrAddAsync(
            context.EquipmentTypes,
            equipment => equipment.Code == "GPU",
            () => Stamp(new EquipmentType
            {
                Code = "GPU",
                Name = "Ground power unit",
                RequiresQualification = true,
                IsActive = true,
            }, "20000000-0000-7000-8000-000000000007"),
            cancellationToken);

        var rampPosition = await GetOrAddAsync(
            context.OperationalPositions,
            position => position.Code == "RAMP-AGENT",
            () => Stamp(new OperationalPosition
            {
                Code = "RAMP-AGENT",
                Name = "Ramp agent",
                RequiresQualification = false,
                IsActive = true,
            }, "20000000-0000-7000-8000-000000000008"),
            cancellationToken);

        var aircraftType = await GetOrAddAsync(
            context.AircraftTypes,
            type => type.IcaoCode == "A320",
            () => Stamp(new AircraftType
            {
                IcaoCode = "A320",
                IataCode = "320",
                Manufacturer = "Airbus",
                Model = "A320 Development",
                IsActive = true,
            }, "20000000-0000-7000-8000-000000000009"),
            cancellationToken);

        var airline = await GetOrAddAsync(
            context.Airlines,
            item => item.IataCode == "ZZ",
            () => Stamp(new Airline
            {
                OrganizationId = airlineOrganization.Id,
                IataCode = "ZZ",
                IcaoCode = "DZZ",
                Name = "Demo Airlines",
                IsActive = true,
            }, "20000000-0000-7000-8000-000000000010"),
            cancellationToken);

        var adminPerson = await SeedPersonAsync(
            "30000000-0000-7000-8000-000000000001",
            "Alex",
            "Operations",
            "admin.occ@dev.elevant.test",
            "DEV-ADMIN-001",
            cancellationToken);
        var agentPerson = await SeedPersonAsync(
            "30000000-0000-7000-8000-000000000002",
            "Riley",
            "Ramp",
            "ramp.agent@dev.elevant.test",
            "DEV-AGENT-001",
            cancellationToken);
        var clientPerson = await SeedPersonAsync(
            "30000000-0000-7000-8000-000000000003",
            "Casey",
            "Airline",
            "airline.client@dev.elevant.test",
            "DEV-CLIENT-001",
            cancellationToken);
        var humanResourcesPerson = await SeedPersonAsync(
            "30000000-0000-7000-8000-000000000004",
            "Camila",
            "Development",
            "gestion.humana@dev.elevant.test",
            "DEV-HR-001",
            cancellationToken);
        var contractsPerson = await SeedPersonAsync(
            "30000000-0000-7000-8000-000000000005",
            "Daniela",
            "Contracts",
            "contratos@dev.elevant.test",
            "DEV-CONTRACTS-001",
            cancellationToken);
        var financePerson = await SeedPersonAsync(
            "30000000-0000-7000-8000-000000000006",
            "Sofia",
            "Finance",
            "finanzas@dev.elevant.test",
            "DEV-FINANCE-001",
            cancellationToken);

        var adminRole = await SeedRoleAsync("Admin OCC", "ADMIN_OCC", PortalKind.BackOffice, "admin_occ", cancellationToken);
        var agentRole = await SeedRoleAsync("Ramp Agent", "RAMP_AGENT", PortalKind.RampMobileApp, "ramp_agent", cancellationToken);
        var clientRole = await SeedRoleAsync("Airline Client", "AIRLINE_CLIENT", PortalKind.AirlinePortal, "airline_client", cancellationToken);
        var humanResourcesRole = await SeedRoleAsync("Gestión Humana", "GESTION_HUMANA", PortalKind.BackOffice, "human_resources", cancellationToken);
        var contractsRole = await SeedRoleAsync("Contratos", "CONTRATOS", PortalKind.BackOffice, "contracts", cancellationToken);
        var financeRole = await SeedRoleAsync("Finanzas", "FINANZAS", PortalKind.BackOffice, "finance", cancellationToken);

        var adminAccount = await SeedAccountAsync(adminPerson, accountPasswords.AdminOcc, "40000000-0000-7000-8000-000000000001", cancellationToken);
        var agentAccount = await SeedAccountAsync(agentPerson, accountPasswords.RampAgent, "40000000-0000-7000-8000-000000000002", cancellationToken);
        var clientAccount = await SeedAccountAsync(clientPerson, accountPasswords.AirlineClient, "40000000-0000-7000-8000-000000000003", cancellationToken);
        var humanResourcesAccount = await SeedAccountAsync(humanResourcesPerson, accountPasswords.HumanResources, "40000000-0000-7000-8000-000000000004", cancellationToken);
        var contractsAccount = await SeedAccountAsync(contractsPerson, accountPasswords.Contracts, "40000000-0000-7000-8000-000000000005", cancellationToken, mustChangePasswordInitially: true);
        var financeAccount = await SeedAccountAsync(financePerson, accountPasswords.Finance, "40000000-0000-7000-8000-000000000006", cancellationToken, mustChangePasswordInitially: true);

        await EnsureUserRoleAsync(adminAccount.Id, adminRole.Id, cancellationToken);
        await EnsureUserRoleAsync(agentAccount.Id, agentRole.Id, cancellationToken);
        await EnsureUserRoleAsync(clientAccount.Id, clientRole.Id, cancellationToken);
        await EnsureUserRoleAsync(humanResourcesAccount.Id, humanResourcesRole.Id, cancellationToken);
        await EnsureUserRoleAsync(contractsAccount.Id, contractsRole.Id, cancellationToken);
        await EnsureUserRoleAsync(financeAccount.Id, financeRole.Id, cancellationToken);
        await EnsureMembershipAsync(adminAccount.Id, aviam.Id, MembershipKind.InternalStaff, "OCC administrator", cancellationToken);
        await EnsureMembershipAsync(agentAccount.Id, aviam.Id, MembershipKind.InternalStaff, "Ramp agent", cancellationToken);
        await EnsureMembershipAsync(clientAccount.Id, airlineOrganization.Id, MembershipKind.AirlineClient, "Operations contact", cancellationToken);
        await EnsureMembershipAsync(humanResourcesAccount.Id, aviam.Id, MembershipKind.InternalStaff, "Gestión Humana", cancellationToken);
        await EnsureMembershipAsync(contractsAccount.Id, aviam.Id, MembershipKind.InternalStaff, "Contracts", cancellationToken);
        await EnsureMembershipAsync(financeAccount.Id, aviam.Id, MembershipKind.InternalStaff, "Finance", cancellationToken);
        await EnsureAccountStationScopeAsync(adminAccount.Id, station.Id, cancellationToken);
        await EnsureAccountStationScopeAsync(agentAccount.Id, station.Id, cancellationToken);
        await EnsureAccountStationScopeAsync(humanResourcesAccount.Id, station.Id, cancellationToken);
        await EnsureAccountStationScopeAsync(contractsAccount.Id, station.Id, cancellationToken);
        await EnsureAccountStationScopeAsync(financeAccount.Id, station.Id, cancellationToken);

        var rampAgent = await GetOrAddAsync(
            context.RampAgents,
            agent => agent.EmployeeNumber == "DEV-RA-001",
            () => Stamp(new RampAgent
            {
                PersonId = agentPerson.Id,
                EmployeeNumber = "DEV-RA-001",
                Category = "Development",
                HireDate = new DateOnly(2026, 1, 1),
                IsActive = true,
            }, "50000000-0000-7000-8000-000000000001"),
            cancellationToken);

        await EnsureAgentScopesAsync(rampAgent.Id, station.Id, terminal.Id, cancellationToken);
        await GetOrAddAsync(
            context.QualificationCycles,
            cycle => cycle.RampAgentId == rampAgent.Id && cycle.EquipmentTypeId == gpuType.Id && cycle.CycleNumber == 1,
            () => Stamp(new QualificationCycle
            {
                RampAgentId = rampAgent.Id,
                EquipmentTypeId = gpuType.Id,
                CycleNumber = 1,
                TrainingDate = new DateOnly(2026, 1, 2),
                ObtainedOn = new DateOnly(2026, 1, 3),
                ExpiresOn = new DateOnly(2099, 12, 31),
                CertifyingEntity = "Synthetic Training Center",
                InstructorName = "Development Instructor",
                IsCurrent = true,
            }, "50000000-0000-7000-8000-000000000002"),
            cancellationToken);

        await SeedPermitAsync(rampAgent.Id, PermitDocumentType.AirportId, "DEV-AIRPORT-ID", "50000000-0000-7000-8000-000000000003", cancellationToken);
        await SeedPermitAsync(rampAgent.Id, PermitDocumentType.RampDriverLicense, "DEV-RAMP-LICENSE", "50000000-0000-7000-8000-000000000004", cancellationToken);

        await GetOrAddAsync(
            context.ShiftAssignments,
            shift => shift.RampAgentId == rampAgent.Id && shift.WorkDate == FixtureDate,
            () => Stamp(new ShiftAssignment
            {
                RampAgentId = rampAgent.Id,
                StationId = station.Id,
                TerminalId = terminal.Id,
                OperationalPositionId = rampPosition.Id,
                WorkDate = FixtureDate,
                StartsAtLocal = new TimeOnly(6, 0),
                EndsAtLocal = new TimeOnly(14, 0),
                Block = ShiftBlock.Morning,
            }, "50000000-0000-7000-8000-000000000005"),
            cancellationToken);

        await GetOrAddAsync(
            context.ShiftAssignments,
            shift => shift.RampAgentId == rampAgent.Id && shift.WorkDate == SecondFixtureDate,
            () => Stamp(new ShiftAssignment
            {
                RampAgentId = rampAgent.Id,
                StationId = station.Id,
                TerminalId = terminal.Id,
                OperationalPositionId = rampPosition.Id,
                WorkDate = SecondFixtureDate,
                StartsAtLocal = new TimeOnly(6, 0),
                EndsAtLocal = new TimeOnly(14, 0),
                Block = ShiftBlock.Morning,
            }, "50000000-0000-7000-8000-000000000006"),
            cancellationToken);

        var serviceRequest = await GetOrAddAsync(
            context.ServiceRequests,
            request => request.RequestCode == "DEV-REQ-0001",
            () => Stamp(new ServiceRequest
            {
                RequestCode = "DEV-REQ-0001",
                AirlineId = airline.Id,
                RequestedAirlineName = airline.Name,
                Type = CommercialRequestType.Affiliation,
                Status = CommercialRequestStatus.Approved,
                ContactName = "Casey Airline",
                ContactEmail = clientPerson.PrimaryEmail!,
                SubmittedAt = FixtureInstant.AddDays(-30),
                ReviewedAt = FixtureInstant.AddDays(-29),
                ReviewedByAccountId = adminAccount.Id,
            }, "60000000-0000-7000-8000-000000000001"),
            cancellationToken);

        var contract = await GetOrAddAsync(
            context.Contracts,
            item => item.ContractCode == "DEV-CONTRACT-0001",
            () => Stamp(new Contract
            {
                AirlineId = airline.Id,
                OriginatingServiceRequestId = serviceRequest.Id,
                ContractCode = "DEV-CONTRACT-0001",
                Status = ContractStatus.Active,
                SignedOn = new DateOnly(2026, 1, 1),
            }, "60000000-0000-7000-8000-000000000002"),
            cancellationToken);

        var contractVersion = await GetOrAddAsync(
            context.ContractVersions,
            version => version.ContractId == contract.Id && version.VersionNumber == 1,
            () => Stamp(new ContractVersion
            {
                ContractId = contract.Id,
                VersionNumber = 1,
                Status = ContractVersionStatus.Approved,
                ValidFrom = new DateOnly(2026, 1, 1),
                ValidTo = new DateOnly(2099, 12, 31),
                CurrencyCode = "USD",
                Terms = "Synthetic Development contract. Not legally binding.",
                ApprovedAt = FixtureInstant.AddDays(-28),
                ApprovedByAccountId = adminAccount.Id,
            }, "60000000-0000-7000-8000-000000000003"),
            cancellationToken);

        await EnsureContractStationAsync(contractVersion.Id, station.Id, cancellationToken);
        var rate = await GetOrAddAsync(
            context.ContractServiceRates,
            item => item.ContractVersionId == contractVersion.Id && item.ServiceDefinitionId == baggageService.Id,
            () => Stamp(new ContractServiceRate
            {
                ContractVersionId = contractVersion.Id,
                ServiceDefinitionId = baggageService.Id,
                BillingUnit = "operation",
                UnitPrice = 125.50m,
                MinimumQuantity = 1m,
            }, "60000000-0000-7000-8000-000000000004"),
            cancellationToken);
        var passengerBridgeRate = await GetOrAddAsync(
            context.ContractServiceRates,
            item => item.ContractVersionId == contractVersion.Id &&
                item.ServiceDefinitionId == passengerBridgeService.Id,
            () => Stamp(new ContractServiceRate
            {
                ContractVersionId = contractVersion.Id,
                ServiceDefinitionId = passengerBridgeService.Id,
                BillingUnit = "operation",
                UnitPrice = 95.00m,
                MinimumQuantity = 1m,
            }, DeterministicGuid("contract-rate:DEV-CONTRACT-0001:PASSENGER-BRIDGE").ToString("D")),
            cancellationToken);

        var turnaround = await GetOrAddAsync(
            context.Turnarounds,
            item => item.OperationCode == "DEV-TAT-0001",
            () => Stamp(new Turnaround
            {
                OperationCode = "DEV-TAT-0001",
                AirlineId = airline.Id,
                StationId = station.Id,
                OperationDate = FixtureDate,
                AircraftTypeId = aircraftType.Id,
                AircraftRegistration = "HI-DEV",
                CurrentStatus = TurnaroundStatus.Confirmed,
                Source = OperationalDataSource.Internal,
            }, "70000000-0000-7000-8000-000000000001"),
            cancellationToken);

        await SeedFlightLegAsync(turnaround.Id, FlightDirection.Arrival, "ZZ100", mia.Id, puj.Id, FixtureInstant.AddHours(1), "70000000-0000-7000-8000-000000000002", cancellationToken);
        await SeedFlightLegAsync(turnaround.Id, FlightDirection.Departure, "ZZ101", puj.Id, mia.Id, FixtureInstant.AddHours(3), "70000000-0000-7000-8000-000000000003", cancellationToken);
        await GetOrAddAsync(
            context.Set<StandAssignment>(),
            assignment => assignment.TurnaroundId == turnaround.Id && assignment.AssignedTo == null,
            () => Stamp(new StandAssignment
            {
                TurnaroundId = turnaround.Id,
                StandId = stand.Id,
                AssignedFrom = FixtureInstant,
                AssignedByAccountId = adminAccount.Id,
                Reason = "Synthetic Development assignment.",
            }, "70000000-0000-7000-8000-000000000004"),
            cancellationToken);

        var operation = await GetOrAddAsync(
            context.GroundOperations,
            item => item.TurnaroundId == turnaround.Id,
            () => Stamp(new GroundOperation
            {
                TurnaroundId = turnaround.Id,
                CurrentStatus = GroundOperationStatus.Assigned,
                PlannedStartAt = FixtureInstant.AddMinutes(45),
                PlannedEndAt = FixtureInstant.AddHours(2).AddMinutes(30),
            }, "70000000-0000-7000-8000-000000000005"),
            cancellationToken);

        await GetOrAddAsync(
            context.OperationAgentAssignments,
            assignment => assignment.GroundOperationId == operation.Id && assignment.RampAgentId == rampAgent.Id && assignment.ReleasedAt == null,
            () => Stamp(new OperationAgentAssignment
            {
                GroundOperationId = operation.Id,
                RampAgentId = rampAgent.Id,
                OperationalPositionId = rampPosition.Id,
                AssignmentRole = "primary",
                AssignedAt = FixtureInstant,
                AssignedByAccountId = adminAccount.Id,
            }, "70000000-0000-7000-8000-000000000006"),
            cancellationToken);

        await GetOrAddAsync(
            context.OperationServices,
            service => service.GroundOperationId == operation.Id && service.LineNumber == 1,
            () => Stamp(new OperationService
            {
                GroundOperationId = operation.Id,
                LineNumber = 1,
                ServiceDefinitionId = baggageService.Id,
                ContractServiceRateId = rate.Id,
                ContractedQuantity = 1m,
                ExecutedQuantity = 0m,
                BillingUnitSnapshot = rate.BillingUnit,
                UnitPriceSnapshot = rate.UnitPrice,
                CurrencyCodeSnapshot = contractVersion.CurrencyCode,
                CurrentStatus = ServiceExecutionStatus.Planned,
            }, "70000000-0000-7000-8000-000000000007"),
            cancellationToken);

        await GetOrAddAsync(
            context.OperationServices,
            service => service.GroundOperationId == operation.Id && service.LineNumber == 2,
            () => Stamp(new OperationService
            {
                GroundOperationId = operation.Id,
                LineNumber = 2,
                ServiceDefinitionId = passengerBridgeService.Id,
                ContractServiceRateId = passengerBridgeRate.Id,
                ContractedQuantity = 1m,
                ExecutedQuantity = 0m,
                BillingUnitSnapshot = passengerBridgeRate.BillingUnit,
                UnitPriceSnapshot = passengerBridgeRate.UnitPrice,
                CurrencyCodeSnapshot = contractVersion.CurrencyCode,
                CurrentStatus = ServiceExecutionStatus.Planned,
            }, DeterministicGuid("operation-service:DEV-TAT-0001:PASSENGER-BRIDGE").ToString("D")),
            cancellationToken);

        var template = await GetOrAddAsync(
            context.Set<ChecklistTemplate>(),
            item => item.Code == "TURNAROUND-BASE",
            () => Stamp(new ChecklistTemplate
            {
                Code = "TURNAROUND-BASE",
                Name = "Turnaround base checklist",
                IsActive = true,
            }, "70000000-0000-7000-8000-000000000008"),
            cancellationToken);
        if (template.PublicId != Guid.Parse("70000000-0000-7000-8000-000000000008") ||
            !string.Equals(template.Code, "TURNAROUND-BASE", StringComparison.Ordinal) ||
            !string.Equals(template.Name, "Turnaround base checklist", StringComparison.Ordinal) ||
            !template.IsActive)
        {
            throw new InvalidOperationException(
                "Synthetic Development checklist template drift was detected.");
        }

        var templateVersion = await GetOrAddAsync(
            context.Set<ChecklistTemplateVersion>(),
            version => version.ChecklistTemplateId == template.Id && version.VersionNumber == 1,
            () => Stamp(new ChecklistTemplateVersion
            {
                ChecklistTemplateId = template.Id,
                VersionNumber = 1,
                Status = ChecklistVersionStatus.Published,
                EffectiveFrom = new DateOnly(2026, 1, 1),
                PublishedAt = FixtureInstant.AddDays(-60),
                PublishedByAccountId = adminAccount.Id,
            }, "70000000-0000-7000-8000-000000000009"),
            cancellationToken);

        await GetOrAddAsync(
            context.Set<ChecklistTemplateItem>(),
            item => item.ChecklistTemplateVersionId == templateVersion.Id && item.ItemCode == "CHOCKS",
            () => Stamp(new ChecklistTemplateItem
            {
                ChecklistTemplateVersionId = templateVersion.Id,
                ItemCode = "CHOCKS",
                SectionName = "Arrival",
                Label = "Wheel chocks positioned",
                SortOrder = 1,
                RequiresNoteWhenNotOk = true,
                IsRequired = true,
            }, "70000000-0000-7000-8000-000000000010"),
            cancellationToken);

        await GetOrAddAsync(
            context.OperationChecklists,
            checklist => checklist.GroundOperationId == operation.Id &&
                checklist.ChecklistTemplateVersionId == templateVersion.Id &&
                checklist.RevisionNumber == 1,
            () => Stamp(new OperationChecklist
            {
                GroundOperationId = operation.Id,
                ChecklistTemplateVersionId = templateVersion.Id,
                Status = ChecklistStatus.NotStarted,
            }, "70000000-0000-7000-8000-000000000011"),
            cancellationToken);

        var templateVersionV2 = await GetOrAddAsync(
            context.Set<ChecklistTemplateVersion>(),
            version => version.ChecklistTemplateId == template.Id && version.VersionNumber == 2,
            () => Stamp(new ChecklistTemplateVersion
            {
                ChecklistTemplateId = template.Id,
                VersionNumber = 2,
                Status = ChecklistVersionStatus.Published,
                EffectiveFrom = FixtureDate,
                PublishedAt = FixtureInstant,
                PublishedByAccountId = adminAccount.Id,
            }, DeterministicGuid("checklist:TURNAROUND-BASE:v2").ToString("D")),
            cancellationToken);
        var expectedTemplateVersionV2Id = DeterministicGuid("checklist:TURNAROUND-BASE:v2");
        if (templateVersionV2.PublicId != expectedTemplateVersionV2Id ||
            templateVersionV2.ChecklistTemplateId != template.Id ||
            templateVersionV2.VersionNumber != 2 ||
            templateVersionV2.Status != ChecklistVersionStatus.Published ||
            templateVersionV2.EffectiveFrom != FixtureDate ||
            templateVersionV2.EffectiveTo is not null ||
            templateVersionV2.PublishedAt != FixtureInstant ||
            templateVersionV2.PublishedByAccountId != adminAccount.Id)
        {
            throw new InvalidOperationException(
                "Synthetic Development checklist template version drift was detected.");
        }

        for (var index = 0; index < TurnaroundChecklistV2Items.Length; index++)
        {
            var fixtureItem = TurnaroundChecklistV2Items[index];
            var templateItem = await GetOrAddAsync(
                context.Set<ChecklistTemplateItem>(),
                item => item.ChecklistTemplateVersionId == templateVersionV2.Id &&
                    item.ItemCode == fixtureItem.Code,
                () => Stamp(new ChecklistTemplateItem
                {
                    ChecklistTemplateVersionId = templateVersionV2.Id,
                    ItemCode = fixtureItem.Code,
                    SectionName = fixtureItem.Section,
                    Label = fixtureItem.Label,
                    SortOrder = index + 1,
                    RequiresNoteWhenNotOk = true,
                    IsRequired = true,
                }, DeterministicGuid($"checklist:TURNAROUND-BASE:v2:{fixtureItem.Code}").ToString("D")),
                cancellationToken);
            var expectedItemId = DeterministicGuid(
                $"checklist:TURNAROUND-BASE:v2:{fixtureItem.Code}");
            if (templateItem.PublicId != expectedItemId ||
                templateItem.ChecklistTemplateVersionId != templateVersionV2.Id ||
                !string.Equals(templateItem.ItemCode, fixtureItem.Code, StringComparison.Ordinal) ||
                !string.Equals(templateItem.SectionName, fixtureItem.Section, StringComparison.Ordinal) ||
                !string.Equals(templateItem.Label, fixtureItem.Label, StringComparison.Ordinal) ||
                templateItem.SortOrder != index + 1 ||
                !templateItem.IsRequired ||
                !templateItem.RequiresNoteWhenNotOk)
            {
                throw new InvalidOperationException(
                    $"Synthetic Development checklist item drift was detected for {fixtureItem.Code}.");
            }
        }

        var templateVersionV2ItemCount = await context.Set<ChecklistTemplateItem>()
            .CountAsync(
                item => item.ChecklistTemplateVersionId == templateVersionV2.Id,
                cancellationToken);
        if (templateVersionV2ItemCount != TurnaroundChecklistV2Items.Length)
        {
            throw new InvalidOperationException(
                "Synthetic Development checklist template contains unexpected items.");
        }

        await GetOrAddAsync(
            context.OperationChecklists,
            checklist => checklist.GroundOperationId == operation.Id &&
                checklist.ChecklistTemplateVersionId == templateVersionV2.Id &&
                checklist.RevisionNumber == 1,
            () => Stamp(new OperationChecklist
            {
                GroundOperationId = operation.Id,
                ChecklistTemplateVersionId = templateVersionV2.Id,
                Status = ChecklistStatus.NotStarted,
            }, DeterministicGuid("checklist:DEV-TAT-0001:v2").ToString("D")),
            cancellationToken);

        var secondTurnaround = await GetOrAddAsync(
            context.Turnarounds,
            item => item.OperationCode == "DEV-TAT-0002",
            () => Stamp(new Turnaround
            {
                OperationCode = "DEV-TAT-0002",
                AirlineId = airline.Id,
                StationId = station.Id,
                OperationDate = SecondFixtureDate,
                AircraftTypeId = aircraftType.Id,
                AircraftRegistration = "HI-DEV2",
                CurrentStatus = TurnaroundStatus.Confirmed,
                Source = OperationalDataSource.Internal,
            }, "70000000-0000-7000-8000-000000000012"),
            cancellationToken);

        var secondArrival = new DateTimeOffset(2026, 8, 19, 12, 0, 0, TimeSpan.Zero);
        var secondDeparture = new DateTimeOffset(2026, 8, 19, 15, 0, 0, TimeSpan.Zero);
        await SeedFlightLegAsync(
            secondTurnaround.Id,
            FlightDirection.Arrival,
            "ZZ102",
            mia.Id,
            puj.Id,
            secondArrival,
            "70000000-0000-7000-8000-000000000013",
            cancellationToken);
        await SeedFlightLegAsync(
            secondTurnaround.Id,
            FlightDirection.Departure,
            "ZZ103",
            puj.Id,
            mia.Id,
            secondDeparture,
            "70000000-0000-7000-8000-000000000014",
            cancellationToken);
        await GetOrAddAsync(
            context.Set<StandAssignment>(),
            assignment => assignment.TurnaroundId == secondTurnaround.Id && assignment.AssignedTo == null,
            () => Stamp(new StandAssignment
            {
                TurnaroundId = secondTurnaround.Id,
                StandId = secondStand.Id,
                AssignedFrom = secondArrival.AddMinutes(-30),
                AssignedByAccountId = adminAccount.Id,
                Reason = "Synthetic Development assignment.",
            }, "70000000-0000-7000-8000-000000000015"),
            cancellationToken);

        var secondOperation = await GetOrAddAsync(
            context.GroundOperations,
            item => item.TurnaroundId == secondTurnaround.Id,
            () => Stamp(new GroundOperation
            {
                TurnaroundId = secondTurnaround.Id,
                CurrentStatus = GroundOperationStatus.Planned,
                PlannedStartAt = new DateTimeOffset(2026, 8, 19, 12, 15, 0, TimeSpan.Zero),
                PlannedEndAt = new DateTimeOffset(2026, 8, 19, 14, 30, 0, TimeSpan.Zero),
            }, "70000000-0000-7000-8000-000000000016"),
            cancellationToken);

        await GetOrAddAsync(
            context.OperationServices,
            service => service.GroundOperationId == secondOperation.Id && service.LineNumber == 1,
            () => Stamp(new OperationService
            {
                GroundOperationId = secondOperation.Id,
                LineNumber = 1,
                ServiceDefinitionId = baggageService.Id,
                ContractServiceRateId = rate.Id,
                ContractedQuantity = 1m,
                ExecutedQuantity = 0m,
                BillingUnitSnapshot = rate.BillingUnit,
                UnitPriceSnapshot = rate.UnitPrice,
                CurrencyCodeSnapshot = contractVersion.CurrencyCode,
                CurrentStatus = ServiceExecutionStatus.Planned,
            }, "70000000-0000-7000-8000-000000000017"),
            cancellationToken);

        await GetOrAddAsync(
            context.OperationServices,
            service => service.GroundOperationId == secondOperation.Id && service.LineNumber == 2,
            () => Stamp(new OperationService
            {
                GroundOperationId = secondOperation.Id,
                LineNumber = 2,
                ServiceDefinitionId = passengerBridgeService.Id,
                ContractServiceRateId = passengerBridgeRate.Id,
                ContractedQuantity = 1m,
                ExecutedQuantity = 0m,
                BillingUnitSnapshot = passengerBridgeRate.BillingUnit,
                UnitPriceSnapshot = passengerBridgeRate.UnitPrice,
                CurrencyCodeSnapshot = contractVersion.CurrencyCode,
                CurrentStatus = ServiceExecutionStatus.Planned,
            }, DeterministicGuid("operation-service:DEV-TAT-0002:PASSENGER-BRIDGE").ToString("D")),
            cancellationToken);

        var secondOperationHasActiveAssignment = await context.OperationAgentAssignments
            .AsNoTracking()
            .AnyAsync(
                assignment => assignment.GroundOperationId == secondOperation.Id &&
                    assignment.ReleasedAt == null,
                cancellationToken);
        if (secondOperationHasActiveAssignment)
        {
            await GetOrAddAsync(
                context.OperationChecklists,
                checklist => checklist.GroundOperationId == secondOperation.Id &&
                    checklist.ChecklistTemplateVersionId == templateVersionV2.Id &&
                    checklist.RevisionNumber == 1,
                () => Stamp(new OperationChecklist
                {
                    GroundOperationId = secondOperation.Id,
                    ChecklistTemplateVersionId = templateVersionV2.Id,
                    Status = ChecklistStatus.NotStarted,
                }, DeterministicGuid("checklist:DEV-TAT-0002:v2").ToString("D")),
                cancellationToken);
        }
    }

    private async Task<Person> SeedPersonAsync(
        string publicId,
        string firstName,
        string lastName,
        string email,
        string identificationNumber,
        CancellationToken cancellationToken)
    {
        var expectedPublicId = Guid.Parse(publicId);
        var person = await GetOrAddAsync(
            context.Persons,
            candidate => candidate.PrimaryEmail == email,
            () => Stamp(new Person
            {
                FirstName = firstName,
                LastName = lastName,
                PrimaryEmail = email,
                IdentificationType = "Synthetic",
                IdentificationNumber = identificationNumber,
            }, publicId),
            cancellationToken);

        if (person.PublicId != expectedPublicId)
        {
            throw new InvalidOperationException(
                "Synthetic Development person identity drift was detected; refusing to seed credentials or privileges.");
        }

        return person;
    }

    private async Task<ApplicationRole> SeedRoleAsync(
        string name,
        string normalizedName,
        PortalKind portal,
        string userType,
        CancellationToken cancellationToken) => await GetOrAddAsync(
            context.Roles,
            role => role.NormalizedName == normalizedName,
            () => new ApplicationRole
            {
                PublicId = DeterministicGuid($"role:{normalizedName}"),
                Name = name,
                NormalizedName = normalizedName,
                Portal = portal,
                UserType = userType,
                ConcurrencyStamp = DeterministicGuid($"role-stamp:{normalizedName}").ToString("D"),
            },
            cancellationToken);

    private async Task<ApplicationUser> SeedAccountAsync(
        Person person,
        string password,
        string publicId,
        CancellationToken cancellationToken,
        bool mustChangePasswordInitially = false)
    {
        var normalizedEmail = person.PrimaryEmail!.ToUpperInvariant();
        var expectedPublicId = Guid.Parse(publicId);
        var account = await context.Users.SingleOrDefaultAsync(
            candidate => candidate.NormalizedEmail == normalizedEmail,
            cancellationToken);
        var passwordHasher = new PasswordHasher<ApplicationUser>();

        if (account is null)
        {
            account = new ApplicationUser
            {
                PublicId = expectedPublicId,
                PersonId = person.Id,
                UserName = person.PrimaryEmail,
                NormalizedUserName = normalizedEmail,
                Email = person.PrimaryEmail,
                NormalizedEmail = normalizedEmail,
                EmailConfirmed = true,
                LockoutEnabled = true,
                Status = AccountLifecycleStatus.Active,
                InvitationStatus = InvitationStatus.Accepted,
                MustChangePassword = mustChangePasswordInitially,
                CreatedAt = FixtureInstant,
                UpdatedAt = FixtureInstant,
                SecurityStamp = DeterministicGuid($"security:{normalizedEmail}").ToString("D"),
                ConcurrencyStamp = DeterministicGuid($"concurrency:{normalizedEmail}").ToString("D"),
            };
            account.PasswordHash = passwordHasher.HashPassword(account, password);
            context.Users.Add(account);
            await context.SaveChangesAsync(cancellationToken);
            return account;
        }

        if (account.PublicId != expectedPublicId || account.PersonId != person.Id)
        {
            throw new InvalidOperationException(
                "Synthetic Development account identity drift was detected; refusing to rotate credentials or attach privileges.");
        }

        // The seed is insert-only for existing identities. Credential rotation is an
        // explicit operation; a database release must not replace a user-chosen password.
        if (!account.LockoutEnabled ||
            string.IsNullOrWhiteSpace(account.PasswordHash) ||
            string.IsNullOrWhiteSpace(account.SecurityStamp))
        {
            throw new InvalidOperationException(
                "Synthetic Development account credential drift was detected; use the reviewed rotation path before seeding.");
        }

        return account;
    }

    private async Task EnsureUserRoleAsync(long accountId, long roleId, CancellationToken cancellationToken)
    {
        var set = context.Set<IdentityUserRole<long>>();
        if (!await set.AnyAsync(link => link.UserId == accountId && link.RoleId == roleId, cancellationToken))
        {
            set.Add(new IdentityUserRole<long> { UserId = accountId, RoleId = roleId });
            await context.SaveChangesAsync(cancellationToken);
        }
    }

    private async Task EnsureMembershipAsync(
        long accountId,
        long organizationId,
        MembershipKind kind,
        string jobTitle,
        CancellationToken cancellationToken) => await GetOrAddAsync(
            context.OrganizationMemberships,
            membership => membership.AccountId == accountId && membership.OrganizationId == organizationId,
            () => Stamp(new OrganizationMembership
            {
                AccountId = accountId,
                OrganizationId = organizationId,
                Kind = kind,
                Status = MembershipStatus.Active,
                JobTitle = jobTitle,
                ValidFrom = new DateOnly(2026, 1, 1),
            }, DeterministicGuid($"membership:{accountId}:{organizationId}").ToString("D")),
            cancellationToken);

    private async Task EnsureAccountStationScopeAsync(long accountId, long stationId, CancellationToken cancellationToken) =>
        await GetOrAddAsync(
            context.AccountStationScopes,
            scope => scope.AccountId == accountId && scope.StationId == stationId && scope.RevokedAt == null,
            () => new AccountStationScope
            {
                AccountId = accountId,
                StationId = stationId,
                GrantedAt = FixtureInstant,
            },
            cancellationToken);

    private async Task EnsureAgentScopesAsync(long rampAgentId, long stationId, long terminalId, CancellationToken cancellationToken)
    {
        await GetOrAddAsync(
            context.Set<RampAgentStationScope>(),
            scope => scope.RampAgentId == rampAgentId && scope.StationId == stationId && scope.ValidTo == null,
            () => new RampAgentStationScope
            {
                RampAgentId = rampAgentId,
                StationId = stationId,
                ValidFrom = new DateOnly(2026, 1, 1),
            },
            cancellationToken);
        await GetOrAddAsync(
            context.Set<RampAgentTerminalScope>(),
            scope => scope.RampAgentId == rampAgentId && scope.TerminalId == terminalId && scope.ValidTo == null,
            () => new RampAgentTerminalScope
            {
                RampAgentId = rampAgentId,
                TerminalId = terminalId,
                ValidFrom = new DateOnly(2026, 1, 1),
            },
            cancellationToken);
    }

    private async Task SeedPermitAsync(
        long rampAgentId,
        PermitDocumentType type,
        string number,
        string publicId,
        CancellationToken cancellationToken) => await GetOrAddAsync(
            context.AirportPermitCycles,
            permit => permit.RampAgentId == rampAgentId && permit.DocumentType == type && permit.CycleNumber == 1,
            () => Stamp(new AirportPermitCycle
            {
                RampAgentId = rampAgentId,
                DocumentType = type,
                CycleNumber = 1,
                DocumentNumber = number,
                IssuedOn = new DateOnly(2026, 1, 1),
                ExpiresOn = new DateOnly(2099, 12, 31),
                IsCurrent = true,
            }, publicId),
            cancellationToken);

    private async Task SeedFlightLegAsync(
        long turnaroundId,
        FlightDirection direction,
        string flightNumber,
        long originAirportId,
        long destinationAirportId,
        DateTimeOffset scheduledAt,
        string publicId,
        CancellationToken cancellationToken) => await GetOrAddAsync(
            context.FlightLegs,
            leg => leg.TurnaroundId == turnaroundId && leg.Direction == direction,
            () => Stamp(new FlightLeg
            {
                TurnaroundId = turnaroundId,
                Direction = direction,
                FlightNumber = flightNumber,
                OriginAirportId = originAirportId,
                DestinationAirportId = destinationAirportId,
                ScheduledAt = scheduledAt,
                Source = OperationalDataSource.Internal,
            }, publicId),
            cancellationToken);

    private async Task EnsureContractStationAsync(long contractVersionId, long stationId, CancellationToken cancellationToken)
    {
        var set = context.Set<ContractVersionStation>();
        if (!await set.AnyAsync(
                item => item.ContractVersionId == contractVersionId && item.StationId == stationId,
                cancellationToken))
        {
            set.Add(new ContractVersionStation { ContractVersionId = contractVersionId, StationId = stationId });
            await context.SaveChangesAsync(cancellationToken);
        }
    }

    private async Task<TEntity> GetOrAddAsync<TEntity>(
        DbSet<TEntity> set,
        Expression<Func<TEntity, bool>> predicate,
        Func<TEntity> factory,
        CancellationToken cancellationToken)
        where TEntity : class
    {
        var entity = await set.SingleOrDefaultAsync(predicate, cancellationToken);
        if (entity is not null)
        {
            return entity;
        }

        entity = factory();
        set.Add(entity);
        await context.SaveChangesAsync(cancellationToken);
        return entity;
    }

    private static TEntity Stamp<TEntity>(TEntity entity, string publicId)
        where TEntity : AuditableEntity
    {
        entity.PublicId = Guid.Parse(publicId);
        entity.CreatedAt = FixtureInstant;
        entity.UpdatedAt = FixtureInstant;
        return entity;
    }

    private static Guid DeterministicGuid(string value)
    {
        var bytes = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(value));
        Span<byte> guidBytes = stackalloc byte[16];
        bytes.AsSpan(0, 16).CopyTo(guidBytes);
        guidBytes[6] = (byte)((guidBytes[6] & 0x0F) | 0x70);
        guidBytes[8] = (byte)((guidBytes[8] & 0x3F) | 0x80);
        return new Guid(guidBytes);
    }

    private sealed record ChecklistFixtureItem(
        string Code,
        string Section,
        string Label);
}
