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

    public async Task SeedAsync(string accountPassword, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(accountPassword) || accountPassword.Length < 14)
        {
            throw new InvalidOperationException("The synthetic Development account password must contain at least 14 characters.");
        }

        await DatabaseInstanceVerifier.RequireEnvironmentAsync(context, "Development", cancellationToken);

        var strategy = context.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(
                IsolationLevel.Serializable,
                cancellationToken);

            await SeedInsideTransactionAsync(accountPassword, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        });
    }

    private async Task SeedInsideTransactionAsync(string accountPassword, CancellationToken cancellationToken)
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

        var adminRole = await SeedRoleAsync("Admin OCC", "ADMIN_OCC", PortalKind.BackOffice, "admin_occ", cancellationToken);
        var agentRole = await SeedRoleAsync("Ramp Agent", "RAMP_AGENT", PortalKind.RampMobileApp, "ramp_agent", cancellationToken);
        var clientRole = await SeedRoleAsync("Airline Client", "AIRLINE_CLIENT", PortalKind.AirlinePortal, "airline_client", cancellationToken);

        var adminAccount = await SeedAccountAsync(adminPerson, accountPassword, "40000000-0000-7000-8000-000000000001", cancellationToken);
        var agentAccount = await SeedAccountAsync(agentPerson, accountPassword, "40000000-0000-7000-8000-000000000002", cancellationToken);
        var clientAccount = await SeedAccountAsync(clientPerson, accountPassword, "40000000-0000-7000-8000-000000000003", cancellationToken);

        await EnsureUserRoleAsync(adminAccount.Id, adminRole.Id, cancellationToken);
        await EnsureUserRoleAsync(agentAccount.Id, agentRole.Id, cancellationToken);
        await EnsureUserRoleAsync(clientAccount.Id, clientRole.Id, cancellationToken);
        await EnsureMembershipAsync(adminAccount.Id, aviam.Id, MembershipKind.InternalStaff, "OCC administrator", cancellationToken);
        await EnsureMembershipAsync(agentAccount.Id, aviam.Id, MembershipKind.InternalStaff, "Ramp agent", cancellationToken);
        await EnsureMembershipAsync(clientAccount.Id, airlineOrganization.Id, MembershipKind.AirlineClient, "Operations contact", cancellationToken);
        await EnsureAccountStationScopeAsync(adminAccount.Id, station.Id, cancellationToken);
        await EnsureAccountStationScopeAsync(agentAccount.Id, station.Id, cancellationToken);

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
            checklist => checklist.GroundOperationId == operation.Id && checklist.ChecklistTemplateVersionId == templateVersion.Id,
            () => Stamp(new OperationChecklist
            {
                GroundOperationId = operation.Id,
                ChecklistTemplateVersionId = templateVersion.Id,
                Status = ChecklistStatus.NotStarted,
            }, "70000000-0000-7000-8000-000000000011"),
            cancellationToken);
    }

    private async Task<Person> SeedPersonAsync(
        string publicId,
        string firstName,
        string lastName,
        string email,
        string identificationNumber,
        CancellationToken cancellationToken) => await GetOrAddAsync(
            context.Persons,
            person => person.PrimaryEmail == email,
            () => Stamp(new Person
            {
                FirstName = firstName,
                LastName = lastName,
                PrimaryEmail = email,
                IdentificationType = "Synthetic",
                IdentificationNumber = identificationNumber,
            }, publicId),
            cancellationToken);

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
        CancellationToken cancellationToken)
    {
        var normalizedEmail = person.PrimaryEmail!.ToUpperInvariant();
        return await GetOrAddAsync(
            context.Users,
            account => account.NormalizedEmail == normalizedEmail,
            () =>
            {
                var account = new ApplicationUser
                {
                    PublicId = Guid.Parse(publicId),
                    PersonId = person.Id,
                    UserName = person.PrimaryEmail,
                    NormalizedUserName = normalizedEmail,
                    Email = person.PrimaryEmail,
                    NormalizedEmail = normalizedEmail,
                    EmailConfirmed = true,
                    Status = AccountLifecycleStatus.Active,
                    InvitationStatus = InvitationStatus.Accepted,
                    CreatedAt = FixtureInstant,
                    UpdatedAt = FixtureInstant,
                    SecurityStamp = DeterministicGuid($"security:{normalizedEmail}").ToString("D"),
                    ConcurrencyStamp = DeterministicGuid($"concurrency:{normalizedEmail}").ToString("D"),
                };
                account.PasswordHash = new PasswordHasher<ApplicationUser>().HashPassword(account, password);
                return account;
            },
            cancellationToken);
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
}
