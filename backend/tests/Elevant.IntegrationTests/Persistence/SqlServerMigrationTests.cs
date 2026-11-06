using System.Collections.Concurrent;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Commercial;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Abstractions.Realtime;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Application.Identity.GetCurrentSession;
using Elevant.Application.Integration;
using Elevant.Application.Operations;
using Elevant.Application.Operations.AssignOccOperation;
using Elevant.Application.Operations.GetRampAssignedOperations;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Infrastructure;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Elevant.Infrastructure.Persistence.Seed;
using Elevant.Persistence;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Finance;
using Elevant.Persistence.Realtime;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public async Task OccClosureRequiresContractsDecisionAndCanBeReopenedWithAReason()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seed = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seed).SeedAsync(new DevelopmentAccountPasswords(
                InitialPasswords.AdminOcc, InitialPasswords.RampAgent,
                InitialPasswords.AirlineClient, InitialPasswords.HumanResources,
                InitialPasswords.Contracts, InitialPasswords.Finance,
                "Synthetic-SuperAdmin!789"), cancellationToken);

        await using var provider = new ServiceCollection().AddLogging()
            .AddSingleton<TimeProvider>(TimeProvider.System)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString,
                }).Build()).BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var closures = scope.ServiceProvider.GetRequiredService<IServiceClosureStore>();
        var catalog = scope.ServiceProvider.GetRequiredService<ICommercialCatalogStore>();
        var management = scope.ServiceProvider.GetRequiredService<ICommercialCatalogManagementStore>();
        var occId = Guid.Parse("40000000-0000-7000-8000-000000000001");
        var contractsId = Guid.Parse("40000000-0000-7000-8000-000000000005");
        var service = await context.ServiceDefinitions.AsNoTracking()
            .SingleAsync(item => item.Code == "RAMP-AC", cancellationToken);
        var requestId = Guid.CreateVersion7();
        var reason = "El equipo de aire acondicionado no está disponible.";

        Assert.Equal(ServiceClosureFailure.Forbidden, (await closures.RequestAsync(
            contractsId, requestId, service.PublicId, reason, cancellationToken)).Failure);
        Assert.Equal(ServiceClosureFailure.Invalid, (await closures.RequestAsync(
            occId, requestId, service.PublicId, "muy corto", cancellationToken)).Failure);
        var pending = await closures.RequestAsync(occId, requestId, service.PublicId,
            reason, cancellationToken);
        Assert.Equal("Pending", pending.Request!.Status);
        Assert.Equal(pending.Request, (await closures.RequestAsync(occId, requestId,
            service.PublicId, reason, cancellationToken)).Request);
        Assert.Equal(ServiceClosureFailure.Conflict, (await closures.RequestAsync(occId,
            Guid.CreateVersion7(), service.PublicId, reason, cancellationToken)).Failure);
        Assert.Contains((await closures.ListAsync(occId, null, 1, 25, cancellationToken))!.Items,
            item => item.Id == requestId);
        Assert.Equal(ServiceClosureFailure.Forbidden, (await closures.DecideAsync(occId,
            requestId, true, null, pending.Request.Version, null, cancellationToken)).Failure);
        Assert.Equal(ServiceClosureFailure.Invalid, (await closures.DecideAsync(contractsId,
            requestId, false, "corto", pending.Request.Version, null, cancellationToken)).Failure);

        var denied = await closures.DecideAsync(contractsId, requestId, false,
            "La contingencia se resolverá hoy.", pending.Request.Version, null, cancellationToken);
        Assert.Equal("Denied", denied.Request!.Status);
        Assert.Contains((await catalog.GetPublicAsync(cancellationToken)).Services,
            item => item.Id == service.PublicId);

        var approvedRequestId = Guid.CreateVersion7();
        var second = (await closures.RequestAsync(occId, approvedRequestId,
            service.PublicId, reason, cancellationToken)).Request!;
        var occRole = await context.Roles.SingleAsync(item => item.NormalizedName == "ADMIN_OCC",
            cancellationToken);
        var decidePermission = await context.Permissions.SingleAsync(item =>
            item.Code == "commercial.service_closures.decide", cancellationToken);
        context.Set<RolePermissionGrant>().Add(new RolePermissionGrant
        {
            RoleId = occRole.Id, PermissionId = decidePermission.Id,
        });
        await context.SaveChangesAsync(cancellationToken);
        Assert.Equal(ServiceClosureFailure.Forbidden, (await closures.DecideAsync(occId,
            approvedRequestId, true, null, second.Version, null, cancellationToken)).Failure);
        var approved = await closures.DecideAsync(contractsId, approvedRequestId,
            true, null, second.Version, null, cancellationToken);
        Assert.Equal("Approved", approved.Request!.Status);
        Assert.False(approved.Request.IsCurrentlyPublic);
        Assert.DoesNotContain((await catalog.GetPublicAsync(cancellationToken)).Services,
            item => item.Id == service.PublicId);
        Assert.True((await context.ServiceDefinitions.AsNoTracking().SingleAsync(
            item => item.PublicId == service.PublicId, cancellationToken)).IsActive);
        Assert.Equal(ServiceClosureFailure.Conflict, (await closures.DecideAsync(contractsId,
            approvedRequestId, false, "La clausura ya se aprobó.", second.Version, null,
            cancellationToken)).Failure);
        Assert.Equal(approved.Request, (await closures.RequestAsync(occId, approvedRequestId,
            service.PublicId, reason, cancellationToken)).Request);
        // Finance no longer edits the catalog; Contracts is told to republish it from the closure (1-N11).
        Assert.Equal(CatalogMutationFailure.Forbidden, (await management.SaveAsync(
            Guid.Parse("40000000-0000-7000-8000-000000000006"), service.PublicId,
            new ManagedServiceInput(service.Code, service.Name, service.Description!,
                service.DefaultBillingUnit, service.ImageUrl, service.VideoUrl,
                service.DisplayOrder, true, true, approved.Request.ServiceVersion), null,
            cancellationToken)).Failure);
        var republishedByForm = await management.SaveAsync(
            contractsId, service.PublicId,
            new ManagedServiceInput(service.Code, service.Name, service.Description!,
                service.DefaultBillingUnit, service.ImageUrl, service.VideoUrl,
                service.DisplayOrder, true, true, approved.Request.ServiceVersion), null,
            cancellationToken);
        Assert.Equal((CatalogMutationFailure.Conflict, "closure_requires_reopen"),
            (republishedByForm.Failure!.Value, republishedByForm.Code));
        Assert.Equal(ServiceClosureFailure.Invalid, (await closures.ReopenAsync(contractsId,
            service.PublicId, "corto", approved.Request.ServiceVersion, null, cancellationToken)).Failure);
        var reopened = await closures.ReopenAsync(contractsId, service.PublicId,
            "El equipo se reparó y ya está disponible.", approved.Request.ServiceVersion, null,
            cancellationToken);
        Assert.True(reopened.Request!.IsCurrentlyPublic);
        Assert.NotNull(reopened.Request.ReopenedAt);
        Assert.Contains((await catalog.GetPublicAsync(cancellationToken)).Services,
            item => item.Id == service.PublicId);
        var closureHints = (await context.OutboxMessages.AsNoTracking()
            .Where(item => item.EventType == "account.changed.v1")
            .ToArrayAsync(cancellationToken)).Select(AccountChangeOutboxWriter.Decode)
            .Where(item => item.Resource == "service_closures" &&
                item.ResourceId == approvedRequestId).ToArray();
        Assert.NotEmpty(closureHints);
        var catalogHints = (await context.OutboxMessages.AsNoTracking()
            .Where(item => item.EventType == "account.changed.v1")
            .ToArrayAsync(cancellationToken)).Select(AccountChangeOutboxWriter.Decode)
            .Where(item => item.Resource == "commercial_catalog" &&
                item.ResourceId == service.PublicId).ToArray();
        Assert.NotEmpty(catalogHints);

        var edited = await management.SaveAsync(contractsId, service.PublicId,
            new ManagedServiceInput(service.Code, service.Name,
                "Descripcion actualizada para OCC.", service.DefaultBillingUnit,
                service.ImageUrl, service.VideoUrl, service.DisplayOrder, true, true,
                reopened.Request.ServiceVersion), null, cancellationToken);
        Assert.NotNull(edited.Service);
        var occKey = await context.Users.Where(item => item.PublicId == occId)
            .Select(item => item.Id).SingleAsync(cancellationToken);
        var occCatalogHints = (await context.OutboxMessages.AsNoTracking()
            .Where(item => item.EventType == "account.changed.v1")
            .ToArrayAsync(cancellationToken)).Select(AccountChangeOutboxWriter.Decode)
            .Where(item => item.Resource == "commercial_catalog" &&
                item.ResourceId == service.PublicId &&
                item.RecipientAccountId == occKey).ToArray();
        Assert.NotEmpty(occCatalogHints);
        await scope.ServiceProvider.GetRequiredService<IAccountChangeDispatcherStore>()
            .DispatchPendingAsync(100, cancellationToken);
        var occFeed = await scope.ServiceProvider.GetRequiredService<IAccountChangeReadStore>()
            .ReadAsync(occId, 0, 100, cancellationToken);
        Assert.Contains(Assert.IsType<AccountChangePage>(occFeed).Changes,
            item => item.Resource == "commercial_catalog" &&
                item.ResourceId == service.PublicId);
    }

    [Fact]
    public async Task RampMobileAccessRequestIsIdempotentAndRequiresAnExplicitDecision()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
        {
            await migration.Database.MigrateAsync(cancellationToken);
            Assert.False(migration.Database.HasPendingModelChanges());
        }
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seed = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seed).SeedAsync(new DevelopmentAccountPasswords(
                InitialPasswords.AdminOcc, InitialPasswords.RampAgent,
                InitialPasswords.AirlineClient, InitialPasswords.HumanResources,
                InitialPasswords.Contracts, InitialPasswords.Finance,
                "Synthetic-SuperAdmin!789"), cancellationToken);

        await using var provider = new ServiceCollection().AddLogging()
            .AddSingleton<TimeProvider>(TimeProvider.System)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString,
                }).Build()).BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var profiles = scope.ServiceProvider.GetRequiredService<IRampProfileStore>();
        var requests = scope.ServiceProvider.GetRequiredService<IRampMobileAccessRequestStore>();
        var governance = scope.ServiceProvider.GetRequiredService<IGovernanceStore>();
        var humanResourcesId = Guid.Parse("40000000-0000-7000-8000-000000000004");
        var superAdminId = Guid.Parse("40000000-0000-7000-8000-000000000007");
        var contractsId = Guid.Parse("40000000-0000-7000-8000-000000000005");
        var humanResourcesRole = Assert.Single((await governance.GetAsync(superAdminId,
            cancellationToken))!.Roles, item => item.Code == "GESTION_HUMANA");
        var secondHumanResources = await governance.CreateUserAsync(superAdminId,
            new CreateGovernanceUserInput("Ana", "Prueba", "ana-hr@example.test",
                humanResourcesRole.Id, "Synthetic-Hr!5678"), cancellationToken);
        Assert.True(secondHumanResources.IsSuccess);
        var station = await context.Stations.SingleAsync(item => item.Code == "PUJ",
            cancellationToken);
        var profileInput = new SaveRampProfileInput("Lucia", "Ramos",
            "SYNTHETIC-MOBILE-REQ", "Ramp agent",
            DateOnly.FromDateTime(DateTime.UtcNow), true, [station.PublicId]);
        var profile = (await profiles.SaveAsync(humanResourcesId, null,
            profileInput, cancellationToken)).Profile!;
        Assert.DoesNotContain((await requests.ListForHumanResourcesAsync(humanResourcesId,
            cancellationToken))!, item => item.RampProfileId == profile.Id);
        var requestId = Guid.CreateVersion7();
        Assert.Equal(MobileAccessRequestFailure.Forbidden, (await requests.RequestAsync(
            contractsId, profile.Id, requestId, cancellationToken)).Failure);
        var pending = await requests.RequestAsync(humanResourcesId, profile.Id,
            requestId, cancellationToken);
        Assert.Null(pending.Failure);
        Assert.Equal("Pending", pending.Request!.Status);
        Assert.Equal(pending.Request, (await requests.RequestAsync(humanResourcesId,
            profile.Id, requestId, cancellationToken)).Request);
        Assert.Equal(MobileAccessRequestFailure.Conflict, (await requests.RequestAsync(
            humanResourcesId, profile.Id, Guid.CreateVersion7(), cancellationToken)).Failure);
        Assert.Null(await requests.ListForGovernanceAsync(contractsId, cancellationToken));
        Assert.Contains((await requests.ListForGovernanceAsync(superAdminId,
            cancellationToken))!, item => item.Id == requestId && item.Status == "Pending");
        Assert.Equal(MobileAccessRequestFailure.Forbidden, (await requests.RejectAsync(
            contractsId, requestId, "No procede", pending.Request.Version, cancellationToken)).Failure);
        Assert.Equal(MobileAccessRequestFailure.Conflict, (await requests.RejectAsync(
            superAdminId, requestId, "No procede", "stale-request-version", cancellationToken)).Failure);
        var rejected = await requests.RejectAsync(superAdminId, requestId,
            "Datos por revisar", pending.Request.Version, cancellationToken);
        Assert.Equal("Rejected", rejected.Request!.Status);
        Assert.Equal("Datos por revisar", rejected.Request.DecisionReason);
        Assert.NotNull(rejected.Request.DecidedAt);
        Assert.Equal(rejected.Request, (await requests.RejectAsync(superAdminId,
            requestId, "Datos por revisar", pending.Request.Version, cancellationToken)).Request);
        var renewedId = Guid.CreateVersion7();
        var renewed = (await requests.RequestAsync(humanResourcesId,
            profile.Id, renewedId, cancellationToken)).Request!;
        Assert.Equal("Pending", renewed.Status);

        var rampRole = Assert.Single((await governance.GetAsync(superAdminId,
            cancellationToken))!.Roles, item => item.Code == "RAMP_AGENT");
        Assert.Equal(GovernanceFailure.Conflict, (await governance.CreateUserAsync(superAdminId,
            new CreateGovernanceUserInput("Lucia", "Ramos", "bypass-mobile@example.test",
                rampRole.Id, "Synthetic-Ramp!5678", profile.Id), cancellationToken)).Failure);
        Assert.Null((await profiles.SaveAsync(humanResourcesId, profile.Id,
            profileInput with { IsActive = false }, cancellationToken)).Failure);
        Assert.Equal(GovernanceFailure.Conflict, (await governance.CreateUserAsync(superAdminId,
            new CreateGovernanceUserInput("Lucia", "Ramos", "inactive-mobile@example.test",
                rampRole.Id, "Synthetic-Ramp!5678", profile.Id,
                AccessRequestId: renewedId, AccessRequestVersion: renewed.Version,
                ExpectedRampProfileVersion: "stale-profile-version",
                ExpectedStationCodes: ["PUJ"]), cancellationToken)).Failure);
        Assert.Null((await profiles.SaveAsync(humanResourcesId, profile.Id,
            profileInput, cancellationToken)).Failure);
        var reviewedProfile = Assert.Single((await governance.GetAsync(superAdminId,
            cancellationToken))!.RampProfiles, item => item.Id == profile.Id);
        var reviewedRequest = Assert.Single((await requests.ListForGovernanceAsync(superAdminId,
            cancellationToken))!, item => item.Id == renewedId);
        var extraAirport = await context.Airports.SingleAsync(item => item.IataCode == "MIA",
            cancellationToken);
        var extraStation = new Station
        {
            PublicId = Guid.CreateVersion7(), AirportId = extraAirport.Id,
            Code = "MIA", Name = "Synthetic test station",
            IanaTimeZone = "America/Santo_Domingo", IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        context.Stations.Add(extraStation);
        await context.SaveChangesAsync(cancellationToken);
        Assert.Null((await profiles.SaveAsync(humanResourcesId, profile.Id,
            profileInput with { StationIds = [station.PublicId, extraStation.PublicId] },
            cancellationToken)).Failure);
        var staleApproval = new CreateGovernanceUserInput("Lucia", "Ramos",
            "lucia-mobile@example.test", rampRole.Id, "Synthetic-Ramp!5678", profile.Id,
            AccessRequestId: renewedId, AccessRequestVersion: reviewedRequest.Version,
            ExpectedRampProfileVersion: reviewedProfile.Version,
            ExpectedStationCodes: reviewedProfile.Stations);
        Assert.Equal(GovernanceFailure.Conflict, (await governance.CreateUserAsync(superAdminId,
            staleApproval, cancellationToken)).Failure);
        reviewedProfile = Assert.Single((await governance.GetAsync(superAdminId,
            cancellationToken))!.RampProfiles, item => item.Id == profile.Id);
        var approval = new CreateGovernanceUserInput("Lucia", "Ramos", "lucia-mobile@example.test",
            rampRole.Id, "Synthetic-Ramp!5678", profile.Id,
            AccessRequestId: renewedId, AccessRequestVersion: reviewedRequest.Version,
            ExpectedRampProfileVersion: reviewedProfile.Version,
            ExpectedStationCodes: reviewedProfile.Stations);
        var created = await governance.CreateUserAsync(superAdminId,
            approval, cancellationToken);
        Assert.True(created.IsSuccess, created.Failure?.ToString());
        Assert.Equal(created.Id, (await governance.CreateUserAsync(superAdminId,
            approval, cancellationToken)).Id);
        Assert.Equal(GovernanceFailure.Conflict, (await governance.CreateUserAsync(superAdminId,
            approval with { TemporaryPassword = "Different-Ramp!5678" }, cancellationToken)).Failure);
        Assert.Equal(MobileAccessRequestFailure.Conflict, (await requests.RejectAsync(
            superAdminId, renewedId, "Too late", reviewedRequest.Version,
            cancellationToken)).Failure);
        Assert.Contains((await requests.ListForHumanResourcesAsync(humanResourcesId,
            cancellationToken))!, item => item.Id == renewedId &&
                item.Status == "Fulfilled" && item.AccountId == created.Id);
        var requesterKey = await context.Users.Where(item => item.PublicId == humanResourcesId)
            .Select(item => item.Id).SingleAsync(cancellationToken);
        var approverKey = await context.Users.Where(item => item.PublicId == superAdminId)
            .Select(item => item.Id).SingleAsync(cancellationToken);
        var secondHumanResourcesKey = await context.Users.Where(item =>
            item.PublicId == secondHumanResources.Id).Select(item => item.Id)
            .SingleAsync(cancellationToken);
        var hints = (await context.OutboxMessages.AsNoTracking()
            .Where(item => item.EventType == "account.changed.v1")
            .ToArrayAsync(cancellationToken)).Select(AccountChangeOutboxWriter.Decode)
            .Where(item => item.Resource == "ramp_mobile_access_requests" &&
                item.ResourceId == renewedId).ToArray();
        Assert.Contains(hints, item => item.RecipientAccountId == requesterKey);
        Assert.Contains(hints, item => item.RecipientAccountId == approverKey);
        Assert.Contains(hints, item => item.RecipientAccountId == secondHumanResourcesKey);
        Assert.Equal(GovernanceFailure.Conflict, (await governance.CreateUserAsync(superAdminId,
            approval with { Email = "other-mobile@example.test" }, cancellationToken)).Failure);

        var racingProfile = (await profiles.SaveAsync(humanResourcesId, null,
            profileInput with { EmployeeNumber = "SYNTHETIC-MOBILE-RACE" },
            cancellationToken)).Profile!;
        var racingId = Guid.CreateVersion7();
        var racingRequest = (await requests.RequestAsync(humanResourcesId,
            racingProfile.Id, racingId, cancellationToken)).Request!;
        var racingReview = Assert.Single((await governance.GetAsync(superAdminId,
            cancellationToken))!.RampProfiles, item => item.Id == racingProfile.Id);
        var racingApproval = approval with
        {
            Email = "lucia-race@example.test", RampAgentId = racingProfile.Id,
            AccessRequestId = racingId, AccessRequestVersion = racingRequest.Version,
            ExpectedRampProfileVersion = racingReview.Version,
            ExpectedStationCodes = racingReview.Stations,
        };
        await using var approvalScope = provider.CreateAsyncScope();
        await using var rejectionScope = provider.CreateAsyncScope();
        var approveTask = approvalScope.ServiceProvider.GetRequiredService<IGovernanceStore>()
            .CreateUserAsync(superAdminId, racingApproval, cancellationToken);
        var rejectTask = rejectionScope.ServiceProvider.GetRequiredService<IRampMobileAccessRequestStore>()
            .RejectAsync(superAdminId, racingId, "Race rejected", racingRequest.Version,
                cancellationToken);
        await Task.WhenAll(approveTask, rejectTask);
        var approvalOutcome = await approveTask;
        var rejectionOutcome = await rejectTask;
        Assert.Equal(1, new[] { approvalOutcome.IsSuccess,
            rejectionOutcome.Failure is null }.Count(success => success));
        var raceState = Assert.Single((await requests.ListForGovernanceAsync(superAdminId,
            cancellationToken))!, item => item.Id == racingId);
        Assert.Equal(approvalOutcome.IsSuccess ? "Fulfilled" : "Rejected", raceState.Status);

        var duplicateProfile = (await profiles.SaveAsync(humanResourcesId, null,
            profileInput with { EmployeeNumber = "SYNTHETIC-MOBILE-DOUBLE" },
            cancellationToken)).Profile!;
        var duplicateId = Guid.CreateVersion7();
        var duplicateRequest = (await requests.RequestAsync(humanResourcesId,
            duplicateProfile.Id, duplicateId, cancellationToken)).Request!;
        var duplicateReview = Assert.Single((await governance.GetAsync(superAdminId,
            cancellationToken))!.RampProfiles, item => item.Id == duplicateProfile.Id);
        var duplicateApproval = approval with
        {
            Email = "lucia-double@example.test", RampAgentId = duplicateProfile.Id,
            AccessRequestId = duplicateId, AccessRequestVersion = duplicateRequest.Version,
            ExpectedRampProfileVersion = duplicateReview.Version,
            ExpectedStationCodes = duplicateReview.Stations,
        };
        await using var firstApprovalScope = provider.CreateAsyncScope();
        await using var secondApprovalScope = provider.CreateAsyncScope();
        var firstApproval = firstApprovalScope.ServiceProvider.GetRequiredService<IGovernanceStore>()
            .CreateUserAsync(superAdminId, duplicateApproval, cancellationToken);
        var secondApproval = secondApprovalScope.ServiceProvider.GetRequiredService<IGovernanceStore>()
            .CreateUserAsync(superAdminId, duplicateApproval, cancellationToken);
        await Task.WhenAll(firstApproval, secondApproval);
        Assert.True((await firstApproval).IsSuccess);
        Assert.Equal((await firstApproval).Id, (await secondApproval).Id);
        Assert.Single(await context.Users.AsNoTracking().Where(item =>
            item.NormalizedEmail == "LUCIA-DOUBLE@EXAMPLE.TEST")
            .ToArrayAsync(cancellationToken));

        var inactiveStationProfile = (await profiles.SaveAsync(humanResourcesId, null,
            profileInput with
            {
                EmployeeNumber = "SYN-MOBILE-INACTIVE-STATION",
                StationIds = [extraStation.PublicId],
            }, cancellationToken)).Profile!;
        var stationToDeactivate = await context.Stations.SingleAsync(item =>
            item.PublicId == extraStation.PublicId, cancellationToken);
        stationToDeactivate.IsActive = false;
        await context.SaveChangesAsync(cancellationToken);
        Assert.Equal(GovernanceFailure.Conflict, (await governance.CreateUserAsync(superAdminId,
            new CreateGovernanceUserInput("Lucia", "Ramos",
                "inactive-station-mobile@example.test", rampRole.Id,
                "Synthetic-Ramp!5678", inactiveStationProfile.Id), cancellationToken)).Failure);
    }

    [Fact]
    public async Task ExplicitDevelopmentScenarioSeedsLocalDatesAndPreservesWorkedOperations()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        var localDate = new DateOnly(2026, 9, 28);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seed = CreateContext(seederConnection))
        {
            await new DevelopmentDataSeeder(seed).SeedAsync(InitialPasswords, cancellationToken);
            await new DevelopmentScenarioSeeder(seed).SeedAsync(localDate, cancellationToken);
        }

        await using (var inspection = CreateContext(database.ConnectionString))
        {
            var rows = await inspection.Turnarounds.AsNoTracking()
                .Where(item => item.OperationCode.StartsWith("DEV-CYCLE-202609"))
                .OrderBy(item => item.OperationDate).ToArrayAsync(cancellationToken);
            Assert.Equal(2, rows.Length);
            Assert.Equal([localDate, localDate.AddDays(1)], rows.Select(item => item.OperationDate));
            Assert.All(rows, item => Assert.Equal(TurnaroundStatus.Confirmed, item.CurrentStatus));
            foreach (var row in rows)
            {
                var operation = await inspection.GroundOperations.AsNoTracking()
                    .SingleAsync(item => item.TurnaroundId == row.Id, cancellationToken);
                Assert.Equal(GroundOperationStatus.Planned, operation.CurrentStatus);
                var services = await inspection.OperationServices.AsNoTracking()
                    .Where(item => item.GroundOperationId == operation.Id)
                    .OrderBy(item => item.LineNumber).ToArrayAsync(cancellationToken);
                Assert.Equal(2, services.Length);
                Assert.Equal([125.50m, 95.00m], services.Select(item => item.UnitPriceSnapshot));
                Assert.All(services, item =>
                {
                    Assert.Equal("USD", item.CurrencyCodeSnapshot);
                    Assert.Equal("operation", item.BillingUnitSnapshot);
                    Assert.Equal(1m, item.ContractedQuantity);
                    Assert.Equal(0m, item.ExecutedQuantity);
                    Assert.Equal(ServiceExecutionStatus.Planned, item.CurrentStatus);
                });
                var legs = await inspection.FlightLegs.AsNoTracking()
                    .Where(item => item.TurnaroundId == row.Id).ToArrayAsync(cancellationToken);
                Assert.Equal(2, legs.Length);
                Assert.All(legs, item => Assert.Equal(row.OperationDate,
                    DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(item.ScheduledAt,
                        TimeZoneInfo.FindSystemTimeZoneById("America/Santo_Domingo")).DateTime)));
                Assert.True(await inspection.ShiftAssignments.AsNoTracking()
                    .AnyAsync(item => item.WorkDate == row.OperationDate &&
                        item.StartsAtLocal <= new TimeOnly(8, 0) &&
                        item.EndsAtLocal >= new TimeOnly(10, 0), cancellationToken));
            }
        }

        await using (var edit = CreateContext(database.ConnectionString))
        {
            var first = await edit.Turnarounds.SingleAsync(
                item => item.OperationCode == "DEV-CYCLE-20260928", cancellationToken);
            first.AircraftRegistration = "HI-CHANGED";
            await edit.SaveChangesAsync(cancellationToken);
        }
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seed = CreateContext(seederConnection))
            await new DevelopmentScenarioSeeder(seed).SeedAsync(localDate, cancellationToken);
        await using (var final = CreateContext(database.ConnectionString))
        {
            Assert.Equal(2, await final.Turnarounds.AsNoTracking()
                .CountAsync(item => item.OperationCode.StartsWith("DEV-CYCLE-202609"),
                    cancellationToken));
            Assert.Equal("HI-CHANGED", (await final.Turnarounds.AsNoTracking()
                .SingleAsync(item => item.OperationCode == "DEV-CYCLE-20260928",
                    cancellationToken)).AircraftRegistration);
        }
    }

    [Fact]
    public async Task ExplicitDevelopmentScenarioRollsBackIfAnExistingShiftCannotCoverIt()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seed = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seed).SeedAsync(InitialPasswords, cancellationToken);
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var agentId = await setup.RampAgents.Where(item => item.EmployeeNumber == "DEV-RA-001")
                .Select(item => item.Id).SingleAsync(cancellationToken);
            var stationId = await setup.Stations.Where(item => item.Code == "PUJ")
                .Select(item => item.Id).SingleAsync(cancellationToken);
            var terminalId = await setup.Terminals.Where(item => item.StationId == stationId &&
                item.Code == "A").Select(item => item.Id).SingleAsync(cancellationToken);
            var now = new DateTimeOffset(2026, 9, 20, 12, 0, 0, TimeSpan.Zero);
            setup.ShiftAssignments.Add(new ShiftAssignment
            {
                PublicId = Guid.NewGuid(), RampAgentId = agentId, StationId = stationId,
                TerminalId = terminalId, WorkDate = new DateOnly(2026, 9, 29),
                StartsAtLocal = new TimeOnly(4, 0), EndsAtLocal = new TimeOnly(7, 0),
                Block = ShiftBlock.Morning, CreatedAt = now, UpdatedAt = now,
            });
            await setup.SaveChangesAsync(cancellationToken);
        }
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seed = CreateContext(seederConnection))
            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                new DevelopmentScenarioSeeder(seed).SeedAsync(new DateOnly(2026, 9, 28),
                    cancellationToken));
        await using (var inspection = CreateContext(database.ConnectionString))
        {
            Assert.False(await inspection.Turnarounds.AsNoTracking()
                .AnyAsync(item => item.OperationCode.StartsWith("DEV-CYCLE-"),
                    cancellationToken));
            Assert.False(await inspection.ShiftAssignments.AsNoTracking()
                .AnyAsync(item => item.WorkDate == new DateOnly(2026, 9, 28),
                    cancellationToken));
        }
    }

    [Fact]
    public async Task ExplicitDevelopmentScenarioRejectsAnOccupiedStandWithoutWritingPartialRows()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seed = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seed).SeedAsync(InitialPasswords, cancellationToken);
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var airlineId = await setup.Airlines.Where(item => item.IataCode == "ZZ")
                .Select(item => item.Id).SingleAsync(cancellationToken);
            var stationId = await setup.Stations.Where(item => item.Code == "PUJ")
                .Select(item => item.Id).SingleAsync(cancellationToken);
            var standId = await setup.Stands.Where(item => item.StationId == stationId &&
                item.Code == "A01").Select(item => item.Id).SingleAsync(cancellationToken);
            var now = new DateTimeOffset(2026, 9, 20, 12, 0, 0, TimeSpan.Zero);
            var other = new Turnaround
            {
                PublicId = Guid.NewGuid(), OperationCode = "DEV-OTHER-20260928",
                AirlineId = airlineId, StationId = stationId,
                OperationDate = new DateOnly(2026, 9, 27),
                CurrentStatus = TurnaroundStatus.Confirmed,
                Source = OperationalDataSource.Internal,
                CreatedAt = now, UpdatedAt = now,
            };
            setup.Turnarounds.Add(other);
            await setup.SaveChangesAsync(cancellationToken);
            setup.Set<StandAssignment>().Add(new StandAssignment
            {
                PublicId = Guid.NewGuid(), TurnaroundId = other.Id, StandId = standId,
                AssignedFrom = now, CreatedAt = now, UpdatedAt = now,
            });
            setup.GroundOperations.Add(new GroundOperation
            {
                PublicId = Guid.NewGuid(), TurnaroundId = other.Id,
                CurrentStatus = GroundOperationStatus.Planned,
                PlannedStartAt = new DateTimeOffset(2026, 9, 28, 11, 30, 0, TimeSpan.Zero),
                PlannedEndAt = new DateTimeOffset(2026, 9, 28, 13, 0, 0, TimeSpan.Zero),
                CreatedAt = now, UpdatedAt = now,
            });
            await setup.SaveChangesAsync(cancellationToken);
        }
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seed = CreateContext(seederConnection))
            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                new DevelopmentScenarioSeeder(seed).SeedAsync(new DateOnly(2026, 9, 28),
                    cancellationToken));
        await using var inspection = CreateContext(database.ConnectionString);
        Assert.False(await inspection.Turnarounds.AsNoTracking()
            .AnyAsync(item => item.OperationCode.StartsWith("DEV-CYCLE-"),
                cancellationToken));
        Assert.False(await inspection.ShiftAssignments.AsNoTracking()
            .AnyAsync(item => item.WorkDate == new DateOnly(2026, 9, 28),
                cancellationToken));
    }

    [Fact]
    public async Task ExplicitDevelopmentScenarioAllowsASeparatedEveningStandWindow()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seed = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seed).SeedAsync(InitialPasswords, cancellationToken);
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var airlineId = await setup.Airlines.Where(item => item.IataCode == "ZZ")
                .Select(item => item.Id).SingleAsync(cancellationToken);
            var stationId = await setup.Stations.Where(item => item.Code == "PUJ")
                .Select(item => item.Id).SingleAsync(cancellationToken);
            var standId = await setup.Stands.Where(item => item.StationId == stationId &&
                item.Code == "A01").Select(item => item.Id).SingleAsync(cancellationToken);
            var now = new DateTimeOffset(2026, 9, 20, 12, 0, 0, TimeSpan.Zero);
            var other = new Turnaround
            {
                PublicId = Guid.NewGuid(), OperationCode = "DEV-EVENING-20260928",
                AirlineId = airlineId, StationId = stationId,
                OperationDate = new DateOnly(2026, 9, 28),
                CurrentStatus = TurnaroundStatus.Confirmed,
                Source = OperationalDataSource.Internal,
                CreatedAt = now, UpdatedAt = now,
            };
            setup.Turnarounds.Add(other);
            await setup.SaveChangesAsync(cancellationToken);
            setup.Set<StandAssignment>().Add(new StandAssignment
            {
                PublicId = Guid.NewGuid(), TurnaroundId = other.Id, StandId = standId,
                AssignedFrom = new DateTimeOffset(2026, 9, 28, 22, 0, 0, TimeSpan.Zero),
                CreatedAt = now, UpdatedAt = now,
            });
            setup.GroundOperations.Add(new GroundOperation
            {
                PublicId = Guid.NewGuid(), TurnaroundId = other.Id,
                CurrentStatus = GroundOperationStatus.Planned,
                PlannedStartAt = new DateTimeOffset(2026, 9, 28, 22, 0, 0, TimeSpan.Zero),
                PlannedEndAt = new DateTimeOffset(2026, 9, 29, 0, 0, 0, TimeSpan.Zero),
                CreatedAt = now, UpdatedAt = now,
            });
            await setup.SaveChangesAsync(cancellationToken);
        }
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seed = CreateContext(seederConnection))
            await new DevelopmentScenarioSeeder(seed).SeedAsync(new DateOnly(2026, 9, 28),
                cancellationToken);
        await using var inspection = CreateContext(database.ConnectionString);
        Assert.Equal(2, await inspection.Turnarounds.AsNoTracking().CountAsync(item =>
            item.OperationCode.StartsWith("DEV-CYCLE-"), cancellationToken));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task ExplicitDevelopmentScenarioRejectsInapplicableContractDates(bool signedTooLate)
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seed = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seed).SeedAsync(InitialPasswords, cancellationToken);
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var contract = await setup.Contracts.SingleAsync(item =>
                item.ContractCode == "DEV-CONTRACT-0001", cancellationToken);
            if (signedTooLate) contract.SignedOn = new DateOnly(2026, 9, 29);
            else contract.TerminatedOn = new DateOnly(2026, 9, 28);
            await setup.SaveChangesAsync(cancellationToken);
        }
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seed = CreateContext(seederConnection))
            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                new DevelopmentScenarioSeeder(seed).SeedAsync(new DateOnly(2026, 9, 28),
                    cancellationToken));
        await using var inspection = CreateContext(database.ConnectionString);
        Assert.False(await inspection.Turnarounds.AsNoTracking().AnyAsync(item =>
            item.OperationCode.StartsWith("DEV-CYCLE-"), cancellationToken));
        Assert.False(await inspection.ShiftAssignments.AsNoTracking().AnyAsync(item =>
            item.WorkDate == new DateOnly(2026, 9, 28), cancellationToken));
    }

    [Fact]
    public async Task ExplicitDevelopmentScenarioRejectsStandOutsideTheAgentTerminal()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seed = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seed).SeedAsync(InitialPasswords, cancellationToken);
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var stand = await setup.Stands.SingleAsync(item => item.Code == "A01",
                cancellationToken);
            stand.TerminalId = null;
            await setup.SaveChangesAsync(cancellationToken);
        }
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seed = CreateContext(seederConnection))
            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                new DevelopmentScenarioSeeder(seed).SeedAsync(new DateOnly(2026, 9, 28),
                    cancellationToken));
        await using var inspection = CreateContext(database.ConnectionString);
        Assert.False(await inspection.Turnarounds.AsNoTracking().AnyAsync(item =>
            item.OperationCode.StartsWith("DEV-CYCLE-"), cancellationToken));
    }

    [Fact]
    public async Task ExplicitDevelopmentScenarioIsForbiddenOnProductionMarker()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Production", cancellationToken);
        await using var context = CreateContext(database.ConnectionString);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            new DevelopmentScenarioSeeder(context).SeedAsync(new DateOnly(2026, 9, 28),
                cancellationToken));
    }

    [Fact]
    public async Task HumanResourcesShiftsReadBoundedMonthForLiveInternalRole()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migrationContext = CreateContext(database.ConnectionString))
            await migrationContext.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seederContext = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seederContext).SeedAsync(new DevelopmentAccountPasswords(
                InitialPasswords.AdminOcc, InitialPasswords.RampAgent,
                InitialPasswords.AirlineClient, InitialPasswords.HumanResources,
                InitialPasswords.Contracts, InitialPasswords.Finance,
                "Synthetic-SuperAdmin!234"), cancellationToken);

        await using var provider = new ServiceCollection().AddLogging()
            .AddSingleton<TimeProvider>(TimeProvider.System)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                { ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString }).Build())
            .BuildServiceProvider();
        var hrId = Guid.Parse("40000000-0000-7000-8000-000000000004");
        var occId = Guid.Parse("40000000-0000-7000-8000-000000000001");
        var superAdminId = Guid.Parse("40000000-0000-7000-8000-000000000007");
        var monday = new DateOnly(2026, 8, 17);
        var sunday = monday.AddDays(6);
        await using (var scope = provider.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<IHumanResourcesShiftReadStore>();
            var first = await store.ListAsync(hrId, monday, sunday, 1, 1, cancellationToken);
            Assert.NotNull(first);
            Assert.True(first.HasMore);
            var shift = Assert.Single(first.Shifts);
            Assert.Equal(Guid.Parse("50000000-0000-7000-8000-000000000005"), shift.Id);
            Assert.Equal("DEV-RA-001", shift.EmployeeNumber);
            Assert.Equal("PUJ", shift.StationCode);
            Assert.Equal("Morning", shift.Block);
            Assert.Equal(new TimeOnly(6, 0), shift.StartsAtLocal);
            Assert.Equal(new TimeOnly(14, 0), shift.EndsAtLocal);
            var agentId = Guid.Parse("50000000-0000-7000-8000-000000000001");
            var available = await store.GetAssignmentOptionsAsync(hrId, agentId,
                new DateOnly(2026, 8, 20), cancellationToken);
            Assert.NotNull(available);
            Assert.False(available.HasShift);
            var station = Assert.Single(available.Stations);
            Assert.Equal("PUJ", station.Code);
            Assert.Equal("A", Assert.Single(station.Terminals).Code);
            Assert.True((await store.GetAssignmentOptionsAsync(hrId, agentId,
                new DateOnly(2026, 8, 18), cancellationToken))!.HasShift);
            Assert.Empty((await store.GetAssignmentOptionsAsync(hrId, agentId,
                new DateOnly(2025, 12, 31), cancellationToken))!.Stations);
            Assert.Null(await store.GetAssignmentOptionsAsync(occId, agentId,
                new DateOnly(2026, 8, 20), cancellationToken));
            var second = await store.ListAsync(hrId, monday, sunday, 2, 1, cancellationToken);
            Assert.NotNull(second);
            Assert.False(second.HasMore);
            Assert.Equal(new DateOnly(2026, 8, 19), Assert.Single(second.Shifts).WorkDate);
            var month = await store.ListAsync(hrId, new DateOnly(2026, 8, 1),
                new DateOnly(2026, 8, 31), 1, 20, cancellationToken);
            Assert.NotNull(month);
            Assert.Equal(2, month.Shifts.Count);
            Assert.Equal(new DateOnly(2026, 8, 1), month.From);
            Assert.Equal(new DateOnly(2026, 8, 31), month.To);
            await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => store.ListAsync(
                hrId, new DateOnly(2026, 8, 1), new DateOnly(2026, 9, 1),
                1, 20, cancellationToken));
            Assert.Empty((await store.ListAsync(hrId, monday.AddDays(7),
                sunday.AddDays(7), 1, 20, cancellationToken))!.Shifts);
            Assert.Null(await store.ListAsync(occId, monday, sunday, 1, 20,
                cancellationToken));
            Assert.Equal(2, (await store.ListAsync(superAdminId, monday, sunday,
                1, 20, cancellationToken))!.Shifts.Count);
        }

        await using (var context = CreateContext(database.ConnectionString))
        {
            var hrKey = await context.Users.Where(user => user.PublicId == hrId)
                .Select(user => user.Id).SingleAsync(cancellationToken);
            var roleKey = await context.Roles.Where(role => role.NormalizedName == "GESTION_HUMANA")
                .Select(role => role.Id).SingleAsync(cancellationToken);
            await context.Set<IdentityUserRole<long>>().Where(link => link.UserId == hrKey &&
                link.RoleId == roleKey).ExecuteDeleteAsync(cancellationToken);
        }
        await using (var scope = provider.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<IHumanResourcesShiftReadStore>();
            Assert.Null(await store.ListAsync(hrId, monday, sunday, 1, 20,
                cancellationToken));
            Assert.Null(await store.GetAssignmentOptionsAsync(hrId,
                Guid.Parse("50000000-0000-7000-8000-000000000001"),
                new DateOnly(2026, 8, 20), cancellationToken));
        }
    }

    [Fact]
    public async Task HumanResourcesAvailabilityReadIsBoundedPagedAndRevocationSafe()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seed = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seed).SeedAsync(new DevelopmentAccountPasswords(
                InitialPasswords.AdminOcc, InitialPasswords.RampAgent,
                InitialPasswords.AirlineClient, InitialPasswords.HumanResources,
                InitialPasswords.Contracts, InitialPasswords.Finance,
                "Synthetic-SuperAdmin!234"), cancellationToken);
        var hrId = Guid.Parse("40000000-0000-7000-8000-000000000004");
        var occId = Guid.Parse("40000000-0000-7000-8000-000000000001");
        var superAdminId = Guid.Parse("40000000-0000-7000-8000-000000000007");
        var monday = new DateOnly(2026, 8, 17);
        var sunday = monday.AddDays(6);
        var firstId = Guid.NewGuid();
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var agentId = await setup.RampAgents.Where(agent =>
                agent.EmployeeNumber == "DEV-RA-001").Select(agent => agent.Id)
                .SingleAsync(cancellationToken);
            var hrKey = await setup.Users.Where(user => user.PublicId == hrId)
                .Select(user => user.Id).SingleAsync(cancellationToken);
            var now = new DateTimeOffset(2026, 8, 17, 12, 0, 0, TimeSpan.Zero);
            setup.AvailabilityRequests.AddRange(
                new AvailabilityRequest
                {
                    PublicId = firstId, RampAgentId = agentId,
                    StartsOn = monday, EndsOn = monday.AddDays(1),
                    Type = AvailabilityRequestType.DayOff,
                    Status = AvailabilityRequestStatus.Approved,
                    Reason = "Synthetic leave", RequestedAt = now,
                    ResolvedAt = now.AddMinutes(1), ResolvedByAccountId = hrKey,
                    CreatedAt = now, UpdatedAt = now,
                },
                new AvailabilityRequest
                {
                    PublicId = Guid.NewGuid(), RampAgentId = agentId,
                    StartsOn = monday.AddDays(4), EndsOn = sunday.AddDays(2),
                    Type = AvailabilityRequestType.Restriction,
                    Status = AvailabilityRequestStatus.Pending,
                    Reason = "Synthetic restriction", RequestedAt = now,
                    CreatedAt = now, UpdatedAt = now,
                },
                new AvailabilityRequest
                {
                    PublicId = Guid.NewGuid(), RampAgentId = agentId,
                    StartsOn = sunday.AddDays(1), EndsOn = sunday.AddDays(2),
                    Type = AvailabilityRequestType.DayOff,
                    Status = AvailabilityRequestStatus.Pending,
                    Reason = "Outside query", RequestedAt = now,
                    CreatedAt = now, UpdatedAt = now,
                });
            await setup.SaveChangesAsync(cancellationToken);
        }
        await using var provider = new ServiceCollection().AddLogging()
            .AddSingleton<TimeProvider>(TimeProvider.System)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                { ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString }).Build())
            .BuildServiceProvider();
        await using (var scope = provider.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<IHumanResourcesAvailabilityReadStore>();
            var first = await store.ListAsync(hrId, monday, sunday, 1, 1,
                cancellationToken);
            Assert.NotNull(first);
            Assert.True(first.HasMore);
            var request = Assert.Single(first.Requests);
            Assert.Equal(firstId, request.Id);
            Assert.Equal("DEV-RA-001", request.EmployeeNumber);
            Assert.Equal("DayOff", request.Type);
            Assert.Equal("Approved", request.Status);
            var second = await store.ListAsync(hrId, monday, sunday, 2, 1,
                cancellationToken);
            Assert.NotNull(second);
            Assert.False(second.HasMore);
            Assert.Equal("Restriction", Assert.Single(second.Requests).Type);
            Assert.Null(await store.ListAsync(occId, monday, sunday, 1, 20,
                cancellationToken));
            Assert.Equal(2, (await store.ListAsync(superAdminId, monday, sunday,
                1, 20, cancellationToken))!.Requests.Count);
        }
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var hrKey = await setup.Users.Where(user => user.PublicId == hrId)
                .Select(user => user.Id).SingleAsync(cancellationToken);
            var roleKey = await setup.Roles.Where(role => role.NormalizedName == "GESTION_HUMANA")
                .Select(role => role.Id).SingleAsync(cancellationToken);
            await setup.Set<IdentityUserRole<long>>().Where(link => link.UserId == hrKey &&
                link.RoleId == roleKey).ExecuteDeleteAsync(cancellationToken);
        }
        await using (var scope = provider.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<IHumanResourcesAvailabilityReadStore>();
            Assert.Null(await store.ListAsync(hrId, monday, sunday, 1, 20,
                cancellationToken));
        }
    }

    [Fact]
    public async Task HumanResourcesAvailabilityWriteReplaysResolvesAndRejectsActiveAssignment()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seed = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seed).SeedAsync(InitialPasswords, cancellationToken);
        await using var provider = new ServiceCollection().AddLogging()
            .AddSingleton<TimeProvider>(TimeProvider.System)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                { ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString }).Build())
            .BuildServiceProvider();
        var hrId = Guid.Parse("40000000-0000-7000-8000-000000000004");
        var occId = Guid.Parse("40000000-0000-7000-8000-000000000001");
        var agentId = Guid.Parse("50000000-0000-7000-8000-000000000001");
        var firstId = Guid.NewGuid();
        var date = new DateOnly(2031, 2, 4);
        var input = new RecordHumanResourcesAvailabilityInput(agentId, date,
            date.AddDays(1), "DayOff", "Synthetic planned leave");
        await using (var scope = provider.CreateAsyncScope())
        {
            var store = scope.ServiceProvider
                .GetRequiredService<IHumanResourcesAvailabilityWriteStore>();
            Assert.Equal(HumanResourcesAvailabilityWriteFailure.Forbidden,
                (await store.RecordAsync(occId, firstId, input, cancellationToken)).Failure);
            Assert.Equal(HumanResourcesAvailabilityWriteFailure.Invalid,
                (await store.RecordAsync(hrId, firstId, input with
                { EndsOn = date.AddDays(31) }, cancellationToken)).Failure);
            Assert.Null((await store.RecordAsync(hrId, firstId, input,
                cancellationToken)).Failure);
            Assert.Null((await store.RecordAsync(hrId, firstId, input,
                cancellationToken)).Failure);
            Assert.Equal(HumanResourcesAvailabilityWriteFailure.Conflict,
                (await store.RecordAsync(hrId, firstId, input with
                { Reason = "Changed intention" }, cancellationToken)).Failure);
            Assert.Equal(HumanResourcesAvailabilityWriteFailure.Conflict,
                (await store.RecordAsync(hrId, Guid.NewGuid(), input,
                cancellationToken)).Failure);
            Assert.Null((await store.ResolveAsync(hrId, firstId,
                new ResolveHumanResourcesAvailabilityInput("Approve", "Coverage arranged"),
                cancellationToken)).Failure);
            Assert.Null((await store.ResolveAsync(hrId, firstId,
                new ResolveHumanResourcesAvailabilityInput("Approve", "Coverage arranged"),
                cancellationToken)).Failure);
            Assert.Equal(HumanResourcesAvailabilityWriteFailure.Conflict,
                (await store.ResolveAsync(hrId, firstId,
                new ResolveHumanResourcesAvailabilityInput("Reject", "Different decision"),
                cancellationToken)).Failure);
        }
        var raceDate = date.AddDays(10);
        async Task<HumanResourcesAvailabilityWriteResult> RaceRecordAsync(Guid id)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider
                .GetRequiredService<IHumanResourcesAvailabilityWriteStore>()
                .RecordAsync(hrId, id, input with
                { StartsOn = raceDate, EndsOn = raceDate }, cancellationToken);
        }
        var race = await Task.WhenAll(RaceRecordAsync(Guid.NewGuid()),
            RaceRecordAsync(Guid.NewGuid()));
        Assert.Single(race, result => result.Failure is null);
        Assert.Single(race, result => result.Failure ==
            HumanResourcesAvailabilityWriteFailure.Conflict);
        var collidingId = Guid.NewGuid();
        var collidingDate = date.AddDays(3);
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var agentKey = await setup.RampAgents.Where(agent => agent.PublicId == agentId)
                .Select(agent => agent.Id).SingleAsync(cancellationToken);
            var airlineKey = await setup.Airlines.Where(airline => airline.IataCode == "ZZ")
                .Select(airline => airline.Id).SingleAsync(cancellationToken);
            var stationKey = await setup.Stations.Where(station => station.Code == "PUJ")
                .Select(station => station.Id).SingleAsync(cancellationToken);
            var now = DateTimeOffset.UtcNow;
            var turnaround = new Turnaround
            {
                PublicId = Guid.NewGuid(), OperationCode = "HR-ABSENCE-COLLISION",
                AirlineId = airlineKey, StationId = stationKey,
                OperationDate = collidingDate,
                CurrentStatus = TurnaroundStatus.Confirmed,
                Source = OperationalDataSource.Internal,
                CreatedAt = now, UpdatedAt = now,
            };
            setup.Turnarounds.Add(turnaround);
            await setup.SaveChangesAsync(cancellationToken);
            var operation = new GroundOperation
            {
                PublicId = Guid.NewGuid(), TurnaroundId = turnaround.Id,
                CurrentStatus = GroundOperationStatus.Planned,
                CreatedAt = now, UpdatedAt = now,
            };
            setup.GroundOperations.Add(operation);
            await setup.SaveChangesAsync(cancellationToken);
            setup.OperationAgentAssignments.Add(new OperationAgentAssignment
            {
                PublicId = Guid.NewGuid(), GroundOperationId = operation.Id,
                RampAgentId = agentKey, AssignmentRole = "RampAgent",
                AssignedAt = now, CreatedAt = now, UpdatedAt = now,
            });
            var terminalKey = await setup.Terminals.Where(terminal =>
                terminal.StationId == stationKey && terminal.Code == "A")
                .Select(terminal => terminal.Id).SingleAsync(cancellationToken);
            setup.ShiftAssignments.Add(new ShiftAssignment
            {
                PublicId = Guid.NewGuid(), RampAgentId = agentKey,
                StationId = stationKey, TerminalId = terminalKey,
                WorkDate = collidingDate, StartsAtLocal = new TimeOnly(22, 0),
                EndsAtLocal = new TimeOnly(6, 0), Block = ShiftBlock.Night,
                CreatedAt = now, UpdatedAt = now,
            });
            await setup.SaveChangesAsync(cancellationToken);
            var overnightTurnaround = new Turnaround
            {
                PublicId = Guid.NewGuid(), OperationCode = "HR-ABSENCE-OVERNIGHT",
                AirlineId = airlineKey, StationId = stationKey,
                OperationDate = collidingDate.AddDays(1),
                CurrentStatus = TurnaroundStatus.Confirmed,
                Source = OperationalDataSource.Internal,
                CreatedAt = now, UpdatedAt = now,
            };
            setup.Turnarounds.Add(overnightTurnaround);
            await setup.SaveChangesAsync(cancellationToken);
            var overnightOperation = new GroundOperation
            {
                PublicId = Guid.NewGuid(), TurnaroundId = overnightTurnaround.Id,
                CurrentStatus = GroundOperationStatus.Planned,
                CreatedAt = now, UpdatedAt = now,
            };
            setup.GroundOperations.Add(overnightOperation);
            await setup.SaveChangesAsync(cancellationToken);
            setup.OperationAgentAssignments.Add(new OperationAgentAssignment
            {
                PublicId = Guid.NewGuid(), GroundOperationId = overnightOperation.Id,
                RampAgentId = agentKey, AssignmentRole = "RampAgent",
                AssignedAt = now, CreatedAt = now, UpdatedAt = now,
            });
            await setup.SaveChangesAsync(cancellationToken);
        }
        await using (var scope = provider.CreateAsyncScope())
        {
            var store = scope.ServiceProvider
                .GetRequiredService<IHumanResourcesAvailabilityWriteStore>();
            Assert.Null((await store.RecordAsync(hrId, collidingId, input with
            { StartsOn = collidingDate, EndsOn = collidingDate },
                cancellationToken)).Failure);
            Assert.Equal(HumanResourcesAvailabilityWriteFailure.Conflict,
                (await store.ResolveAsync(hrId, collidingId,
                    new ResolveHumanResourcesAvailabilityInput("Approve", null),
                    cancellationToken)).Failure);
        }
        await using (var inspection = CreateContext(database.ConnectionString))
        {
            var saved = await inspection.AvailabilityRequests.AsNoTracking()
                .SingleAsync(request => request.PublicId == firstId, cancellationToken);
            Assert.Equal(AvailabilityRequestStatus.Approved, saved.Status);
            Assert.NotNull(saved.ResolvedAt);
            Assert.Equal(1, await inspection.AuditEntries.CountAsync(entry =>
                entry.Action == "hr.availability.recorded" &&
                entry.EntityPublicId == firstId, cancellationToken));
            Assert.Equal(1, await inspection.AuditEntries.CountAsync(entry =>
                entry.Action == "hr.availability.approved" &&
                entry.EntityPublicId == firstId, cancellationToken));
            Assert.NotEmpty(await inspection.OutboxMessages.AsNoTracking()
                .Where(message => message.PayloadJson.Contains("\"resource\":\"hr_absences\""))
                .ToArrayAsync(cancellationToken));
            var station = await inspection.Stations.AsNoTracking()
                .SingleAsync(item => item.Code == "PUJ", cancellationToken);
            var occKey = await inspection.Users.AsNoTracking()
                .Where(item => item.PublicId == occId).Select(item => item.Id)
                .SingleAsync(cancellationToken);
            var occHints = await inspection.OutboxMessages.AsNoTracking()
                .Where(message => message.PayloadJson.Contains("\"resource\":\"occ_planning\""))
                .ToArrayAsync(cancellationToken);
            var occHint = Assert.Single(occHints);
            var payload = AccountChangeOutboxWriter.Decode(occHint);
            Assert.Equal(occKey, payload.RecipientAccountId);
            Assert.Equal(station.Id, payload.StationId);
            Assert.Equal(station.PublicId, payload.ResourceId);
            Assert.DoesNotContain(firstId.ToString(), occHint.PayloadJson,
                StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain(input.Reason, occHint.PayloadJson,
                StringComparison.Ordinal);
            Assert.Equal(AvailabilityRequestStatus.Pending,
                (await inspection.AvailabilityRequests.AsNoTracking()
                    .SingleAsync(request => request.PublicId == collidingId,
                        cancellationToken)).Status);
            var turnaroundKey = await inspection.Turnarounds.Where(turnaround =>
                turnaround.OperationCode == "HR-ABSENCE-COLLISION")
                .Select(turnaround => turnaround.Id).SingleAsync(cancellationToken);
            var operationKey = await inspection.GroundOperations.Where(operation =>
                operation.TurnaroundId == turnaroundKey).Select(operation => operation.Id)
                .SingleAsync(cancellationToken);
            var assignment = await inspection.OperationAgentAssignments.SingleAsync(item =>
                item.GroundOperationId == operationKey && item.ReleasedAt == null,
                cancellationToken);
            assignment.ReleasedAt = DateTimeOffset.UtcNow;
            await inspection.SaveChangesAsync(cancellationToken);
        }
        await using (var scope = provider.CreateAsyncScope())
        {
            var store = scope.ServiceProvider
                .GetRequiredService<IHumanResourcesAvailabilityWriteStore>();
            Assert.Equal(HumanResourcesAvailabilityWriteFailure.Conflict,
                (await store.ResolveAsync(hrId, collidingId,
                    new ResolveHumanResourcesAvailabilityInput("Approve", null),
                    cancellationToken)).Failure);
        }
        await using (var inspection = CreateContext(database.ConnectionString))
        {
            var turnaroundKey = await inspection.Turnarounds.Where(turnaround =>
                turnaround.OperationCode == "HR-ABSENCE-OVERNIGHT")
                .Select(turnaround => turnaround.Id).SingleAsync(cancellationToken);
            var operationKey = await inspection.GroundOperations.Where(operation =>
                operation.TurnaroundId == turnaroundKey).Select(operation => operation.Id)
                .SingleAsync(cancellationToken);
            var assignment = await inspection.OperationAgentAssignments.SingleAsync(item =>
                item.GroundOperationId == operationKey && item.ReleasedAt == null,
                cancellationToken);
            assignment.ReleasedAt = DateTimeOffset.UtcNow;
            await inspection.SaveChangesAsync(cancellationToken);
        }
        await using (var scope = provider.CreateAsyncScope())
        {
            var store = scope.ServiceProvider
                .GetRequiredService<IHumanResourcesAvailabilityWriteStore>();
            Assert.Null((await store.ResolveAsync(hrId, collidingId,
                new ResolveHumanResourcesAvailabilityInput("Approve", null),
                cancellationToken)).Failure);
            var rejectedId = Guid.NewGuid();
            Assert.Null((await store.RecordAsync(hrId, rejectedId, input with
            { StartsOn = collidingDate.AddDays(2), EndsOn = collidingDate.AddDays(2),
              Type = "ShiftChange" }, cancellationToken)).Failure);
            Assert.Null((await store.ResolveAsync(hrId, rejectedId,
                new ResolveHumanResourcesAvailabilityInput("Reject", "Not scheduled"),
                cancellationToken)).Failure);
            Assert.Equal(HumanResourcesAvailabilityWriteFailure.Forbidden,
                (await store.ResolveAsync(occId, rejectedId,
                    new ResolveHumanResourcesAvailabilityInput("Reject", "Not scheduled"),
                    cancellationToken)).Failure);
        }
        await using (var inspection = CreateContext(database.ConnectionString))
            Assert.Equal(2, await inspection.OutboxMessages.AsNoTracking()
                .CountAsync(message => message.PayloadJson.Contains(
                    "\"resource\":\"occ_planning\""), cancellationToken));
        await using (var revoke = CreateContext(database.ConnectionString))
        {
            var hrKey = await revoke.Users.Where(user => user.PublicId == hrId)
                .Select(user => user.Id).SingleAsync(cancellationToken);
            var roleKey = await revoke.Roles.Where(role =>
                role.NormalizedName == "GESTION_HUMANA").Select(role => role.Id)
                .SingleAsync(cancellationToken);
            await revoke.Set<IdentityUserRole<long>>().Where(link =>
                link.UserId == hrKey && link.RoleId == roleKey)
                .ExecuteDeleteAsync(cancellationToken);
        }
        await using (var scope = provider.CreateAsyncScope())
        {
            var store = scope.ServiceProvider
                .GetRequiredService<IHumanResourcesAvailabilityWriteStore>();
            Assert.Equal(HumanResourcesAvailabilityWriteFailure.Forbidden,
                (await store.RecordAsync(hrId, Guid.NewGuid(), input with
                { StartsOn = date.AddDays(20), EndsOn = date.AddDays(20) },
                    cancellationToken)).Failure);
        }
    }

    [Fact]
    public async Task RampProfileDeactivationInvalidatesFormerOccStationWithoutAgentIdentity()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var connection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seeder = CreateContext(connection))
            await new DevelopmentDataSeeder(seeder).SeedAsync(InitialPasswords, cancellationToken);

        await using var provider = new ServiceCollection().AddLogging()
            .AddSingleton<TimeProvider>(TimeProvider.System)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                { ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString }).Build())
            .BuildServiceProvider();
        var hrId = Guid.Parse("40000000-0000-7000-8000-000000000004");
        var occId = Guid.Parse("40000000-0000-7000-8000-000000000001");
        var stationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
        await using var scope = provider.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IRampProfileStore>();
        var profile = Assert.Single((await store.ListAsync(hrId, cancellationToken))!.Profiles,
            item => item.EmployeeNumber == "DEV-RA-001");
        var before = await CountOccPlanningHintsAsync();
        var result = await store.SaveAsync(hrId, profile.Id,
            new SaveRampProfileInput(profile.FirstName, profile.LastName,
                profile.EmployeeNumber, profile.Category, profile.HireDate, false,
                [stationId]),
            cancellationToken);
        Assert.Null(result.Failure);
        Assert.False(result.Profile!.IsActive);
        Assert.Equal(before + 1, await CountOccPlanningHintsAsync());
        await using var inspection = CreateContext(database.ConnectionString);
        var hint = Assert.Single(await inspection.OutboxMessages.AsNoTracking()
            .Where(item => item.PayloadJson.Contains("\"resource\":\"occ_planning\""))
            .ToArrayAsync(cancellationToken));
        var payload = AccountChangeOutboxWriter.Decode(hint);
        Assert.Equal(stationId, payload.ResourceId);
        Assert.Equal(await inspection.Users.AsNoTracking()
            .Where(item => item.PublicId == occId).Select(item => item.Id)
            .SingleAsync(cancellationToken), payload.RecipientAccountId);
        Assert.DoesNotContain(profile.Id.ToString(), hint.PayloadJson,
            StringComparison.OrdinalIgnoreCase);

        async Task<int> CountOccPlanningHintsAsync()
        {
            await using var check = CreateContext(database.ConnectionString);
            return await check.OutboxMessages.AsNoTracking().CountAsync(item =>
                item.PayloadJson.Contains("\"resource\":\"occ_planning\""),
                cancellationToken);
        }
    }

    [Fact]
    public async Task HumanResourcesShiftRecordingRespectsScopesReplaysAndEmitsOneChange()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migrationContext = CreateContext(database.ConnectionString))
            await migrationContext.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seederContext = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seederContext).SeedAsync(new DevelopmentAccountPasswords(
                InitialPasswords.AdminOcc, InitialPasswords.RampAgent,
                InitialPasswords.AirlineClient, InitialPasswords.HumanResources,
                InitialPasswords.Contracts, InitialPasswords.Finance,
                "Synthetic-SuperAdmin!234"), cancellationToken);

        await using var provider = new ServiceCollection().AddLogging()
            .AddSingleton<TimeProvider>(TimeProvider.System)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                { ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString }).Build())
            .BuildServiceProvider();
        var hrId = Guid.Parse("40000000-0000-7000-8000-000000000004");
        var occId = Guid.Parse("40000000-0000-7000-8000-000000000001");
        var agentId = Guid.Parse("50000000-0000-7000-8000-000000000001");
        var stationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
        var terminalId = Guid.Parse("20000000-0000-7000-8000-000000000004");
        var date = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1);
        var id = Guid.NewGuid();
        var input = new RecordHumanResourcesShiftInput(agentId, stationId, terminalId,
            date, new TimeOnly(6, 0), new TimeOnly(14, 0), "Development coverage");
        await using (var scope = provider.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<IHumanResourcesShiftWriteStore>();
            // ADR-0026: HR programs shifts too; an account without a scheduling permission does not.
            Assert.Equal(HumanResourcesShiftWriteFailure.Forbidden,
                (await store.RecordAsync(Guid.Parse("40000000-0000-7000-8000-000000000002"), Guid.NewGuid(), input,
                    cancellationToken)).Failure);
            Assert.Equal(HumanResourcesShiftWriteFailure.Invalid,
                (await store.RecordAsync(occId, Guid.NewGuid(), input with
                { EndsAtLocal = new TimeOnly(4, 0) }, cancellationToken)).Failure);
            Assert.Equal(HumanResourcesShiftWriteFailure.Conflict,
                (await store.RecordAsync(occId, Guid.NewGuid(), input with
                { TerminalId = Guid.NewGuid() }, cancellationToken)).Failure);
            var saved = await store.RecordAsync(occId, id, input, cancellationToken);
            Assert.Null(saved.Failure);
            Assert.Equal(id, saved.Shift!.Id);
            Assert.Equal(saved.Shift, (await store.RecordAsync(occId, id, input,
                cancellationToken)).Shift);
            Assert.Equal(HumanResourcesShiftWriteFailure.Conflict,
                (await store.RecordAsync(occId, id, input with
                { Notes = "Different" }, cancellationToken)).Failure);
            Assert.Equal(HumanResourcesShiftWriteFailure.Conflict,
                (await store.RecordAsync(occId, Guid.NewGuid(), input,
                    cancellationToken)).Failure);
        }
        var concurrentId = Guid.NewGuid();
        var concurrentInput = input with { WorkDate = date.AddDays(1) };
        async Task<HumanResourcesShiftWriteResult> ConcurrentRecordAsync()
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider
                .GetRequiredService<IHumanResourcesShiftWriteStore>()
                .RecordAsync(occId, concurrentId, concurrentInput, cancellationToken);
        }
        var concurrentResults = await Task.WhenAll(ConcurrentRecordAsync(), ConcurrentRecordAsync());
        Assert.All(concurrentResults, result =>
        {
            Assert.Null(result.Failure);
            Assert.Equal(concurrentId, result.Shift!.Id);
        });
        await using (var context = CreateContext(database.ConnectionString))
        {
            var saved = await context.ShiftAssignments.AsNoTracking()
                .SingleAsync(shift => shift.PublicId == id, cancellationToken);
            Assert.Equal(date, saved.WorkDate);
            Assert.Equal(ShiftBlock.Morning, saved.Block);
            Assert.Equal(1, await context.AuditEntries.CountAsync(entry =>
                entry.Action == "hr.shift.recorded" && entry.EntityPublicId == id,
                cancellationToken));
            Assert.Equal(1, await context.AuditEntries.CountAsync(entry =>
                entry.Action == "hr.shift.recorded" && entry.EntityPublicId == concurrentId,
                cancellationToken));
            Assert.NotEmpty(await context.OutboxMessages.AsNoTracking()
                .Where(message => message.PayloadJson.Contains("\"resource\":\"hr_shifts\""))
                .ToArrayAsync(cancellationToken));
            Assert.Equal(2, await context.OutboxMessages.AsNoTracking()
                .CountAsync(message => message.PayloadJson.Contains(
                    "\"resource\":\"occ_planning\""), cancellationToken));
            var occKey = await context.Users.Where(user => user.PublicId == occId)
                .Select(user => user.Id).SingleAsync(cancellationToken);
            var stationKey = await context.Stations.Where(station => station.PublicId == stationId)
                .Select(station => station.Id).SingleAsync(cancellationToken);
            var roleKey = await context.Roles.Where(role => role.NormalizedName == "ADMIN_OCC")
                .Select(role => role.Id).SingleAsync(cancellationToken);
            var agentKey = await context.RampAgents.Where(agent => agent.PublicId == agentId)
                .Select(agent => agent.Id).SingleAsync(cancellationToken);
            await context.Set<RampAgentTerminalScope>()
                .Where(scope => scope.RampAgentId == agentKey && scope.ValidTo == null)
                .ExecuteUpdateAsync(setters => setters.SetProperty(scope => scope.ValidTo,
                    date.AddDays(1)), cancellationToken);
            await using (var scope = provider.CreateAsyncScope())
            {
                var store = scope.ServiceProvider.GetRequiredService<IHumanResourcesShiftWriteStore>();
                Assert.Equal(HumanResourcesShiftWriteFailure.Conflict,
                    (await store.RecordAsync(occId, Guid.NewGuid(), input with
                    { WorkDate = date.AddDays(2) }, cancellationToken)).Failure);
                Assert.Equal(HumanResourcesShiftWriteFailure.Forbidden,
                    (await store.RecordAsync(occId, Guid.NewGuid(), input with
                    { StationId = Guid.NewGuid() }, cancellationToken)).Failure);
            }
            var shiftCount = await context.ShiftAssignments.CountAsync(cancellationToken);
            var auditCount = await context.AuditEntries.CountAsync(cancellationToken);
            var outboxCount = await context.OutboxMessages.CountAsync(cancellationToken);
            Assert.Equal(1, await context.AccountStationScopes.Where(grant => grant.AccountId == occKey &&
                grant.StationId == stationKey && grant.RevokedAt == null)
                .ExecuteUpdateAsync(setters => setters.SetProperty(grant => grant.RevokedAt,
                    (DateTimeOffset?)DateTimeOffset.UtcNow), cancellationToken));
            await using (var scope = provider.CreateAsyncScope())
            {
                var store = scope.ServiceProvider.GetRequiredService<IHumanResourcesShiftWriteStore>();
                Assert.Equal(HumanResourcesShiftWriteFailure.Forbidden,
                    (await store.RecordAsync(occId, Guid.NewGuid(), input with
                    { WorkDate = date.AddDays(3) }, cancellationToken)).Failure);
                Assert.Equal(HumanResourcesShiftWriteFailure.Forbidden,
                    (await store.RecordAsync(occId, id, input, cancellationToken)).Failure);
            }
            Assert.Equal(shiftCount, await context.ShiftAssignments.CountAsync(cancellationToken));
            Assert.Equal(auditCount, await context.AuditEntries.CountAsync(cancellationToken));
            Assert.Equal(outboxCount, await context.OutboxMessages.CountAsync(cancellationToken));
            Assert.Equal(1, await context.AccountStationScopes.Where(grant => grant.AccountId == occKey &&
                grant.StationId == stationKey && grant.RevokedAt != null)
                .ExecuteUpdateAsync(setters => setters.SetProperty(grant => grant.RevokedAt,
                    (DateTimeOffset?)null), cancellationToken));
            await context.Set<IdentityUserRole<long>>().Where(link => link.UserId == occKey &&
                link.RoleId == roleKey).ExecuteDeleteAsync(cancellationToken);
        }
        await using (var scope = provider.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<IHumanResourcesShiftWriteStore>();
            Assert.Equal(HumanResourcesShiftWriteFailure.Forbidden,
                (await store.RecordAsync(occId, Guid.NewGuid(), input with
                { WorkDate = date.AddDays(1) }, cancellationToken)).Failure);
        }
    }

    [Fact]
    public async Task HumanResourcesPermitsReadCurrentCyclesOnlyForLiveInternalRole()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migrationContext = CreateContext(database.ConnectionString))
            await migrationContext.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seederContext = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seederContext).SeedAsync(new DevelopmentAccountPasswords(
                InitialPasswords.AdminOcc, InitialPasswords.RampAgent,
                InitialPasswords.AirlineClient, InitialPasswords.HumanResources,
                InitialPasswords.Contracts, InitialPasswords.Finance,
                "Synthetic-SuperAdmin!234"), cancellationToken);

        await using var provider = new ServiceCollection().AddLogging()
            .AddSingleton<TimeProvider>(TimeProvider.System)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                { ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString }).Build())
            .BuildServiceProvider();
        var hrId = Guid.Parse("40000000-0000-7000-8000-000000000004");
        var occId = Guid.Parse("40000000-0000-7000-8000-000000000001");
        var superAdminId = Guid.Parse("40000000-0000-7000-8000-000000000007");
        await using (var scope = provider.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<IHumanResourcesPermitReadStore>();
            var first = await store.ListCurrentAsync(hrId, 1, 1, cancellationToken);
            Assert.NotNull(first);
            Assert.True(first.HasMore);
            var airportId = Assert.Single(first.Permits);
            Assert.Equal(Guid.Parse("50000000-0000-7000-8000-000000000003"), airportId.Id);
            Assert.Equal("AirportId", airportId.DocumentType);
            Assert.Equal("DEV-RA-001", airportId.EmployeeNumber);
            var exact = await store.ListCurrentAsync(hrId, 1, 1,
                airportId.RampProfileId, PermitDocumentType.AirportId, cancellationToken);
            Assert.Equal(airportId.Id, Assert.Single(exact!.Permits).Id);
            Assert.Empty((await store.ListCurrentAsync(hrId, 1, 1,
                Guid.NewGuid(), PermitDocumentType.AirportId, cancellationToken))!.Permits);
            Assert.Null(await store.ListCurrentAsync(occId, 1, 1,
                airportId.RampProfileId, PermitDocumentType.AirportId, cancellationToken));
            var second = await store.ListCurrentAsync(hrId, 2, 1, cancellationToken);
            Assert.NotNull(second);
            Assert.False(second.HasMore);
            Assert.Equal("RampDriverLicense", Assert.Single(second.Permits).DocumentType);
            Assert.Null(await store.ListCurrentAsync(occId, 1, 20, cancellationToken));
            Assert.Equal(2, (await store.ListCurrentAsync(superAdminId, 1, 20,
                cancellationToken))!.Permits.Count);
        }

        await using (var context = CreateContext(database.ConnectionString))
        {
            var hrKey = await context.Users.Where(user => user.PublicId == hrId)
                .Select(user => user.Id).SingleAsync(cancellationToken);
            var roleKey = await context.Roles.Where(role => role.NormalizedName == "GESTION_HUMANA")
                .Select(role => role.Id).SingleAsync(cancellationToken);
            await context.Set<IdentityUserRole<long>>().Where(link => link.UserId == hrKey &&
                link.RoleId == roleKey).ExecuteDeleteAsync(cancellationToken);
            await context.AirportPermitCycles.Where(cycle => cycle.DocumentType ==
                PermitDocumentType.AirportId).ExecuteUpdateAsync(update => update
                    .SetProperty(cycle => cycle.IsCurrent, false), cancellationToken);
        }
        await using (var scope = provider.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<IHumanResourcesPermitReadStore>();
            Assert.Null(await store.ListCurrentAsync(hrId, 1, 20, cancellationToken));
            var remaining = (await store.ListCurrentAsync(superAdminId, 1, 20,
                cancellationToken))!.Permits;
            Assert.Equal("RampDriverLicense", Assert.Single(remaining).DocumentType);
        }
    }

    [Fact]
    public async Task HumanResourcesPermitRenewalPreservesCurrentHistoryAndReplaysOneIntent()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migrationContext = CreateContext(database.ConnectionString))
            await migrationContext.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seederContext = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seederContext).SeedAsync(new DevelopmentAccountPasswords(
                InitialPasswords.AdminOcc, InitialPasswords.RampAgent,
                InitialPasswords.AirlineClient, InitialPasswords.HumanResources,
                InitialPasswords.Contracts, InitialPasswords.Finance,
                "Synthetic-SuperAdmin!234"), cancellationToken);

        await using var provider = new ServiceCollection().AddLogging()
            .AddSingleton<TimeProvider>(TimeProvider.System)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                { ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString }).Build())
            .BuildServiceProvider();
        var hrId = Guid.Parse("40000000-0000-7000-8000-000000000004");
        var occId = Guid.Parse("40000000-0000-7000-8000-000000000001");
        var agentId = Guid.Parse("50000000-0000-7000-8000-000000000001");
        var previousId = Guid.Parse("50000000-0000-7000-8000-000000000003");
        var newId = Guid.NewGuid();
        var firstAgentId = Guid.NewGuid();
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var now = DateTimeOffset.UtcNow;
            var person = new Person
            {
                PublicId = Guid.NewGuid(), FirstName = "Permit", LastName = "FirstCycle",
                IdentificationType = "Synthetic", IdentificationNumber = "DEV-PERMIT-FIRST",
                CreatedAt = now, UpdatedAt = now,
            };
            setup.Persons.Add(person);
            await setup.SaveChangesAsync(cancellationToken);
            setup.RampAgents.Add(NewTestAgent(person.Id, "DEV-RA-PERMIT-FIRST",
                firstAgentId.ToString("D"), now));
            await setup.SaveChangesAsync(cancellationToken);
        }
        var input = new RecordHumanResourcesPermitInput(agentId, "AirportId",
            previousId, "DEV-AIRPORT-ID-RENEWED", new DateOnly(2026, 2, 1),
            new DateOnly(2099, 12, 31));
        var firstId = Guid.NewGuid();
        var firstInput = input with { RampProfileId = firstAgentId,
            ExpectedCurrentId = null, DocumentNumber = "DEV-PERMIT-FIRST" };
        await using (var scope = provider.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<IHumanResourcesPermitWriteStore>();
            var first = await store.RecordAsync(hrId, firstId, firstInput,
                cancellationToken);
            Assert.Null(first.Failure);
            Assert.Equal(1, first.Permit!.CycleNumber);
            Assert.Equal(first.Permit, (await store.RecordAsync(hrId, firstId,
                firstInput, cancellationToken)).Permit);
            var saved = await store.RecordAsync(hrId, newId, input, cancellationToken);
            Assert.Null(saved.Failure);
            Assert.Equal(2, saved.Permit!.CycleNumber);
            Assert.Equal(saved.Permit, (await store.RecordAsync(hrId, newId, input,
                cancellationToken)).Permit);
            Assert.Equal(HumanResourcesPermitWriteFailure.Conflict,
                (await store.RecordAsync(hrId, newId, input with
                { DocumentNumber = "DIFFERENT" }, cancellationToken)).Failure);
            Assert.Equal(HumanResourcesPermitWriteFailure.Conflict,
                (await store.RecordAsync(hrId, Guid.NewGuid(), input,
                    cancellationToken)).Failure);
            Assert.Equal(HumanResourcesPermitWriteFailure.Invalid,
                (await store.RecordAsync(hrId, Guid.NewGuid(), input with
                { IssuedOn = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1) },
                    cancellationToken)).Failure);
            Assert.Equal(HumanResourcesPermitWriteFailure.Forbidden,
                (await store.RecordAsync(occId, Guid.NewGuid(), input,
                    cancellationToken)).Failure);
        }

        var concurrentId = Guid.NewGuid();
        var concurrentInput = input with { ExpectedCurrentId = newId,
            DocumentNumber = "DEV-AIRPORT-ID-CONCURRENT" };
        async Task<HumanResourcesPermitWriteResult> ConcurrentRecordAsync()
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider
                .GetRequiredService<IHumanResourcesPermitWriteStore>()
                .RecordAsync(hrId, concurrentId, concurrentInput, cancellationToken);
        }
        var concurrentResults = await Task.WhenAll(ConcurrentRecordAsync(), ConcurrentRecordAsync());
        Assert.All(concurrentResults, result =>
        {
            Assert.Null(result.Failure);
            Assert.Equal(concurrentId, result.Permit!.Id);
            Assert.Equal(3, result.Permit.CycleNumber);
        });
        await using (var context = CreateContext(database.ConnectionString))
        {
            var firstCycle = await context.AirportPermitCycles.AsNoTracking()
                .SingleAsync(cycle => cycle.PublicId == firstId, cancellationToken);
            Assert.True(firstCycle.IsCurrent);
            Assert.Null(firstCycle.SupersedesPermitId);
            var cycles = await context.AirportPermitCycles.AsNoTracking()
                .Where(cycle => cycle.PublicId == previousId || cycle.PublicId == newId ||
                    cycle.PublicId == concurrentId)
                .OrderBy(cycle => cycle.CycleNumber).ToArrayAsync(cancellationToken);
            Assert.Equal(3, cycles.Length);
            Assert.False(cycles[0].IsCurrent);
            Assert.False(cycles[1].IsCurrent);
            Assert.True(cycles[2].IsCurrent);
            Assert.Equal(cycles[0].Id, cycles[1].SupersedesPermitId);
            Assert.Equal(cycles[1].Id, cycles[2].SupersedesPermitId);
            Assert.Equal(1, await context.AuditEntries.CountAsync(entry =>
                entry.Action == "hr.permit.recorded" && entry.EntityPublicId == newId,
                cancellationToken));
            Assert.Equal(1, await context.AuditEntries.CountAsync(entry =>
                entry.Action == "hr.permit.recorded" && entry.EntityPublicId == concurrentId,
                cancellationToken));
            Assert.NotEmpty(await context.OutboxMessages.AsNoTracking()
                .Where(message => message.PayloadJson.Contains("\"resource\":\"hr_permits\""))
                .ToArrayAsync(cancellationToken));
            Assert.Equal(2, await context.OutboxMessages.AsNoTracking()
                .CountAsync(message => message.PayloadJson.Contains(
                    "\"resource\":\"occ_planning\""), cancellationToken));
            var hrKey = await context.Users.Where(user => user.PublicId == hrId)
                .Select(user => user.Id).SingleAsync(cancellationToken);
            var roleKey = await context.Roles.Where(role => role.NormalizedName == "GESTION_HUMANA")
                .Select(role => role.Id).SingleAsync(cancellationToken);
            await context.Set<IdentityUserRole<long>>().Where(link => link.UserId == hrKey &&
                link.RoleId == roleKey).ExecuteDeleteAsync(cancellationToken);
        }
        await using (var scope = provider.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<IHumanResourcesPermitWriteStore>();
            Assert.Equal(HumanResourcesPermitWriteFailure.Forbidden,
                (await store.RecordAsync(hrId, Guid.NewGuid(), input,
                    cancellationToken)).Failure);
        }
    }

    [Fact]
    public async Task HumanResourcesQualificationsReadCurrentCyclesOnlyForLiveInternalRole()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migrationContext = CreateContext(database.ConnectionString))
            await migrationContext.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seederContext = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seederContext).SeedAsync(new DevelopmentAccountPasswords(
                InitialPasswords.AdminOcc, InitialPasswords.RampAgent,
                InitialPasswords.AirlineClient, InitialPasswords.HumanResources,
                InitialPasswords.Contracts, InitialPasswords.Finance,
                "Synthetic-SuperAdmin!234"), cancellationToken);

        await using var provider = new ServiceCollection().AddLogging()
            .AddSingleton<TimeProvider>(TimeProvider.System)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                { ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString }).Build())
            .BuildServiceProvider();
        var hrId = Guid.Parse("40000000-0000-7000-8000-000000000004");
        var occId = Guid.Parse("40000000-0000-7000-8000-000000000001");
        var superAdminId = Guid.Parse("40000000-0000-7000-8000-000000000007");
        await using (var scope = provider.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<IHumanResourcesQualificationReadStore>();
            var page = await store.ListCurrentAsync(hrId, 1, 1, cancellationToken);
            Assert.NotNull(page);
            Assert.False(page.HasMore);
            var qualification = Assert.Single(page.Qualifications);
            Assert.Equal(Guid.Parse("50000000-0000-7000-8000-000000000002"), qualification.Id);
            Assert.Equal("DEV-RA-001", qualification.EmployeeNumber);
            Assert.Equal("GPU", qualification.EquipmentCode);
            Assert.Equal(new DateOnly(2099, 12, 31), qualification.ExpiresOn);
            var exact = await store.ListCurrentAsync(hrId, 1, 1,
                qualification.RampProfileId, qualification.EquipmentTypeId, cancellationToken);
            Assert.Equal(qualification.Id, Assert.Single(exact!.Qualifications).Id);
            var differentEquipment = await store.ListCurrentAsync(hrId, 1, 1,
                qualification.RampProfileId, Guid.NewGuid(), cancellationToken);
            Assert.Empty(differentEquipment!.Qualifications);
            Assert.Null(await store.ListCurrentAsync(occId, 1, 1,
                qualification.RampProfileId, qualification.EquipmentTypeId, cancellationToken));
            Assert.Empty((await store.ListCurrentAsync(hrId, 2, 1, cancellationToken))!.Qualifications);
            Assert.Null(await store.ListCurrentAsync(occId, 1, 20, cancellationToken));
            Assert.Single((await store.ListCurrentAsync(superAdminId, 1, 20,
                cancellationToken))!.Qualifications);
        }

        await using (var context = CreateContext(database.ConnectionString))
        {
            var hrKey = await context.Users.Where(user => user.PublicId == hrId)
                .Select(user => user.Id).SingleAsync(cancellationToken);
            var roleKey = await context.Roles.Where(role => role.NormalizedName == "GESTION_HUMANA")
                .Select(role => role.Id).SingleAsync(cancellationToken);
            await context.Set<IdentityUserRole<long>>().Where(link => link.UserId == hrKey &&
                link.RoleId == roleKey).ExecuteDeleteAsync(cancellationToken);
            await context.QualificationCycles.Where(cycle => cycle.IsCurrent)
                .ExecuteUpdateAsync(update => update.SetProperty(cycle => cycle.IsCurrent, false),
                    cancellationToken);
        }
        await using (var scope = provider.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<IHumanResourcesQualificationReadStore>();
            Assert.Null(await store.ListCurrentAsync(hrId, 1, 20, cancellationToken));
            Assert.Empty((await store.ListCurrentAsync(superAdminId, 1, 20,
                cancellationToken))!.Qualifications);
        }
    }

    [Fact]
    public async Task HumanResourcesQualificationRenewalPreservesHistoryAndRejectsStaleWriters()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migrationContext = CreateContext(database.ConnectionString))
            await migrationContext.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seederContext = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seederContext).SeedAsync(new DevelopmentAccountPasswords(
                InitialPasswords.AdminOcc, InitialPasswords.RampAgent,
                InitialPasswords.AirlineClient, InitialPasswords.HumanResources,
                InitialPasswords.Contracts, InitialPasswords.Finance,
                "Synthetic-SuperAdmin!234"), cancellationToken);

        await using var provider = new ServiceCollection().AddLogging()
            .AddSingleton<TimeProvider>(TimeProvider.System)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                { ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString }).Build())
            .BuildServiceProvider();
        var hrId = Guid.Parse("40000000-0000-7000-8000-000000000004");
        var occId = Guid.Parse("40000000-0000-7000-8000-000000000001");
        var agentId = Guid.Parse("50000000-0000-7000-8000-000000000001");
        var equipmentId = Guid.Parse("20000000-0000-7000-8000-000000000007");
        var additionalEquipmentId = Guid.NewGuid();
        await using (var context = CreateContext(database.ConnectionString))
        {
            var now = DateTimeOffset.UtcNow;
            context.EquipmentTypes.Add(new EquipmentType { PublicId = additionalEquipmentId,
                CreatedAt = now, UpdatedAt = now, Code = "DEV-QUAL-SECOND",
                Name = "Second synthetic equipment", IsActive = true,
                RequiresQualification = true });
            await context.SaveChangesAsync(cancellationToken);
        }
        var previousId = Guid.Parse("50000000-0000-7000-8000-000000000002");
        var newId = Guid.NewGuid();
        var input = new RecordHumanResourcesQualificationInput(agentId, equipmentId,
            previousId, new DateOnly(2026, 1, 3), new DateOnly(2026, 1, 4),
            new DateOnly(2099, 12, 31), "Synthetic Training Center",
            "Development Instructor", "Renewal recorded by HR");

        await using (var scope = provider.CreateAsyncScope())
        {
            var options = scope.ServiceProvider
                .GetRequiredService<IHumanResourcesQualificationReadStore>();
            var types = await options.ListEquipmentTypesAsync(hrId, cancellationToken);
            Assert.Contains(types!, item => item.Id == equipmentId && item.Code == "GPU");
            Assert.Contains(types!, item => item.Id == additionalEquipmentId);
            Assert.Null(await options.ListEquipmentTypesAsync(occId, cancellationToken));
            var store = scope.ServiceProvider.GetRequiredService<IHumanResourcesQualificationWriteStore>();
            var result = await store.RecordAsync(hrId, newId, input, cancellationToken);
            Assert.Null(result.Failure);
            Assert.Equal(newId, result.Qualification!.Id);
            Assert.Equal(2, result.Qualification.CycleNumber);
            var replay = await store.RecordAsync(hrId, newId, input, cancellationToken);
            Assert.Equal(result.Qualification, replay.Qualification);
            var initialId = Guid.NewGuid();
            var initialInput = input with { EquipmentTypeId = additionalEquipmentId,
                ExpectedCurrentId = null };
            var initial = await store.RecordAsync(hrId, initialId, initialInput,
                cancellationToken);
            Assert.Null(initial.Failure);
            Assert.Equal(1, initial.Qualification!.CycleNumber);
            Assert.Equal(initial.Qualification, (await store.RecordAsync(hrId, initialId,
                initialInput, cancellationToken)).Qualification);
            Assert.Equal(HumanResourcesQualificationWriteFailure.Conflict,
                (await store.RecordAsync(Guid.Parse("40000000-0000-7000-8000-000000000007"),
                    initialId, initialInput, cancellationToken)).Failure);
            Assert.Equal(HumanResourcesQualificationWriteFailure.Conflict,
                (await store.RecordAsync(hrId, initialId, initialInput with
                { InstructorName = "Different instructor" }, cancellationToken)).Failure);
            Assert.Equal(HumanResourcesQualificationWriteFailure.Conflict,
                (await store.RecordAsync(hrId, Guid.NewGuid(), input, cancellationToken)).Failure);
            Assert.Equal(HumanResourcesQualificationWriteFailure.Invalid,
                (await store.RecordAsync(hrId, Guid.NewGuid(), input with
                { ObtainedOn = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1) },
                    cancellationToken)).Failure);
            Assert.Equal(HumanResourcesQualificationWriteFailure.Forbidden,
                (await store.RecordAsync(occId, Guid.NewGuid(), input, cancellationToken)).Failure);
        }

        var concurrentId = Guid.NewGuid();
        var concurrentInput = input with { ExpectedCurrentId = newId,
            TrainingDate = new DateOnly(2026, 1, 4),
            ObtainedOn = new DateOnly(2026, 1, 5) };
        async Task<HumanResourcesQualificationWriteResult> ConcurrentRecordAsync()
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider
                .GetRequiredService<IHumanResourcesQualificationWriteStore>()
                .RecordAsync(hrId, concurrentId, concurrentInput, cancellationToken);
        }
        var concurrentResults = await Task.WhenAll(ConcurrentRecordAsync(), ConcurrentRecordAsync());
        Assert.All(concurrentResults, result =>
        {
            Assert.Null(result.Failure);
            Assert.Equal(concurrentId, result.Qualification!.Id);
            Assert.Equal(3, result.Qualification.CycleNumber);
        });

        await using (var context = CreateContext(database.ConnectionString))
        {
            var cycles = await context.QualificationCycles.AsNoTracking()
                .Where(cycle => cycle.PublicId == previousId || cycle.PublicId == newId ||
                    cycle.PublicId == concurrentId)
                .OrderBy(cycle => cycle.CycleNumber).ToArrayAsync(cancellationToken);
            Assert.Equal(3, cycles.Length);
            Assert.False(cycles[0].IsCurrent);
            Assert.False(cycles[1].IsCurrent);
            Assert.Equal(cycles[0].Id, cycles[1].SupersedesQualificationId);
            Assert.True(cycles[2].IsCurrent);
            Assert.Equal(cycles[1].Id, cycles[2].SupersedesQualificationId);
            Assert.Equal(1, await context.AuditEntries.CountAsync(entry =>
                entry.Action == "hr.qualification.recorded" && entry.EntityPublicId == newId,
                cancellationToken));
            Assert.NotEmpty(await context.OutboxMessages.AsNoTracking()
                .Where(message => message.PayloadJson.Contains("\"resource\":\"hr_qualifications\""))
                .ToArrayAsync(cancellationToken));
            Assert.Equal(3, await context.OutboxMessages.AsNoTracking()
                .CountAsync(message => message.PayloadJson.Contains(
                    "\"resource\":\"occ_planning\""), cancellationToken));
            // Emulate an EF retry after the first SaveChanges rolled back in SQL:
            // the context still holds an unchanged, no-longer-current entity.
            var afterRollbackId = Guid.NewGuid();
            await using (var retryScope = provider.CreateAsyncScope())
            {
                var retryContext = retryScope.ServiceProvider.GetRequiredService<ElevantDbContext>();
                var tracked = await retryContext.QualificationCycles.SingleAsync(cycle =>
                    cycle.PublicId == concurrentId, cancellationToken);
                tracked.IsCurrent = false;
                retryContext.Entry(tracked).Property(cycle => cycle.IsCurrent).OriginalValue = false;
                retryContext.Entry(tracked).State = EntityState.Unchanged;
                var retryStore = retryScope.ServiceProvider
                    .GetRequiredService<IHumanResourcesQualificationWriteStore>();
                var afterRollback = await retryStore.RecordAsync(hrId, afterRollbackId,
                    input with { ExpectedCurrentId = concurrentId,
                        TrainingDate = new DateOnly(2026, 1, 5),
                        ObtainedOn = new DateOnly(2026, 1, 6) }, cancellationToken);
                Assert.Null(afterRollback.Failure);
                Assert.Equal(4, afterRollback.Qualification!.CycleNumber);
            }
            Assert.True(await context.QualificationCycles.AsNoTracking().AnyAsync(cycle =>
                cycle.PublicId == afterRollbackId && cycle.IsCurrent, cancellationToken));
            Assert.Equal(4, await context.OutboxMessages.AsNoTracking()
                .CountAsync(message => message.PayloadJson.Contains(
                    "\"resource\":\"occ_planning\""), cancellationToken));
            var hrKey = await context.Users.Where(user => user.PublicId == hrId)
                .Select(user => user.Id).SingleAsync(cancellationToken);
            var roleKey = await context.Roles.Where(role => role.NormalizedName == "GESTION_HUMANA")
                .Select(role => role.Id).SingleAsync(cancellationToken);
            await context.Set<IdentityUserRole<long>>().Where(link => link.UserId == hrKey &&
                link.RoleId == roleKey).ExecuteDeleteAsync(cancellationToken);
        }
        await using (var scope = provider.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<IHumanResourcesQualificationWriteStore>();
            Assert.Equal(HumanResourcesQualificationWriteFailure.Forbidden,
                (await store.RecordAsync(hrId, Guid.NewGuid(), input, cancellationToken)).Failure);
        }
    }

    [Fact]
    public async Task FinanceTariffsExposeOnlyPublishedRatesForALiveStationGrant()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migrationContext = CreateContext(database.ConnectionString))
            await migrationContext.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seederContext = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seederContext).SeedAsync(new DevelopmentAccountPasswords(
                InitialPasswords.AdminOcc, InitialPasswords.RampAgent,
                InitialPasswords.AirlineClient, InitialPasswords.HumanResources,
                InitialPasswords.Contracts, InitialPasswords.Finance,
                "Synthetic-SuperAdmin!234"), cancellationToken);

        await using var provider = new ServiceCollection().AddLogging()
            .AddSingleton<TimeProvider>(TimeProvider.System)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                { ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString }).Build())
            .BuildServiceProvider();
        var financeId = Guid.Parse("40000000-0000-7000-8000-000000000006");
        var occId = Guid.Parse("40000000-0000-7000-8000-000000000001");
        var stationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
        await using var scope = provider.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IFinanceTariffReadStore>();
        var page = await store.ListAsync(financeId, stationId, 1, 20, cancellationToken);
        Assert.NotNull(page);
        Assert.Equal(stationId, page.StationId);
        Assert.Contains(page.Tariffs, row => row.ContractCode == "DEV-CONTRACT-0001" &&
            row.UnitPrice == 125.50m && row.VersionStatus == "Approved");
        Assert.All(page.Tariffs, row => Assert.Equal("DEV-CONTRACT-0001", row.ContractCode));
        Assert.Null(await store.ListAsync(occId, stationId, 1, 20, cancellationToken));
        Assert.Null(await store.ListAsync(financeId, Guid.NewGuid(), 1, 20, cancellationToken));

        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var accountKey = await context.Users.AsNoTracking().Where(user => user.PublicId == financeId)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        var stationKey = await context.Stations.AsNoTracking().Where(station => station.PublicId == stationId)
            .Select(station => station.Id).SingleAsync(cancellationToken);
        await context.AccountStationScopes.Where(grant => grant.AccountId == accountKey &&
            grant.StationId == stationKey && grant.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(grant => grant.RevokedAt,
                DateTimeOffset.UtcNow), cancellationToken);
        Assert.Null(await store.ListAsync(financeId, stationId, 1, 20, cancellationToken));
    }

    [Fact]
    public async Task CommercialServiceImageUploadUsesGarageCompatiblePutAndCanBeRead()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var server = await GarageCompatibleS3Server.StartAsync(cancellationToken);
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seed = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seed).SeedAsync(new DevelopmentAccountPasswords(
                InitialPasswords.AdminOcc, InitialPasswords.RampAgent,
                InitialPasswords.AirlineClient, InitialPasswords.HumanResources,
                InitialPasswords.Contracts, InitialPasswords.Finance,
                "Synthetic-SuperAdmin!234"), cancellationToken);

        await using var provider = new ServiceCollection().AddLogging()
            .AddSingleton<TimeProvider>(TimeProvider.System)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString,
                    ["MediaStorage:Endpoint"] = server.Endpoint,
                    ["MediaStorage:AccessKey"] = "synthetic-access",
                    ["MediaStorage:SecretKey"] = "synthetic-secret",
                    ["MediaStorage:Bucket"] = "synthetic-bucket",
                    ["MediaStorage:Region"] = "garage",
                }).Build())
            .BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        var media = scope.ServiceProvider.GetRequiredService<ICommercialMediaStore>();
        var actor = Guid.Parse("40000000-0000-7000-8000-000000000007");
        var formats = new (string Purpose, string ContentType, byte[] Content)[]
        {
            ("service-image", "image/png", [137, 80, 78, 71, 13, 10, 26, 10]),
            ("service-image", "image/jpeg", [0xff, 0xd8, 0xff]),
            ("service-image", "image/webp", "RIFF0000WEBP"u8.ToArray()),
            ("service-video", "video/mp4", [0, 0, 0, 12, 102, 116, 121, 112, 0, 0, 0, 0]),
            ("service-video", "video/webm", [0x1a, 0x45, 0xdf, 0xa3]),
            ("airline-logo", "image/png", [137, 80, 78, 71, 13, 10, 26, 10]),
            ("avatar", "image/png", [137, 80, 78, 71, 13, 10, 26, 10]),
        };
        foreach (var format in formats)
        {
            using var input = new MemoryStream(format.Content);
            var uploadActor = format.Purpose.StartsWith("service-", StringComparison.Ordinal) ? ContractsAccount : actor;
            var uploaded = await media.UploadAsync(uploadActor, format.Purpose,
                format.ContentType, input, input.Length, cancellationToken);

            Assert.NotNull(uploaded);
            Assert.Equal(format.Content, server.LastUploadedContent);
            Assert.Equal($"/synthetic-bucket/{format.Purpose}/{uploaded.Id:N}",
                server.LastUploadedPath);
            await using var output = await media.OpenAsync($"{format.Purpose}/{uploaded.Id:N}",
                cancellationToken: cancellationToken);
            using var buffer = new MemoryStream();
            await output.CopyToAsync(buffer, cancellationToken);
            Assert.Equal(format.Content, buffer.ToArray());
        }
    }

    [Fact]
    public async Task MediaLinksExpireBeforeCleanupButExistingPrivateLinksRemainReadable()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migrationContext = CreateContext(database.ConnectionString))
            await migrationContext.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seederContext = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seederContext).SeedAsync(new DevelopmentAccountPasswords(
                InitialPasswords.AdminOcc, InitialPasswords.RampAgent,
                InitialPasswords.AirlineClient, InitialPasswords.HumanResources,
                InitialPasswords.Contracts, InitialPasswords.Finance,
                "Synthetic-SuperAdmin!234"), cancellationToken);

        await using var provider = new ServiceCollection().AddLogging()
            .AddSingleton<TimeProvider>(TimeProvider.System)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                { ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString }).Build())
            .BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var actor = ContractsAccount;
        var accountId = await context.Users.Where(user => user.PublicId == actor)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        var assetId = Guid.CreateVersion7();
        var url = $"/api/v1/media/{assetId}";
        var asset = new MediaAsset
        {
            PublicId = assetId, Purpose = "service-image", ObjectKey = $"service-image/{assetId:N}",
            ContentType = "image/png", Length = 8, Sha256 = new string('a', 64),
            UploadedByAccountId = accountId, CreatedAt = DateTimeOffset.UtcNow.AddDays(-8),
        };
        context.MediaAssets.Add(asset);
        await context.SaveChangesAsync(cancellationToken);
        var manager = scope.ServiceProvider.GetRequiredService<ICommercialCatalogManagementStore>();
        var input = new ManagedServiceInput("MEDIA-LINK-PHOTO", "Servicio con foto",
            "Servicio con fotografía real para validar los enlaces", "operación", url, null, 999, false, true, null);
        Assert.Equal(CatalogMutationFailure.Invalid,
            (await manager.SaveAsync(actor, null, input, null, cancellationToken)).Failure);

        // Each catalog command runs in its own transaction and clears the change tracker, so the
        // asset age is changed with a set-based update rather than through a tracked entity.
        await context.MediaAssets.Where(item => item.PublicId == assetId).ExecuteUpdateAsync(update =>
            update.SetProperty(item => item.CreatedAt, DateTimeOffset.UtcNow.AddDays(-5)), cancellationToken);
        var saved = await manager.SaveAsync(actor, null, input, null, cancellationToken);
        Assert.Null(saved.Failure);
        var media = scope.ServiceProvider.GetRequiredService<ICommercialMediaStore>();
        Assert.Null(await media.GetReadableAsync(assetId, null, cancellationToken));
        Assert.NotNull(await media.GetReadableAsync(assetId, actor, cancellationToken));

        await context.MediaAssets.Where(item => item.PublicId == assetId).ExecuteUpdateAsync(update =>
            update.SetProperty(item => item.CreatedAt, DateTimeOffset.UtcNow.AddDays(-8)), cancellationToken);
        var updated = await manager.SaveAsync(actor, saved.Service!.Id,
            input with { IsPublic = true, Version = saved.Service.Version }, null, cancellationToken);
        Assert.Null(updated.Failure);
        Assert.NotNull(await media.GetReadableAsync(assetId, null, cancellationToken));
        Assert.Equal(CatalogMutationFailure.Invalid,
            (await manager.SaveAsync(actor, null,
                input with { Code = "MEDIA-LINK-NEW", Version = null }, null, cancellationToken)).Failure);

        context.MediaAssets.AddRange(Enumerable.Range(0, 100).Select(_ =>
        {
            var id = Guid.CreateVersion7();
            return new MediaAsset
            {
                PublicId = id, Purpose = "service-image", ObjectKey = $"service-image/{id:N}",
                ContentType = "image/png", Length = 8, Sha256 = new string('b', 64),
                UploadedByAccountId = accountId, CreatedAt = DateTimeOffset.UtcNow,
            };
        }));
        await context.SaveChangesAsync(cancellationToken);
        using var content = new MemoryStream([137, 80, 78, 71, 13, 10, 26, 10]);
        Assert.Null(await media.UploadAsync(actor, "service-image", "image/png", content,
            content.Length, cancellationToken));
    }

    [Fact]
    public async Task PublicCommercialIntakePersistsAStableSnapshotAndReplaysSafely()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migrationContext = CreateContext(database.ConnectionString))
            await migrationContext.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seederContext = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seederContext).SeedAsync(InitialPasswords, cancellationToken);

        await using var provider = new ServiceCollection()
            .AddLogging()
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString,
                }).Build())
            .BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        var catalog = await scope.ServiceProvider.GetRequiredService<ICommercialCatalogStore>()
            .GetPublicAsync(cancellationToken);
        Assert.Equal(7, catalog.Services.Count);
        Assert.Equal(47, catalog.Airlines.Count);
        Assert.DoesNotContain(catalog.Airlines, item => item.Name is "AIR BERLIN" or "THOMAS COOK" or "TAM AIRLINES" or "LANPERU");
        Assert.Contains(catalog.Airlines, item => item.Name == "AIR FRANCE" &&
            item.IataCode == "AF" && item.IcaoCode == "AFR");
        var command = new SubmitCommercialRequestCommand(Guid.NewGuid(),
            catalog.Airlines[0].Id, [catalog.Services[0].Id],
            "María Pérez", "Representante legal", "maria@example.test", "849-246-3371", true,
            "DO", "Avenida Principal 10", "República Dominicana", "Santo Domingo",
            "Boca Chica", "Passport", "rd 123 4567");
        var handler = new SubmitCommercialRequestHandler(
            scope.ServiceProvider.GetRequiredService<ICommercialIntakeStore>());
        Assert.Equal(CommercialSubmissionFailure.ReceiptNotFound,
            (await handler.LookupReceiptAsync(command, cancellationToken)).Failure);
        var submitted = await handler.HandleAsync(command, cancellationToken);
        Assert.True(submitted.IsSuccess);
        Assert.False(submitted.Replayed);
        Assert.True((await handler.HandleAsync(command, cancellationToken)).Replayed);
        Assert.Equal(submitted.Reference,
            (await handler.LookupReceiptAsync(command, cancellationToken)).Reference);
        Assert.Equal(CommercialSubmissionFailure.ReceiptNotFound,
            (await handler.LookupReceiptAsync(command with { RepresentativeTitle = "Director" },
                cancellationToken)).Failure);
        Assert.Equal(CommercialSubmissionFailure.Conflict,
            (await handler.HandleAsync(command with { RepresentativeTitle = "Director" }, cancellationToken)).Failure);

        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var request = await context.ServiceRequests.AsNoTracking()
            .SingleAsync(item => item.PublicId == command.RequestId, cancellationToken);
        Assert.Equal(catalog.Airlines[0].Name, request.RequestedAirlineName);
        Assert.True(request.AuthorityDeclared);
        Assert.Equal("DO", request.ContactNationalityCode);
        Assert.Equal("RD1234567", request.ContactDocumentNumber);
        Assert.Equal("+18492463371", request.ContactPhone);
        Assert.Null(request.ContactDistrict);

        // Dominican addresses follow the official division down to the municipal district.
        var seibo = command with
        {
            RequestId = Guid.NewGuid(), RepresentativeEmail = "seibo@example.test",
            RepresentativeProvince = "El Seibo", RepresentativeMunicipality = "El Seibo",
            RepresentativeDistrict = "Pedro Sánchez",
        };
        Assert.True((await handler.HandleAsync(seibo, cancellationToken)).IsSuccess);
        Assert.Equal("Pedro Sánchez", await context.ServiceRequests.AsNoTracking()
            .Where(item => item.PublicId == seibo.RequestId).Select(item => item.ContactDistrict)
            .SingleAsync(cancellationToken));
        Assert.Equal(CommercialSubmissionFailure.InvalidRequest, (await handler.HandleAsync(seibo with
        {
            RequestId = Guid.NewGuid(), RepresentativeMunicipality = "Pedro Sánchez", RepresentativeDistrict = null,
        }, cancellationToken)).Failure);
        Assert.Equal(1, await context.Set<ServiceRequestItem>().CountAsync(
            item => item.ServiceRequestId == request.Id, cancellationToken));

        var hiddenService = await context.ServiceDefinitions.SingleAsync(
            item => item.PublicId == catalog.Services[0].Id, cancellationToken);
        hiddenService.IsPublic = false;
        await context.SaveChangesAsync(cancellationToken);
        Assert.Equal(submitted.Reference,
            (await handler.LookupReceiptAsync(command, cancellationToken)).Reference);
        Assert.DoesNotContain((await scope.ServiceProvider.GetRequiredService<ICommercialCatalogStore>()
            .GetPublicAsync(cancellationToken)).Services, item => item.Id == hiddenService.PublicId);
        var hiddenRequest = command with { RequestId = Guid.NewGuid() };
        Assert.Equal(CommercialSubmissionFailure.ServiceUnavailable,
            (await handler.HandleAsync(hiddenRequest, cancellationToken)).Failure);
        Assert.False(await context.ServiceRequests.AnyAsync(
            item => item.PublicId == hiddenRequest.RequestId, cancellationToken));
    }

    [Fact]
    public async Task PublicIntakeHoldsServiceVisibilityUntilSubmissionCommits()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migrationContext = CreateContext(database.ConnectionString))
            await migrationContext.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seederContext = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seederContext).SeedAsync(InitialPasswords, cancellationToken);

        var blocker = new SavingChangesGate();
        var options = new DbContextOptionsBuilder<ElevantDbContext>()
            .UseSqlServer(database.ConnectionString, ElevantSqlServerOptions.Configure)
            .AddInterceptors(blocker).Options;
        await using var intakeContext = new ElevantDbContext(options);
        await using var catalogContext = CreateContext(database.ConnectionString);
        var catalog = await new EfCommercialCatalogStore(catalogContext)
            .GetPublicAsync(cancellationToken);
        var serviceId = catalog.Services[0].Id;
        var command = new SubmitCommercialRequestCommand(Guid.NewGuid(),
            catalog.Airlines[0].Id, [serviceId], "María Pérez", "Representante legal",
            "maria@example.test", "+1 809 555 0100", true);
        var submission = new EfCommercialIntakeStore(intakeContext)
            .SubmitAsync(command, cancellationToken);
        await blocker.Entered.WaitAsync(TimeSpan.FromSeconds(15), cancellationToken);

        await using var retirementConnection = new SqlConnection(database.ConnectionString);
        await retirementConnection.OpenAsync(cancellationToken);
        await using var retirement = retirementConnection.CreateCommand();
        retirement.CommandText = """
            SET LOCK_TIMEOUT 1000;
            UPDATE [ref].[service_definitions] SET [is_public] = 0
            WHERE [public_id] = @serviceId;
            """;
        retirement.Parameters.AddWithValue("@serviceId", serviceId);
        Exception? retirementFailure;
        try
        {
            retirementFailure = await Record.ExceptionAsync(async () =>
                await retirement.ExecuteNonQueryAsync(cancellationToken));
        }
        finally
        {
            blocker.Release();
        }
        Assert.True((await submission).IsSuccess);
        Assert.Equal(1222, Assert.IsType<SqlException>(retirementFailure).Number);
    }

    [Fact]
    public async Task RampProfileEditWithOmittedTerminalsPreservesTemporarilyInactiveScope()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seed = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seed).SeedAsync(InitialPasswords, cancellationToken);

        await using var provider = new ServiceCollection()
            .AddLogging().AddSingleton<TimeProvider>(TimeProvider.System)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString,
                }).Build()).BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var profiles = scope.ServiceProvider.GetRequiredService<IRampProfileStore>();
        var humanResourcesId = Guid.Parse("40000000-0000-7000-8000-000000000004");
        var station = await context.Stations.SingleAsync(item => item.Code == "PUJ",
            cancellationToken);
        var terminal = await context.Terminals.SingleAsync(item => item.Code == "A" &&
            item.StationId == station.Id && item.IsActive, cancellationToken);
        var input = new SaveRampProfileInput("Lucia", "Ramos", "SYNTHETIC-INACTIVE-TERMINAL",
            "Ramp agent", DateOnly.FromDateTime(DateTime.UtcNow), true, [station.PublicId]) with
        {
            TerminalIds = [terminal.PublicId],
        };
        var created = await profiles.SaveAsync(humanResourcesId, null, input, cancellationToken);
        Assert.Null(created.Failure);
        terminal.IsActive = false;
        await context.SaveChangesAsync(cancellationToken);

        var edited = await profiles.SaveAsync(humanResourcesId, created.Profile!.Id,
            input with { Category = "Lead ramp agent", TerminalIds = null }, cancellationToken);

        Assert.Null(edited.Failure);
        var agentId = await context.RampAgents.Where(item => item.PublicId == created.Profile.Id)
            .Select(item => item.Id).SingleAsync(cancellationToken);
        Assert.True(await context.Set<RampAgentTerminalScope>().AsNoTracking().AnyAsync(item =>
            item.RampAgentId == agentId && item.TerminalId == terminal.Id && item.ValidTo == null,
            cancellationToken));
        terminal.IsActive = true;
        await context.SaveChangesAsync(cancellationToken);
        Assert.Contains((await profiles.ListAsync(humanResourcesId, cancellationToken))!.Profiles,
            item => item.Id == created.Profile.Id &&
                item.Terminals!.Any(link => link.Id == terminal.PublicId));
    }

    [Fact]
    public async Task RampProfileEditPreservesItsExistingInactiveSupervisor()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seed = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seed).SeedAsync(InitialPasswords, cancellationToken);

        await using var provider = new ServiceCollection()
            .AddLogging().AddSingleton<TimeProvider>(TimeProvider.System)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString,
                }).Build()).BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var profiles = scope.ServiceProvider.GetRequiredService<IRampProfileStore>();
        var humanResourcesId = Guid.Parse("40000000-0000-7000-8000-000000000004");
        var supervisor = Assert.Single((await profiles.ListAsync(humanResourcesId,
            cancellationToken))!.Profiles, item => item.EmployeeNumber == "DEV-RA-001");
        var stationId = await context.Stations.Where(item => item.Code == "PUJ")
            .Select(item => item.PublicId).SingleAsync(cancellationToken);
        var input = new SaveRampProfileInput("Lucia", "Ramos", "SYNTHETIC-INACTIVE-SUPERVISOR",
            "Ramp agent", DateOnly.FromDateTime(DateTime.UtcNow), true, [stationId]) with
        {
            Supervisor = new RampProfileSupervisorSelection(supervisor.Id),
        };
        var created = await profiles.SaveAsync(humanResourcesId, null, input, cancellationToken);
        Assert.Null(created.Failure);
        var supervisorRow = await context.RampAgents.SingleAsync(item =>
            item.PublicId == supervisor.Id, cancellationToken);
        supervisorRow.IsActive = false;
        await context.SaveChangesAsync(cancellationToken);

        var edited = await profiles.SaveAsync(humanResourcesId, created.Profile!.Id,
            input with { Category = "Lead ramp agent" }, cancellationToken);

        Assert.Null(edited.Failure);
        Assert.Equal("Lead ramp agent", edited.Profile!.Category);
        Assert.Equal(supervisor.Id, edited.Profile.SupervisorProfileId);
    }

    [Fact]
    public async Task ContractsApprovalRequiresVerifiedAirlineAndCreatesDraftWithProvisioningHint()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migrationContext = CreateContext(database.ConnectionString))
            await migrationContext.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seederContext = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seederContext).SeedAsync(new DevelopmentAccountPasswords(
                InitialPasswords.AdminOcc, InitialPasswords.RampAgent,
                InitialPasswords.AirlineClient, InitialPasswords.HumanResources,
                InitialPasswords.Contracts, InitialPasswords.Finance,
                "Synthetic-SuperAdmin!234"), cancellationToken);

        await using var provider = new ServiceCollection()
            .AddLogging().AddSingleton<TimeProvider>(TimeProvider.System)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString,
                }).Build()).BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        var catalog = await scope.ServiceProvider.GetRequiredService<ICommercialCatalogStore>()
            .GetPublicAsync(cancellationToken);
        var intake = new SubmitCommercialRequestHandler(
            scope.ServiceProvider.GetRequiredService<ICommercialIntakeStore>());
        var requestId = Guid.NewGuid();
        Assert.True((await intake.HandleAsync(new SubmitCommercialRequestCommand(requestId,
            catalog.Airlines[0].Id, [catalog.Services[0].Id], "María Pérez",
            "Representante legal", "maria@example.test", "+1 809 555 0100", true, RepresentativeDocumentType: "NationalId", RepresentativeDocumentNumber: "00112345673"),
            cancellationToken)).IsSuccess);
        var contractsAccountId = Guid.Parse("40000000-0000-7000-8000-000000000005");
        var workflow = scope.ServiceProvider.GetRequiredService<ICommercialWorkflowStore>();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        Task<int> CountCommercialRequestChangesAsync() => context.OutboxMessages.AsNoTracking()
            .CountAsync(message => message.EventType == "account.changed.v1" &&
                message.PayloadJson.Contains("commercial_requests"), cancellationToken);
        var station = (await workflow.ListStationsAsync(contractsAccountId, cancellationToken))!.Single();
        var approval = new ReviewCommercialInput(true, null, [station.Id]);
        async Task<string> VersionOfAsync(Guid id) => (await workflow.ListInboxAsync(contractsAccountId,
                new CommercialInboxQuery(CommercialInboxQuery.All, null, 1, 50), cancellationToken))!
            .Requests.Single(item => item.Id == id).Version;
        // Approval needs the representative confirmed by Contratos (1-N18) and the airline verified.
        Assert.Equal("representative_unconfirmed",
            (await workflow.DecideAsync(contractsAccountId, requestId, approval, null, cancellationToken)).Code);
        Assert.True((await workflow.ConfirmRepresentativeAsync(contractsAccountId, requestId, Guid.NewGuid(),
            new ConfirmCommercialRepresentativeInput(await VersionOfAsync(requestId),
                "Llamada a la central de la aerolínea: confirmó la gerencia comercial."), cancellationToken)).IsSuccess);
        Assert.Equal(CommercialWorkflowFailure.AirlineUnverified,
            (await workflow.DecideAsync(contractsAccountId, requestId, approval, null, cancellationToken)).Failure);
        var requestChangesBeforeVerification = await CountCommercialRequestChangesAsync();
        Assert.True((await workflow.VerifyRequestAirlineAsync(contractsAccountId, requestId, Guid.NewGuid(),
            new VerifyRequestAirlineInput(await VersionOfAsync(requestId), null, "Test Carrier LLC", "DO",
                "ZX", "ZZX", "https://example.test/airline-record"),
            cancellationToken)).IsSuccess);
        Assert.True(await CountCommercialRequestChangesAsync() > requestChangesBeforeVerification,
            "Verifying an airline must invalidate other Contracts sessions.");
        var rejectedRequestId = Guid.NewGuid();
        Assert.True((await intake.HandleAsync(new SubmitCommercialRequestCommand(rejectedRequestId,
            catalog.Airlines[0].Id, [catalog.Services[0].Id], "Elena Rivera",
            "Representante legal", "elena@example.test", "+1 809 555 0101", true, RepresentativeDocumentType: "NationalId", RepresentativeDocumentNumber: "00112345673"),
            cancellationToken)).IsSuccess);
        var requestChangesBeforeRejection = await CountCommercialRequestChangesAsync();
        Assert.True((await workflow.DecideAsync(contractsAccountId, rejectedRequestId,
            new ReviewCommercialInput(false, "No se acreditó la representación.", []), null,
            cancellationToken)).IsSuccess);
        Assert.True(await CountCommercialRequestChangesAsync() > requestChangesBeforeRejection,
            "Rejecting a request must invalidate other Contracts sessions.");
        var requestChangesBeforeDecision = await CountCommercialRequestChangesAsync();
        var decided = await workflow.DecideAsync(contractsAccountId, requestId, approval, null,
            cancellationToken);
        Assert.True(decided.IsSuccess, decided.Failure?.ToString());
        Assert.True(await CountCommercialRequestChangesAsync() > requestChangesBeforeDecision,
            "Approving a request must invalidate other Contracts sessions.");
        var contract = await context.Contracts.AsNoTracking()
            .SingleAsync(item => item.PublicId == decided.ResourceId, cancellationToken);
        Assert.Equal(ContractStatus.Draft, contract.Status);
        var version = await context.ContractVersions.AsNoTracking()
            .SingleAsync(item => item.ContractId == contract.Id, cancellationToken);
        Assert.Equal(ContractVersionStatus.Draft, version.Status);
        Assert.Equal(1, await context.ContractServiceRates.CountAsync(item =>
            item.ContractVersionId == version.Id, cancellationToken));
        Assert.Contains(await context.OutboxMessages.AsNoTracking()
            .Select(item => item.PayloadJson).ToArrayAsync(cancellationToken),
            payload => payload.Contains("account_provisioning", StringComparison.Ordinal));

        var superAdminId = Guid.Parse("40000000-0000-7000-8000-000000000007");
        var provisioning = scope.ServiceProvider.GetRequiredService<ICommercialProvisioningStore>();
        Assert.Single((await provisioning.ListPendingAsync(superAdminId, cancellationToken))!);
        var provisioned = await provisioning.ProvisionAsync(superAdminId, requestId,
            new ProvisionAirlineInput("representative@example.test", "Synthetic-AirlineNew!234"), null,
            cancellationToken);
        Assert.True(provisioned.IsSuccess, provisioned.Failure?.ToString());
        Assert.Empty((await provisioning.ListPendingAsync(superAdminId, cancellationToken))!);
        // 1-N14: Contratos hears that the portal account exists, on the airline's draft.
        Assert.True(await context.DepartmentNotifications.AsNoTracking().AnyAsync(item =>
            item.Kind == "portal_account_ready" && item.SourceId == version.PublicId, cancellationToken));
        Assert.True((await context.Users.AsNoTracking().SingleAsync(item =>
            item.PublicId == provisioned.AccountId, cancellationToken)).MustChangePassword);
        Assert.Equal(ProvisioningFailure.Conflict,
            (await provisioning.ProvisionAsync(superAdminId, requestId,
                new ProvisionAirlineInput("other@example.test", "Synthetic-AirlineNew!234"), null,
                cancellationToken)).Failure);

        var drafts = scope.ServiceProvider.GetRequiredService<IContractDraftStore>();
        var overview = (await drafts.GetOverviewForContractsAsync(
            contractsAccountId, cancellationToken))!;
        Assert.Equal(1, overview.Count);
        Assert.Equal(version.PublicId, Assert.Single(overview.Recent).Id);
        Assert.Null(await drafts.GetOverviewForContractsAsync(
            provisioned.AccountId!.Value, cancellationToken));
        var airlineDraft = Assert.Single((await drafts.ListForAirlineAsync(
            provisioned.AccountId!.Value, cancellationToken))!);
        Assert.Equal(version.PublicId, airlineDraft.Id);
        // The draft prints as a watermarked review copy for its airline and Contratos only.
        var documents = scope.ServiceProvider.GetRequiredService<IContractDocumentStore>();
        var draftCopy = await documents.ReadDraftAsync(provisioned.AccountId.Value, airlineDraft.Id, cancellationToken);
        Assert.Null(draftCopy.Failure);
        Assert.Null(draftCopy.Document!.SignableBy);
        Assert.True(Elevant.Infrastructure.Commercial.ContractPdfRenderer.IsDraft(draftCopy.Document));
        Assert.Null((await documents.ReadDraftAsync(contractsAccountId, airlineDraft.Id, cancellationToken)).Failure);
        Assert.Equal(ContractDocumentFailure.Forbidden, (await documents.ReadDraftAsync(
            Guid.Parse("40000000-0000-7000-8000-000000000003"), airlineDraft.Id, cancellationToken)).Failure);
        Assert.Equal(ContractDocumentFailure.NotFound,
            (await documents.ReadAsync(provisioned.AccountId.Value, airlineDraft.Id, cancellationToken)).Failure);
        Assert.True((await drafts.AddAirlineCommentAsync(provisioned.AccountId.Value,
            airlineDraft.Id, new AirlineDraftCommentInput("Confirmar el horario de asistencia."), null, cancellationToken)).IsSuccess);
        await using (var commentsConnection = new SqlConnection(database.ConnectionString))
        {
            await commentsConnection.OpenAsync(cancellationToken);
            await using var commentsTransaction = await commentsConnection.BeginTransactionAsync(
                cancellationToken);
            await using var lockCommand = commentsConnection.CreateCommand();
            lockCommand.Transaction = (SqlTransaction)commentsTransaction;
            lockCommand.CommandText = "SELECT COUNT(*) FROM [commercial].[contract_draft_comments] WITH (TABLOCKX, HOLDLOCK);";
            await lockCommand.ExecuteScalarAsync(cancellationToken);
            context.Database.SetCommandTimeout(2);
            try
            {
                Assert.Equal(1, (await drafts.GetOverviewForContractsAsync(
                    contractsAccountId, cancellationToken))!.Count);
            }
            finally
            {
                context.Database.SetCommandTimeout(null);
                await commentsTransaction.RollbackAsync(cancellationToken);
            }
        }
        var managedDraft = Assert.Single((await drafts.ListForContractsAsync(
            contractsAccountId, cancellationToken))!);
        Assert.Single(managedDraft.Comments);
        Assert.Equal(ContractDraftFailure.Conflict,
            (await drafts.ActivateAsync(contractsAccountId, airlineDraft.Id, null, null,
                cancellationToken)).Failure);
        Assert.True((await drafts.UpdateAsync(contractsAccountId, airlineDraft.Id,
            new UpdateContractDraftInput(airlineDraft.ValidFrom, null, "USD",
                "Condiciones revisadas por Contratos.",
                airlineDraft.Rates.Select(rate => new UpdateDraftRateInput(
                    rate.Id, rate.BillingUnit, 100, 0, false)).ToArray()), null,
            cancellationToken)).IsSuccess);
        Assert.Equal(ContractDraftFailure.Conflict,
            (await drafts.ActivateAsync(contractsAccountId, airlineDraft.Id, null, null,
                cancellationToken)).Failure);
        Assert.True((await drafts.UpdateAsync(contractsAccountId, airlineDraft.Id,
            new UpdateContractDraftInput(airlineDraft.ValidFrom, null, "USD",
                "Condiciones revisadas por Contratos.",
                airlineDraft.Rates.Select(rate => new UpdateDraftRateInput(
                    rate.Id, rate.BillingUnit, 0, 0, true)).ToArray()), null,
            cancellationToken)).IsSuccess);
        var agreements = scope.ServiceProvider.GetRequiredService<IManagedContractReadStore>();
        Assert.DoesNotContain((await agreements.ListAsync(contractsAccountId, 1, 20,
            cancellationToken))!.Contracts, item => item.Code == contract.ContractCode);
        Assert.True((await drafts.ActivateAsync(contractsAccountId, airlineDraft.Id, null, null,
            cancellationToken)).IsSuccess);
        // Contracts only submits; the contract becomes active when Finance approves it.
        Assert.Equal(ContractStatus.Draft, (await context.Contracts.AsNoTracking()
            .SingleAsync(item => item.Id == contract.Id, cancellationToken)).Status);
        var tariffBook = scope.ServiceProvider.GetRequiredService<IFinanceTariffBookStore>();
        var financeAccountId = Guid.Parse("40000000-0000-7000-8000-000000000006");
        var pendingApproval = Assert.Single((await tariffBook.ListContractApprovalsAsync(financeAccountId, true,
            cancellationToken))!, item => item.VersionId == airlineDraft.Id);
        Assert.Equal("PendingFinanceApproval", pendingApproval.Status);
        Assert.Equal(FinanceCatalogFailure.Forbidden, (await tariffBook.DecideContractApprovalAsync(contractsAccountId,
            airlineDraft.Id, new DecideContractApprovalInput("Approved", null, pendingApproval.Version), null,
            cancellationToken)).Failure);
        Assert.True((await tariffBook.DecideContractApprovalAsync(financeAccountId, airlineDraft.Id,
            new DecideContractApprovalInput("Approved", null, pendingApproval.Version), null, cancellationToken)).IsSuccess);
        var financeAccountKey = await context.Users.AsNoTracking().Where(account =>
            account.PublicId == Guid.Parse("40000000-0000-7000-8000-000000000006"))
            .Select(account => account.Id).SingleAsync(cancellationToken);
        var stationInternalId = await context.Stations.AsNoTracking().Where(item =>
            item.PublicId == station.Id).Select(item => item.Id)
            .SingleAsync(cancellationToken);
        var tariffHint = Assert.Single((await context.OutboxMessages.AsNoTracking()
            .Where(message => message.EventType == "account.changed.v1")
            .ToArrayAsync(cancellationToken))
            .Select(AccountChangeOutboxWriter.Decode),
            change => change.Resource == "finance_tariffs" &&
                change.ResourceId == airlineDraft.Id);
        Assert.Equal(financeAccountKey, tariffHint.RecipientAccountId);
        Assert.Equal(stationInternalId, tariffHint.StationId);
        await scope.ServiceProvider.GetRequiredService<IAccountChangeDispatcherStore>()
            .DispatchPendingAsync(100, cancellationToken);
        var financeChanges = await scope.ServiceProvider.GetRequiredService<IAccountChangeReadStore>()
            .ReadAsync(Guid.Parse("40000000-0000-7000-8000-000000000006"), 0, 100,
                cancellationToken);
        Assert.Contains(Assert.IsType<AccountChangePage>(financeChanges).Changes,
            change => change.Resource == "finance_tariffs" &&
                change.ResourceId == airlineDraft.Id);
        Assert.Empty((await drafts.ListForAirlineAsync(provisioned.AccountId.Value,
            cancellationToken))!);
        Assert.Equal(0, (await drafts.GetOverviewForContractsAsync(
            contractsAccountId, cancellationToken))!.Count);
        // Finance approval alone does not activate it: both signatures and a verified permit come first (ADR-0024).
        Assert.Equal(ContractStatus.Draft, (await context.Contracts.AsNoTracking()
            .SingleAsync(item => item.Id == contract.Id, cancellationToken)).Status);
        var agreementPage = (await agreements.ListAsync(contractsAccountId, 1, 20,
            cancellationToken))!;
        var published = Assert.Single(agreementPage.Contracts,
            item => item.Code == contract.ContractCode);
        Assert.Equal((await context.Airlines.AsNoTracking().SingleAsync(item =>
            item.Id == contract.AirlineId, cancellationToken)).Name, published.Airline);
        Assert.Equal("Approved", Assert.Single(published.ApprovedVersions).Status);
        Assert.Single(Assert.Single(published.ApprovedVersions).Rates);
        var historicalVersion = await context.ContractVersions.SingleAsync(item =>
            item.Id == version.Id, cancellationToken);
        var historicalRate = await context.ContractServiceRates.SingleAsync(item =>
            item.ContractVersionId == version.Id, cancellationToken);
        var originalPrice = historicalRate.UnitPrice;
        historicalVersion.Status = ContractVersionStatus.Superseded;
        historicalRate.UnitPrice = 0.0001m;
        await context.SaveChangesAsync(cancellationToken);
        var historicalPage = (await agreements.ListAsync(contractsAccountId, 1, 20,
            cancellationToken))!;
        var historical = Assert.Single(historicalPage.Contracts,
            item => item.Code == contract.ContractCode);
        Assert.Equal("Superseded", Assert.Single(historical.ApprovedVersions).Status);
        Assert.Equal(0.0001m, Assert.Single(Assert.Single(historical.ApprovedVersions).Rates).UnitPrice);
        Assert.Contains(Assert.Single(historical.ApprovedVersions).Stations,
            item => item.Code == station.Code);
        historicalVersion.Status = ContractVersionStatus.Approved;
        historicalRate.UnitPrice = originalPrice;
        await context.SaveChangesAsync(cancellationToken);
        Assert.Null(await agreements.ListAsync(provisioned.AccountId.Value, 1, 20,
            cancellationToken));

        var governance = scope.ServiceProvider.GetRequiredService<IGovernanceStore>();
        var snapshot = (await governance.GetAsync(superAdminId, cancellationToken))!;
        Assert.Contains(snapshot.Roles, role => role.Code == "SUPERADMIN");
        var historicalAirline = await context.CommercialAirlineProfiles.SingleAsync(item =>
            item.SourceName == "AIR FRANCE", cancellationToken);
        historicalAirline.CountryCode = null;
        historicalAirline.LegalName = null;
        historicalAirline.IataCode = null;
        historicalAirline.IcaoCode = null;
        historicalAirline.VerificationSourceUrl = null;
        historicalAirline.VerifiedAt = null;
        historicalAirline.UpdatedAt = new DateTimeOffset(2026, 8, 17, 12, 0, 0, TimeSpan.Zero);
        var manuallyEditedAirline = await context.CommercialAirlineProfiles.SingleAsync(item =>
            item.SourceName == "AIR CANADA", cancellationToken);
        Assert.Equal("/assets/airlines/air-canada.png", manuallyEditedAirline.LogoObjectKey);
        manuallyEditedAirline.CountryCode = "XX";
        manuallyEditedAirline.UpdatedAt = DateTimeOffset.UtcNow;
        var historicalLogo = await context.CommercialAirlineProfiles.SingleAsync(item =>
            item.SourceName == "BRITISH AIRWAYS", cancellationToken);
        historicalLogo.LogoObjectKey = null;
        historicalLogo.UpdatedAt = new DateTimeOffset(2026, 8, 17, 12, 0, 0, TimeSpan.Zero);
        await context.SaveChangesAsync(cancellationToken);
        var airlineManager = scope.ServiceProvider.GetRequiredService<ICommercialAirlineManagementStore>();
        Assert.Equal(CatalogMutationFailure.Forbidden,
            (await airlineManager.EnrichHistoricalCatalogAsync(contractsAccountId, cancellationToken)).Failure);
        Assert.True((await airlineManager.EnrichHistoricalCatalogAsync(superAdminId, cancellationToken)).Changed > 0);
        Assert.Equal("AF", historicalAirline.IataCode);
        Assert.Equal("FR", historicalAirline.CountryCode);
        Assert.Equal("/assets/airlines/british-airways.png", historicalLogo.LogoObjectKey);
        Assert.Equal("XX", manuallyEditedAirline.CountryCode);
        var rampRole = Assert.Single(snapshot.Roles, role => role.Code == "RAMP_AGENT");
        // Employees of a ramp position may wait for their access request (ADR-0017); the seeded agent has one.
        Assert.Contains(snapshot.RampProfiles, profile => profile.EmployeeNumber == "DEV-RA-001" && profile.AccountId is not null);
        var humanResourcesAccountId = Guid.Parse("40000000-0000-7000-8000-000000000004");
        var rampProfiles = scope.ServiceProvider.GetRequiredService<IRampProfileStore>();
        var supervisorProfile = Assert.Single((await rampProfiles.ListAsync(
            humanResourcesAccountId, cancellationToken))!.Profiles,
            item => item.EmployeeNumber == "DEV-RA-001");
        var terminalId = Guid.Parse("20000000-0000-7000-8000-000000000004");
        var profileInput = new SaveRampProfileInput("Lucia", "Ramos", "SYNTHETIC-RA-2",
            "Ramp agent", DateOnly.FromDateTime(DateTime.UtcNow), true, [station.Id]) with
        {
            TerminalIds = [terminalId],
            Supervisor = new RampProfileSupervisorSelection(supervisorProfile.Id),
        };
        Assert.Null(await rampProfiles.ListAsync(contractsAccountId, cancellationToken));
        var savedProfile = await rampProfiles.SaveAsync(humanResourcesAccountId, null,
            profileInput, cancellationToken);
        Assert.Null(savedProfile.Failure);
        var newRampProfileId = savedProfile.Profile!.Id;
        Assert.Null(savedProfile.Profile.AccountStatus);
        Assert.Contains(savedProfile.Profile.Terminals!, item => item.Id == terminalId);
        Assert.Equal(supervisorProfile.Id, savedProfile.Profile.SupervisorProfileId);
        Assert.Contains((await rampProfiles.ListAsync(humanResourcesAccountId, cancellationToken))!.Profiles,
            profile => profile.Id == newRampProfileId && profile.Stations.Single().Id == station.Id &&
                profile.Terminals!.Single().Id == terminalId &&
                profile.SupervisorProfileId == supervisorProfile.Id);
        Assert.Contains((await rampProfiles.ListAsync(humanResourcesAccountId,
            cancellationToken))!.AvailableTerminals!, item =>
            item.Id == terminalId && item.StationId == station.Id);
        Assert.Equal(RampProfileFailure.Invalid, (await rampProfiles.SaveAsync(
            humanResourcesAccountId, supervisorProfile.Id, profileInput with
            {
                FirstName = supervisorProfile.FirstName,
                LastName = supervisorProfile.LastName,
                EmployeeNumber = supervisorProfile.EmployeeNumber,
                Category = supervisorProfile.Category,
                HireDate = supervisorProfile.HireDate,
                Supervisor = new RampProfileSupervisorSelection(newRampProfileId),
            }, cancellationToken)).Failure);
        var legacyProfileUpdate = await rampProfiles.SaveAsync(humanResourcesAccountId,
            newRampProfileId, profileInput with { TerminalIds = null, Supervisor = null },
            cancellationToken);
        Assert.Null(legacyProfileUpdate.Failure);
        Assert.Contains(legacyProfileUpdate.Profile!.Terminals!, item => item.Id == terminalId);
        Assert.Equal(supervisorProfile.Id, legacyProfileUpdate.Profile.SupervisorProfileId);
        Assert.Equal(GovernanceFailure.Invalid,
            (await governance.CreateUserAsync(superAdminId,
                new CreateGovernanceUserInput("Lucia", "Ramos", "lucia@example.test",
                    rampRole.Id, "Synthetic-Ramp!5678"), cancellationToken)).Failure);
        var rampAccount = await governance.CreateUserAsync(superAdminId,
            new CreateGovernanceUserInput("Lucia", "Ramos", "lucia@example.test",
                rampRole.Id, "Synthetic-Ramp!5678", newRampProfileId), cancellationToken);
        Assert.True(rampAccount.IsSuccess, rampAccount.Failure?.ToString());
        var rampCreationAudit = Assert.Single(await context.AuditEntries.AsNoTracking()
            .Where(item => item.Action == "governance.user.created" &&
                item.EntityPublicId == rampAccount.Id)
            .ToArrayAsync(cancellationToken));
        Assert.Equal(await context.Stations.Where(item => item.PublicId == station.Id)
            .Select(item => item.Id).SingleAsync(cancellationToken),
            rampCreationAudit.StationId);
        Assert.True((await governance.DeleteUserAsync(superAdminId, rampAccount.Id!.Value,
            cancellationToken)).IsSuccess);
        Assert.True((await governance.DeleteUserAsync(superAdminId, rampAccount.Id.Value,
            cancellationToken)).IsSuccess);
        Assert.Equal(1, await context.AuditEntries.AsNoTracking().CountAsync(item =>
            item.Action == "governance.user.deactivated" &&
            item.EntityPublicId == rampAccount.Id, cancellationToken));
        Assert.True((await governance.UpdateUserAsync(superAdminId, rampAccount.Id.Value,
            new UpdateGovernanceUserInput("Lucia", "Ramos", "lucia@example.test",
                rampRole.Id, true, newRampProfileId), cancellationToken)).IsSuccess);
        var movementAudits = await context.AuditEntries.AsNoTracking()
            .Where(item => (item.Action == "governance.user.deactivated" ||
                item.Action == "governance.user.updated") &&
                item.EntityPublicId == rampAccount.Id)
            .OrderBy(item => item.OccurredAt).ToArrayAsync(cancellationToken);
        Assert.Equal(2, movementAudits.Length);
        Assert.All(movementAudits, item => Assert.Equal(rampCreationAudit.StationId,
            item.StationId));
        var reportDate = DateOnly.FromDateTime(DateTime.UtcNow);
        var movementReport = await scope.ServiceProvider
            .GetRequiredService<IHumanResourcesReportStore>()
            .ListAccountMovementsAsync(humanResourcesAccountId, station.Id,
                reportDate.AddDays(-1), reportDate.AddDays(1), 1, 20,
                cancellationToken);
        Assert.Null(movementReport.Failure);
        Assert.Equal(["Created", "Deactivated", "Reactivated"],
            movementReport.Page!.Rows.Where(item => item.AccountId == rampAccount.Id)
                .Select(item => item.Kind).ToArray());
        await context.Database.ExecuteSqlRawAsync(
            """CREATE TRIGGER audit.tr_hr_movement_failure ON audit.audit_entries AFTER INSERT AS BEGIN IF EXISTS (SELECT 1 FROM inserted WHERE action = 'governance.user.deactivated') THROW 51000, 'Synthetic audit rejection', 1; END""",
            cancellationToken);
        try
        {
            await Assert.ThrowsAnyAsync<Exception>(() => governance.DeleteUserAsync(
                superAdminId, rampAccount.Id.Value, cancellationToken));
        }
        finally
        {
            await context.Database.ExecuteSqlRawAsync(
                "DROP TRIGGER audit.tr_hr_movement_failure", cancellationToken);
        }
        Assert.Equal(AccountLifecycleStatus.Active, await context.Users.AsNoTracking()
            .Where(item => item.PublicId == rampAccount.Id)
            .Select(item => item.Status).SingleAsync(cancellationToken));
        context.ChangeTracker.Clear();
        Assert.Contains((await governance.GetAsync(superAdminId, cancellationToken))!.RampProfiles,
            profile => profile.Id == newRampProfileId && profile.AccountId == rampAccount.Id);
        Assert.Contains((await rampProfiles.ListAsync(humanResourcesAccountId,
            cancellationToken))!.Profiles, profile =>
            profile.Id == newRampProfileId && profile.AccountStatus == "Active");
        var rampActor = await scope.ServiceProvider.GetRequiredService<IActorContextResolver>()
            .ResolveAsync(rampAccount.Id!.Value, cancellationToken);
        Assert.NotNull(rampActor);
        Assert.True(RampOperationsAccess.IsAuthorized(rampActor));
        var spareAirportId = await context.Airports.Where(item => item.IataCode == "MIA")
            .Select(item => item.Id).SingleAsync(cancellationToken);
        var extraStation = new Station
        {
            PublicId = Guid.CreateVersion7(), AirportId = spareAirportId,
            Code = "MIA", Name = "Synthetic second station",
            IanaTimeZone = "America/New_York", IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        context.Stations.Add(extraStation);
        await context.SaveChangesAsync(cancellationToken);
        Assert.Equal(RampProfileFailure.Invalid, (await rampProfiles.SaveAsync(
            humanResourcesAccountId, newRampProfileId, profileInput with
            { StationIds = [extraStation.PublicId] }, cancellationToken)).Failure);
        Assert.Equal(RampProfileFailure.Invalid, (await rampProfiles.SaveAsync(
            humanResourcesAccountId, newRampProfileId, profileInput with
            { Supervisor = new RampProfileSupervisorSelection(newRampProfileId) },
            cancellationToken)).Failure);
        var expandedProfile = await rampProfiles.SaveAsync(humanResourcesAccountId,
            newRampProfileId, profileInput with
            { StationIds = [station.Id, extraStation.PublicId] }, cancellationToken);
        Assert.Null(expandedProfile.Failure);
        Assert.Contains(expandedProfile.Profile!.Stations, item => item.Id == extraStation.PublicId);
        var rampAccountKey = await context.Users.Where(item => item.PublicId == rampAccount.Id)
            .Select(item => item.Id).SingleAsync(cancellationToken);
        Assert.False(await context.AccountStationScopes.AnyAsync(item =>
            item.AccountId == rampAccountKey && item.StationId == extraStation.Id &&
            item.RevokedAt == null, cancellationToken));
        var clearedProfile = await rampProfiles.SaveAsync(humanResourcesAccountId,
            newRampProfileId, profileInput with
            { TerminalIds = [], Supervisor = new RampProfileSupervisorSelection(null) },
            cancellationToken);
        Assert.Null(clearedProfile.Failure);
        Assert.Empty(clearedProfile.Profile!.Terminals!);
        Assert.Null(clearedProfile.Profile.SupervisorProfileId);
        Assert.Null((await rampProfiles.SaveAsync(contractsAccountId, newRampProfileId,
            profileInput with { IsActive = false }, cancellationToken)).Profile);
        Assert.NotNull((await rampProfiles.SaveAsync(humanResourcesAccountId, newRampProfileId,
            profileInput with { IsActive = false }, cancellationToken)).Profile);
        Assert.Contains((await rampProfiles.ListAsync(humanResourcesAccountId,
            cancellationToken))!.Profiles, profile =>
            profile.Id == newRampProfileId && profile.AccountStatus == "Disabled");
        Assert.Null(await scope.ServiceProvider.GetRequiredService<IActorContextResolver>()
            .ResolveAsync(rampAccount.Id.Value, cancellationToken));
        var catalogCreatorRole = await governance.CreateRoleAsync(superAdminId,
            new SaveGovernanceRoleInput("Creador de servicios", null,
                ["commercial.catalog.read", "commercial.catalog.create"], true), cancellationToken);
        Assert.True(catalogCreatorRole.IsSuccess);
        var catalogCreator = await governance.CreateUserAsync(superAdminId,
            new CreateGovernanceUserInput("Luis", "Santos", "luis@example.test",
                catalogCreatorRole.Id!.Value, "Synthetic-Catalog!234"), cancellationToken);
        Assert.True(catalogCreator.IsSuccess);
        var managedCatalog = scope.ServiceProvider.GetRequiredService<ICommercialCatalogManagementStore>();
        // Contracts owns the catalog: Finance cannot create services, a legacy role with «create» can.
        Assert.Equal(CatalogMutationFailure.Forbidden, (await managedCatalog.SaveAsync(FinanceAccount, null,
            new ManagedServiceInput("TEST-RAMP", "Servicio de prueba", "Descripción sintética", "operación", null, null, 999, false, true, null), null, cancellationToken)).Failure);
        var createdService = await managedCatalog.SaveAsync(catalogCreator.Id!.Value, null,
            new ManagedServiceInput("TEST-RAMP", "Servicio de prueba", "Descripción sintética",
                "operación", null, null, 999, false, true, null), null, cancellationToken);
        Assert.Null(createdService.Failure);
        Assert.Equal(CatalogMutationFailure.Forbidden,
            (await managedCatalog.SaveAsync(catalogCreator.Id.Value, createdService.Service!.Id,
                new ManagedServiceInput("TEST-RAMP", "Edición", "Descripción sintética",
                    "operación", null, null, 999, false, true, createdService.Service.Version), null,
                cancellationToken)).Failure);
        Assert.Equal(CatalogMutationFailure.Forbidden,
            (await managedCatalog.DeleteAsync(catalogCreator.Id.Value,
                createdService.Service.Id, createdService.Service.Version, null, cancellationToken)).Failure);
        var createdRole = await governance.CreateRoleAsync(superAdminId,
            new SaveGovernanceRoleInput("Revisor comercial", "Lectura de solicitudes",
                ["commercial.requests.read"], true), cancellationToken);
        Assert.True(createdRole.IsSuccess, createdRole.Failure?.ToString());
        var createdUser = await governance.CreateUserAsync(superAdminId,
            new CreateGovernanceUserInput("Elena", "Rivera", "elena@example.test",
                createdRole.Id!.Value, "Synthetic-Reviewer!234"), cancellationToken);
        Assert.True(createdUser.IsSuccess, createdUser.Failure?.ToString());
        Assert.Equal(["commercial.requests.read"],
            await governance.GetMyPermissionsAsync(createdUser.Id!.Value, cancellationToken));
        Assert.NotNull(await scope.ServiceProvider.GetRequiredService<IAccountChangeReadStore>()
            .ReadAsync(createdUser.Id.Value, 0, 20, cancellationToken));
        Assert.Null(await governance.GetAsync(createdUser.Id.Value, cancellationToken));
        Assert.Equal(GovernanceFailure.Conflict,
            (await governance.DeleteRoleAsync(superAdminId, createdRole.Id.Value,
                cancellationToken)).Failure);
        Assert.Equal(GovernanceFailure.Protected,
            (await governance.DeleteUserAsync(superAdminId, superAdminId,
                cancellationToken)).Failure);
        Assert.True((await governance.UpdateRoleAsync(superAdminId, createdRole.Id.Value,
            new SaveGovernanceRoleInput("Revisor comercial", "Lectura y edición",
                ["commercial.requests.read", "commercial.requests.write"], true),
            cancellationToken)).IsSuccess);
        Assert.Equal(["commercial.requests.read", "commercial.requests.write"],
            await governance.GetMyPermissionsAsync(createdUser.Id.Value, cancellationToken));
        var auditPage = (await governance.GetAuditAsync(superAdminId, 1, 10, cancellationToken))!;
        Assert.Equal(10, auditPage.Entries.Count);
        Assert.Contains(auditPage.Entries, entry => entry.Action == "governance.role.updated" &&
            entry.Actor == "Ariana Gobernanza" &&
            entry.Changes.Any(change => change.Field == "role.permissions" &&
                change.Before == "commercial.requests.read" &&
                change.After!.Contains("commercial.requests.write", StringComparison.Ordinal)));
        Assert.DoesNotContain(auditPage.Entries.SelectMany(entry => entry.Changes),
            change => change.Field.Contains("password", StringComparison.OrdinalIgnoreCase) ||
                change.Field.Contains("email", StringComparison.OrdinalIgnoreCase));
        Assert.Null(await governance.GetAuditAsync(createdUser.Id.Value, 1, 10, cancellationToken));
        Assert.True((await governance.UpdateUserAsync(superAdminId, createdUser.Id!.Value,
            new UpdateGovernanceUserInput("Elena", "Rivera", "elena2@example.test",
                createdRole.Id.Value, true), cancellationToken)).IsSuccess);
        Assert.True((await governance.DeleteUserAsync(superAdminId, createdUser.Id.Value,
            cancellationToken)).IsSuccess);
        Assert.Null(await governance.GetMyPermissionsAsync(createdUser.Id.Value, cancellationToken));
        Assert.True((await governance.DeleteRoleAsync(superAdminId, createdRole.Id.Value,
            cancellationToken)).IsSuccess);
        Assert.Equal(GovernanceFailure.Protected,
            (await governance.DeleteRoleAsync(superAdminId,
                snapshot.Roles.Single(role => role.Code == "SUPERADMIN").Id,
                cancellationToken)).Failure);
    }

    private const string MasterConnectionEnvironmentVariable = "ELEVANT_TEST_SQLSERVER_MASTER";
    private static readonly DevelopmentAccountPasswords InitialPasswords = new(
        "Synthetic-Admin!234",
        "Synthetic-Ramp!2345",
        "Synthetic-Airline!234",
        "Synthetic-HumanResources!234",
        "Synthetic-Contracts!234",
        "Synthetic-Finance!234");
    private static readonly DevelopmentAccountPasswords RotatedPasswords = new(
        "Rotated-Admin!5678",
        InitialPasswords.RampAgent,
        InitialPasswords.AirlineClient,
        InitialPasswords.HumanResources,
        InitialPasswords.Contracts,
        InitialPasswords.Finance);

    [Fact]
    public void DevelopmentPasswordsRejectSharedOrWeakSecrets()
    {
        Assert.Throws<InvalidOperationException>(() => new DevelopmentAccountPasswords(
            "Synthetic-Shared!234",
            "Synthetic-Shared!234",
            "Synthetic-Airline!234",
            "Synthetic-HumanResources!234",
            "Synthetic-Contracts!234",
            "Synthetic-Finance!234"));
        Assert.Throws<InvalidOperationException>(() => new DevelopmentAccountPasswords(
            "all-lowercase-password",
            "Synthetic-Ramp!2345",
            "Synthetic-Airline!234",
            "Synthetic-HumanResources!234",
            "Synthetic-Contracts!234",
            "Synthetic-Finance!234"));
        Assert.Throws<InvalidOperationException>(() => new DevelopmentAccountPasswords(
            "REPLACE_ME_AdminAccount!2026",
            "Synthetic-Ramp!2345",
            "Synthetic-Airline!234",
            "Synthetic-HumanResources!234",
            "Synthetic-Contracts!234",
            "Synthetic-Finance!234"));
    }

    [Fact]
    public async Task PasswordChangeUsesTheRetryingSqlStrategyAndPreservesOneAuditEntry()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migrationContext = CreateContext(database.ConnectionString))
        {
            await migrationContext.Database.MigrateAsync(cancellationToken);
        }
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seederContext = CreateContext(seederConnection))
        {
            await new DevelopmentDataSeeder(seederContext).SeedAsync(InitialPasswords, cancellationToken);
        }

        await using var provider = new ServiceCollection()
            .AddLogging()
            .AddSingleton<TimeProvider>(TimeProvider.System)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString,
                }).Build())
            .BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IPasswordChangeStore>();
        var accountId = Guid.Parse("40000000-0000-7000-8000-000000000005");
        const string newPassword = "Synthetic-ContractsRotated!234";

        Assert.Equal(PasswordChangeOutcome.Succeeded, await store.ChangeAsync(
            accountId, InitialPasswords.Contracts, newPassword, cancellationToken));
        Assert.Equal(PasswordChangeOutcome.InvalidCredentials, await store.ChangeAsync(
            accountId, InitialPasswords.Contracts, "Synthetic-AnotherContracts!234", cancellationToken));

        await using var inspection = CreateContext(database.ConnectionString);
        var account = await inspection.Users.AsNoTracking().SingleAsync(
            item => item.PublicId == accountId, cancellationToken);
        Assert.False(account.MustChangePassword);
        var hasher = new PasswordHasher<ApplicationUser>();
        Assert.NotEqual(PasswordVerificationResult.Failed,
            hasher.VerifyHashedPassword(account, account.PasswordHash!, newPassword));
        Assert.Equal(PasswordVerificationResult.Failed,
            hasher.VerifyHashedPassword(account, account.PasswordHash!, InitialPasswords.Contracts));
        Assert.Equal(1, await inspection.AuditEntries.AsNoTracking().CountAsync(
            entry => entry.EntityPublicId == accountId &&
                entry.Action == "identity.password.changed",
            cancellationToken));
    }

    [Fact]
    public async Task AffiliationOptionsExcludeInactiveStationsAndServices()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seederContext = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seederContext).SeedAsync(InitialPasswords, cancellationToken);

        await using (var change = CreateContext(database.ConnectionString))
        {
            var station = await change.Stations.SingleAsync(item => item.Code == "PUJ", cancellationToken);
            var service = await change.ServiceDefinitions.SingleAsync(
                item => item.Code == "BAGGAGE", cancellationToken);
            var passengerBridge = await change.ServiceDefinitions.SingleAsync(
                item => item.Code == "PASSENGER-BRIDGE", cancellationToken);
            station.IsActive = false;
            service.IsActive = false;
            passengerBridge.IsPublic = true;
            await change.SaveChangesAsync(cancellationToken);
        }

        await using var provider = new ServiceCollection()
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString,
                }).Build())
            .BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        var options = await scope.ServiceProvider.GetRequiredService<IAffiliationStore>()
            .GetOptionsAsync(cancellationToken);

        Assert.DoesNotContain(options.Stations, item => item.Code == "PUJ");
        Assert.DoesNotContain(options.Services, item => item.Code == "BAGGAGE");
        Assert.Contains(options.Services, item => item.Code == "PASSENGER-BRIDGE");
    }

    [Fact]
    public async Task AffiliationOptionsStayBoundedWhenTheCatalogGrows()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seederContext = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seederContext).SeedAsync(InitialPasswords, cancellationToken);

        await using (var change = CreateContext(database.ConnectionString))
        {
            var baggage = await change.ServiceDefinitions.SingleAsync(
                item => item.Code == "BAGGAGE", cancellationToken);
            baggage.IsPublic = true;
            var airports = Enumerable.Range(0, 60).Select(index => new Airport
            {
                IataCode = $"T{index:D2}",
                IcaoCode = $"KT{index:D2}",
                Name = $"Test airport {index:D2}",
                City = "Synthetic city",
                CountryCode = "DO",
            }).ToArray();
            change.Airports.AddRange(airports);
            await change.SaveChangesAsync(cancellationToken);
            change.Stations.AddRange(airports.Select(airport => new Station
            {
                AirportId = airport.Id,
                Code = airport.IataCode,
                Name = airport.Name,
                IanaTimeZone = "America/Santo_Domingo",
                IsActive = true,
            }));
            change.ServiceDefinitions.AddRange(Enumerable.Range(0, 110).Select(index => new ServiceDefinition
            {
                Code = $"EXTRA-{index:D3}",
                Name = $"Test service {index:D3}",
                DefaultBillingUnit = "operation",
                IsActive = true,
                IsPublic = true,
            }));
            await change.SaveChangesAsync(cancellationToken);
        }

        await using var provider = new ServiceCollection()
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString,
                }).Build())
            .BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        var options = await scope.ServiceProvider.GetRequiredService<IAffiliationStore>()
            .GetOptionsAsync(cancellationToken);

        Assert.Equal(50, options.Stations.Count);
        Assert.Equal(100, options.Services.Count);
        Assert.Equal("PUJ", options.Stations[0].Code);
        Assert.Equal("BAGGAGE", options.Services[0].Code);
    }

    [Fact]
    public async Task AirlinePortalReadStoreReturnsOnlyActiveContractStations()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migrationContext = CreateContext(database.ConnectionString))
        {
            await migrationContext.Database.MigrateAsync(cancellationToken);
        }
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seederContext = CreateContext(seederConnection))
        {
            await new DevelopmentDataSeeder(seederContext).SeedAsync(InitialPasswords, cancellationToken);
        }

        await using var provider = new ServiceCollection()
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString,
                }).Build())
            .BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IAirlinePortalReadStore>();
        var organizationId = Guid.Parse("10000000-0000-7000-8000-000000000002");

        var active = await store.GetBootstrapAsync(
            organizationId, new DateOnly(2026, 9, 25), cancellationToken);
        Assert.NotNull(active);
        Assert.Equal(organizationId, active.OrganizationId);
        Assert.Equal("Demo Airlines", active.Name);
        Assert.Collection(active.Stations, station => Assert.Equal("PUJ", station.Code));
        Assert.Empty(active.CurrentOperations);

        var fixtureDate = await store.GetBootstrapAsync(
            organizationId, new DateOnly(2026, 8, 18), cancellationToken);
        Assert.NotNull(fixtureDate);
        Assert.Collection(fixtureDate.CurrentOperations,
            operation =>
            {
                Assert.Equal("DEV-TAT-0001", operation.Code);
                Assert.Equal("ZZ100", operation.ArrivalFlightNumber);
                Assert.Equal("ZZ101", operation.DepartureFlightNumber);
                Assert.Equal("PUJ", operation.StationCode);
            },
            operation =>
            {
                Assert.Equal("DEV-TAT-0002", operation.Code);
                Assert.Equal("ZZ102", operation.ArrivalFlightNumber);
                Assert.Equal("ZZ103", operation.DepartureFlightNumber);
            });

        var expired = await store.GetBootstrapAsync(
            organizationId, new DateOnly(2100, 1, 1), cancellationToken);
        Assert.NotNull(expired);
        Assert.Empty(expired.Stations);
        Assert.Empty(expired.CurrentOperations);
        Assert.Null(await store.GetBootstrapAsync(
            Guid.NewGuid(), new DateOnly(2026, 9, 25), cancellationToken));

        var contracts = await store.GetContractsAsync(
            organizationId, 1, 20, cancellationToken);
        Assert.NotNull(contracts);
        Assert.False(contracts.HasMore);
        var ownContract = Assert.Single(contracts.Contracts);
        Assert.Equal("DEV-CONTRACT-0001", ownContract.Code);
        var approved = Assert.Single(ownContract.ApprovedVersions);
        Assert.Equal(1, approved.VersionNumber);
        Assert.Equal("USD", approved.CurrencyCode);
        Assert.Collection(approved.Stations, station => Assert.Equal("PUJ", station.Code));
        Assert.Equal(2, approved.Rates.Count);
        Assert.Contains(approved.Rates, rate => rate.UnitPrice == 125.50m &&
            rate.BillingUnit == "operation");
        Assert.Null(await store.GetContractsAsync(Guid.NewGuid(), 1, 20, cancellationToken));

        Guid foreignOperationId;
        await using (var update = CreateContext(database.ConnectionString))
        {
            var contract = await update.Contracts.SingleAsync(item =>
                item.ContractCode == "DEV-CONTRACT-0001", cancellationToken);
            contract.Status = ContractStatus.Expired;
            var version = await update.ContractVersions.SingleAsync(item =>
                item.ContractId == contract.Id && item.VersionNumber == 1,
                cancellationToken);
            version.ValidTo = new DateOnly(2026, 8, 31);
            version.Status = ContractVersionStatus.Superseded;
            update.ContractVersions.Add(new ContractVersion
            {
                PublicId = Guid.NewGuid(),
                ContractId = contract.Id,
                VersionNumber = 2,
                Status = ContractVersionStatus.Draft,
                ValidFrom = new DateOnly(2026, 9, 1),
                CurrencyCode = "USD",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            var sameAirlineContract = new Contract
            {
                PublicId = Guid.NewGuid(),
                AirlineId = contract.AirlineId,
                ContractCode = "DEV-CONTRACT-0002",
                Status = ContractStatus.Active,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            update.Contracts.Add(sameAirlineContract);
            await update.SaveChangesAsync(cancellationToken);
            update.ContractVersions.Add(new ContractVersion
            {
                PublicId = Guid.NewGuid(),
                ContractId = sameAirlineContract.Id,
                VersionNumber = 1,
                Status = ContractVersionStatus.Approved,
                ValidFrom = new DateOnly(2026, 9, 1),
                CurrencyCode = "USD",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            var foreignOrganization = new Organization
            {
                PublicId = Guid.NewGuid(),
                Code = "OTHER-AIR",
                LegalName = "OTHER TEST AIRLINE",
                DisplayName = "Other Test Airline",
                Type = OrganizationType.AirlineCustomer,
                Status = OrganizationStatus.Active,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            update.Organizations.Add(foreignOrganization);
            await update.SaveChangesAsync(cancellationToken);
            var foreignAirline = new Airline
            {
                PublicId = Guid.NewGuid(),
                OrganizationId = foreignOrganization.Id,
                IataCode = "XY",
                IcaoCode = "DXY",
                Name = "Other Test Airline",
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            update.Airlines.Add(foreignAirline);
            await update.SaveChangesAsync(cancellationToken);
            var foreignContract = new Contract
            {
                PublicId = Guid.NewGuid(),
                AirlineId = foreignAirline.Id,
                ContractCode = "OTHER-CONTRACT-0001",
                Status = ContractStatus.Active,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            update.Contracts.Add(foreignContract);
            await update.SaveChangesAsync(cancellationToken);
            var foreignVersion = new ContractVersion
            {
                PublicId = Guid.NewGuid(),
                ContractId = foreignContract.Id,
                VersionNumber = 1,
                Status = ContractVersionStatus.Approved,
                ValidFrom = new DateOnly(2026, 1, 1),
                CurrencyCode = "USD",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            update.ContractVersions.Add(foreignVersion);
            await update.SaveChangesAsync(cancellationToken);
            var pujStation = await update.Stations.SingleAsync(
                station => station.Code == "PUJ", cancellationToken);
            update.Set<ContractVersionStation>().Add(new ContractVersionStation
            {
                ContractVersionId = foreignVersion.Id,
                StationId = pujStation.Id,
            });
            var foreignTurnaround = new Turnaround
            {
                PublicId = Guid.NewGuid(),
                OperationCode = "AAA-TAT-FOREIGN",
                AirlineId = foreignAirline.Id,
                StationId = pujStation.Id,
                OperationDate = new DateOnly(2026, 8, 19),
                CurrentStatus = TurnaroundStatus.Confirmed,
                Source = OperationalDataSource.Internal,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            update.Turnarounds.Add(foreignTurnaround);
            await update.SaveChangesAsync(cancellationToken);
            foreignOperationId = Guid.NewGuid();
            update.GroundOperations.Add(new GroundOperation
            {
                PublicId = foreignOperationId,
                TurnaroundId = foreignTurnaround.Id,
                CurrentStatus = GroundOperationStatus.Assigned,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            var airlineAccount = await update.Users.SingleAsync(account =>
                account.PublicId == Guid.Parse("40000000-0000-7000-8000-000000000003"),
                cancellationToken);
            var requestedAt = new DateTimeOffset(2026, 8, 19, 12, 3, 0, TimeSpan.Zero);
            update.Set<OperationalServiceRequest>().AddRange(
                new OperationalServiceRequest
                {
                    PublicId = Guid.NewGuid(), AirlineId = foreignAirline.Id,
                    StationId = pujStation.Id, TurnaroundId = foreignTurnaround.Id,
                    RequestedByAccountId = airlineAccount.Id,
                    Status = OperationalRequestStatus.Submitted,
                    RequestedServiceName = "Foreign request", Description = "Other tenant.",
                    RequestedAt = requestedAt, CreatedAt = requestedAt, UpdatedAt = requestedAt,
                },
                new OperationalServiceRequest
                {
                    PublicId = Guid.NewGuid(), AirlineId = contract.AirlineId,
                    StationId = pujStation.Id, TurnaroundId = foreignTurnaround.Id,
                    RequestedByAccountId = airlineAccount.Id,
                    Status = OperationalRequestStatus.Submitted,
                    RequestedServiceName = "Incoherent request", Description = "Wrong turnaround tenant.",
                    RequestedAt = requestedAt, CreatedAt = requestedAt, UpdatedAt = requestedAt,
                });
            await update.SaveChangesAsync(cancellationToken);
        }

        var history = await store.GetContractsAsync(organizationId, 1, 1, cancellationToken);
        Assert.NotNull(history);
        Assert.True(history.HasMore);
        Assert.Equal("Expired", Assert.Single(history.Contracts).Status);
        Assert.Equal(1, Assert.Single(Assert.Single(history.Contracts).ApprovedVersions).VersionNumber);
        var secondPage = await store.GetContractsAsync(organizationId, 2, 1, cancellationToken);
        Assert.NotNull(secondPage);
        Assert.False(secondPage.HasMore);
        Assert.Equal("DEV-CONTRACT-0002", Assert.Single(secondPage.Contracts).Code);
        Assert.Empty((await store.GetContractsAsync(organizationId, 3, 1, cancellationToken))!.Contracts);

        var firstOperationPage = await store.GetOperationsAsync(
            organizationId, 1, 1, cancellationToken);
        Assert.NotNull(firstOperationPage);
        Assert.True(firstOperationPage.HasMore);
        Assert.Equal("DEV-TAT-0002", Assert.Single(firstOperationPage.Operations).Code);

        var secondOperationPage = await store.GetOperationsAsync(
            organizationId, 2, 1, cancellationToken);
        Assert.NotNull(secondOperationPage);
        Assert.False(secondOperationPage.HasMore);
        Assert.Equal("DEV-TAT-0001", Assert.Single(secondOperationPage.Operations).Code);
        var historicalOperationId = Assert.Single(secondOperationPage.Operations).Id;
        var detail = await store.GetOperationAsync(
            organizationId, historicalOperationId, cancellationToken);
        Assert.NotNull(detail);
        Assert.Equal("DEV-TAT-0001", detail.Code);
        Assert.Null(await store.GetOperationAsync(
            organizationId, Guid.NewGuid(), cancellationToken));
        Assert.Null(await store.GetOperationAsync(
            Guid.NewGuid(), historicalOperationId, cancellationToken));
        Assert.Null(await store.GetOperationAsync(
            organizationId, foreignOperationId, cancellationToken));
        Assert.Null(await store.GetOperationsAsync(Guid.NewGuid(), 1, 20, cancellationToken));

        var requests = await store.GetRequestsAsync(
            organizationId, 1, 20, cancellationToken);
        Assert.NotNull(requests);
        Assert.False(requests.HasMore);
        var ownRequest = Assert.Single(requests.Requests);
        Assert.Equal("Escalera adicional", ownRequest.ServiceName);
        Assert.Equal("DEV-TAT-0002", ownRequest.OperationCode);
        Assert.Null(await store.GetRequestsAsync(Guid.NewGuid(), 1, 20, cancellationToken));
    }

    [Fact]
    public async Task AirlineApprovedEvidenceUsesImmutableSnapshotAndHidesOtherTenants()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var connection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seeder = CreateContext(connection))
            await new DevelopmentDataSeeder(seeder).SeedAsync(InitialPasswords, cancellationToken);

        var approvedAt = new DateTimeOffset(2026, 8, 18, 15, 0, 0, TimeSpan.Zero);
        Guid operationId;
        var otherOrganizationId = Guid.NewGuid();
        await using (var update = CreateContext(database.ConnectionString))
        {
            var otherOrganization = new Organization
            {
                PublicId = otherOrganizationId, Code = "QA-OTHER-AIR",
                LegalName = "OTHER SYNTHETIC AIRLINE", DisplayName = "Other Airline",
                Type = OrganizationType.AirlineCustomer, Status = OrganizationStatus.Active,
                CreatedAt = approvedAt, UpdatedAt = approvedAt,
            };
            update.Organizations.Add(otherOrganization);
            await update.SaveChangesAsync(cancellationToken);
            var otherAirline = new Airline
            {
                PublicId = Guid.NewGuid(), OrganizationId = otherOrganization.Id,
                IataCode = "QA", IcaoCode = "QAT", Name = "Other Airline", IsActive = true,
                CreatedAt = approvedAt, UpdatedAt = approvedAt,
            };
            update.Airlines.Add(otherAirline);
            await update.SaveChangesAsync(cancellationToken);

            var turnaround = await update.Turnarounds.SingleAsync(item =>
                item.OperationCode == "DEV-TAT-0001", cancellationToken);
            var otherContract = new Contract
            {
                PublicId = Guid.NewGuid(), AirlineId = otherAirline.Id,
                ContractCode = "QA-OTHER-CONTRACT", Status = ContractStatus.Active,
                SignedOn = new DateOnly(2026, 1, 1),
                CreatedAt = approvedAt, UpdatedAt = approvedAt,
            };
            update.Contracts.Add(otherContract);
            await update.SaveChangesAsync(cancellationToken);
            var otherVersion = new ContractVersion
            {
                PublicId = Guid.NewGuid(), ContractId = otherContract.Id,
                VersionNumber = 1, Status = ContractVersionStatus.Approved,
                ValidFrom = new DateOnly(2026, 1, 1),
                ValidTo = new DateOnly(2026, 12, 31), CurrencyCode = "USD",
                ApprovedAt = approvedAt, CreatedAt = approvedAt, UpdatedAt = approvedAt,
            };
            update.ContractVersions.Add(otherVersion);
            await update.SaveChangesAsync(cancellationToken);
            update.Set<ContractVersionStation>().Add(new ContractVersionStation
            {
                ContractVersionId = otherVersion.Id, StationId = turnaround.StationId,
            });
            await update.SaveChangesAsync(cancellationToken);
            var operation = await update.GroundOperations.SingleAsync(item =>
                item.TurnaroundId == turnaround.Id, cancellationToken);
            operationId = operation.PublicId;
            operation.CurrentStatus = GroundOperationStatus.Approved;
            operation.ActualStartAt = approvedAt.AddHours(-2);
            operation.ActualEndAt = approvedAt.AddMinutes(-10);
            var checklist = await update.OperationChecklists
                .Where(item => item.GroundOperationId == operation.Id)
                .OrderByDescending(item => item.RevisionNumber)
                .FirstAsync(cancellationToken);
            var agent = await update.RampAgents.SingleAsync(item =>
                item.EmployeeNumber == "DEV-RA-001", cancellationToken);
            var reviewer = await update.Users.SingleAsync(item =>
                item.PublicId == Guid.Parse("40000000-0000-7000-8000-000000000001"),
                cancellationToken);
            var service = await update.OperationServices
                .Where(item => item.GroundOperationId == operation.Id)
                .OrderBy(item => item.LineNumber)
                .FirstAsync(cancellationToken);
            var snapshot = System.Text.Json.JsonSerializer.Serialize(new
            {
                version = 1,
                services = new[] { new
                {
                    id = service.PublicId, code = "BAGGAGE", name = "Baggage handling",
                    status = "Completed", contractedQuantity = 1m,
                    executedQuantity = 1m, unit = "operation",
                } },
                incidents = new[] { new
                {
                    id = Guid.NewGuid(), type = "Internal", severity = "Low",
                    status = "Closed", description = "Confidential internal note",
                    occurredAt = approvedAt.AddMinutes(-30),
                } },
            });
            var submission = new OperationSubmission
            {
                PublicId = Guid.NewGuid(), GroundOperationId = operation.Id,
                OperationChecklistId = checklist.Id, RevisionNumber = 1,
                Status = SubmissionStatus.Approved,
                SubmittedByRampAgentId = agent.Id, SubmittedAt = approvedAt.AddMinutes(-5),
                AgentNote = "Internal agent note", EvidenceJson = snapshot,
                CreatedAt = approvedAt, UpdatedAt = approvedAt,
            };
            update.OperationSubmissions.Add(submission);
            await update.SaveChangesAsync(cancellationToken);
            update.ReviewDecisions.Add(new ReviewDecision
            {
                PublicId = Guid.NewGuid(), OperationSubmissionId = submission.Id,
                ReviewerAccountId = reviewer.Id, Outcome = ReviewOutcome.Approved,
                DecidedAt = approvedAt, Reason = "Internal reviewer note",
                CreatedAt = approvedAt, UpdatedAt = approvedAt,
            });
            await update.SaveChangesAsync(cancellationToken);
        }

        await using var provider = new ServiceCollection()
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString,
                }).Build())
            .BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IAirlinePortalReadStore>();
        var organizationId = Guid.Parse("10000000-0000-7000-8000-000000000002");
        var evidence = await store.GetApprovedOperationEvidenceAsync(
            organizationId, operationId, cancellationToken);

        Assert.NotNull(evidence);
        Assert.True(evidence.Available);
        Assert.Equal(approvedAt, evidence.ApprovedAt);
        Assert.Equal(1, evidence.IncidentCount);
        Assert.Equal("BAGGAGE", Assert.Single(evidence.Services).Code);
        Assert.Equal(1m, Assert.Single(evidence.Services).ExecutedQuantity);
        Assert.Null(await store.GetApprovedOperationEvidenceAsync(
            otherOrganizationId, operationId, cancellationToken));
        Assert.Null(await store.GetApprovedOperationEvidenceAsync(
            organizationId, Guid.NewGuid(), cancellationToken));
        var planned = await store.GetApprovedOperationEvidenceAsync(
            organizationId, Guid.Parse("70000000-0000-7000-8000-000000000016"),
            cancellationToken);
        Assert.NotNull(planned);
        Assert.False(planned.Available);
        Assert.Empty(planned.Services);
    }

    [Fact]
    public async Task AirlinePreinvoiceReadExcludesDraftsAndOtherTenantsButKeepsPublishedHistory()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var connection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seeder = CreateContext(connection))
            await new DevelopmentDataSeeder(seeder).SeedAsync(InitialPasswords, cancellationToken);

        var organizationId = Guid.Parse("10000000-0000-7000-8000-000000000002");
        var publishedId = Guid.NewGuid();
        var olderId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        var unpublishedVoidId = Guid.NewGuid();
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var airline = await setup.Airlines.SingleAsync(item =>
                item.OrganizationId == setup.Organizations.Single(organization =>
                    organization.PublicId == organizationId).Id, cancellationToken);
            var station = await setup.Stations.SingleAsync(item => item.Code == "PUJ", cancellationToken);
            var account = await setup.Users.SingleAsync(item =>
                item.PublicId == Guid.Parse("40000000-0000-7000-8000-000000000006"), cancellationToken);
            var otherOrganization = new Organization
            {
                PublicId = Guid.NewGuid(), Code = "OTHER-FINANCE-AIR",
                LegalName = "Other Finance Airline", DisplayName = "Other Finance Airline",
                Type = OrganizationType.AirlineCustomer, Status = OrganizationStatus.Active,
                CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            };
            setup.Organizations.Add(otherOrganization);
            await setup.SaveChangesAsync(cancellationToken);
            var otherAirline = new Airline
            {
                PublicId = Guid.NewGuid(), OrganizationId = otherOrganization.Id,
                IataCode = "XF", IcaoCode = "XFN", Name = "Other Finance Airline",
                IsActive = true, CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            setup.Airlines.Add(otherAirline);
            await setup.SaveChangesAsync(cancellationToken);

            Preinvoice Create(Guid id, long airlineId, PreinvoiceStatus status, int day) => new()
            {
                PublicId = id, AirlineId = airlineId, StationId = station.Id,
                CreatedByAccountId = account.Id, RequestId = Guid.NewGuid(),
                PayloadHash = new string('a', 64), From = new DateOnly(2026, 8, day),
                To = new DateOnly(2026, 8, day), CurrencyCode = "USD", Total = 125.50m,
                Status = status,
                CreatedAt = new DateTimeOffset(2026, 8, day, 12, 0, 0, TimeSpan.Zero),
                UpdatedAt = new DateTimeOffset(2026, 8, day, 12, 0, 0, TimeSpan.Zero),
            };
            setup.Preinvoices.AddRange(
                Create(olderId, airline.Id, PreinvoiceStatus.Submitted, 18),
                Create(publishedId, airline.Id, PreinvoiceStatus.Accepted, 19),
                Create(draftId, airline.Id, PreinvoiceStatus.Draft, 20),
                Create(unpublishedVoidId, airline.Id, PreinvoiceStatus.Voided, 20),
                Create(Guid.NewGuid(), otherAirline.Id, PreinvoiceStatus.Submitted, 21));
            await setup.SaveChangesAsync(cancellationToken);
        }

        await using var provider = new ServiceCollection()
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString,
                }).Build())
            .BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IAirlinePortalReadStore>();
        var first = await store.GetPreinvoicesAsync(organizationId, 1, 1,
            cancellationToken: cancellationToken);
        Assert.NotNull(first);
        Assert.True(first.HasMore);
        var latest = Assert.Single(first.Preinvoices);
        Assert.Equal(publishedId, latest.Id);
        Assert.Equal("Accepted", latest.Status);
        Assert.Equal("PUJ", latest.StationCode);
        Assert.Equal(125.50m, latest.Total);
        var second = await store.GetPreinvoicesAsync(organizationId, 2, 1,
            cancellationToken: cancellationToken);
        Assert.NotNull(second);
        Assert.False(second.HasMore);
        Assert.Equal(olderId, Assert.Single(second.Preinvoices).Id);
        Assert.Empty((await store.GetPreinvoicesAsync(organizationId, 3, 1,
            cancellationToken: cancellationToken))!.Preinvoices);
        Assert.Null(await store.GetPreinvoiceAsync(
            organizationId, unpublishedVoidId, cancellationToken: cancellationToken));
        Assert.Null(await store.GetPreinvoiceDisputesAsync(
            organizationId, unpublishedVoidId, cancellationToken: cancellationToken));
        Assert.Null(await store.GetPreinvoicesAsync(Guid.NewGuid(), 1, 20,
            cancellationToken: cancellationToken));
    }

    [Fact]
    public async Task ProductionSchemaStartsWithoutBusinessRows()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null)
        {
            return;
        }

        await using var database = await TemporaryDatabase.CreateAsync(masterConnection, "Production", cancellationToken);
        await using var context = CreateContext(database.ConnectionString);

        await context.Database.MigrateAsync(cancellationToken);

        Assert.Empty(await context.Organizations.AsNoTracking().ToListAsync(cancellationToken));
        Assert.Empty(await context.Users.AsNoTracking().ToListAsync(cancellationToken));
        Assert.Empty(await context.Turnarounds.AsNoTracking().ToListAsync(cancellationToken));
        Assert.Equal(
            context.Database.GetMigrations(),
            await context.Database.GetAppliedMigrationsAsync(cancellationToken));

        var productionCredentialMutation = await Assert.ThrowsAsync<SqlException>(() =>
            context.Database.ExecuteSqlRawAsync(
                "EXEC [iam].[set_development_account_credential] N'ADMIN.OCC@DEV.ELEVANT.TEST', '40000000-0000-7000-8000-000000000001', NULL, NULL;",
                cancellationToken));
        Assert.Equal(52100, productionCredentialMutation.Number);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => new DevelopmentDataSeeder(context).SeedAsync(InitialPasswords, cancellationToken));
        Assert.Empty(await context.Organizations.AsNoTracking().ToListAsync(cancellationToken));
    }

    [Fact]
    public async Task PreinvoiceMigrationUpgradesPopulatedDevelopmentWithoutChangingOperations()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var preparation = CreateContext(database.ConnectionString))
            await preparation.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seeder = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seeder).SeedAsync(InitialPasswords, cancellationToken);

        await using var context = CreateContext(database.ConnectionString);
        var operationIds = await context.GroundOperations.AsNoTracking()
            .Select(item => item.PublicId).OrderBy(item => item).ToArrayAsync(cancellationToken);
        Assert.NotEmpty(operationIds);
        await context.GetService<IMigrator>().MigrateAsync(
            "20260926062846_AccountChangeFeed", cancellationToken);
        await context.GetService<IMigrator>().MigrateAsync(cancellationToken: cancellationToken);
        Assert.Equal(operationIds, await context.GroundOperations.AsNoTracking()
            .Select(item => item.PublicId).OrderBy(item => item).ToArrayAsync(cancellationToken));
        Assert.Empty(await context.Preinvoices.AsNoTracking().ToArrayAsync(cancellationToken));
        Assert.Empty(await context.PreinvoiceLines.AsNoTracking().ToArrayAsync(cancellationToken));
        Assert.Equal(context.Database.GetMigrations(),
            await context.Database.GetAppliedMigrationsAsync(cancellationToken));
    }

    [Fact]
    public async Task CorrectionRevisionMigrationUpgradesExistingDevelopmentChecklists()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
        {
            await migration.Database.MigrateAsync(cancellationToken);
        }
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var connection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seeder = CreateContext(connection))
        {
            await new DevelopmentDataSeeder(seeder).SeedAsync(InitialPasswords, cancellationToken);
        }

        await using var context = CreateContext(database.ConnectionString);
        var originalIds = await context.OperationChecklists.AsNoTracking()
            .Select(item => item.PublicId).OrderBy(item => item).ToArrayAsync(cancellationToken);
        Assert.NotEmpty(originalIds);
        var migrator = context.GetService<IMigrator>();
        await migrator.MigrateAsync(
            "20260917161921_V1_07_DevelopmentHumanResourcesAccount", cancellationToken);
        await migrator.MigrateAsync(cancellationToken: cancellationToken);
        context.ChangeTracker.Clear();

        var upgraded = await context.OperationChecklists.AsNoTracking()
            .OrderBy(item => item.PublicId).ToArrayAsync(cancellationToken);
        Assert.Equal(originalIds, upgraded.Select(item => item.PublicId));
        Assert.All(upgraded, item => Assert.Equal(1, item.RevisionNumber));
        var previous = upgraded[0];
        context.OperationChecklists.Add(new OperationChecklist
        {
            PublicId = Guid.CreateVersion7(),
            GroundOperationId = previous.GroundOperationId,
            ChecklistTemplateVersionId = previous.ChecklistTemplateVersionId,
            RevisionNumber = 2,
            Status = ChecklistStatus.NotStarted,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await context.SaveChangesAsync(cancellationToken);
        Assert.Equal(2, await context.OperationChecklists.AsNoTracking().CountAsync(item =>
            item.GroundOperationId == previous.GroundOperationId &&
            item.ChecklistTemplateVersionId == previous.ChecklistTemplateVersionId,
            cancellationToken));
    }

    [Fact]
    public async Task DevelopmentSeederPreservesChecklistCorrectionRevisionsForAssignedOperations()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);

        async Task SeedAsync()
        {
            await using var connection = await database.OpenAsDevelopmentSeederAsync(cancellationToken);
            await using var seedContext = CreateContext(connection);
            await new DevelopmentDataSeeder(seedContext).SeedAsync(InitialPasswords, cancellationToken);
        }

        await SeedAsync();

        await using (var setup = CreateContext(database.ConnectionString))
        {
            var secondOperationId = await (
                    from operation in setup.GroundOperations
                    join turnaround in setup.Turnarounds
                        on operation.TurnaroundId equals turnaround.Id
                    where turnaround.OperationCode == "DEV-TAT-0002"
                    select operation.Id)
                .SingleAsync(cancellationToken);
            var rampAgentId = await setup.RampAgents
                .Where(agent => agent.EmployeeNumber == "DEV-RA-001")
                .Select(agent => agent.Id)
                .SingleAsync(cancellationToken);
            var instant = new DateTimeOffset(2026, 8, 19, 12, 0, 0, TimeSpan.Zero);
            setup.OperationAgentAssignments.Add(new OperationAgentAssignment
            {
                PublicId = Guid.CreateVersion7(),
                GroundOperationId = secondOperationId,
                RampAgentId = rampAgentId,
                AssignmentRole = "regression-test",
                AssignedAt = instant,
                CreatedAt = instant,
                UpdatedAt = instant,
            });
            await setup.SaveChangesAsync(cancellationToken);
        }

        await SeedAsync(); // The second operation now receives its initial checklist.

        await using var context = CreateContext(database.ConnectionString);
        var initial = await context.OperationChecklists.AsNoTracking()
            .Where(checklist => checklist.RevisionNumber == 1)
            .ToArrayAsync(cancellationToken);
        Assert.Equal(3, initial.Length); // v1 and v2 for the first operation; v2 for the second.
        var instantForCorrections = new DateTimeOffset(2026, 8, 20, 12, 0, 0, TimeSpan.Zero);
        foreach (var checklist in initial)
        {
            context.OperationChecklists.Add(new OperationChecklist
            {
                PublicId = Guid.CreateVersion7(),
                GroundOperationId = checklist.GroundOperationId,
                ChecklistTemplateVersionId = checklist.ChecklistTemplateVersionId,
                RevisionNumber = 2,
                Status = ChecklistStatus.NotStarted,
                CreatedAt = instantForCorrections,
                UpdatedAt = instantForCorrections,
            });
        }
        await context.SaveChangesAsync(cancellationToken);

        var before = await context.OperationChecklists.AsNoTracking()
            .OrderBy(checklist => checklist.PublicId)
            .Select(checklist => new
            {
                checklist.PublicId,
                checklist.GroundOperationId,
                checklist.ChecklistTemplateVersionId,
                checklist.RevisionNumber,
                checklist.Status,
            })
            .ToArrayAsync(cancellationToken);
        Assert.Equal(6, before.Length);

        await SeedAsync();

        var after = await context.OperationChecklists.AsNoTracking()
            .OrderBy(checklist => checklist.PublicId)
            .Select(checklist => new
            {
                checklist.PublicId,
                checklist.GroundOperationId,
                checklist.ChecklistTemplateVersionId,
                checklist.RevisionNumber,
                checklist.Status,
            })
            .ToArrayAsync(cancellationToken);
        Assert.Equal(before, after);
    }

    [Fact]
    public async Task HumanResourcesCredentialMigrationDownRestoresPreviousAllowlist()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null)
        {
            return;
        }

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection,
            "Development",
            cancellationToken);
        await using var migrationContext = CreateContext(database.ConnectionString);
        var migrator = migrationContext.GetService<IMigrator>();
        await migrator.MigrateAsync(cancellationToken: cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);

        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seederContext = CreateContext(seederConnection))
        {
            await new DevelopmentDataSeeder(seederContext).SeedAsync(
                InitialPasswords,
                cancellationToken);
            await seederContext.Database.ExecuteSqlRawAsync(
                "EXEC [iam].[set_development_account_credential] N'GESTION.HUMANA@DEV.ELEVANT.TEST', '40000000-0000-7000-8000-000000000004', NULL, NULL;",
                cancellationToken);
        }

        await migrator.MigrateAsync(
            "20260916151935_V1_06_DevelopmentAccountCredentialRotation",
            cancellationToken);

        await using var downgradedSeederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken);
        await using var downgradedSeederContext = CreateContext(downgradedSeederConnection);
        var humanResourcesCredentialMutation = await Assert.ThrowsAsync<SqlException>(() =>
            downgradedSeederContext.Database.ExecuteSqlRawAsync(
                "EXEC [iam].[set_development_account_credential] N'GESTION.HUMANA@DEV.ELEVANT.TEST', '40000000-0000-7000-8000-000000000004', NULL, NULL;",
                cancellationToken));
        Assert.Equal(52101, humanResourcesCredentialMutation.Number);
        await downgradedSeederContext.Database.ExecuteSqlRawAsync(
            "EXEC [iam].[set_development_account_credential] N'ADMIN.OCC@DEV.ELEVANT.TEST', '40000000-0000-7000-8000-000000000001', NULL, NULL;",
            cancellationToken);
    }

    [Fact]
    public async Task ExplicitHumanResourcesRecoveryIsNotUndoneByTheDevelopmentSeeder()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
        {
            await migration.Database.MigrateAsync(cancellationToken);
        }
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken);
        await using var context = CreateContext(seederConnection);
        var seeder = new DevelopmentDataSeeder(context);
        await seeder.SeedAsync(InitialPasswords, cancellationToken);

        const string recoveredPassword = "Synthetic-RecoveredHumanResources!234";
        await new DevelopmentHumanResourcesCredentialRotator(context)
            .RotateAsync(recoveredPassword, cancellationToken);
        context.ChangeTracker.Clear();
        var recovered = await context.Users.AsNoTracking().SingleAsync(
            account => account.NormalizedEmail == "GESTION.HUMANA@DEV.ELEVANT.TEST",
            cancellationToken);
        var hasher = new PasswordHasher<ApplicationUser>();
        Assert.NotEqual(PasswordVerificationResult.Failed,
            hasher.VerifyHashedPassword(recovered, recovered.PasswordHash!, recoveredPassword));
        Assert.True(recovered.MustChangePassword);
        Assert.Equal(PasswordVerificationResult.Failed,
            hasher.VerifyHashedPassword(recovered, recovered.PasswordHash!, InitialPasswords.HumanResources));
        var recoveredHash = recovered.PasswordHash;
        var recoveredStamp = recovered.SecurityStamp;

        await seeder.SeedAsync(InitialPasswords, cancellationToken);
        context.ChangeTracker.Clear();
        var repeated = await context.Users.AsNoTracking().SingleAsync(
            account => account.NormalizedEmail == "GESTION.HUMANA@DEV.ELEVANT.TEST",
            cancellationToken);
        Assert.Equal(recoveredHash, repeated.PasswordHash);
        Assert.Equal(recoveredStamp, repeated.SecurityStamp);
        Assert.True(repeated.MustChangePassword);
    }

    [Fact]
    public async Task DevelopmentSeederIsIdempotentAndPreservesExistingRows()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null)
        {
            return;
        }

        await using var database = await TemporaryDatabase.CreateAsync(masterConnection, "Development", cancellationToken);
        await using (var migrationContext = CreateContext(database.ConnectionString))
        {
            await migrationContext.Database.MigrateAsync(cancellationToken);
        }

        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken);
        await using var context = CreateContext(seederConnection);

        var missingSyntheticAccount = await Assert.ThrowsAsync<SqlException>(() =>
            context.Database.ExecuteSqlRawAsync(
                "EXEC [iam].[set_development_account_credential] N'ADMIN.OCC@DEV.ELEVANT.TEST', '40000000-0000-7000-8000-000000000001', NULL, NULL;",
                cancellationToken));
        Assert.Equal(52103, missingSyntheticAccount.Number);
        Assert.Empty(await context.Users.AsNoTracking().ToListAsync(cancellationToken));

        var seeder = new DevelopmentDataSeeder(context);
        await seeder.SeedAsync(InitialPasswords, cancellationToken);

        var humanResourcesPerson = await context.Persons
            .AsNoTracking()
            .SingleAsync(
                person => person.PrimaryEmail == "gestion.humana@dev.elevant.test",
                cancellationToken);
        Assert.Equal(Guid.Parse("30000000-0000-7000-8000-000000000004"), humanResourcesPerson.PublicId);
        Assert.Equal("Camila", humanResourcesPerson.FirstName);
        Assert.Equal("Development", humanResourcesPerson.LastName);
        Assert.Equal("DEV-HR-001", humanResourcesPerson.IdentificationNumber);

        var humanResourcesAccount = await context.Users
            .AsNoTracking()
            .SingleAsync(
                account => account.NormalizedEmail == "GESTION.HUMANA@DEV.ELEVANT.TEST",
                cancellationToken);
        Assert.Equal(Guid.Parse("40000000-0000-7000-8000-000000000004"), humanResourcesAccount.PublicId);
        Assert.Equal(humanResourcesPerson.Id, humanResourcesAccount.PersonId);
        Assert.Equal(AccountLifecycleStatus.Active, humanResourcesAccount.Status);
        Assert.Equal(InvitationStatus.Accepted, humanResourcesAccount.InvitationStatus);

        var humanResourcesRole = await context.Roles
            .AsNoTracking()
            .SingleAsync(role => role.NormalizedName == "GESTION_HUMANA", cancellationToken);
        Assert.Equal("Gestión Humana", humanResourcesRole.Name);
        Assert.Equal(PortalKind.BackOffice, humanResourcesRole.Portal);
        Assert.Equal("human_resources", humanResourcesRole.UserType);
        Assert.True(await context.Set<IdentityUserRole<long>>()
            .AsNoTracking()
            .AnyAsync(
                link => link.UserId == humanResourcesAccount.Id &&
                    link.RoleId == humanResourcesRole.Id,
                cancellationToken));

        var aviamOrganizationId = await context.Organizations
            .AsNoTracking()
            .Where(organization => organization.Code == "AVIAM")
            .Select(organization => organization.Id)
            .SingleAsync(cancellationToken);
        var humanResourcesMembership = await context.OrganizationMemberships
            .AsNoTracking()
            .SingleAsync(
                membership => membership.AccountId == humanResourcesAccount.Id &&
                    membership.OrganizationId == aviamOrganizationId,
                cancellationToken);
        Assert.Equal(MembershipKind.InternalStaff, humanResourcesMembership.Kind);
        Assert.Equal(MembershipStatus.Active, humanResourcesMembership.Status);
        Assert.Equal("Gestión Humana", humanResourcesMembership.JobTitle);

        var pujStationId = await context.Stations
            .AsNoTracking()
            .Where(item => item.Code == "PUJ")
            .Select(item => item.Id)
            .SingleAsync(cancellationToken);
        var humanResourcesStationScope = await context.AccountStationScopes
            .AsNoTracking()
            .SingleAsync(
                scope => scope.AccountId == humanResourcesAccount.Id &&
                    scope.StationId == pujStationId,
                cancellationToken);
        Assert.Null(humanResourcesStationScope.RevokedAt);

        foreach (var (email, roleCode, userType, publicId) in new[]
                 {
                     ("CONTRATOS@DEV.ELEVANT.TEST", "CONTRATOS", "contracts",
                         Guid.Parse("40000000-0000-7000-8000-000000000005")),
                     ("FINANZAS@DEV.ELEVANT.TEST", "FINANZAS", "finance",
                         Guid.Parse("40000000-0000-7000-8000-000000000006")),
                 })
        {
            var departmentAccount = await context.Users.AsNoTracking()
                .SingleAsync(account => account.NormalizedEmail == email, cancellationToken);
            Assert.Equal(publicId, departmentAccount.PublicId);
            Assert.True(departmentAccount.LockoutEnabled);
            Assert.True(departmentAccount.MustChangePassword);
            var departmentRole = await context.Roles.AsNoTracking()
                .SingleAsync(role => role.NormalizedName == roleCode, cancellationToken);
            Assert.Equal(PortalKind.BackOffice, departmentRole.Portal);
            Assert.Equal(userType, departmentRole.UserType);
            Assert.True(await context.Set<IdentityUserRole<long>>().AsNoTracking()
                .AnyAsync(link => link.UserId == departmentAccount.Id &&
                    link.RoleId == departmentRole.Id, cancellationToken));
            Assert.True(await context.OrganizationMemberships.AsNoTracking()
                .AnyAsync(membership => membership.AccountId == departmentAccount.Id &&
                    membership.OrganizationId == aviamOrganizationId &&
                    membership.Kind == MembershipKind.InternalStaff, cancellationToken));
            Assert.True(await context.AccountStationScopes.AsNoTracking()
                .AnyAsync(scope => scope.AccountId == departmentAccount.Id &&
                    scope.StationId == pujStationId && scope.RevokedAt == null,
                    cancellationToken));
        }

        var legacyTurnaround = await context.Turnarounds
            .AsNoTracking()
            .SingleAsync(item => item.OperationCode == "DEV-TAT-0001", cancellationToken);
        var planningTurnaround = await context.Turnarounds
            .AsNoTracking()
            .SingleAsync(item => item.OperationCode == "DEV-TAT-0002", cancellationToken);
        Assert.Equal(new DateOnly(2026, 8, 18), legacyTurnaround.OperationDate);
        Assert.Equal(new DateOnly(2026, 8, 19), planningTurnaround.OperationDate);
        Assert.Equal(
            Guid.Parse("70000000-0000-7000-8000-000000000012"),
            planningTurnaround.PublicId);

        var legacyLegDates = await context.FlightLegs
            .AsNoTracking()
            .Where(leg => leg.TurnaroundId == legacyTurnaround.Id)
            .Select(leg => DateOnly.FromDateTime(leg.ScheduledAt.UtcDateTime))
            .ToArrayAsync(cancellationToken);
        Assert.Equal(2, legacyLegDates.Length);
        Assert.All(legacyLegDates, date => Assert.Equal(new DateOnly(2026, 8, 17), date));

        var planningLegs = await context.FlightLegs
            .AsNoTracking()
            .Where(leg => leg.TurnaroundId == planningTurnaround.Id)
            .OrderBy(leg => leg.Direction)
            .Select(leg => new { leg.PublicId, leg.Direction, leg.FlightNumber, leg.ScheduledAt })
            .ToArrayAsync(cancellationToken);
        Assert.Collection(
            planningLegs,
            arrival =>
            {
                Assert.Equal(FlightDirection.Arrival, arrival.Direction);
                Assert.Equal(
                    Guid.Parse("70000000-0000-7000-8000-000000000013"),
                    arrival.PublicId);
                Assert.Equal("ZZ102", arrival.FlightNumber);
                Assert.Equal(
                    new DateTimeOffset(2026, 8, 19, 12, 0, 0, TimeSpan.Zero),
                    arrival.ScheduledAt);
            },
            departure =>
            {
                Assert.Equal(FlightDirection.Departure, departure.Direction);
                Assert.Equal(
                    Guid.Parse("70000000-0000-7000-8000-000000000014"),
                    departure.PublicId);
                Assert.Equal("ZZ103", departure.FlightNumber);
                Assert.Equal(
                    new DateTimeOffset(2026, 8, 19, 15, 0, 0, TimeSpan.Zero),
                    departure.ScheduledAt);
            });

        var planningOperation = await context.GroundOperations
            .AsNoTracking()
            .SingleAsync(item => item.TurnaroundId == planningTurnaround.Id, cancellationToken);
        Assert.Equal(
            Guid.Parse("70000000-0000-7000-8000-000000000016"),
            planningOperation.PublicId);
        Assert.Equal(
            new DateTimeOffset(2026, 8, 19, 12, 15, 0, TimeSpan.Zero),
            planningOperation.PlannedStartAt);
        Assert.Equal(
            new DateTimeOffset(2026, 8, 19, 14, 30, 0, TimeSpan.Zero),
            planningOperation.PlannedEndAt);
        Assert.False(await context.OperationAgentAssignments.AsNoTracking().AnyAsync(
            item => item.GroundOperationId == planningOperation.Id,
            cancellationToken));
        var planningServices = await (
                from service in context.OperationServices.AsNoTracking()
                join definition in context.ServiceDefinitions.AsNoTracking()
                    on service.ServiceDefinitionId equals definition.Id
                where service.GroundOperationId == planningOperation.Id
                orderby service.LineNumber
                select new { service.PublicId, definition.Code })
            .ToArrayAsync(cancellationToken);
        Assert.Collection(
            planningServices,
            baggage =>
            {
                Assert.Equal("BAGGAGE", baggage.Code);
                Assert.Equal(
                    Guid.Parse("70000000-0000-7000-8000-000000000017"),
                    baggage.PublicId);
            },
            passengerBridge => Assert.Equal("PASSENGER-BRIDGE", passengerBridge.Code));
        Assert.False(await context.OperationChecklists.AsNoTracking().AnyAsync(
            item => item.GroundOperationId == planningOperation.Id,
            cancellationToken));

        var checklistTemplate = await context.Set<ChecklistTemplate>()
            .AsNoTracking()
            .SingleAsync(item => item.Code == "TURNAROUND-BASE", cancellationToken);
        var checklistVersions = await context.Set<ChecklistTemplateVersion>()
            .AsNoTracking()
            .Where(item => item.ChecklistTemplateId == checklistTemplate.Id)
            .OrderBy(item => item.VersionNumber)
            .ToArrayAsync(cancellationToken);
        Assert.Equal(2, checklistVersions.Length);
        Assert.Null(checklistVersions[0].EffectiveTo);
        Assert.Equal(ChecklistVersionStatus.Published, checklistVersions[1].Status);
        Assert.Equal(new DateOnly(2026, 8, 18), checklistVersions[1].EffectiveFrom);
        var checklistItems = await context.Set<ChecklistTemplateItem>()
            .AsNoTracking()
            .Where(item => item.ChecklistTemplateVersionId == checklistVersions[1].Id)
            .OrderBy(item => item.SortOrder)
            .ToArrayAsync(cancellationToken);
        Assert.Equal(45, checklistItems.Length);
        Assert.Equal(
            [13, 13, 10, 9],
            checklistItems
                .GroupBy(item => item.SectionName)
                .Select(section => section.Count())
                .ToArray());

        var planningStand = await (
                from assignment in context.Set<StandAssignment>().AsNoTracking()
                join stand in context.Stands.AsNoTracking() on assignment.StandId equals stand.Id
                where assignment.TurnaroundId == planningTurnaround.Id && assignment.AssignedTo == null
                select new
                {
                    AssignmentInternalId = assignment.Id,
                    StandInternalId = stand.Id,
                    AssignmentId = assignment.PublicId,
                    StandId = stand.PublicId,
                    stand.Code,
                })
            .SingleAsync(cancellationToken);
        Assert.Equal("A02", planningStand.Code);
        Assert.Equal(
            Guid.Parse("70000000-0000-7000-8000-000000000015"),
            planningStand.AssignmentId);
        Assert.Equal(
            Guid.Parse("20000000-0000-7000-8000-000000000011"),
            planningStand.StandId);

        var riley = await context.RampAgents
            .AsNoTracking()
            .SingleAsync(agent => agent.EmployeeNumber == "DEV-RA-001", cancellationToken);
        var planningShift = await context.ShiftAssignments
            .AsNoTracking()
            .SingleAsync(
                shift => shift.RampAgentId == riley.Id &&
                    shift.WorkDate == new DateOnly(2026, 8, 19),
                cancellationToken);
        Assert.Equal(new TimeOnly(6, 0), planningShift.StartsAtLocal);
        Assert.Equal(new TimeOnly(14, 0), planningShift.EndsAtLocal);
        Assert.Equal(
            Guid.Parse("50000000-0000-7000-8000-000000000006"),
            planningShift.PublicId);

        var station = await context.Stations
            .SingleAsync(item => item.Code == "PUJ", cancellationToken);
        var terminal = await context.Terminals
            .SingleAsync(item => item.StationId == station.Id && item.Code == "A", cancellationToken);
        var testInstant = new DateTimeOffset(2026, 8, 19, 0, 0, 0, TimeSpan.Zero);
        var otherTerminal = new Terminal
        {
            PublicId = Guid.Parse("90000000-0000-7000-8000-000000000030"),
            StationId = station.Id,
            Code = "Z",
            Name = "Development terminal Z",
            IsActive = true,
            CreatedAt = testInstant,
            UpdatedAt = testInstant,
        };
        context.Terminals.Add(otherTerminal);
        await context.SaveChangesAsync(cancellationToken);
        var mia = await context.Airports
            .SingleAsync(item => item.IataCode == "MIA", cancellationToken);
        var crossStation = new Station
        {
            PublicId = Guid.Parse("90000000-0000-7000-8000-000000000031"),
            AirportId = mia.Id,
            Code = "MIA",
            Name = "Cross-station isolation fixture",
            IanaTimeZone = "America/New_York",
            IsActive = true,
            CreatedAt = testInstant,
            UpdatedAt = testInstant,
        };
        context.Stations.Add(crossStation);
        await context.SaveChangesAsync(cancellationToken);
        var crossTerminal = new Terminal
        {
            PublicId = Guid.Parse("90000000-0000-7000-8000-000000000032"),
            StationId = crossStation.Id,
            Code = "X",
            Name = "Cross-station terminal",
            IsActive = true,
            CreatedAt = testInstant,
            UpdatedAt = testInstant,
        };
        context.Terminals.Add(crossTerminal);
        await context.SaveChangesAsync(cancellationToken);
        var crossStand = new Stand
        {
            PublicId = Guid.Parse("90000000-0000-7000-8000-000000000033"),
            StationId = crossStation.Id,
            TerminalId = crossTerminal.Id,
            Code = "X99",
            StandType = "Isolation fixture",
            IsActive = true,
            CreatedAt = testInstant,
            UpdatedAt = testInstant,
        };
        context.Stands.Add(crossStand);
        await context.SaveChangesAsync(cancellationToken);
        var position = await context.OperationalPositions
            .SingleAsync(item => item.Code == "RAMP-AGENT", cancellationToken);
        var unrelatedEquipmentType = new EquipmentType
        {
            PublicId = Guid.Parse("90000000-0000-7000-8000-000000000034"),
            Code = "UNRELATED-QUALIFICATION",
            Name = "Unrelated qualification fixture",
            RequiresQualification = true,
            IsActive = true,
            CreatedAt = testInstant,
            UpdatedAt = testInstant,
        };
        context.EquipmentTypes.Add(unrelatedEquipmentType);
        await context.SaveChangesAsync(cancellationToken);
        var expiredPerson = new Person
        {
            PublicId = Guid.Parse("90000000-0000-7000-8000-000000000001"),
            FirstName = "Expired",
            LastName = "Scope",
            PrimaryEmail = "expired.scope@dev.elevant.test",
            IdentificationType = "Synthetic",
            IdentificationNumber = "DEV-EXPIRED-SCOPE",
            CreatedAt = testInstant,
            UpdatedAt = testInstant,
        };
        var futurePerson = new Person
        {
            PublicId = Guid.Parse("90000000-0000-7000-8000-000000000002"),
            FirstName = "Future",
            LastName = "Scope",
            PrimaryEmail = "future.scope@dev.elevant.test",
            IdentificationType = "Synthetic",
            IdentificationNumber = "DEV-FUTURE-SCOPE",
            CreatedAt = testInstant,
            UpdatedAt = testInstant,
        };
        var shiftOnlyPerson = new Person
        {
            PublicId = Guid.Parse("90000000-0000-7000-8000-000000000003"),
            FirstName = "Shift",
            LastName = "Only",
            PrimaryEmail = "shift.only@dev.elevant.test",
            IdentificationType = "Synthetic",
            IdentificationNumber = "DEV-SHIFT-ONLY",
            CreatedAt = testInstant,
            UpdatedAt = testInstant,
        };
        var wrongTerminalPerson = new Person
        {
            PublicId = Guid.Parse("90000000-0000-7000-8000-000000000004"),
            FirstName = "Wrong",
            LastName = "Terminal",
            PrimaryEmail = "wrong.terminal@dev.elevant.test",
            IdentificationType = "Synthetic",
            IdentificationNumber = "DEV-WRONG-TERMINAL",
            CreatedAt = testInstant,
            UpdatedAt = testInstant,
        };
        var wrongTimePerson = new Person
        {
            PublicId = Guid.Parse("90000000-0000-7000-8000-000000000005"),
            FirstName = "Wrong",
            LastName = "Time",
            PrimaryEmail = "wrong.time@dev.elevant.test",
            IdentificationType = "Synthetic",
            IdentificationNumber = "DEV-WRONG-TIME",
            CreatedAt = testInstant,
            UpdatedAt = testInstant,
        };
        var equalShiftPerson = new Person
        {
            PublicId = Guid.Parse("90000000-0000-7000-8000-000000000006"),
            FirstName = "Equal",
            LastName = "Shift",
            PrimaryEmail = "equal.shift@dev.elevant.test",
            IdentificationType = "Synthetic",
            IdentificationNumber = "DEV-EQUAL-SHIFT",
            CreatedAt = testInstant,
            UpdatedAt = testInstant,
        };
        context.Persons.AddRange(
            expiredPerson,
            futurePerson,
            shiftOnlyPerson,
            wrongTerminalPerson,
            wrongTimePerson,
            equalShiftPerson);
        await context.SaveChangesAsync(cancellationToken);

        var expiredAgent = NewTestAgent(
            expiredPerson.Id,
            "DEV-RA-EXPIRED",
            "90000000-0000-7000-8000-000000000011",
            testInstant);
        var futureAgent = NewTestAgent(
            futurePerson.Id,
            "DEV-RA-FUTURE",
            "90000000-0000-7000-8000-000000000012",
            testInstant);
        var shiftOnlyAgent = NewTestAgent(
            shiftOnlyPerson.Id,
            "DEV-RA-SHIFT-ONLY",
            "90000000-0000-7000-8000-000000000013",
            testInstant);
        var wrongTerminalAgent = NewTestAgent(
            wrongTerminalPerson.Id,
            "DEV-RA-WRONG-TERMINAL",
            "90000000-0000-7000-8000-000000000014",
            testInstant);
        var wrongTimeAgent = NewTestAgent(
            wrongTimePerson.Id,
            "DEV-RA-WRONG-TIME",
            "90000000-0000-7000-8000-000000000015",
            testInstant);
        var equalShiftAgent = NewTestAgent(
            equalShiftPerson.Id,
            "DEV-RA-EQUAL-SHIFT",
            "90000000-0000-7000-8000-000000000016",
            testInstant);
        context.RampAgents.AddRange(
            expiredAgent,
            futureAgent,
            shiftOnlyAgent,
            wrongTerminalAgent,
            wrongTimeAgent,
            equalShiftAgent);
        await context.SaveChangesAsync(cancellationToken);

        context.Set<RampAgentStationScope>().AddRange(
            new RampAgentStationScope
            {
                RampAgentId = expiredAgent.Id,
                StationId = station.Id,
                ValidFrom = new DateOnly(2026, 1, 1),
                ValidTo = new DateOnly(2026, 8, 18),
            },
            new RampAgentStationScope
            {
                RampAgentId = futureAgent.Id,
                StationId = station.Id,
                ValidFrom = new DateOnly(2026, 8, 20),
            });
        context.Set<RampAgentTerminalScope>().Add(new RampAgentTerminalScope
        {
            RampAgentId = shiftOnlyAgent.Id,
            TerminalId = terminal.Id,
            ValidFrom = new DateOnly(2026, 1, 1),
        });
        context.ShiftAssignments.Add(new ShiftAssignment
        {
            PublicId = Guid.Parse("90000000-0000-7000-8000-000000000021"),
            RampAgentId = shiftOnlyAgent.Id,
            StationId = station.Id,
            TerminalId = terminal.Id,
            OperationalPositionId = position.Id,
            WorkDate = new DateOnly(2026, 8, 19),
            StartsAtLocal = new TimeOnly(6, 0),
            EndsAtLocal = new TimeOnly(14, 0),
            Block = ShiftBlock.Morning,
            CreatedAt = testInstant,
            UpdatedAt = testInstant,
        });
        context.ShiftAssignments.AddRange(
            new ShiftAssignment
            {
                PublicId = Guid.Parse("90000000-0000-7000-8000-000000000022"),
                RampAgentId = wrongTerminalAgent.Id,
                StationId = station.Id,
                TerminalId = otherTerminal.Id,
                OperationalPositionId = position.Id,
                WorkDate = new DateOnly(2026, 8, 19),
                StartsAtLocal = new TimeOnly(6, 0),
                EndsAtLocal = new TimeOnly(14, 0),
                Block = ShiftBlock.Morning,
                CreatedAt = testInstant,
                UpdatedAt = testInstant,
            },
            new ShiftAssignment
            {
                PublicId = Guid.Parse("90000000-0000-7000-8000-000000000023"),
                RampAgentId = wrongTimeAgent.Id,
                StationId = station.Id,
                TerminalId = terminal.Id,
                OperationalPositionId = position.Id,
                WorkDate = new DateOnly(2026, 8, 19),
                StartsAtLocal = new TimeOnly(15, 0),
                EndsAtLocal = new TimeOnly(18, 0),
                Block = ShiftBlock.Afternoon,
                CreatedAt = testInstant,
                UpdatedAt = testInstant,
            },
            new ShiftAssignment
            {
                PublicId = Guid.Parse("90000000-0000-7000-8000-000000000024"),
                RampAgentId = equalShiftAgent.Id,
                StationId = station.Id,
                TerminalId = terminal.Id,
                OperationalPositionId = position.Id,
                WorkDate = new DateOnly(2026, 8, 19),
                StartsAtLocal = new TimeOnly(8, 0),
                EndsAtLocal = new TimeOnly(8, 0),
                Block = ShiftBlock.Morning,
                CreatedAt = testInstant,
                UpdatedAt = testInstant,
            });
        await context.SaveChangesAsync(cancellationToken);

        await using (var planningProvider = CreateAuthenticationProvider(
            database.ConnectionString,
            new PasswordHashCounter()))
        using (var planningScope = planningProvider.CreateScope())
        {
            var readStore = planningScope.ServiceProvider.GetRequiredService<IOccPlanningReadStore>();
            var stationPublicId = Guid.Parse("20000000-0000-7000-8000-000000000003");
            Assert.Equal(
                new DateOnly(2026, 8, 19),
                await readStore.GetLatestOperationDateAsync(stationPublicId, cancellationToken));

            var snapshot = await readStore.GetSnapshotAsync(
                stationPublicId,
                new DateOnly(2026, 8, 19),
                cancellationToken);
            Assert.NotNull(snapshot);
            var planningItem = Assert.Single(snapshot.Turnarounds);
            Assert.Equal("DEV-TAT-0002", planningItem.OperationCode);
            Assert.Equal("A02", planningItem.Stand?.Code);
            Assert.Equal("ZZ102", planningItem.Arrival?.FlightNumber);
            Assert.Equal("ZZ103", planningItem.Departure?.FlightNumber);
            Assert.Empty(planningItem.Agents);
            Assert.Equal(
                ["BAGGAGE", "PASSENGER-BRIDGE"],
                planningItem.Services.Select(service => service.Code).ToArray());

            var optionsResult = await readStore.GetOptionsAsync(
                [stationPublicId],
                Guid.Parse("70000000-0000-7000-8000-000000000012"),
                cancellationToken);
            Assert.True(optionsResult.IsSuccess);
            var options = Assert.IsType<OccPlanningOptionsSourceData>(optionsResult.Options);
            Assert.Equal("DEV-CONTRACT-0001", options.Contract?.Code);
            Assert.Equal(
                ["BAGGAGE", "PASSENGER-BRIDGE"],
                options.Services.Select(service => service.Code).Order().ToArray());
            Assert.True(OccPlanningConcurrencyToken.TryDecode(
                options.Turnaround.ConcurrencyToken,
                out var optionsVersion));
            Assert.Equal(32, optionsVersion.Length);
            Assert.False(planningOperation.RowVersion.AsSpan().SequenceEqual(optionsVersion));
            Assert.DoesNotContain(options.AgentCandidates, candidate =>
                candidate.EmployeeNumber is
                    "DEV-RA-EXPIRED" or
                    "DEV-RA-FUTURE" or
                    "DEV-RA-WRONG-TERMINAL" or
                    "DEV-RA-WRONG-TIME" or
                    "DEV-RA-EQUAL-SHIFT" ||
                candidate.DisplayName is
                    "Expired Scope" or
                    "Future Scope" or
                    "Wrong Terminal" or
                    "Wrong Time" or
                    "Equal Shift");
            var rileyCandidate = Assert.Single(
                options.AgentCandidates,
                candidate => candidate.EmployeeNumber == "DEV-RA-001");
            Assert.True(rileyCandidate.IsActive);
            Assert.True(rileyCandidate.HasMobileAccount);
            Assert.True(rileyCandidate.HasStationScope);
            Assert.True(rileyCandidate.HasTerminalScope);
            Assert.True(rileyCandidate.HasCurrentQualification);
            Assert.True(rileyCandidate.HasCurrentAirportId);
            Assert.True(rileyCandidate.HasCurrentRampDriverLicense);
            Assert.True(rileyCandidate.HasCompatibleShift);
            Assert.Equal(position.PublicId, rileyCandidate.OperationalPositionId);
            Assert.False(rileyCandidate.HasAssignmentConflict);

            var absence = new AvailabilityRequest
            {
                PublicId = Guid.Parse("90000000-0000-7000-8000-000000000025"),
                RampAgentId = riley.Id,
                StartsOn = new DateOnly(2026, 8, 19),
                EndsOn = new DateOnly(2026, 8, 19),
                Type = AvailabilityRequestType.DayOff,
                Status = AvailabilityRequestStatus.Pending,
                Reason = "Test absence",
                RequestedAt = testInstant,
                CreatedAt = testInstant,
                UpdatedAt = testInstant,
            };
            context.AvailabilityRequests.Add(absence);
            await context.SaveChangesAsync(cancellationToken);
            await using var absenceAdminContext = CreateContext(database.ConnectionString);
            var pendingAbsenceOptions = Assert.IsType<OccPlanningOptionsSourceData>((await
                readStore.GetOptionsAsync([stationPublicId], planningTurnaround.PublicId,
                    cancellationToken)).Options);
            Assert.False(Assert.Single(pendingAbsenceOptions.AgentCandidates,
                candidate => candidate.Id == riley.PublicId).HasApprovedAbsence);

            await absenceAdminContext.AvailabilityRequests.Where(item => item.Id == absence.Id)
                .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.Status,
                    AvailabilityRequestStatus.Approved), cancellationToken);
            var approvedAbsenceOptions = Assert.IsType<OccPlanningOptionsSourceData>((await
                readStore.GetOptionsAsync([stationPublicId], planningTurnaround.PublicId,
                    cancellationToken)).Options);
            var absentRiley = Assert.Single(approvedAbsenceOptions.AgentCandidates,
                candidate => candidate.Id == riley.PublicId);
            Assert.True(absentRiley.HasApprovedAbsence);
            Assert.NotEqual(pendingAbsenceOptions.Turnaround.ConcurrencyToken,
                approvedAbsenceOptions.Turnaround.ConcurrencyToken);
            Assert.Contains("approved_absence",
                OccAgentEligibilityPolicy.Evaluate(absentRiley).EligibilityReasons);

            await absenceAdminContext.AvailabilityRequests.Where(item => item.Id == absence.Id)
                .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.Type,
                    AvailabilityRequestType.ShiftChange), cancellationToken);
            var shiftChangeOptions = Assert.IsType<OccPlanningOptionsSourceData>((await
                readStore.GetOptionsAsync([stationPublicId], planningTurnaround.PublicId,
                    cancellationToken)).Options);
            Assert.False(Assert.Single(shiftChangeOptions.AgentCandidates,
                candidate => candidate.Id == riley.PublicId).HasApprovedAbsence);

            await absenceAdminContext.AvailabilityRequests.Where(item => item.Id == absence.Id)
                .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.Type,
                    AvailabilityRequestType.Restriction), cancellationToken);
            var restrictionOptions = Assert.IsType<OccPlanningOptionsSourceData>((await
                readStore.GetOptionsAsync([stationPublicId], planningTurnaround.PublicId,
                    cancellationToken)).Options);
            Assert.True(Assert.Single(restrictionOptions.AgentCandidates,
                candidate => candidate.Id == riley.PublicId).HasApprovedAbsence);

            await absenceAdminContext.AvailabilityRequests.Where(item => item.Id == absence.Id)
                .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.Status,
                    AvailabilityRequestStatus.Cancelled), cancellationToken);

            await using (var administratorContext = CreateContext(database.ConnectionString))
            {
                var changed = await administratorContext.OperationalPositions
                    .Where(item => item.Id == position.Id)
                    .ExecuteUpdateAsync(
                        setters => setters
                            .SetProperty(item => item.RequiresQualification, true)
                            .SetProperty(
                                item => item.RequiredEquipmentTypeId,
                                unrelatedEquipmentType.Id),
                        cancellationToken);
                Assert.Equal(1, changed);
            }

            var unrelatedQualificationResult = await readStore.GetOptionsAsync(
                [stationPublicId],
                planningTurnaround.PublicId,
                cancellationToken);
            var unrelatedQualificationOptions = Assert.IsType<OccPlanningOptionsSourceData>(
                unrelatedQualificationResult.Options);
            var unrelatedQualificationRiley = Assert.Single(
                unrelatedQualificationOptions.AgentCandidates,
                candidate => candidate.EmployeeNumber == "DEV-RA-001");
            Assert.False(unrelatedQualificationRiley.HasCurrentQualification);
            Assert.Equal(
                ["qualification_not_current"],
                OccAgentEligibilityPolicy.Evaluate(unrelatedQualificationRiley)
                    .EligibilityReasons);

            var gpuType = await context.EquipmentTypes
                .AsNoTracking()
                .SingleAsync(item => item.Code == "GPU", cancellationToken);
            await using (var administratorContext = CreateContext(database.ConnectionString))
            {
                var changed = await administratorContext.OperationalPositions
                    .Where(item => item.Id == position.Id)
                    .ExecuteUpdateAsync(
                        setters => setters.SetProperty(
                            item => item.RequiredEquipmentTypeId,
                            gpuType.Id),
                        cancellationToken);
                Assert.Equal(1, changed);
            }

            var matchingQualificationResult = await readStore.GetOptionsAsync(
                [stationPublicId],
                planningTurnaround.PublicId,
                cancellationToken);
            var matchingQualificationOptions = Assert.IsType<OccPlanningOptionsSourceData>(
                matchingQualificationResult.Options);
            var matchingQualificationRiley = Assert.Single(
                matchingQualificationOptions.AgentCandidates,
                candidate => candidate.EmployeeNumber == "DEV-RA-001");
            Assert.True(matchingQualificationRiley.HasCurrentQualification);

            await using (var administratorContext = CreateContext(database.ConnectionString))
            {
                var changed = await administratorContext.OperationalPositions
                    .Where(item => item.Id == position.Id)
                    .ExecuteUpdateAsync(
                        setters => setters.SetProperty(item => item.IsActive, false),
                        cancellationToken);
                Assert.Equal(1, changed);
            }

            var inactivePositionResult = await readStore.GetOptionsAsync(
                [stationPublicId],
                planningTurnaround.PublicId,
                cancellationToken);
            var inactivePositionOptions = Assert.IsType<OccPlanningOptionsSourceData>(
                inactivePositionResult.Options);
            var inactivePositionRiley = Assert.Single(
                inactivePositionOptions.AgentCandidates,
                candidate => candidate.EmployeeNumber == "DEV-RA-001");
            Assert.True(inactivePositionRiley.HasCompatibleShift);
            Assert.Null(inactivePositionRiley.OperationalPositionId);
            Assert.False(inactivePositionRiley.HasCurrentQualification);
            Assert.Equal(
                ["operational_position_unavailable"],
                OccAgentEligibilityPolicy.Evaluate(inactivePositionRiley)
                    .EligibilityReasons);

            await using (var administratorContext = CreateContext(database.ConnectionString))
            {
                var changed = await administratorContext.OperationalPositions
                    .Where(item => item.Id == position.Id)
                    .ExecuteUpdateAsync(
                        setters => setters
                            .SetProperty(item => item.IsActive, true)
                            .SetProperty(item => item.RequiresQualification, false)
                            .SetProperty(item => item.RequiredEquipmentTypeId, (long?)null),
                        cancellationToken);
                Assert.Equal(1, changed);

                var overlappingShiftChanged = await administratorContext.ShiftAssignments
                    .Where(item => item.RampAgentId == riley.Id &&
                        item.WorkDate == new DateOnly(2026, 8, 18))
                    .ExecuteUpdateAsync(
                        setters => setters
                            .SetProperty(item => item.StartsAtLocal, new TimeOnly(22, 0))
                            .SetProperty(item => item.EndsAtLocal, new TimeOnly(9, 0)),
                        cancellationToken);
                Assert.Equal(1, overlappingShiftChanged);
            }

            var ambiguousPositionResult = await readStore.GetOptionsAsync(
                [stationPublicId],
                planningTurnaround.PublicId,
                cancellationToken);
            var ambiguousPositionOptions = Assert.IsType<OccPlanningOptionsSourceData>(
                ambiguousPositionResult.Options);
            var ambiguousPositionRiley = Assert.Single(
                ambiguousPositionOptions.AgentCandidates,
                candidate => candidate.EmployeeNumber == "DEV-RA-001");
            Assert.True(ambiguousPositionRiley.HasCompatibleShift);
            Assert.Null(ambiguousPositionRiley.OperationalPositionId);
            Assert.Contains(
                "operational_position_unavailable",
                OccAgentEligibilityPolicy.Evaluate(ambiguousPositionRiley)
                    .EligibilityReasons);

            await using (var administratorContext = CreateContext(database.ConnectionString))
            {
                var shiftChanged = await administratorContext.ShiftAssignments
                    .Where(item => item.RampAgentId == riley.Id &&
                        item.WorkDate == new DateOnly(2026, 8, 18))
                    .ExecuteUpdateAsync(
                        setters => setters
                            .SetProperty(item => item.StartsAtLocal, new TimeOnly(6, 0))
                            .SetProperty(item => item.EndsAtLocal, new TimeOnly(14, 0)),
                        cancellationToken);
                Assert.Equal(1, shiftChanged);

                var boundaryChanged = await administratorContext.GroundOperations
                    .Where(item => item.TurnaroundId == legacyTurnaround.Id)
                    .ExecuteUpdateAsync(
                        setters => setters
                            .SetProperty(
                                item => item.PlannedStartAt,
                                planningOperation.PlannedEndAt)
                            .SetProperty(
                                item => item.PlannedEndAt,
                                planningOperation.PlannedEndAt!.Value.AddHours(1)),
                        cancellationToken);
                Assert.Equal(1, boundaryChanged);
            }

            var touchingWindowResult = await readStore.GetOptionsAsync(
                [stationPublicId],
                planningTurnaround.PublicId,
                cancellationToken);
            var touchingWindowOptions = Assert.IsType<OccPlanningOptionsSourceData>(
                touchingWindowResult.Options);
            var touchingWindowRiley = Assert.Single(
                touchingWindowOptions.AgentCandidates,
                candidate => candidate.EmployeeNumber == "DEV-RA-001");
            Assert.False(touchingWindowRiley.HasAssignmentConflict);

            await using (var administratorContext = CreateContext(database.ConnectionString))
            {
                var changed = await administratorContext.GroundOperations
                    .Where(item => item.TurnaroundId == legacyTurnaround.Id)
                    .ExecuteUpdateAsync(
                        setters => setters.SetProperty(
                            item => item.PlannedStartAt,
                            planningOperation.PlannedEndAt!.Value.AddMinutes(-1)),
                        cancellationToken);
                Assert.Equal(1, changed);
            }

            var overlappingWindowResult = await readStore.GetOptionsAsync(
                [stationPublicId],
                planningTurnaround.PublicId,
                cancellationToken);
            var overlappingWindowOptions = Assert.IsType<OccPlanningOptionsSourceData>(
                overlappingWindowResult.Options);
            var overlappingWindowRiley = Assert.Single(
                overlappingWindowOptions.AgentCandidates,
                candidate => candidate.EmployeeNumber == "DEV-RA-001");
            Assert.True(overlappingWindowRiley.HasAssignmentConflict);
            Assert.Contains(
                "assignment_conflict",
                OccAgentEligibilityPolicy.Evaluate(overlappingWindowRiley)
                    .EligibilityReasons);

            await using (var administratorContext = CreateContext(database.ConnectionString))
            {
                var changed = await administratorContext.GroundOperations
                    .Where(item => item.TurnaroundId == legacyTurnaround.Id)
                    .ExecuteUpdateAsync(
                        setters => setters
                            .SetProperty(
                                item => item.PlannedStartAt,
                                new DateTimeOffset(2026, 8, 17, 12, 45, 0, TimeSpan.Zero))
                            .SetProperty(
                                item => item.PlannedEndAt,
                                new DateTimeOffset(2026, 8, 17, 14, 30, 0, TimeSpan.Zero)),
                        cancellationToken);
                Assert.Equal(1, changed);
            }

            var shiftOnlyCandidate = Assert.Single(
                options.AgentCandidates,
                candidate => candidate.EmployeeNumber == "DEV-RA-SHIFT-ONLY");
            Assert.False(shiftOnlyCandidate.HasStationScope);
            Assert.True(shiftOnlyCandidate.HasTerminalScope);
            Assert.True(shiftOnlyCandidate.HasCompatibleShift);
            var shiftOnlyEligibility = OccAgentEligibilityPolicy.Evaluate(shiftOnlyCandidate);
            Assert.False(shiftOnlyEligibility.Eligible);
            Assert.Contains("station_scope_missing", shiftOnlyEligibility.EligibilityReasons);
            Assert.DoesNotContain("shift_not_compatible", shiftOnlyEligibility.EligibilityReasons);

            await using (var administratorContext = CreateContext(database.ConnectionString))
            {
                var changed = await administratorContext.Set<StandAssignment>()
                    .Where(assignment => assignment.Id == planningStand.AssignmentInternalId)
                    .ExecuteUpdateAsync(
                        setters => setters.SetProperty(
                            assignment => assignment.StandId,
                            crossStand.Id),
                        cancellationToken);
                Assert.Equal(1, changed);
            }

            var crossStationSnapshot = await readStore.GetSnapshotAsync(
                stationPublicId,
                new DateOnly(2026, 8, 19),
                cancellationToken);
            var crossStationPlanningItem = Assert.Single(
                Assert.IsType<OccPlanningSnapshotData>(crossStationSnapshot).Turnarounds);
            Assert.Null(crossStationPlanningItem.Stand);

            var crossStationOptionsResult = await readStore.GetOptionsAsync(
                [stationPublicId],
                planningTurnaround.PublicId,
                cancellationToken);
            var crossStationOptions = Assert.IsType<OccPlanningOptionsSourceData>(
                crossStationOptionsResult.Options);
            Assert.Null(crossStationOptions.Turnaround.Stand);
            var crossStationRiley = Assert.Single(crossStationOptions.AgentCandidates);
            Assert.Equal("DEV-RA-001", crossStationRiley.EmployeeNumber);
            Assert.True(crossStationRiley.HasStationScope);
            Assert.False(crossStationRiley.HasTerminalScope);
            Assert.False(crossStationRiley.HasCompatibleShift);
            var crossStationEligibility = OccAgentEligibilityPolicy.Evaluate(crossStationRiley);
            Assert.Contains("terminal_scope_missing", crossStationEligibility.EligibilityReasons);
            Assert.Contains("shift_not_compatible", crossStationEligibility.EligibilityReasons);

            await using (var administratorContext = CreateContext(database.ConnectionString))
            {
                var changed = await administratorContext.Set<StandAssignment>()
                    .Where(assignment => assignment.Id == planningStand.AssignmentInternalId)
                    .ExecuteUpdateAsync(
                        setters => setters.SetProperty(
                            assignment => assignment.StandId,
                            planningStand.StandInternalId),
                        cancellationToken);
                Assert.Equal(1, changed);
            }

            var outOfScope = await readStore.GetOptionsAsync(
                [Guid.NewGuid()],
                Guid.Parse("70000000-0000-7000-8000-000000000012"),
                cancellationToken);
            Assert.False(outOfScope.IsSuccess);
            Assert.Equal(OccPlanningOptionsReadFailure.NotFound, outOfScope.Failure);

            await using (var administratorContext = CreateContext(database.ConnectionString))
            {
                await administratorContext.Users
                    .Where(account => account.NormalizedEmail == "RAMP.AGENT@DEV.ELEVANT.TEST")
                    .ExecuteUpdateAsync(
                        setters => setters.SetProperty(
                            account => account.LockoutEnd,
                            new DateTimeOffset(2099, 1, 1, 0, 0, 0, TimeSpan.Zero)),
                        cancellationToken);
            }

            var lockedResult = await readStore.GetOptionsAsync(
                [stationPublicId],
                planningTurnaround.PublicId,
                cancellationToken);
            var lockedOptions = Assert.IsType<OccPlanningOptionsSourceData>(lockedResult.Options);
            var lockedRiley = Assert.Single(
                lockedOptions.AgentCandidates,
                candidate => candidate.EmployeeNumber == "DEV-RA-001");
            Assert.False(lockedRiley.HasMobileAccount);
            Assert.Contains(
                "mobile_account_unavailable",
                OccAgentEligibilityPolicy.Evaluate(lockedRiley).EligibilityReasons);

            await using (var administratorContext = CreateContext(database.ConnectionString))
            {
                await administratorContext.Users
                    .Where(account => account.NormalizedEmail == "RAMP.AGENT@DEV.ELEVANT.TEST")
                    .ExecuteUpdateAsync(
                        setters => setters.SetProperty(
                            account => account.LockoutEnd,
                            (DateTimeOffset?)null),
                        cancellationToken);
                await administratorContext.AirportPermitCycles
                    .Where(permit =>
                        permit.PublicId == Guid.Parse("50000000-0000-7000-8000-000000000003"))
                    .ExecuteUpdateAsync(
                        setters => setters.SetProperty(
                            permit => permit.ExpiresOn,
                            new DateOnly(2026, 8, 18)),
                        cancellationToken);
            }

            var expiredPermitResult = await readStore.GetOptionsAsync(
                [stationPublicId],
                planningTurnaround.PublicId,
                cancellationToken);
            var expiredPermitOptions = Assert.IsType<OccPlanningOptionsSourceData>(
                expiredPermitResult.Options);
            var expiredPermitRiley = Assert.Single(
                expiredPermitOptions.AgentCandidates,
                candidate => candidate.EmployeeNumber == "DEV-RA-001");
            Assert.False(expiredPermitRiley.HasCurrentAirportId);
            Assert.Contains(
                "airport_id_not_current",
                OccAgentEligibilityPolicy.Evaluate(expiredPermitRiley).EligibilityReasons);

            await using (var administratorContext = CreateContext(database.ConnectionString))
            {
                await administratorContext.AirportPermitCycles
                    .Where(permit =>
                        permit.PublicId == Guid.Parse("50000000-0000-7000-8000-000000000003"))
                    .ExecuteUpdateAsync(
                        setters => setters.SetProperty(
                            permit => permit.ExpiresOn,
                            new DateOnly(2099, 12, 31)),
                        cancellationToken);
            }

            var noTimeTurnaround = new Turnaround
            {
                PublicId = Guid.Parse("90000000-0000-7000-8000-000000000101"),
                OperationCode = "DEV-TAT-NO-TIME",
                AirlineId = planningTurnaround.AirlineId,
                StationId = planningTurnaround.StationId,
                OperationDate = new DateOnly(2026, 8, 19),
                CurrentStatus = TurnaroundStatus.Confirmed,
                Source = OperationalDataSource.Internal,
                CreatedAt = testInstant,
                UpdatedAt = testInstant,
            };
            context.Turnarounds.Add(noTimeTurnaround);
            await context.SaveChangesAsync(cancellationToken);

            var noTimeResult = await readStore.GetOptionsAsync(
                [stationPublicId],
                noTimeTurnaround.PublicId,
                cancellationToken);
            Assert.False(noTimeResult.IsSuccess);
            Assert.Null(noTimeResult.Options);
            Assert.Equal(
                OccPlanningOptionsReadFailure.OperationalConflict,
                noTimeResult.Failure);

            var conflictingContract = new Contract
            {
                PublicId = Guid.Parse("90000000-0000-7000-8000-000000000201"),
                AirlineId = planningTurnaround.AirlineId,
                ContractCode = "DEV-CONTRACT-OVERLAP",
                Status = ContractStatus.Active,
                SignedOn = new DateOnly(2026, 1, 1),
                CreatedAt = testInstant,
                UpdatedAt = testInstant,
            };
            context.Contracts.Add(conflictingContract);
            await context.SaveChangesAsync(cancellationToken);
            var conflictingVersion = new ContractVersion
            {
                PublicId = Guid.Parse("90000000-0000-7000-8000-000000000202"),
                ContractId = conflictingContract.Id,
                VersionNumber = 1,
                Status = ContractVersionStatus.Approved,
                ValidFrom = new DateOnly(2026, 1, 1),
                ValidTo = new DateOnly(2099, 12, 31),
                CurrencyCode = "USD",
                ApprovedAt = testInstant,
                CreatedAt = testInstant,
                UpdatedAt = testInstant,
            };
            context.ContractVersions.Add(conflictingVersion);
            await context.SaveChangesAsync(cancellationToken);
            context.Set<ContractVersionStation>().Add(new ContractVersionStation
            {
                ContractVersionId = conflictingVersion.Id,
                StationId = station.Id,
            });
            await context.SaveChangesAsync(cancellationToken);

            var conflictResult = await readStore.GetOptionsAsync(
                [stationPublicId],
                planningTurnaround.PublicId,
                cancellationToken);
            Assert.False(conflictResult.IsSuccess);
            Assert.Null(conflictResult.Options);
            Assert.Equal(OccPlanningOptionsReadFailure.ContractConflict, conflictResult.Failure);
        }

        var initialAccounts = await LoadAccountsAsync(context, cancellationToken);
        Assert.All(initialAccounts.Values, account => Assert.True(account.LockoutEnabled));
        AssertPasswordSet(initialAccounts, InitialPasswords);
        var initialCredentialState = initialAccounts.ToDictionary(
            pair => pair.Key,
            pair => (pair.Value.PasswordHash, pair.Value.SecurityStamp),
            StringComparer.Ordinal);

        var driftedPublicId = Guid.CreateVersion7();
        await using (var administratorContext = CreateContext(database.ConnectionString))
        {
            await administratorContext.Database.ExecuteSqlInterpolatedAsync(
                $"""
                UPDATE [iam].[accounts]
                SET [public_id] = {driftedPublicId}
                WHERE [normalized_email] = {"ADMIN.OCC@DEV.ELEVANT.TEST"};
                """,
                cancellationToken);
        }

        context.ChangeTracker.Clear();
        var identityDrift = await Assert.ThrowsAsync<InvalidOperationException>(
            () => seeder.SeedAsync(RotatedPasswords, cancellationToken));
        Assert.Contains("identity drift", identityDrift.Message, StringComparison.OrdinalIgnoreCase);
        context.ChangeTracker.Clear();
        var driftedAccounts = await LoadAccountsAsync(context, cancellationToken);
        Assert.Equal(driftedPublicId, driftedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].PublicId);
        Assert.Equal(
            initialCredentialState["ADMIN.OCC@DEV.ELEVANT.TEST"].PasswordHash,
            driftedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].PasswordHash);
        Assert.Equal(
            initialCredentialState["ADMIN.OCC@DEV.ELEVANT.TEST"].SecurityStamp,
            driftedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].SecurityStamp);

        await using (var administratorContext = CreateContext(database.ConnectionString))
        {
            await administratorContext.Database.ExecuteSqlRawAsync(
                "UPDATE [iam].[accounts] SET [public_id] = '40000000-0000-7000-8000-000000000001' WHERE [normalized_email] = N'ADMIN.OCC@DEV.ELEVANT.TEST';",
                cancellationToken);
        }
        context.ChangeTracker.Clear();

        long driftPersonId;
        var expectedAdminPersonId = initialAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].PersonId;
        await using (var administratorContext = CreateContext(database.ConnectionString))
        {
            var driftPerson = new Person
            {
                PublicId = Guid.CreateVersion7(),
                FirstName = "Identity",
                LastName = "Drift",
                PrimaryEmail = "identity.drift@dev.elevant.test",
                IdentificationType = "Synthetic",
                IdentificationNumber = "DEV-DRIFT-001",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            administratorContext.Persons.Add(driftPerson);
            await administratorContext.SaveChangesAsync(cancellationToken);
            driftPersonId = driftPerson.Id;
            await administratorContext.Database.ExecuteSqlInterpolatedAsync(
                $"""
                UPDATE [iam].[accounts]
                SET [person_id] = {driftPersonId}
                WHERE [normalized_email] = {"ADMIN.OCC@DEV.ELEVANT.TEST"};
                """,
                cancellationToken);
        }

        var procedurePersonDrift = await Assert.ThrowsAsync<SqlException>(() =>
            context.Database.ExecuteSqlRawAsync(
                "EXEC [iam].[set_development_account_credential] N'ADMIN.OCC@DEV.ELEVANT.TEST', '40000000-0000-7000-8000-000000000001', NULL, NULL;",
                cancellationToken));
        Assert.Equal(52103, procedurePersonDrift.Number);
        var accountPersonDrift = await Assert.ThrowsAsync<InvalidOperationException>(
            () => seeder.SeedAsync(RotatedPasswords, cancellationToken));
        Assert.Contains("identity drift", accountPersonDrift.Message, StringComparison.OrdinalIgnoreCase);
        context.ChangeTracker.Clear();
        var personDriftedAccounts = await LoadAccountsAsync(context, cancellationToken);
        Assert.Equal(
            initialCredentialState["ADMIN.OCC@DEV.ELEVANT.TEST"].PasswordHash,
            personDriftedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].PasswordHash);

        await using (var administratorContext = CreateContext(database.ConnectionString))
        {
            await administratorContext.Database.ExecuteSqlInterpolatedAsync(
                $"""
                UPDATE [iam].[accounts]
                SET [person_id] = {expectedAdminPersonId}
                WHERE [normalized_email] = {"ADMIN.OCC@DEV.ELEVANT.TEST"};
                DELETE FROM [iam].[persons] WHERE [id] = {driftPersonId};
                """,
                cancellationToken);
        }
        context.ChangeTracker.Clear();

        var organizationCount = await context.Organizations.CountAsync(cancellationToken);
        var accountCount = await context.Users.CountAsync(cancellationToken);
        var turnaroundCount = await context.Turnarounds.CountAsync(cancellationToken);

        context.ServiceDefinitions.Add(new ServiceDefinition
        {
            PublicId = Guid.CreateVersion7(),
            Code = "USER-SENTINEL",
            Name = "Existing row preserved by seed",
            DefaultBillingUnit = "test",
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await context.SaveChangesAsync(cancellationToken);

        var preservedLockoutEnd = new DateTimeOffset(2099, 12, 30, 12, 34, 56, TimeSpan.Zero);
        await using (var administratorContext = CreateContext(database.ConnectionString))
        {
            await administratorContext.Database.ExecuteSqlInterpolatedAsync(
                $"""
                UPDATE [iam].[accounts]
                SET [lockout_enabled] = {false},
                    [access_failed_count] = {4},
                    [lockout_end] = {preservedLockoutEnd}
                WHERE [normalized_email] = {"ADMIN.OCC@DEV.ELEVANT.TEST"};
                """,
                cancellationToken);
        }

        context.ChangeTracker.Clear();
        var unsafeLockout = await Assert.ThrowsAsync<InvalidOperationException>(
            () => seeder.SeedAsync(InitialPasswords, cancellationToken));
        Assert.Contains("credential drift", unsafeLockout.Message, StringComparison.OrdinalIgnoreCase);
        context.ChangeTracker.Clear();
        await using (var administratorContext = CreateContext(database.ConnectionString))
        {
            await administratorContext.Database.ExecuteSqlInterpolatedAsync(
                $"UPDATE [iam].[accounts] SET [lockout_enabled] = {true} WHERE [normalized_email] = {"ADMIN.OCC@DEV.ELEVANT.TEST"};",
                cancellationToken);
        }
        await seeder.SeedAsync(InitialPasswords, cancellationToken);

        Assert.Equal(organizationCount, await context.Organizations.CountAsync(cancellationToken));
        Assert.Equal(accountCount, await context.Users.CountAsync(cancellationToken));
        Assert.Equal(turnaroundCount, await context.Turnarounds.CountAsync(cancellationToken));
        Assert.True(await context.ServiceDefinitions.AnyAsync(
            item => item.Code == "USER-SENTINEL",
            cancellationToken));

        context.ChangeTracker.Clear();
        var repeatedAccounts = await LoadAccountsAsync(context, cancellationToken);
        AssertPasswordSet(repeatedAccounts, InitialPasswords);
        Assert.All(initialCredentialState, pair =>
        {
            Assert.Equal(pair.Value.PasswordHash, repeatedAccounts[pair.Key].PasswordHash);
            Assert.Equal(pair.Value.SecurityStamp, repeatedAccounts[pair.Key].SecurityStamp);
        });
        Assert.Equal(4, repeatedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].AccessFailedCount);
        Assert.Equal(preservedLockoutEnd, repeatedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].LockoutEnd);

        await seeder.SeedAsync(RotatedPasswords, cancellationToken);
        context.ChangeTracker.Clear();
        var rotatedAccounts = await LoadAccountsAsync(context, cancellationToken);
        AssertPasswordSet(rotatedAccounts, InitialPasswords);
        Assert.Equal(
            initialCredentialState["ADMIN.OCC@DEV.ELEVANT.TEST"].PasswordHash,
            rotatedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].PasswordHash);
        Assert.Equal(
            initialCredentialState["ADMIN.OCC@DEV.ELEVANT.TEST"].SecurityStamp,
            rotatedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].SecurityStamp);
        Assert.Equal(
            initialCredentialState["RAMP.AGENT@DEV.ELEVANT.TEST"].PasswordHash,
            rotatedAccounts["RAMP.AGENT@DEV.ELEVANT.TEST"].PasswordHash);
        Assert.Equal(
            initialCredentialState["RAMP.AGENT@DEV.ELEVANT.TEST"].SecurityStamp,
            rotatedAccounts["RAMP.AGENT@DEV.ELEVANT.TEST"].SecurityStamp);
        Assert.Equal(
            initialCredentialState["AIRLINE.CLIENT@DEV.ELEVANT.TEST"].PasswordHash,
            rotatedAccounts["AIRLINE.CLIENT@DEV.ELEVANT.TEST"].PasswordHash);
        Assert.Equal(
            initialCredentialState["AIRLINE.CLIENT@DEV.ELEVANT.TEST"].SecurityStamp,
            rotatedAccounts["AIRLINE.CLIENT@DEV.ELEVANT.TEST"].SecurityStamp);
        Assert.Equal(4, rotatedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].AccessFailedCount);
        Assert.Equal(preservedLockoutEnd, rotatedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].LockoutEnd);

        var legacyRampAccount = rotatedAccounts["RAMP.AGENT@DEV.ELEVANT.TEST"];
        var legacyHasher = new PasswordHasher<ApplicationUser>(Options.Create(new PasswordHasherOptions
        {
            CompatibilityMode = PasswordHasherCompatibilityMode.IdentityV2,
        }));
        var legacyHash = legacyHasher.HashPassword(legacyRampAccount, RotatedPasswords.RampAgent);
        var legacySecurityStamp = Guid.NewGuid().ToString("D");
        var runtimeHasher = new PasswordHasher<ApplicationUser>();
        Assert.Equal(
            PasswordVerificationResult.SuccessRehashNeeded,
            runtimeHasher.VerifyHashedPassword(legacyRampAccount, legacyHash, RotatedPasswords.RampAgent));

        await using (var administratorContext = CreateContext(database.ConnectionString))
        {
            await administratorContext.Database.ExecuteSqlInterpolatedAsync(
                $"""
                UPDATE [iam].[accounts]
                SET [password_hash] = {legacyHash},
                    [security_stamp] = {legacySecurityStamp}
                WHERE [normalized_email] = {"RAMP.AGENT@DEV.ELEVANT.TEST"};
                """,
                cancellationToken);
        }

        context.ChangeTracker.Clear();
        await seeder.SeedAsync(RotatedPasswords, cancellationToken);
        context.ChangeTracker.Clear();
        var rehashedAccounts = await LoadAccountsAsync(context, cancellationToken);
        Assert.Equal(legacyHash, rehashedAccounts["RAMP.AGENT@DEV.ELEVANT.TEST"].PasswordHash);
        Assert.Equal(legacySecurityStamp, rehashedAccounts["RAMP.AGENT@DEV.ELEVANT.TEST"].SecurityStamp);
        Assert.Equal(
            rotatedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].PasswordHash,
            rehashedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].PasswordHash);
        Assert.Equal(
            rotatedAccounts["AIRLINE.CLIENT@DEV.ELEVANT.TEST"].PasswordHash,
            rehashedAccounts["AIRLINE.CLIENT@DEV.ELEVANT.TEST"].PasswordHash);

        var rehashedCredentialState = rehashedAccounts.ToDictionary(
            pair => pair.Key,
            pair => (pair.Value.PasswordHash, pair.Value.SecurityStamp),
            StringComparer.Ordinal);
        await seeder.SeedAsync(RotatedPasswords, cancellationToken);
        context.ChangeTracker.Clear();
        var repeatedRehashedAccounts = await LoadAccountsAsync(context, cancellationToken);
        Assert.All(rehashedCredentialState, pair =>
        {
            Assert.Equal(pair.Value.PasswordHash, repeatedRehashedAccounts[pair.Key].PasswordHash);
            Assert.Equal(pair.Value.SecurityStamp, repeatedRehashedAccounts[pair.Key].SecurityStamp);
        });

        var unauthorizedAccount = await Assert.ThrowsAsync<SqlException>(() =>
            context.Database.ExecuteSqlRawAsync(
                "EXEC [iam].[set_development_account_credential] N'OUTSIDER@DEV.ELEVANT.TEST', '49999999-0000-7000-8000-000000000999', NULL, NULL;",
                cancellationToken));
        Assert.Equal(52101, unauthorizedAccount.Number);

        var mismatchedPublicId = await Assert.ThrowsAsync<SqlException>(() =>
            context.Database.ExecuteSqlRawAsync(
                "EXEC [iam].[set_development_account_credential] N'ADMIN.OCC@DEV.ELEVANT.TEST', '49999999-0000-7000-8000-000000000999', NULL, NULL;",
                cancellationToken));
        Assert.Equal(52101, mismatchedPublicId.Number);

        var directUpdate = await Assert.ThrowsAsync<SqlException>(() =>
            context.Database.ExecuteSqlRawAsync(
                "UPDATE [iam].[accounts] SET [lockout_enabled] = 0 WHERE [normalized_email] = N'ADMIN.OCC@DEV.ELEVANT.TEST';",
                cancellationToken));
        Assert.Equal(229, directUpdate.Number);

        await using (var appConnection = await database.OpenAsDevelopmentAppAsync(cancellationToken))
        await using (var appContext = CreateContext(appConnection))
        {
            var appProcedureAccess = await Assert.ThrowsAsync<SqlException>(() =>
                appContext.Database.ExecuteSqlRawAsync(
                    "EXEC [iam].[set_development_account_credential] N'ADMIN.OCC@DEV.ELEVANT.TEST', '40000000-0000-7000-8000-000000000001', NULL, NULL;",
                    cancellationToken));
            Assert.Equal(229, appProcedureAccess.Number);
        }

        await using (var administratorContext = CreateContext(database.ConnectionString))
        {
            var duplicateNormalizedEmail = await Assert.ThrowsAsync<SqlException>(() =>
                administratorContext.Database.ExecuteSqlRawAsync(
                    "UPDATE [iam].[accounts] SET [normalized_email] = N'ADMIN.OCC@DEV.ELEVANT.TEST' WHERE [normalized_email] = N'RAMP.AGENT@DEV.ELEVANT.TEST';",
                    cancellationToken));
            Assert.True(duplicateNormalizedEmail.Number is 2601 or 2627);
        }
    }

    [Fact]
    public async Task AuthenticationAdaptersEnforceLockoutIdentityCasAndEffectiveScopes()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null)
        {
            return;
        }

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection,
            "Development",
            cancellationToken);
        await using (var migrationContext = CreateContext(database.ConnectionString))
        {
            await migrationContext.Database.MigrateAsync(cancellationToken);
        }

        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seederContext = CreateContext(seederConnection))
        {
            await new DevelopmentDataSeeder(seederContext).SeedAsync(
                InitialPasswords,
                cancellationToken);
        }

        var passwordCounter = new PasswordHashCounter();
        await using var provider = CreateAuthenticationProvider(
            database.ConnectionString,
            passwordCounter);
        var adminPublicId = Guid.Parse("40000000-0000-7000-8000-000000000001");
        const string adminEmail = "admin.occ@dev.elevant.test";

        var verifications = passwordCounter.VerificationCount;
        Assert.Null(await VerifyAsync(
            provider,
            "unknown@dev.elevant.test",
            InitialPasswords.AdminOcc,
            cancellationToken));
        Assert.Equal(verifications + 1, passwordCounter.VerificationCount);

        verifications = passwordCounter.VerificationCount;
        var credential = await VerifyAsync(
            provider,
            adminEmail,
            InitialPasswords.AdminOcc,
            cancellationToken);
        Assert.NotNull(credential);
        Assert.Equal(adminPublicId, credential.AccountId);
        Assert.Equal(verifications + 1, passwordCounter.VerificationCount);

        var actor = await ResolveActorAsync(provider, adminPublicId, cancellationToken);
        Assert.NotNull(actor);
        Assert.NotEmpty(actor.Roles);
        Assert.NotEmpty(actor.Memberships);
        Assert.NotEmpty(actor.StationScopes);

        await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => VerifyAsync(
            provider,
            adminEmail,
            "Wrong-DevelopmentPassword!2026",
            cancellationToken)));

        await using (var lockedContext = CreateContext(database.ConnectionString))
        {
            var locked = await lockedContext.Users
                .AsNoTracking()
                .SingleAsync(account => account.PublicId == adminPublicId, cancellationToken);
            Assert.NotNull(locked.LockoutEnd);
            Assert.True(locked.LockoutEnd > TimeProvider.System.GetUtcNow());
            Assert.Equal(0, locked.AccessFailedCount);
        }

        Assert.Null(await VerifyAsync(
            provider,
            adminEmail,
            InitialPasswords.AdminOcc,
            cancellationToken));

        await using (var expirationContext = CreateContext(database.ConnectionString))
        {
            var expiredAt = TimeProvider.System.GetUtcNow().AddMinutes(-1);
            await expirationContext.Users
                .Where(account => account.PublicId == adminPublicId)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(account => account.LockoutEnd, expiredAt)
                        .SetProperty(account => account.AccessFailedCount, 3),
                    cancellationToken);
        }

        Assert.NotNull(await VerifyAsync(
            provider,
            adminEmail,
            InitialPasswords.AdminOcc,
            cancellationToken));
        await using (var resetContext = CreateContext(database.ConnectionString))
        {
            var reset = await resetContext.Users
                .AsNoTracking()
                .SingleAsync(account => account.PublicId == adminPublicId, cancellationToken);
            Assert.Null(reset.LockoutEnd);
            Assert.Equal(0, reset.AccessFailedCount);
            Assert.NotNull(reset.LastLoginAt);
        }

        var driftedPublicId = Guid.CreateVersion7();
        using var verificationGate = passwordCounter.PauseOnceAfterVerification();
        var verificationTask = Task.Run(
            () => VerifyAsync(
                provider,
                adminEmail,
                InitialPasswords.AdminOcc,
                cancellationToken),
            cancellationToken);
        var observation = await verificationGate.Reached.WaitAsync(
            TimeSpan.FromSeconds(10),
            cancellationToken);
        Assert.NotEqual(PasswordVerificationResult.Failed, observation.Result);
        try
        {
            await UpdateAccountPublicIdAsync(
                database.ConnectionString,
                observation.AccountId,
                driftedPublicId,
                cancellationToken);
        }
        finally
        {
            verificationGate.Release();
        }

        Assert.Null(await verificationTask);
        await UpdateAccountPublicIdAsync(
            database.ConnectionString,
            accountId: null,
            adminPublicId,
            cancellationToken);

        await using (var secondFactorContext = CreateContext(database.ConnectionString))
        {
            await secondFactorContext.Users
                .Where(account => account.PublicId == adminPublicId)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(account => account.TwoFactorEnabled, true),
                    cancellationToken);
        }

        Assert.Null(await VerifyAsync(
            provider,
            adminEmail,
            InitialPasswords.AdminOcc,
            cancellationToken));
        Assert.Null(await ResolveActorAsync(provider, adminPublicId, cancellationToken));

        await using (var scopeContext = CreateContext(database.ConnectionString))
        {
            await scopeContext.Users
                .Where(account => account.PublicId == adminPublicId)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(account => account.TwoFactorEnabled, false),
                    cancellationToken);
            var adminId = await scopeContext.Users
                .Where(account => account.PublicId == adminPublicId)
                .Select(account => account.Id)
                .SingleAsync(cancellationToken);
            await scopeContext.OrganizationMemberships
                .Where(membership => membership.AccountId == adminId)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(
                        membership => membership.Status,
                        MembershipStatus.Suspended),
                    cancellationToken);
        }

        await using (var scope = provider.CreateAsyncScope())
        {
            var resolver = scope.ServiceProvider.GetRequiredService<IActorContextResolver>();
            var currentSession = await new GetCurrentSessionHandler(resolver).HandleAsync(
                new GetCurrentSessionQuery(adminPublicId),
                cancellationToken);
            Assert.False(currentSession.IsSuccess);
        }
    }

    [Fact]
    public async Task ManualTurnaroundIsAtomicScopedAndIdempotent()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seeder = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seeder).SeedAsync(InitialPasswords, cancellationToken);

        var actorId = Guid.Parse("40000000-0000-7000-8000-000000000001");
        var stationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
        var turnaroundId = Guid.CreateVersion7();
        var standId = Guid.Parse("20000000-0000-7000-8000-000000000005");
        Guid airlineId;
        await using (var context = CreateContext(database.ConnectionString))
            airlineId = await context.Airlines.AsNoTracking().Select(item => item.PublicId)
                .SingleAsync(cancellationToken);

        await using var provider = CreateAuthenticationProvider(
            database.ConnectionString, new PasswordHashCounter());
        await using (var scope = provider.CreateAsyncScope())
        {
            var options = await scope.ServiceProvider
                .GetRequiredService<IManualTurnaroundOptionsStore>()
                .GetAsync(actorId, stationId, new DateOnly(2026, 9, 26), cancellationToken);
            Assert.NotNull(options);
            Assert.Equal("PUJ", options.StationAirport.IataCode);
            Assert.Contains(options.Airlines, item => item.Id == airlineId);
            Assert.Contains(options.Airports, item => item.IataCode == "MIA");
            Assert.Contains(options.Stands, item => item.Id == standId);
            Assert.Null(await scope.ServiceProvider
                .GetRequiredService<IManualTurnaroundOptionsStore>()
                .GetAsync(actorId, Guid.NewGuid(), new DateOnly(2026, 9, 26), cancellationToken));
        }
        var request = new ManualTurnaroundWriteRequest(
            actorId, [stationId], turnaroundId, stationId, airlineId, standId,
            new DateOnly(2026, 9, 26), "EV311", "MIA",
            new DateTimeOffset(2026, 9, 26, 13, 0, 0, TimeSpan.Zero),
            "EV312", "MIA",
            new DateTimeOffset(2026, 9, 26, 15, 0, 0, TimeSpan.Zero),
            Guid.CreateVersion7(), "manual-turnaround-test");

        async Task<ManualTurnaroundWriteResult> CreateAsync(ManualTurnaroundWriteRequest input)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IManualTurnaroundStore>()
                .CreateAsync(input, cancellationToken);
        }

        var created = await CreateAsync(request);
        Assert.True(created.IsSuccess);
        Assert.False(created.Replayed);
        Assert.Equal(turnaroundId, created.TurnaroundId);
        var replay = await CreateAsync(request with { CorrelationId = Guid.CreateVersion7() });
        Assert.True(replay.IsSuccess);
        Assert.True(replay.Replayed);
        Assert.Equal(created.OperationCode, replay.OperationCode);
        var changed = await CreateAsync(request with { DepartureFlightNumber = "EV999" });
        Assert.Equal(ManualTurnaroundWriteFailure.Conflict, changed.Failure);
        var overlappingStand = await CreateAsync(request with
        {
            TurnaroundId = Guid.CreateVersion7(),
            ArrivalFlightNumber = "EV313",
            DepartureFlightNumber = "EV314",
        });
        Assert.Equal(ManualTurnaroundWriteFailure.Conflict, overlappingStand.Failure);
        var foreignScope = await CreateAsync(request with { AllowedStationIds = [] });
        Assert.Equal(ManualTurnaroundWriteFailure.NotFound, foreignScope.Failure);

        await using (var scope = provider.CreateAsyncScope())
        {
            var planning = await scope.ServiceProvider.GetRequiredService<IOccPlanningReadStore>()
                .GetOptionsAsync([stationId], turnaroundId, cancellationToken);
            Assert.True(planning.IsSuccess);
            Assert.Equal("A01", planning.Options!.Turnaround.Stand?.Code);
            Assert.Equal(2, planning.Options.Services.Count);
            Assert.Contains(planning.Options.AgentCandidates, candidate =>
                !candidate.HasCompatibleShift);
        }

        var shiftRequest = new OccShiftWriteRequest(actorId, [stationId], turnaroundId,
            Guid.Parse("50000000-0000-7000-8000-000000000001"),
            new TimeOnly(8, 0), new TimeOnly(12, 0),
            Guid.CreateVersion7(), "manual-shift-test");
        async Task<OccShiftWriteResult> ProgramShiftAsync(OccShiftWriteRequest input)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IOccShiftProgrammingStore>()
                .ProgramAsync(input, cancellationToken);
        }
        Assert.Equal(OccShiftWriteFailure.Conflict,
            (await ProgramShiftAsync(shiftRequest with { AgentId = Guid.CreateVersion7() })).Failure);
        Assert.Equal(OccShiftWriteFailure.Conflict,
            (await ProgramShiftAsync(shiftRequest with { StartsAtLocal = new TimeOnly(10, 0) })).Failure);
        await using (var context = CreateContext(database.ConnectionString))
        {
            var agentDbId = await context.RampAgents.AsNoTracking()
                .Where(item => item.PublicId == shiftRequest.AgentId)
                .Select(item => item.Id).SingleAsync(cancellationToken);
            await context.AirportPermitCycles.Where(item => item.RampAgentId == agentDbId &&
                item.DocumentType == PermitDocumentType.AirportId)
                .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.ExpiresOn,
                    new DateOnly(2026, 9, 25)), cancellationToken);
            Assert.Equal(OccShiftWriteFailure.Conflict,
                (await ProgramShiftAsync(shiftRequest)).Failure);
            Assert.Equal(0, await context.ShiftAssignments.AsNoTracking().CountAsync(item =>
                item.RampAgentId == agentDbId && item.WorkDate == new DateOnly(2026, 9, 26),
                cancellationToken));
            await context.AirportPermitCycles.Where(item => item.RampAgentId == agentDbId &&
                item.DocumentType == PermitDocumentType.AirportId)
                .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.ExpiresOn,
                    new DateOnly(2099, 12, 31)), cancellationToken);
        }
        var shift = await ProgramShiftAsync(shiftRequest);
        Assert.True(shift.IsSuccess);
        Assert.False(shift.Replayed);
        var shiftReplay = await ProgramShiftAsync(shiftRequest);
        Assert.True(shiftReplay.IsSuccess);
        Assert.True(shiftReplay.Replayed);
        Assert.Equal(shift.ShiftId, shiftReplay.ShiftId);
        Assert.Equal(OccShiftWriteFailure.Conflict,
            (await ProgramShiftAsync(shiftRequest with { EndsAtLocal = new TimeOnly(13, 0) })).Failure);
        Assert.Equal(OccShiftWriteFailure.NotFound,
            (await ProgramShiftAsync(shiftRequest with { AllowedStationIds = [] })).Failure);
        await using (var beforeAssignment = CreateContext(database.ConnectionString))
        {
            var shiftPlanningHints = (await beforeAssignment.OutboxMessages.AsNoTracking()
                .Where(item => item.EventType == "account.changed.v1")
                .ToArrayAsync(cancellationToken))
                .Select(AccountChangeOutboxWriter.Decode)
                .Where(item => item.Resource == "occ_planning" && item.ResourceId == stationId)
                .ToArray();
            Assert.Single(shiftPlanningHints); // The shift replay does not publish twice.
        }
        await using (var scope = provider.CreateAsyncScope())
        {
            var planning = await scope.ServiceProvider.GetRequiredService<IOccPlanningReadStore>()
                .GetOptionsAsync([stationId], turnaroundId, cancellationToken);
            Assert.True(planning.IsSuccess);
            Assert.Contains(planning.Options!.AgentCandidates, candidate =>
                candidate.Id == shiftRequest.AgentId && candidate.HasCompatibleShift);
            var token = planning.Options.Turnaround.ConcurrencyToken;
            var assigned = await new AssignOccOperationHandler(
                    scope.ServiceProvider.GetRequiredService<IActorContextResolver>(),
                    scope.ServiceProvider.GetRequiredService<IOccPlanningCommandStore>())
                .HandleAsync(new AssignOccOperationCommand(actorId, turnaroundId,
                    shiftRequest.AgentId, token, Guid.CreateVersion7(), "manual-cycle-test"),
                    cancellationToken);
            Assert.True(assigned.IsSuccess);
            Assert.Equal(GroundOperationStatus.Assigned.ToString(), assigned.Assignment!.Operation.Status);
        }
        await using (var scope = provider.CreateAsyncScope())
        {
            var rampQueue = await new GetRampAssignedOperationsHandler(
                    scope.ServiceProvider.GetRequiredService<IActorContextResolver>(),
                    scope.ServiceProvider.GetRequiredService<IRampOperationsReadStore>())
                .HandleAsync(new GetRampAssignedOperationsQuery(
                    Guid.Parse("40000000-0000-7000-8000-000000000002")), cancellationToken);
            Assert.True(rampQueue.IsSuccess);
            Assert.Contains(rampQueue.Operations!, item => item.Turnaround.Id == turnaroundId &&
                item.Assignment.AgentId == shiftRequest.AgentId);
        }

        await using var inspection = CreateContext(database.ConnectionString);
        var turnaround = await inspection.Turnarounds.AsNoTracking()
            .SingleAsync(item => item.PublicId == turnaroundId, cancellationToken);
        Assert.Equal(OperationalDataSource.Manual, turnaround.Source);
        Assert.Equal(TurnaroundStatus.Confirmed, turnaround.CurrentStatus);
        Assert.Equal(2, await inspection.FlightLegs.AsNoTracking()
            .CountAsync(item => item.TurnaroundId == turnaround.Id, cancellationToken));
        Assert.Equal(1, await inspection.Set<StandAssignment>().AsNoTracking()
            .CountAsync(item => item.TurnaroundId == turnaround.Id && item.StandId ==
                inspection.Stands.Where(stand => stand.PublicId == standId).Select(stand => stand.Id).Single(),
                cancellationToken));
        var operation = await inspection.GroundOperations.AsNoTracking()
            .SingleAsync(item => item.TurnaroundId == turnaround.Id, cancellationToken);
        Assert.Equal(GroundOperationStatus.Assigned, operation.CurrentStatus);
        Assert.Equal(1, await inspection.Set<TurnaroundStatusEvent>().AsNoTracking()
            .CountAsync(item => item.TurnaroundId == turnaround.Id, cancellationToken));
        Assert.Equal(2, await inspection.Set<GroundOperationStatusEvent>().AsNoTracking()
            .CountAsync(item => item.GroundOperationId == operation.Id, cancellationToken));
        Assert.Equal(1, await inspection.AuditEntries.AsNoTracking()
            .CountAsync(item => item.EntityPublicId == turnaroundId &&
                item.Action == "occ.turnaround.created", cancellationToken));
        var manualHints = (await inspection.OutboxMessages.AsNoTracking()
            .Where(item => item.EventType == "account.changed.v1")
            .ToArrayAsync(cancellationToken))
            .Select(AccountChangeOutboxWriter.Decode)
            .Where(item => item.Resource == "airline_operations" &&
                item.ResourceId == operation.PublicId)
            .ToArray();
        Assert.Equal(2, manualHints.Length); // Creation and OCC assignment are separate durable changes.
        var hrAccountDbId = await inspection.Users.AsNoTracking()
            .Where(item => item.PublicId == Guid.Parse("40000000-0000-7000-8000-000000000004"))
            .Select(item => item.Id).SingleAsync(cancellationToken);
        var shiftHints = (await inspection.OutboxMessages.AsNoTracking()
            .Where(item => item.EventType == "account.changed.v1")
            .ToArrayAsync(cancellationToken))
            .Select(AccountChangeOutboxWriter.Decode)
            .Where(item => item.Resource == "hr_shifts" && item.ResourceId == shift.ShiftId &&
                item.RecipientAccountId == hrAccountDbId)
            .ToArray();
        Assert.Single(shiftHints); // The successful retry must not publish a second HR hint.
        Assert.Equal(1, await inspection.ShiftAssignments.AsNoTracking()
            .CountAsync(item => item.PublicId == shift.ShiftId, cancellationToken));
        Assert.Equal(1, await inspection.AuditEntries.AsNoTracking()
            .CountAsync(item => item.EntityPublicId == shift.ShiftId &&
                item.Action == "occ.shift.programmed", cancellationToken));
        var actorDbId = await inspection.Users.AsNoTracking()
            .Where(item => item.PublicId == actorId).Select(item => item.Id)
            .SingleAsync(cancellationToken);
        var occPlanningHints = (await inspection.OutboxMessages.AsNoTracking()
            .Where(item => item.EventType == "account.changed.v1")
            .ToArrayAsync(cancellationToken))
            .Select(AccountChangeOutboxWriter.Decode)
            .Where(item => item.Resource == "occ_planning" &&
                item.ResourceId == stationId &&
                item.RecipientAccountId == actorDbId)
            .ToArray();
        Assert.Equal(2, occPlanningHints.Length); // Shift and assignment each publish once.
        await inspection.AccountStationScopes.Where(item => item.AccountId == actorDbId &&
            item.StationId == turnaround.StationId && item.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.RevokedAt,
                DateTimeOffset.UtcNow), cancellationToken);
        Assert.Equal(OccShiftWriteFailure.NotFound,
            (await ProgramShiftAsync(shiftRequest)).Failure);
    }

    [Fact]
    public async Task OccAssignmentIsAtomicContractDrivenAndConcurrencySafe()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null)
        {
            return;
        }

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection,
            "Development",
            cancellationToken);
        await using (var migrationContext = CreateContext(database.ConnectionString))
        {
            await migrationContext.Database.MigrateAsync(cancellationToken);
        }

        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seederContext = CreateContext(seederConnection))
        {
            await new DevelopmentDataSeeder(seederContext)
                .SeedAsync(InitialPasswords, cancellationToken);
        }

        var actorId = Guid.Parse("40000000-0000-7000-8000-000000000001");
        var stationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
        var turnaroundId = Guid.Parse("70000000-0000-7000-8000-000000000012");
        var agentId = Guid.Parse("50000000-0000-7000-8000-000000000001");
        long turnaroundInternalId;
        long operationId;
        long activeAssignmentOperationId;
        DateTimeOffset activeAssignmentStart;
        DateTimeOffset activeAssignmentEnd;
        await using (var setupContext = CreateContext(database.ConnectionString))
        {
            turnaroundInternalId = await setupContext.Turnarounds
                .Where(item => item.PublicId == turnaroundId)
                .Select(item => item.Id)
                .SingleAsync(cancellationToken);
            var operation = await setupContext.GroundOperations
                .SingleAsync(
                    item => item.TurnaroundId == turnaroundInternalId,
                    cancellationToken);
            operationId = operation.Id;
            var activeAssignmentOperation = await (
                    from activeAssignment in setupContext.OperationAgentAssignments
                    join agent in setupContext.RampAgents
                        on activeAssignment.RampAgentId equals agent.Id
                    join assignedOperation in setupContext.GroundOperations
                        on activeAssignment.GroundOperationId equals assignedOperation.Id
                    where agent.PublicId == agentId &&
                          activeAssignment.ReleasedAt == null &&
                          assignedOperation.Id != operationId
                    select assignedOperation)
                .SingleAsync(cancellationToken);
            activeAssignmentOperationId = activeAssignmentOperation.Id;
            activeAssignmentStart = Assert.IsType<DateTimeOffset>(
                activeAssignmentOperation.PlannedStartAt);
            activeAssignmentEnd = Assert.IsType<DateTimeOffset>(
                activeAssignmentOperation.PlannedEndAt);
            // The command, not the client or fixture, owns complete service materialization.
            await setupContext.OperationServices
                .Where(item => item.GroundOperationId == operationId)
                .ExecuteDeleteAsync(cancellationToken);
        }

        await using var provider = CreateAuthenticationProvider(
            database.ConnectionString,
            new PasswordHashCounter());

        async Task<byte[]> FetchOptionsVersionAsync()
        {
            await using var scope = provider.CreateAsyncScope();
            var optionsResult = await scope.ServiceProvider
                .GetRequiredService<IOccPlanningReadStore>()
                .GetOptionsAsync([stationId], turnaroundId, cancellationToken);
            Assert.True(optionsResult.IsSuccess);
            Assert.True(OccPlanningConcurrencyToken.TryDecode(
                optionsResult.Options!.Turnaround.ConcurrencyToken,
                out var version));
            return version;
        }

        async Task<OccAssignmentWriteResult> AssignAsync(
            byte[] version,
            string correlationId,
            string requestId)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider
                .GetRequiredService<IOccPlanningCommandStore>()
                .AssignOperationAsync(
                    new OccAssignmentWriteRequest(
                        actorId,
                        [stationId],
                        turnaroundId,
                        agentId,
                        version,
                        Guid.Parse(correlationId),
                        requestId),
                    cancellationToken);
        }

        async Task AssertNoAssignmentWritesAsync()
        {
            await using var verificationContext = CreateContext(database.ConnectionString);
            var operationPublicId = await verificationContext.GroundOperations
                .Where(item => item.Id == operationId)
                .Select(item => item.PublicId)
                .SingleAsync(cancellationToken);
            Assert.Empty(await verificationContext.OperationAgentAssignments
                .Where(item => item.GroundOperationId == operationId && item.ReleasedAt == null)
                .ToArrayAsync(cancellationToken));
            Assert.Empty(await verificationContext.OperationServices
                .Where(item => item.GroundOperationId == operationId)
                .ToArrayAsync(cancellationToken));
            Assert.Empty(await verificationContext.Set<GroundOperationStatusEvent>()
                .Where(item =>
                    item.GroundOperationId == operationId &&
                    item.FromStatus == GroundOperationStatus.Planned &&
                    item.ToStatus == GroundOperationStatus.Assigned)
                .ToArrayAsync(cancellationToken));
            Assert.Empty(await verificationContext.AuditEntries
                .Where(item =>
                    item.EntityPublicId == operationPublicId &&
                    item.Action == "occ.operation.assigned")
                .ToArrayAsync(cancellationToken));
        }

        await using (var mutationContext = CreateContext(database.ConnectionString))
        {
            await mutationContext.GroundOperations
                .Where(item => item.Id == activeAssignmentOperationId)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(
                        item => item.PlannedStartAt,
                        (DateTimeOffset?)null),
                    cancellationToken);
        }

        var expectedVersion = await FetchOptionsVersionAsync();
        var missingWindowResult = await AssignAsync(
            expectedVersion,
            "90000000-0000-7000-8000-000000000079",
            "occ-assignment-missing-active-window-sql-test");
        Assert.Equal(OccAssignmentWriteFailure.Conflict, missingWindowResult.Failure);
        await AssertNoAssignmentWritesAsync();

        await using (var mutationContext = CreateContext(database.ConnectionString))
        {
            await mutationContext.GroundOperations
                .Where(item => item.Id == activeAssignmentOperationId)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(item => item.PlannedStartAt, activeAssignmentStart)
                        .SetProperty(item => item.PlannedEndAt, activeAssignmentStart),
                    cancellationToken);
        }

        expectedVersion = await FetchOptionsVersionAsync();
        var zeroWindowResult = await AssignAsync(
            expectedVersion,
            "90000000-0000-7000-8000-000000000080",
            "occ-assignment-zero-active-window-sql-test");
        Assert.Equal(OccAssignmentWriteFailure.Conflict, zeroWindowResult.Failure);
        await AssertNoAssignmentWritesAsync();

        await using (var mutationContext = CreateContext(database.ConnectionString))
        {
            await mutationContext.GroundOperations
                .Where(item => item.Id == activeAssignmentOperationId)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(item => item.PlannedStartAt, activeAssignmentStart)
                        .SetProperty(item => item.PlannedEndAt, activeAssignmentEnd),
                    cancellationToken);
        }

        expectedVersion = await FetchOptionsVersionAsync();
        await using (var mutationContext = CreateContext(database.ConnectionString))
        {
            await mutationContext.Turnarounds
                .Where(item => item.PublicId == turnaroundId)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(
                        item => item.CurrentStatus,
                        TurnaroundStatus.Completed),
                    cancellationToken);
        }

        var terminalResult = await AssignAsync(
            expectedVersion,
            "90000000-0000-7000-8000-000000000081",
            "occ-assignment-terminal-sql-test");
        Assert.Equal(OccAssignmentWriteFailure.PreconditionFailed, terminalResult.Failure);
        await AssertNoAssignmentWritesAsync();

        await using (var mutationContext = CreateContext(database.ConnectionString))
        {
            await mutationContext.Turnarounds
                .Where(item => item.PublicId == turnaroundId)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(
                        item => item.CurrentStatus,
                        TurnaroundStatus.Confirmed),
                    cancellationToken);
        }

        expectedVersion = await FetchOptionsVersionAsync();
        long originalStandId;
        long alternateStandId;
        await using (var mutationContext = CreateContext(database.ConnectionString))
        {
            originalStandId = await (
                    from assignmentItem in mutationContext.Set<StandAssignment>()
                    join turnaround in mutationContext.Turnarounds
                        on assignmentItem.TurnaroundId equals turnaround.Id
                    where turnaround.PublicId == turnaroundId && assignmentItem.AssignedTo == null
                    select assignmentItem.StandId)
                .SingleAsync(cancellationToken);
            alternateStandId = await mutationContext.Stands
                .Where(item => item.Code == "A01" && item.Id != originalStandId)
                .Select(item => item.Id)
                .SingleAsync(cancellationToken);
            await mutationContext.Set<StandAssignment>()
                .Where(item =>
                    item.TurnaroundId == turnaroundInternalId &&
                    item.AssignedTo == null)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(item => item.StandId, alternateStandId),
                    cancellationToken);
        }

        var standResult = await AssignAsync(
            expectedVersion,
            "90000000-0000-7000-8000-000000000082",
            "occ-assignment-stand-sql-test");
        Assert.Equal(OccAssignmentWriteFailure.PreconditionFailed, standResult.Failure);
        await AssertNoAssignmentWritesAsync();

        await using (var mutationContext = CreateContext(database.ConnectionString))
        {
            await mutationContext.Set<StandAssignment>()
                .Where(item => item.TurnaroundId == turnaroundInternalId && item.AssignedTo == null)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(item => item.StandId, originalStandId),
                    cancellationToken);
        }

        expectedVersion = await FetchOptionsVersionAsync();
        decimal originalUnitPrice;
        long rateId;
        await using (var mutationContext = CreateContext(database.ConnectionString))
        {
            var rate = await mutationContext.ContractServiceRates
                .SingleAsync(item => item.PublicId ==
                    Guid.Parse("60000000-0000-7000-8000-000000000004"), cancellationToken);
            rateId = rate.Id;
            originalUnitPrice = rate.UnitPrice;
            await mutationContext.ContractServiceRates
                .Where(item => item.Id == rateId)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(
                        item => item.UnitPrice,
                        originalUnitPrice + 1m),
                    cancellationToken);
        }

        var contractResult = await AssignAsync(
            expectedVersion,
            "90000000-0000-7000-8000-000000000083",
            "occ-assignment-contract-sql-test");
        Assert.Equal(OccAssignmentWriteFailure.PreconditionFailed, contractResult.Failure);
        await AssertNoAssignmentWritesAsync();

        await using (var mutationContext = CreateContext(database.ConnectionString))
        {
            await mutationContext.ContractServiceRates
                .Where(item => item.Id == rateId)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(item => item.UnitPrice, originalUnitPrice),
                    cancellationToken);
        }

        expectedVersion = await FetchOptionsVersionAsync();
        var startGate = new TaskCompletionSource(
            TaskCreationOptions.RunContinuationsAsynchronously);

        async Task<OccAssignmentWriteResult> AssignWhenReleasedAsync(
            string correlationId,
            string requestId)
        {
            await startGate.Task.WaitAsync(cancellationToken);
            return await AssignAsync(expectedVersion, correlationId, requestId);
        }

        var concurrentAttempts = new[]
        {
            AssignWhenReleasedAsync(
                "90000000-0000-7000-8000-000000000091",
                "occ-assignment-concurrent-a-sql-test"),
            AssignWhenReleasedAsync(
                "90000000-0000-7000-8000-000000000092",
                "occ-assignment-concurrent-b-sql-test"),
        };
        startGate.SetResult();
        var concurrentResults = await Task.WhenAll(concurrentAttempts);
        var firstResult = Assert.Single(concurrentResults, result => result.IsSuccess);
        var rejectedResult = Assert.Single(concurrentResults, result => !result.IsSuccess);
        Assert.True(
            rejectedResult.Failure is OccAssignmentWriteFailure.PreconditionFailed or
                OccAssignmentWriteFailure.Conflict,
            $"Unexpected concurrent rejection: {rejectedResult.Failure}.");

        var assignment = Assert.IsType<OccAssignmentData>(firstResult.Assignment);
        Assert.Equal("Assigned", assignment.Operation.Status);
        Assert.Equal(agentId, assignment.Assignment.AgentId);
        Assert.Equal("primary", assignment.Assignment.AssignmentRole);
        Assert.Equal(
            ["BAGGAGE", "PASSENGER-BRIDGE"],
            assignment.Services.Select(service => service.Code).ToArray());
        Assert.True(OccPlanningConcurrencyToken.TryDecode(
            assignment.ConcurrencyToken,
            out var assignmentVersion));
        Assert.False(expectedVersion.AsSpan().SequenceEqual(assignmentVersion));

        await using (var verificationContext = CreateContext(database.ConnectionString))
        {
            var operation = await verificationContext.GroundOperations
                .SingleAsync(item => item.Id == operationId, cancellationToken);
            Assert.Equal(GroundOperationStatus.Assigned, operation.CurrentStatus);
            Assert.Single(await verificationContext.OperationAgentAssignments
                .Where(item => item.GroundOperationId == operationId && item.ReleasedAt == null)
                .ToArrayAsync(cancellationToken));
            var services = await verificationContext.OperationServices
                .Where(item => item.GroundOperationId == operationId)
                .OrderBy(item => item.LineNumber)
                .ToArrayAsync(cancellationToken);
            Assert.Equal(2, services.Length);
            Assert.All(services, service =>
            {
                Assert.NotNull(service.ContractServiceRateId);
                Assert.Equal(0m, service.ExecutedQuantity);
                Assert.Equal(ServiceExecutionStatus.Planned, service.CurrentStatus);
            });
            var serviceStatusEvents = await verificationContext
                .Set<OperationServiceStatusEvent>()
                .Where(item => services.Select(service => service.Id)
                    .Contains(item.OperationServiceId))
                .ToArrayAsync(cancellationToken);
            Assert.Equal(2, serviceStatusEvents.Length);
            Assert.All(serviceStatusEvents, serviceStatusEvent =>
            {
                Assert.Null(serviceStatusEvent.FromStatus);
                Assert.Equal(ServiceExecutionStatus.Planned, serviceStatusEvent.ToStatus);
            });
            Assert.Single(await verificationContext.OperationChecklists
                .Where(item => item.GroundOperationId == operationId)
                .ToArrayAsync(cancellationToken));
            Assert.Single(await verificationContext.Set<GroundOperationStatusEvent>()
                .Where(item =>
                    item.GroundOperationId == operationId &&
                    item.FromStatus == GroundOperationStatus.Planned &&
                    item.ToStatus == GroundOperationStatus.Assigned)
                .ToArrayAsync(cancellationToken));
            Assert.Single(await verificationContext.AuditEntries
                .Where(item =>
                    item.EntityPublicId == operation.PublicId &&
                    item.Action == "occ.operation.assigned")
                .ToArrayAsync(cancellationToken));
            var stationInternalId = await verificationContext.Turnarounds.AsNoTracking()
                .Where(item => item.Id == turnaroundInternalId)
                .Select(item => item.StationId)
                .SingleAsync(cancellationToken);
            var assignmentHints = (await verificationContext.OutboxMessages.AsNoTracking()
                .Where(item => item.EventType == "account.changed.v1")
                .ToArrayAsync(cancellationToken))
                .Select(AccountChangeOutboxWriter.Decode).ToArray();
            Assert.Single(assignmentHints, item => item.Resource == "airline_operations" &&
                item.ResourceId == operation.PublicId && item.StationId == null);
            Assert.Single(assignmentHints, item => item.Resource == "occ_planning" &&
                item.ResourceId == stationId && item.StationId == stationInternalId);
        }

        await using (var upgradeSetupContext = CreateContext(database.ConnectionString))
        {
            var removedChecklists = await upgradeSetupContext.OperationChecklists
                .Where(item => item.GroundOperationId == operationId)
                .ExecuteDeleteAsync(cancellationToken);
            Assert.Equal(1, removedChecklists);
        }
        await using (var upgradeSeederConnection = await database.OpenAsDevelopmentSeederAsync(
            cancellationToken))
        await using (var upgradeSeederContext = CreateContext(upgradeSeederConnection))
        {
            await new DevelopmentDataSeeder(upgradeSeederContext)
                .SeedAsync(InitialPasswords, cancellationToken);
        }
        await using (var upgradeVerificationContext = CreateContext(database.ConnectionString))
        {
            var restoredChecklist = await (
                    from checklist in upgradeVerificationContext.OperationChecklists.AsNoTracking()
                    join version in upgradeVerificationContext.Set<ChecklistTemplateVersion>()
                            .AsNoTracking()
                        on checklist.ChecklistTemplateVersionId equals version.Id
                    where checklist.GroundOperationId == operationId
                    select new
                    {
                        checklist.PublicId,
                        checklist.Status,
                        version.VersionNumber,
                    })
                .SingleAsync(cancellationToken);
            Assert.NotEqual(Guid.Empty, restoredChecklist.PublicId);
            Assert.Equal(ChecklistStatus.NotStarted, restoredChecklist.Status);
            Assert.Equal(2, restoredChecklist.VersionNumber);
        }

        var staleResult = await AssignAsync(
            expectedVersion,
            "90000000-0000-7000-8000-000000000093",
            "occ-assignment-stale-sql-test");

        Assert.Equal(OccAssignmentWriteFailure.PreconditionFailed, staleResult.Failure);
        await using var finalContext = CreateContext(database.ConnectionString);
        Assert.Single(await finalContext.OperationAgentAssignments
            .Where(item => item.GroundOperationId == operationId && item.ReleasedAt == null)
            .ToArrayAsync(cancellationToken));
        Assert.Equal(2, await finalContext.OperationServices
            .Where(item => item.GroundOperationId == operationId)
            .CountAsync(cancellationToken));

        var existingServiceTurnaroundId =
            Guid.Parse("70000000-0000-7000-8000-000000000001");
        long existingServiceOperationId;
        Guid[] existingServiceIds;
        await using (var reconciliationSetupContext = CreateContext(database.ConnectionString))
        {
            var existingServiceTurnaroundInternalId = await reconciliationSetupContext.Turnarounds
                .Where(item => item.PublicId == existingServiceTurnaroundId)
                .Select(item => item.Id)
                .SingleAsync(cancellationToken);
            var existingServiceOperation = await reconciliationSetupContext.GroundOperations
                .SingleAsync(
                    item => item.TurnaroundId == existingServiceTurnaroundInternalId,
                    cancellationToken);
            existingServiceOperationId = existingServiceOperation.Id;
            existingServiceOperation.CurrentStatus = GroundOperationStatus.Planned;
            existingServiceOperation.PlannedStartAt =
                new DateTimeOffset(2026, 8, 18, 12, 15, 0, TimeSpan.Zero);
            existingServiceOperation.PlannedEndAt =
                new DateTimeOffset(2026, 8, 18, 13, 30, 0, TimeSpan.Zero);
            await reconciliationSetupContext.OperationAgentAssignments
                .Where(item => item.GroundOperationId == existingServiceOperationId)
                .ExecuteDeleteAsync(cancellationToken);
            existingServiceIds = await reconciliationSetupContext.OperationServices
                .Where(item => item.GroundOperationId == existingServiceOperationId)
                .OrderBy(item => item.LineNumber)
                .Select(item => item.PublicId)
                .ToArrayAsync(cancellationToken);
            await reconciliationSetupContext.SaveChangesAsync(cancellationToken);
        }

        await using (var reconciliationScope = provider.CreateAsyncScope())
        {
            var reconciliationOptions = await reconciliationScope.ServiceProvider
                .GetRequiredService<IOccPlanningReadStore>()
                .GetOptionsAsync(
                    [stationId],
                    existingServiceTurnaroundId,
                    cancellationToken);
            Assert.True(reconciliationOptions.IsSuccess);
            Assert.True(OccPlanningConcurrencyToken.TryDecode(
                reconciliationOptions.Options!.Turnaround.ConcurrencyToken,
                out var reconciliationVersion));
            var reconciliationCandidate = Assert.Single(
                reconciliationOptions.Options.AgentCandidates,
                candidate => candidate.Id == agentId);
            var reconciliationEligibility =
                OccAgentEligibilityPolicy.Evaluate(reconciliationCandidate);
            Assert.True(
                reconciliationEligibility.Eligible,
                string.Join(", ", reconciliationEligibility.EligibilityReasons));

            var reconciliationResult = await reconciliationScope.ServiceProvider
                .GetRequiredService<IOccPlanningCommandStore>()
                .AssignOperationAsync(
                    new OccAssignmentWriteRequest(
                        actorId,
                        [stationId],
                        existingServiceTurnaroundId,
                        agentId,
                        reconciliationVersion,
                        Guid.Parse("90000000-0000-7000-8000-000000000094"),
                        "occ-assignment-existing-service-sql-test"),
                    cancellationToken);
            Assert.True(
                reconciliationResult.IsSuccess,
                $"Existing-service reconciliation failed: {reconciliationResult.Failure}.");
        }

        await using var reconciliationContext = CreateContext(database.ConnectionString);
        var reconciledServices = await reconciliationContext.OperationServices
            .Where(item => item.GroundOperationId == existingServiceOperationId)
            .OrderBy(item => item.LineNumber)
            .ToArrayAsync(cancellationToken);
        Assert.Equal(existingServiceIds, reconciledServices.Select(item => item.PublicId).ToArray());
        Assert.Empty(await reconciliationContext.Set<OperationServiceStatusEvent>()
            .Where(item => reconciledServices.Select(service => service.Id)
                .Contains(item.OperationServiceId))
            .ToArrayAsync(cancellationToken));
    }

    [Fact]
    public async Task MobileRegistrationAndRampStartAreFailClosedAtomicAndIdempotent()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null)
        {
            return;
        }

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection,
            "Development",
            cancellationToken);
        await using (var migrationContext = CreateContext(database.ConnectionString))
        {
            await migrationContext.Database.MigrateAsync(cancellationToken);
        }

        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seederContext = CreateContext(seederConnection))
        {
            await new DevelopmentDataSeeder(seederContext)
                .SeedAsync(InitialPasswords, cancellationToken);
        }

        var accountId = Guid.Parse("40000000-0000-7000-8000-000000000002");
        var stationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
        var operationId = Guid.Parse("70000000-0000-7000-8000-000000000005");
        var installationId = Guid.Parse("81000000-0000-7000-8000-000000000011");
        var idempotencyKey = Guid.Parse("82000000-0000-7000-8000-000000000011");
        await using var provider = CreateAuthenticationProvider(
            database.ConnectionString,
            new PasswordHashCounter());

        async Task<MobileDeviceRegistrationWriteResult> RegisterAsync(
            MobilePlatform platform = MobilePlatform.Android)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider
                .GetRequiredService<IMobileDeviceCommandStore>()
                .RegisterAsync(
                    new MobileDeviceRegistrationWriteRequest(
                        accountId,
                        installationId,
                        platform,
                        "1.2.3",
                        "SQL test tablet",
                        "Android 16"),
                    cancellationToken);
        }

        async Task<RampOperationStartWriteResult> StartAsync(
            Guid commandKey,
            Guid requestedOperationId)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider
                .GetRequiredService<IRampOperationsCommandStore>()
                .StartOperationAsync(
                    new RampOperationStartWriteRequest(
                        accountId,
                        [stationId],
                        requestedOperationId,
                        installationId,
                        commandKey,
                        commandKey,
                        "ramp-start-sql-test"),
                    cancellationToken);
        }

        var rampAgentId = Guid.Parse("50000000-0000-7000-8000-000000000001");
        await using (var inactiveProfileContext = CreateContext(database.ConnectionString))
        {
            await inactiveProfileContext.RampAgents
                .Where(item => item.PublicId == rampAgentId)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(item => item.IsActive, false),
                    cancellationToken);
        }

        var inactiveProfileRegistration = await RegisterAsync();
        Assert.Equal(
            MobileDeviceRegistrationWriteFailure.Forbidden,
            inactiveProfileRegistration.Failure);
        await using (var restoreProfileContext = CreateContext(database.ConnectionString))
        {
            Assert.False(await restoreProfileContext.MobileDevices
                .AnyAsync(item => item.InstallationId == installationId, cancellationToken));
            await restoreProfileContext.RampAgents
                .Where(item => item.PublicId == rampAgentId)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(item => item.IsActive, true),
                    cancellationToken);
        }

        var firstRegistration = await RegisterAsync();
        var repeatedRegistration = await RegisterAsync();
        Assert.True(firstRegistration.IsSuccess);
        Assert.True(repeatedRegistration.IsSuccess);
        Assert.Equal(
            firstRegistration.CommitReceiptId,
            repeatedRegistration.CommitReceiptId);
        Assert.Equal(installationId, repeatedRegistration.Device!.InstallationId);
        Assert.Equal("Android", repeatedRegistration.Device.Platform);
        Assert.Equal(0, repeatedRegistration.Device.LastSeenAt.Ticks %
            TimeSpan.TicksPerMillisecond);

        var platformConflict = await RegisterAsync(MobilePlatform.Ios);
        Assert.Equal(
            MobileDeviceRegistrationWriteFailure.Conflict,
            platformConflict.Failure);

        var startGate = new TaskCompletionSource(
            TaskCreationOptions.RunContinuationsAsynchronously);
        async Task<RampOperationStartWriteResult> StartWhenReleasedAsync(Guid commandKey)
        {
            await startGate.Task.WaitAsync(cancellationToken);
            return await StartAsync(commandKey, operationId);
        }

        var concurrentStarts = new[]
        {
            StartWhenReleasedAsync(idempotencyKey),
            StartWhenReleasedAsync(idempotencyKey),
        };
        startGate.SetResult();
        var outcomes = await Task.WhenAll(concurrentStarts);
        Assert.All(outcomes, outcome => Assert.True(outcome.IsSuccess));
        Assert.Single(outcomes.Select(outcome => outcome.CommitReceiptId).Distinct());
        Assert.Single(outcomes.Select(outcome => outcome.Start).Distinct());

        var firstStart = outcomes[0];
        var replay = await StartAsync(idempotencyKey, operationId);
        Assert.True(replay.IsSuccess);
        Assert.Equal(firstStart.Start, replay.Start);
        Assert.Equal("InProgress", firstStart.Start!.Operation.Status);
        Assert.NotNull(firstStart.Start.Operation.ActualStartAt);
        Assert.Equal(
            0,
            firstStart.Start.Operation.ActualStartAt.Value.Ticks %
                TimeSpan.TicksPerMillisecond);

        var keyReuse = await StartAsync(idempotencyKey, Guid.NewGuid());
        Assert.Equal(
            RampOperationStartWriteFailure.IdempotencyKeyConflict,
            keyReuse.Failure);

        var postStartKey = Guid.Parse("82000000-0000-7000-8000-000000000013");
        var alreadyStarted = await StartAsync(postStartKey, operationId);
        Assert.Equal(RampOperationStartWriteFailure.Conflict, alreadyStarted.Failure);
        var rejectedReplay = await StartAsync(postStartKey, operationId);
        Assert.Equal(alreadyStarted.Failure, rejectedReplay.Failure);
        Assert.Equal(alreadyStarted.CommitReceiptId, rejectedReplay.CommitReceiptId);

        await using (var verificationContext = CreateContext(database.ConnectionString))
        {
            var device = await verificationContext.MobileDevices
                .SingleAsync(
                    item => item.InstallationId == installationId,
                    cancellationToken);
            Assert.Null(device.RevokedAt);
            Assert.Single(await verificationContext.Set<MobileDeviceAccountBinding>()
                .Where(item => item.MobileDeviceId == device.Id && item.UnboundAt == null)
                .ToArrayAsync(cancellationToken));

            var operation = await verificationContext.GroundOperations
                .SingleAsync(item => item.PublicId == operationId, cancellationToken);
            Assert.Equal(GroundOperationStatus.InProgress, operation.CurrentStatus);
            Assert.Equal(firstStart.Start.Operation.ActualStartAt, operation.ActualStartAt);
            Assert.Single(await verificationContext.Set<GroundOperationStatusEvent>()
                .Where(item => item.GroundOperationId == operation.Id &&
                    item.FromStatus == GroundOperationStatus.Assigned &&
                    item.ToStatus == GroundOperationStatus.InProgress)
                .ToArrayAsync(cancellationToken));

            var audit = Assert.Single(await verificationContext.AuditEntries
                .Where(item => item.EntityPublicId == operationId &&
                    item.Action == "ramp.operation.started" &&
                    item.Source == AuditSource.MobileSync)
                .ToArrayAsync(cancellationToken));
            Assert.Equal(2, await verificationContext.AuditChanges
                .CountAsync(item => item.AuditEntryId == audit.Id, cancellationToken));

            var receipts = await verificationContext.MobileCommandReceipts
                .Where(item => item.MobileDeviceId == device.Id)
                .OrderBy(item => item.IdempotencyKey)
                .ToArrayAsync(cancellationToken);
            Assert.Equal(2, receipts.Length);
            var processed = Assert.Single(
                receipts,
                item => item.IdempotencyKey == idempotencyKey.ToString("D"));
            Assert.Equal(MobileCommandStatus.Processed, processed.Status);
            Assert.NotNull(processed.ResultJson);
            var postStartRejection = Assert.Single(
                receipts,
                item => item.IdempotencyKey == postStartKey.ToString("D"));
            Assert.Equal(MobileCommandStatus.Rejected, postStartRejection.Status);
            Assert.Equal("conflict", postStartRejection.ErrorCode);

            var startHints = (await verificationContext.OutboxMessages.AsNoTracking()
                .Where(item => item.EventType == "account.changed.v1")
                .ToArrayAsync(cancellationToken))
                .Select(AccountChangeOutboxWriter.Decode).ToArray();
            Assert.Single(startHints, item => item.Resource == "airline_operations" &&
                item.ResourceId == operationId && item.StationId == null);

        }

        await using (var revokedContext = CreateContext(database.ConnectionString))
        {
            var device = await revokedContext.MobileDevices
                .SingleAsync(item => item.InstallationId == installationId, cancellationToken);
            device.RevokedAt = device.LastSeenAt.AddMilliseconds(1);
            await revokedContext.SaveChangesAsync(cancellationToken);
        }

        var revokedDeviceStart = await StartAsync(
            Guid.Parse("82000000-0000-7000-8000-000000000014"),
            operationId);
        Assert.Equal(RampOperationStartWriteFailure.Forbidden, revokedDeviceStart.Failure);
        await using (var restoreDeviceContext = CreateContext(database.ConnectionString))
        {
            await restoreDeviceContext.MobileDevices
                .Where(item => item.InstallationId == installationId)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(item => item.RevokedAt, (DateTimeOffset?)null),
                    cancellationToken);
        }

        long rampAgentInternalId;
        DateOnly operationDate;
        await using (var scopeContext = CreateContext(database.ConnectionString))
        {
            rampAgentInternalId = await scopeContext.RampAgents
                .Where(item => item.PublicId == rampAgentId)
                .Select(item => item.Id)
                .SingleAsync(cancellationToken);
            operationDate = await (
                    from operation in scopeContext.GroundOperations
                    join turnaround in scopeContext.Turnarounds
                        on operation.TurnaroundId equals turnaround.Id
                    where operation.PublicId == operationId
                    select turnaround.OperationDate)
                .SingleAsync(cancellationToken);
            await scopeContext.Set<RampAgentStationScope>()
                .Where(item => item.RampAgentId == rampAgentInternalId && item.ValidTo == null)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(
                        item => item.ValidTo,
                        operationDate.AddDays(-1)),
                    cancellationToken);
        }

        var expiredStationScope = await StartAsync(
            Guid.Parse("82000000-0000-7000-8000-000000000015"),
            operationId);
        Assert.Equal(RampOperationStartWriteFailure.NotFound, expiredStationScope.Failure);
        await using (var scopeContext = CreateContext(database.ConnectionString))
        {
            await scopeContext.Set<RampAgentStationScope>()
                .Where(item => item.RampAgentId == rampAgentInternalId)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(item => item.ValidTo, (DateOnly?)null),
                    cancellationToken);
            await scopeContext.Set<RampAgentTerminalScope>()
                .Where(item => item.RampAgentId == rampAgentInternalId && item.ValidTo == null)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(
                        item => item.ValidTo,
                        operationDate.AddDays(-1)),
                    cancellationToken);
        }

        var expiredTerminalScope = await StartAsync(
            Guid.Parse("82000000-0000-7000-8000-000000000016"),
            operationId);
        Assert.Equal(RampOperationStartWriteFailure.NotFound, expiredTerminalScope.Failure);
        await using (var bindingContext = CreateContext(database.ConnectionString))
        {
            await bindingContext.Set<RampAgentTerminalScope>()
                .Where(item => item.RampAgentId == rampAgentInternalId)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(item => item.ValidTo, (DateOnly?)null),
                    cancellationToken);
            var deviceInternalId = await bindingContext.MobileDevices
                .Where(item => item.InstallationId == installationId)
                .Select(item => item.Id)
                .SingleAsync(cancellationToken);
            var adminInternalId = await bindingContext.Users
                .Where(item => item.PublicId ==
                    Guid.Parse("40000000-0000-7000-8000-000000000001"))
                .Select(item => item.Id)
                .SingleAsync(cancellationToken);
            await bindingContext.Set<MobileDeviceAccountBinding>()
                .Where(item => item.MobileDeviceId == deviceInternalId && item.UnboundAt == null)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(item => item.AccountId, adminInternalId),
                    cancellationToken);
        }

        var foreignBinding = await RegisterAsync();
        Assert.Equal(
            MobileDeviceRegistrationWriteFailure.Forbidden,
            foreignBinding.Failure);
        var foreignBindingStart = await StartAsync(
            Guid.Parse("82000000-0000-7000-8000-000000000017"),
            operationId);
        Assert.Equal(RampOperationStartWriteFailure.Forbidden, foreignBindingStart.Failure);
    }

    [Theory]
    [InlineData("Approved")]
    [InlineData("Returned")]
    public async Task RampChecklistAndServiceExecutionAreCanonicalAtomicAndIdempotent(string reviewOutcome)
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null)
        {
            return;
        }

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection,
            "Development",
            cancellationToken);
        await using (var migrationContext = CreateContext(database.ConnectionString))
        {
            await migrationContext.Database.MigrateAsync(cancellationToken);
            var releasedAtPrecision = await migrationContext.Database.SqlQueryRaw<int>(
                "SELECT CONVERT(int, scale) AS Value FROM sys.columns " +
                "WHERE object_id = OBJECT_ID('commercial.preinvoice_lines') " +
                "AND name = 'released_at'").SingleAsync(cancellationToken);
            Assert.Equal(3, releasedAtPrecision);
        }

        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(
            cancellationToken))
        await using (var seederContext = CreateContext(seederConnection))
        {
            await new DevelopmentDataSeeder(seederContext)
                .SeedAsync(InitialPasswords, cancellationToken);
        }

        var accountId = Guid.Parse("40000000-0000-7000-8000-000000000002");
        var stationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
        var operationId = Guid.Parse("70000000-0000-7000-8000-000000000005");
        var historicalChecklistId = Guid.Parse("70000000-0000-7000-8000-000000000011");
        var historicalItemId = Guid.Parse("70000000-0000-7000-8000-000000000010");
        var crossOperationServiceId = Guid.Parse("70000000-0000-7000-8000-000000000017");
        var installationId = Guid.Parse("81000000-0000-7000-8000-000000000021");
        var startKey = Guid.Parse("82000000-0000-7000-8000-000000000021");
        var historicalChecklistKey = Guid.Parse("83000000-0000-7000-8000-000000000021");
        var checklistKey = Guid.Parse("83000000-0000-7000-8000-000000000022");
        var secondChecklistKey = Guid.Parse("83000000-0000-7000-8000-000000000023");
        var serviceStartedKey = Guid.Parse("84000000-0000-7000-8000-000000000021");
        var serviceCompletedKey = Guid.Parse("84000000-0000-7000-8000-000000000022");
        var crossOperationServiceKey = Guid.Parse("84000000-0000-7000-8000-000000000023");
        const string SensitiveChecklistNote = "sensitive-checklist-note-must-not-leak";
        const string SensitiveServiceNote = "sensitive-service-note-must-not-leak";

        await using var provider = CreateAuthenticationProvider(
            database.ConnectionString,
            new PasswordHashCounter());

        await using (var registrationScope = provider.CreateAsyncScope())
        {
            var registration = await registrationScope.ServiceProvider
                .GetRequiredService<IMobileDeviceCommandStore>()
                .RegisterAsync(
                    new MobileDeviceRegistrationWriteRequest(
                        accountId,
                        installationId,
                        MobilePlatform.Android,
                        "1.2.3",
                        "Ramp execution SQL test tablet",
                        "Android 16"),
                    cancellationToken);
            Assert.True(registration.IsSuccess);
        }

        await using (var startScope = provider.CreateAsyncScope())
        {
            var start = await startScope.ServiceProvider
                .GetRequiredService<IRampOperationsCommandStore>()
                .StartOperationAsync(
                    new RampOperationStartWriteRequest(
                        accountId,
                        [stationId],
                        operationId,
                        installationId,
                        startKey,
                        startKey,
                        "ramp-execution-sql-start"),
                    cancellationToken);
            Assert.True(start.IsSuccess);
            Assert.Equal("InProgress", start.Start!.Operation.Status);
        }

        RampOperationChecklistData canonicalChecklist;
        await using (var readScope = provider.CreateAsyncScope())
        {
            var read = await readScope.ServiceProvider
                .GetRequiredService<IRampOperationChecklistReadStore>()
                .GetChecklistAsync(
                    new RampOperationChecklistReadRequest(
                        accountId,
                        [stationId],
                        operationId),
                    cancellationToken);
            Assert.True(read.IsSuccess);
            canonicalChecklist = Assert.IsType<RampOperationChecklistData>(read.Checklist);
        }

        Assert.Equal(operationId, canonicalChecklist.OperationId);
        Assert.NotEqual(historicalChecklistId, canonicalChecklist.Id);
        Assert.Equal("NotStarted", canonicalChecklist.Status);
        Assert.Equal("TURNAROUND-BASE", canonicalChecklist.Template.Code);
        Assert.Equal(2, canonicalChecklist.Template.Version);
        Assert.Collection(
            canonicalChecklist.Sections,
            section =>
            {
                Assert.Equal("Chequeo preuso", section.Name);
                Assert.Equal(13, section.Items.Count);
            },
            section =>
            {
                Assert.Equal("Antes de la llegada", section.Name);
                Assert.Equal(13, section.Items.Count);
            },
            section =>
            {
                Assert.Equal("Antes de la salida", section.Name);
                Assert.Equal(10, section.Items.Count);
            },
            section =>
            {
                Assert.Equal("Después de la salida", section.Name);
                Assert.Equal(9, section.Items.Count);
            });
        var canonicalItems = canonicalChecklist.Sections
            .SelectMany(section => section.Items)
            .ToArray();
        Assert.Equal(45, canonicalItems.Length);
        Assert.All(canonicalItems, item =>
        {
            Assert.True(item.IsRequired);
            Assert.True(item.RequiresNoteWhenNotOk);
            Assert.Null(item.Answer);
        });

        async Task<RampChecklistSubmissionWriteResult> SubmitChecklistAsync(
            Guid commandKey,
            Guid checklistId,
            IReadOnlyCollection<RampChecklistAnswerWriteData> answers)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider
                .GetRequiredService<IRampOperationChecklistCommandStore>()
                .SubmitChecklistAsync(
                    new RampChecklistSubmissionWriteRequest(
                        accountId,
                        [stationId],
                        operationId,
                        checklistId,
                        answers,
                        installationId,
                        commandKey,
                        commandKey,
                        "ramp-checklist-sql-test"),
                    cancellationToken);
        }

        var historicalSubmission = await SubmitChecklistAsync(
            historicalChecklistKey,
            historicalChecklistId,
            [new RampChecklistAnswerWriteData(
                historicalItemId,
                ChecklistAnswerValue.Ok,
                null)]);
        Assert.Equal(
            RampChecklistSubmissionWriteFailure.Conflict,
            historicalSubmission.Failure);
        Assert.NotNull(historicalSubmission.CommitReceiptId);

        var answers = canonicalItems
            .Select((item, index) => new RampChecklistAnswerWriteData(
                item.Id,
                index == 0 ? ChecklistAnswerValue.NotOk : ChecklistAnswerValue.Ok,
                index == 0 ? SensitiveChecklistNote : null))
            .ToArray();
        var submission = await SubmitChecklistAsync(
            checklistKey,
            canonicalChecklist.Id,
            answers);
        Assert.True(submission.IsSuccess);
        Assert.Equal(submission.CommitReceiptId, submission.Submission!.ReceiptId);
        Assert.Equal(canonicalChecklist.Id, submission.Submission.Checklist.Id);
        Assert.Equal("Submitted", submission.Submission.Checklist.Status);
        Assert.Equal(45, submission.Submission.Checklist.AnswerCount);

        var submissionReplay = await SubmitChecklistAsync(
            checklistKey,
            canonicalChecklist.Id,
            answers);
        Assert.True(submissionReplay.IsSuccess);
        Assert.Equal(submission.CommitReceiptId, submissionReplay.CommitReceiptId);
        Assert.Equal(submission.Submission, submissionReplay.Submission);

        var checklistKeyCollision = await SubmitChecklistAsync(
            checklistKey,
            historicalChecklistId,
            [new RampChecklistAnswerWriteData(
                historicalItemId,
                ChecklistAnswerValue.Ok,
                null)]);
        Assert.Equal(
            RampChecklistSubmissionWriteFailure.IdempotencyKeyConflict,
            checklistKeyCollision.Failure);
        Assert.Null(checklistKeyCollision.CommitReceiptId);

        var secondSubmission = await SubmitChecklistAsync(
            secondChecklistKey,
            canonicalChecklist.Id,
            answers);
        Assert.Equal(RampChecklistSubmissionWriteFailure.Conflict, secondSubmission.Failure);
        Assert.NotNull(secondSubmission.CommitReceiptId);

        Guid baggageServiceId;
        long baggageServiceInternalId;
        long operationInternalId;
        await using (var serviceLookupContext = CreateContext(database.ConnectionString))
        {
            var baggageService = await (
                    from service in serviceLookupContext.OperationServices.AsNoTracking()
                    join operation in serviceLookupContext.GroundOperations.AsNoTracking()
                        on service.GroundOperationId equals operation.Id
                    join definition in serviceLookupContext.ServiceDefinitions.AsNoTracking()
                        on service.ServiceDefinitionId equals definition.Id
                    where operation.PublicId == operationId && definition.Code == "BAGGAGE"
                    select new
                    {
                        service.Id,
                        service.PublicId,
                        OperationInternalId = operation.Id,
                    })
                .SingleAsync(cancellationToken);
            baggageServiceId = baggageService.PublicId;
            baggageServiceInternalId = baggageService.Id;
            operationInternalId = baggageService.OperationInternalId;
        }

        async Task<RampOperationServiceTransitionWriteResult> TransitionServiceAsync(
            Guid commandKey,
            Guid requestedServiceId,
            ServiceExecutionStatus targetStatus,
            decimal? executedQuantity,
            string? note)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider
                .GetRequiredService<IRampOperationServiceCommandStore>()
                .TransitionServiceAsync(
                    new RampOperationServiceTransitionWriteRequest(
                        accountId,
                        [stationId],
                        operationId,
                        requestedServiceId,
                        targetStatus,
                        executedQuantity,
                        note,
                        installationId,
                        commandKey,
                        commandKey,
                        "ramp-service-sql-test"),
                    cancellationToken);
        }

        var serviceStarted = await TransitionServiceAsync(
            serviceStartedKey,
            baggageServiceId,
            ServiceExecutionStatus.InProgress,
            null,
            null);
        Assert.True(serviceStarted.IsSuccess);
        Assert.Equal("InProgress", serviceStarted.Transition!.Service.Status);
        Assert.Equal(0m, serviceStarted.Transition.Service.ExecutedQuantity);
        Assert.Equal(serviceStarted.CommitReceiptId, serviceStarted.Transition.ReceiptId);

        var serviceStartedReplay = await TransitionServiceAsync(
            serviceStartedKey,
            baggageServiceId,
            ServiceExecutionStatus.InProgress,
            null,
            null);
        Assert.True(serviceStartedReplay.IsSuccess);
        Assert.Equal(serviceStarted.CommitReceiptId, serviceStartedReplay.CommitReceiptId);
        Assert.Equal(serviceStarted.Transition, serviceStartedReplay.Transition);

        // The agent marks charges on a service in progress; prices never reach the ramp.
        async Task<RampServiceChargeWriteResult> ChargeAsync(Guid commandKey, Guid chargeId,
            RampServiceChargeAction action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IRampServiceChargeStore>().ApplyAsync(
                new RampServiceChargeWriteRequest(accountId, [stationId], operationId, baggageServiceId, chargeId,
                    action, installationId, commandKey, commandKey, "ramp-charge-sql-test"), cancellationToken);
        }
        RampOperationChargesData chargeOptions;
        await using (var chargeScope = provider.CreateAsyncScope())
            chargeOptions = (await chargeScope.ServiceProvider.GetRequiredService<IRampServiceChargeStore>()
                .ReadAsync(accountId, [stationId], operationId, installationId, cancellationToken))!;
        var baggageCharges = Assert.Single(chargeOptions.Services, item => item.ServiceId == baggageServiceId);
        Assert.True(baggageCharges.CanEdit);
        var nightCharge = Assert.Single(baggageCharges.Available, item => item.Code == "NIGHT");
        Assert.Empty(baggageCharges.Applied);
        var nightKey = Guid.NewGuid();
        var nightApplied = await ChargeAsync(nightKey, nightCharge.Id, RampServiceChargeAction.Apply);
        Assert.True(nightApplied.IsSuccess);
        Assert.Equal("NIGHT", Assert.Single(nightApplied.Command!.Service.Applied).Code);
        Assert.Equal(System.Text.Json.JsonSerializer.Serialize(nightApplied.Command),
            System.Text.Json.JsonSerializer.Serialize((await ChargeAsync(nightKey, nightCharge.Id,
                RampServiceChargeAction.Apply)).Command));
        Assert.Equal(RampOperationServiceTransitionWriteFailure.IdempotencyKeyConflict,
            (await ChargeAsync(nightKey, nightCharge.Id, RampServiceChargeAction.Remove)).Failure);
        Assert.Equal(RampOperationServiceTransitionWriteFailure.Conflict,
            (await ChargeAsync(Guid.NewGuid(), nightCharge.Id, RampServiceChargeAction.Apply)).Failure);
        Assert.Empty((await ChargeAsync(Guid.NewGuid(), nightCharge.Id, RampServiceChargeAction.Remove))
            .Command!.Service.Applied);
        Assert.Equal(RampOperationServiceTransitionWriteFailure.Conflict,
            (await ChargeAsync(Guid.NewGuid(), Guid.NewGuid(), RampServiceChargeAction.Apply)).Failure);
        Assert.True((await ChargeAsync(Guid.NewGuid(), nightCharge.Id, RampServiceChargeAction.Apply)).IsSuccess);

        var serviceKeyCollision = await TransitionServiceAsync(
            serviceStartedKey,
            baggageServiceId,
            ServiceExecutionStatus.Completed,
            1m,
            null);
        Assert.Equal(
            RampOperationServiceTransitionWriteFailure.IdempotencyKeyConflict,
            serviceKeyCollision.Failure);
        Assert.Null(serviceKeyCollision.CommitReceiptId);

        var serviceCompleted = await TransitionServiceAsync(
            serviceCompletedKey,
            baggageServiceId,
            ServiceExecutionStatus.Completed,
            1m,
            SensitiveServiceNote);
        Assert.True(serviceCompleted.IsSuccess);
        Assert.Equal("Completed", serviceCompleted.Transition!.Service.Status);
        Assert.Equal(1m, serviceCompleted.Transition.Service.ExecutedQuantity);

        var serviceCompletedReplay = await TransitionServiceAsync(
            serviceCompletedKey,
            baggageServiceId,
            ServiceExecutionStatus.Completed,
            1m,
            SensitiveServiceNote);
        Assert.True(serviceCompletedReplay.IsSuccess);
        Assert.Equal(serviceCompleted.CommitReceiptId, serviceCompletedReplay.CommitReceiptId);
        Assert.Equal(serviceCompleted.Transition, serviceCompletedReplay.Transition);

        var crossOperationService = await TransitionServiceAsync(
            crossOperationServiceKey,
            crossOperationServiceId,
            ServiceExecutionStatus.InProgress,
            null,
            null);
        Assert.Equal(
            RampOperationServiceTransitionWriteFailure.NotFound,
            crossOperationService.Failure);
        Assert.NotNull(crossOperationService.CommitReceiptId);

        await using var verificationContext = CreateContext(database.ConnectionString);
        var operationChecklists = await verificationContext.OperationChecklists
            .AsNoTracking()
            .Where(item => item.GroundOperationId == operationInternalId)
            .ToArrayAsync(cancellationToken);
        Assert.Equal(2, operationChecklists.Length);
        Assert.Equal(
            ChecklistStatus.NotStarted,
            Assert.Single(operationChecklists, item => item.PublicId == historicalChecklistId).Status);
        var submittedChecklist = Assert.Single(
            operationChecklists,
            item => item.PublicId == canonicalChecklist.Id);
        Assert.Equal(ChecklistStatus.Submitted, submittedChecklist.Status);
        Assert.NotNull(submittedChecklist.StartedAt);
        Assert.NotNull(submittedChecklist.SubmittedAt);

        var persistedAnswers = await verificationContext.Set<ChecklistAnswer>()
            .AsNoTracking()
            .Where(item => item.OperationChecklistId == submittedChecklist.Id)
            .ToArrayAsync(cancellationToken);
        Assert.Equal(45, persistedAnswers.Length);
        var notOkAnswer = Assert.Single(
            persistedAnswers,
            item => item.Value == ChecklistAnswerValue.NotOk);
        Assert.Equal(SensitiveChecklistNote, notOkAnswer.Note);

        var persistedService = await verificationContext.OperationServices
            .AsNoTracking()
            .SingleAsync(item => item.Id == baggageServiceInternalId, cancellationToken);
        Assert.Equal(ServiceExecutionStatus.Completed, persistedService.CurrentStatus);
        Assert.Equal(1m, persistedService.ExecutedQuantity);
        var serviceEvents = await verificationContext.Set<OperationServiceStatusEvent>()
            .AsNoTracking()
            .Where(item => item.OperationServiceId == baggageServiceInternalId)
            .OrderBy(item => item.OccurredAt)
            .ThenBy(item => item.Id)
            .ToArrayAsync(cancellationToken);
        Assert.Collection(
            serviceEvents,
            started =>
            {
                Assert.Equal(ServiceExecutionStatus.Planned, started.FromStatus);
                Assert.Equal(ServiceExecutionStatus.InProgress, started.ToStatus);
                Assert.Null(started.Note);
            },
            completed =>
            {
                Assert.Equal(ServiceExecutionStatus.InProgress, completed.FromStatus);
                Assert.Equal(ServiceExecutionStatus.Completed, completed.ToStatus);
                Assert.Equal(SensitiveServiceNote, completed.Note);
            });

        var executionAudits = await verificationContext.AuditEntries
            .AsNoTracking()
            .Where(item => item.Action == "ramp.operation.checklist.submitted" ||
                item.Action == "ramp.operation.service.transitioned")
            .OrderBy(item => item.OccurredAt)
            .ThenBy(item => item.Id)
            .ToArrayAsync(cancellationToken);
        Assert.Equal(3, executionAudits.Length);
        Assert.Single(
            executionAudits,
            item => item.Action == "ramp.operation.checklist.submitted" &&
                item.EntityPublicId == canonicalChecklist.Id);
        Assert.Equal(
            2,
            executionAudits.Count(item =>
                item.Action == "ramp.operation.service.transitioned" &&
                item.EntityPublicId == baggageServiceId));
        Assert.All(executionAudits, audit =>
        {
            var metadata = audit.MetadataJson ?? string.Empty;
            Assert.DoesNotContain(SensitiveChecklistNote, metadata, StringComparison.Ordinal);
            Assert.DoesNotContain(SensitiveServiceNote, metadata, StringComparison.Ordinal);
            Assert.DoesNotContain("NotOk", metadata, StringComparison.Ordinal);
        });

        var deviceInternalId = await verificationContext.MobileDevices
            .AsNoTracking()
            .Where(item => item.InstallationId == installationId)
            .Select(item => item.Id)
            .SingleAsync(cancellationToken);
        var receipts = await verificationContext.MobileCommandReceipts
            .AsNoTracking()
            .Where(item => item.MobileDeviceId == deviceInternalId)
            .ToArrayAsync(cancellationToken);
        Assert.Equal(5, receipts.Count(item => item.CommandType == "ramp.operation.service.charge.v1"));
        receipts = receipts.Where(item => item.CommandType != "ramp.operation.service.charge.v1").ToArray();
        Assert.Equal(7, receipts.Length);
        Assert.Equal(
            1,
            receipts.Count(item =>
                item.CommandType == "ramp.operation.start.v1" &&
                item.Status == MobileCommandStatus.Processed));
        Assert.Equal(
            3,
            receipts.Count(item => item.CommandType == "ramp.operation.checklist.submit.v1"));
        Assert.Equal(
            3,
            receipts.Count(item => item.CommandType == "ramp.operation.service.transition.v1"));
        Assert.Equal(
            4,
            receipts.Count(item => item.Status == MobileCommandStatus.Processed));
        Assert.Equal(
            3,
            receipts.Count(item => item.Status == MobileCommandStatus.Rejected));
        Assert.All(receipts, receipt =>
        {
            Assert.DoesNotContain(
                SensitiveChecklistNote,
                receipt.ResultJson ?? string.Empty,
                StringComparison.Ordinal);
            Assert.DoesNotContain(
                SensitiveServiceNote,
                receipt.ResultJson ?? string.Empty,
                StringComparison.Ordinal);
        });

        var bridgeServiceId = await (
                from service in verificationContext.OperationServices.AsNoTracking()
                join definition in verificationContext.ServiceDefinitions.AsNoTracking()
                    on service.ServiceDefinitionId equals definition.Id
                where service.GroundOperationId == operationInternalId &&
                      definition.Code == "PASSENGER-BRIDGE"
                select service.PublicId)
            .SingleAsync(cancellationToken);
        var prematureKey = Guid.Parse("85000000-0000-7000-8000-000000000021");
        var handoffKey = Guid.Parse("85000000-0000-7000-8000-000000000022");
        const string AgentNote = "Se reportó la verificación final del servicio.";

        async Task<RampOperationSubmissionWriteResult> HandOffAsync(
            Guid commandKey,
            string? note,
            IReadOnlyCollection<Guid>? stationIds = null)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider
                .GetRequiredService<IRampOperationSubmissionStore>()
                .SubmitAsync(new RampOperationSubmissionWriteRequest(
                    accountId,
                    stationIds ?? [stationId],
                    operationId,
                    installationId,
                    commandKey,
                    note,
                    commandKey,
                    "ramp-handoff-sql-test"), cancellationToken);
        }

        var premature = await HandOffAsync(prematureKey, AgentNote);
        Assert.Equal(RampOperationsFailure.Conflict, premature.Failure);
        Assert.NotNull(premature.CommitReceiptId);
        Assert.Empty(await verificationContext.OperationSubmissions.AsNoTracking()
            .Where(item => item.GroundOperationId == operationInternalId)
            .ToArrayAsync(cancellationToken));

        var bridgeFinished = await TransitionServiceAsync(
            Guid.Parse("84000000-0000-7000-8000-000000000024"),
            bridgeServiceId,
            ServiceExecutionStatus.NotPerformed,
            0m,
            "Puente no disponible en el turno de prueba");
        Assert.True(bridgeFinished.IsSuccess);

        var outOfScope = await HandOffAsync(
            Guid.Parse("85000000-0000-7000-8000-000000000023"),
            AgentNote,
            [Guid.Parse("20000000-0000-7000-8000-000000000013")]);
        Assert.Equal(RampOperationsFailure.NotFound, outOfScope.Failure);
        Assert.Null(outOfScope.CommitReceiptId);

        var handedOff = await HandOffAsync(handoffKey, AgentNote);
        Assert.True(handedOff.IsSuccess);
        Assert.Equal(handoffKey, handedOff.Submission!.SubmissionId);
        Assert.Equal(canonicalChecklist.Id, handedOff.Submission.ChecklistId);
        Assert.Equal("PendingReview", handedOff.Submission.Status);
        Assert.Equal(1, handedOff.Submission.RevisionNumber);
        Assert.Equal(AgentNote, handedOff.Submission.AgentNote);
        Assert.Equal(handedOff.Submission.SubmittedAt, handedOff.Submission.ActualEndAt);

        var replay = await HandOffAsync(handoffKey, AgentNote);
        Assert.True(replay.IsSuccess);
        Assert.Equal(handedOff.Submission, replay.Submission);
        Assert.Equal(handedOff.CommitReceiptId, replay.CommitReceiptId);
        var keyCollision = await HandOffAsync(handoffKey, "Different note");
        Assert.Equal(RampOperationsFailure.Conflict, keyCollision.Failure);
        Assert.Null(keyCollision.CommitReceiptId);
        var secondHandoff = await HandOffAsync(
            Guid.Parse("85000000-0000-7000-8000-000000000024"), AgentNote);
        Assert.Equal(RampOperationsFailure.Conflict, secondHandoff.Failure);
        Assert.NotNull(secondHandoff.CommitReceiptId);

        await using (var expiryContext = CreateContext(database.ConnectionString))
        {
            await expiryContext.MobileCommandReceipts
                .Where(item => item.PublicId == handedOff.CommitReceiptId)
                .ExecuteDeleteAsync(cancellationToken);
        }
        var lateReplay = await HandOffAsync(handoffKey, AgentNote);
        Assert.True(lateReplay.IsSuccess);
        Assert.NotEqual(handedOff.CommitReceiptId, lateReplay.CommitReceiptId);
        Assert.Equal(handoffKey, lateReplay.Submission!.SubmissionId);

        await using var handoffCheck = CreateContext(database.ConnectionString);
        var operationAfter = await handoffCheck.GroundOperations.AsNoTracking()
            .SingleAsync(item => item.Id == operationInternalId, cancellationToken);
        Assert.Equal(GroundOperationStatus.PendingReview, operationAfter.CurrentStatus);
        Assert.Equal(handedOff.Submission.ActualEndAt, operationAfter.ActualEndAt);
        Assert.Single(await handoffCheck.OperationSubmissions.AsNoTracking()
            .Where(item => item.GroundOperationId == operationInternalId)
            .ToArrayAsync(cancellationToken));
        Assert.Single(await handoffCheck.Set<GroundOperationStatusEvent>().AsNoTracking()
            .Where(item => item.GroundOperationId == operationInternalId &&
                item.ToStatus == GroundOperationStatus.PendingReview)
            .ToArrayAsync(cancellationToken));
        var handoffAudit = await handoffCheck.AuditEntries.AsNoTracking()
            .SingleAsync(item => item.Action == "ramp.operation.submitted", cancellationToken);
        Assert.DoesNotContain(AgentNote, handoffAudit.MetadataJson ?? string.Empty, StringComparison.Ordinal);
        var occNotification = Assert.Single(await handoffCheck.OperationalNotifications.AsNoTracking()
            .Where(item => item.GroundOperationId == operationInternalId &&
                item.Kind == "operation_submitted" && item.SourceId == handoffKey)
            .ToArrayAsync(cancellationToken));
        Assert.Null(occNotification.ReadAt);
        var handoffHints = (await handoffCheck.OutboxMessages.AsNoTracking()
            .Where(item => item.EventType == "account.changed.v1")
            .ToArrayAsync(cancellationToken))
            .Select(AccountChangeOutboxWriter.Decode).ToArray();
        Assert.Equal(2, handoffHints.Count(item => item.Resource == "airline_operations" &&
            item.ResourceId == operationId)); // start + submission, despite exact replays

        var occAccountId = Guid.Parse("40000000-0000-7000-8000-000000000001");
        OccReviewDetailData reviewDetail;
        await using (var reviewScope = provider.CreateAsyncScope())
        {
            var reviewStore = reviewScope.ServiceProvider.GetRequiredService<IOccReviewStore>();
            var queue = await reviewStore.GetQueueAsync(stationId, cancellationToken);
            Assert.NotNull(queue);
            Assert.Contains(queue.Operations, item =>
                item.OperationId == operationId && item.Status == "PendingReview");
            Assert.Null(await reviewStore.GetDetailAsync(
                operationId, [Guid.Parse("20000000-0000-7000-8000-000000000013")],
                cancellationToken));
            reviewDetail = Assert.IsType<OccReviewDetailData>(await reviewStore.GetDetailAsync(
                operationId, [stationId], cancellationToken));
            Assert.Equal(handoffKey, reviewDetail.SubmissionId);
            Assert.Equal("Submitted", reviewDetail.ChecklistStatus);
            Assert.NotEmpty(reviewDetail.ChecklistAnswers);
            Assert.All(reviewDetail.Services, service =>
                Assert.True(service.Status is "Completed" or "NotPerformed" or "Exception"));
            // ADR-0034: OCC sees what it closes the operation with and can still adjust the charges.
            var close = Assert.IsType<OccReviewCloseData>(reviewDetail.Close);
            Assert.True(close.CanAdjustCharges);
            Assert.Contains(close.Charges, charge => charge.Code == "NIGHT" && charge.Source == "Agent");
            Assert.All(close.Charges, charge => Assert.Contains(charge.Source, new[] { "Agent", "Automatic" }));
            Assert.Contains(close.ChargeOptions, option => option.Code == "ADMIN-FEE");
        }

        if (reviewOutcome == "Approved")
        {
            // ADR-0034: OCC adds a charge and takes it back, each with a reason; every change moves the
            // review version, so a decision prepared on the old charges is refused.
            async Task<OccReviewChargeAdjustResult> AdjustAsync(string token, Guid? serviceId, Guid? chargeId,
                Guid? markId, string reason)
            {
                await using var scope = provider.CreateAsyncScope();
                return await scope.ServiceProvider.GetRequiredService<IOccReviewStore>().AdjustChargeAsync(
                    new OccReviewChargeAdjustRequest(occAccountId, [stationId], operationId, handoffKey, token,
                        serviceId, chargeId, markId, reason, Guid.CreateVersion7(), "occ-close-sql-test"),
                    cancellationToken);
            }
            var adminFee = reviewDetail.Close!.ChargeOptions.Single(option => option.Code == "ADMIN-FEE");
            Assert.Equal(OccReviewFailure.PreconditionFailed, (await AdjustAsync("\"" + new string('0', 64) + "\"",
                baggageServiceId, adminFee.ChargeId, null, "Cargo administrativo acordado")).Failure);
            var added = await AdjustAsync(reviewDetail.ConcurrencyToken, baggageServiceId, adminFee.ChargeId, null,
                "Cargo administrativo acordado");
            Assert.True(added.IsSuccess);
            Assert.NotEqual(reviewDetail.ConcurrencyToken, added.ConcurrencyToken);
            Assert.Equal(OccReviewFailure.PreconditionFailed,
                (await DecideAsync(occAccountId, reviewDetail.ConcurrencyToken, "Approved")).Failure);
            await using (var adjustedScope = provider.CreateAsyncScope())
                reviewDetail = (await adjustedScope.ServiceProvider.GetRequiredService<IOccReviewStore>()
                    .GetDetailAsync(operationId, [stationId], cancellationToken))!;
            var occMark = Assert.Single(reviewDetail.Close!.Charges, charge => charge.Source == "Occ");
            Assert.Equal("Cargo administrativo acordado", occMark.Reason);
            var removed = await AdjustAsync(reviewDetail.ConcurrencyToken, null, null, occMark.MarkId,
                "Se cobra en otra factura");
            Assert.True(removed.IsSuccess);
            Assert.Equal(OccReviewFailure.Conflict, (await AdjustAsync(removed.ConcurrencyToken!, null, null,
                occMark.MarkId, "Se cobra en otra factura")).Failure);
            await using (var adjustedScope = provider.CreateAsyncScope())
                reviewDetail = (await adjustedScope.ServiceProvider.GetRequiredService<IOccReviewStore>()
                    .GetDetailAsync(operationId, [stationId], cancellationToken))!;
            Assert.DoesNotContain(reviewDetail.Close!.Charges, charge => charge.Source == "Occ");
            await using var adjustCheck = CreateContext(database.ConnectionString);
            Assert.Equal(2, await adjustCheck.AuditEntries.AsNoTracking().CountAsync(item =>
                item.Action == "occ.operation.charge.added" || item.Action == "occ.operation.charge.removed",
                cancellationToken));
        }

        async Task<OccReviewDecisionWriteResult> DecideAsync(Guid actorId, string token, string outcome,
            string? reason = null)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IOccReviewStore>()
                .DecideAsync(new OccReviewDecisionWriteRequest(
                    actorId, [stationId], operationId, handoffKey,
                    token, outcome, reason, Guid.CreateVersion7(), "occ-review-sql-test"),
                    cancellationToken);
        }

        const string CorrectionReason = "Corregir la ejecución antes de reenviar la operación.";
        var decisionReason = reviewOutcome == "Returned" ? CorrectionReason : null;
        Assert.Equal(OccReviewFailure.NotFound,
            (await DecideAsync(accountId, reviewDetail.ConcurrencyToken, reviewOutcome, decisionReason)).Failure);
        Assert.Equal(OccReviewFailure.PreconditionFailed,
            (await DecideAsync(occAccountId, "\"" + new string('0', 64) + "\"", reviewOutcome, decisionReason)).Failure);
        var decided = await DecideAsync(occAccountId, reviewDetail.ConcurrencyToken, reviewOutcome, decisionReason);
        Assert.True(decided.IsSuccess);
        Assert.Equal(reviewOutcome, decided.Decision!.Status);
        Assert.Equal(OccReviewFailure.PreconditionFailed,
            (await DecideAsync(occAccountId, reviewDetail.ConcurrencyToken, reviewOutcome, decisionReason)).Failure);

        await using var decisionCheck = CreateContext(database.ConnectionString);
        Assert.Equal(reviewOutcome == "Approved"
                ? GroundOperationStatus.Approved : GroundOperationStatus.Returned,
            (await decisionCheck.GroundOperations.AsNoTracking()
                .SingleAsync(item => item.Id == operationInternalId, cancellationToken)).CurrentStatus);
        var savedDecision = Assert.Single(await decisionCheck.ReviewDecisions.AsNoTracking()
            .Where(item => item.OperationSubmissionId ==
                decisionCheck.OperationSubmissions.Where(submission => submission.PublicId == handoffKey)
                    .Select(submission => submission.Id).Single())
            .ToArrayAsync(cancellationToken));
        Assert.Equal(decisionReason, savedDecision.Reason);
        if (reviewOutcome == "Approved")
        {
            // ADR-0034: what OCC approved is frozen with the charges as they stood; the incidents are
            // closed and the turnaround completes.
            Assert.NotNull(savedDecision.ApprovedEvidenceJson);
            Assert.DoesNotContain("ADMIN-FEE", savedDecision.ApprovedEvidenceJson!, StringComparison.Ordinal);
            Assert.Contains("NIGHT", savedDecision.ApprovedEvidenceJson!, StringComparison.Ordinal);
            Assert.All(await decisionCheck.Incidents.AsNoTracking()
                    .Where(item => item.GroundOperationId == operationInternalId).ToArrayAsync(cancellationToken),
                incident =>
                {
                    Assert.Equal(IncidentStatus.Resolved, incident.Status);
                    Assert.NotNull(incident.ResolvedAt);
                });
            var turnaroundAfter = await decisionCheck.Turnarounds.AsNoTracking().SingleAsync(item =>
                item.Id == decisionCheck.GroundOperations.Where(operation => operation.Id == operationInternalId)
                    .Select(operation => operation.TurnaroundId).Single(), cancellationToken);
            Assert.Equal(TurnaroundStatus.Completed, turnaroundAfter.CurrentStatus);
        }
        else
        {
            Assert.Null(savedDecision.ApprovedEvidenceJson);
        }
        var reviewAudit = await decisionCheck.AuditEntries.AsNoTracking()
            .SingleAsync(item => item.Action == "occ.operation.review.decided", cancellationToken);
        Assert.DoesNotContain(AgentNote, reviewAudit.MetadataJson ?? string.Empty, StringComparison.Ordinal);
        Assert.DoesNotContain(CorrectionReason, reviewAudit.MetadataJson ?? string.Empty, StringComparison.Ordinal);
        var agentNotification = Assert.Single(await decisionCheck.OperationalNotifications.AsNoTracking()
            .Where(item => item.GroundOperationId == operationInternalId &&
                item.Kind == (reviewOutcome == "Approved" ? "operation_approved" : "operation_returned") &&
                item.SourceId == savedDecision.PublicId)
            .ToArrayAsync(cancellationToken));
        Assert.Null(agentNotification.ReadAt);
        var airlineAccountInternalId = await decisionCheck.Users.AsNoTracking()
            .Where(item => item.PublicId == Guid.Parse("40000000-0000-7000-8000-000000000003"))
            .Select(item => item.Id).SingleAsync(cancellationToken);
        var airlineHints = (await decisionCheck.OutboxMessages.AsNoTracking()
            .Where(item => item.EventType == "account.changed.v1")
            .ToArrayAsync(cancellationToken))
            .Select(AccountChangeOutboxWriter.Decode)
            .Where(item => item.Resource == "airline_operations" &&
                item.ResourceId == operationId).ToArray();
        Assert.Equal(3, airlineHints.Length); // start + submission + OCC decision
        Assert.All(airlineHints, airlineHint =>
        {
            Assert.Equal(airlineAccountInternalId, airlineHint.RecipientAccountId);
            Assert.Null(airlineHint.StationId);
        });
        var financeAccountInternalId = await decisionCheck.Users.AsNoTracking()
            .Where(item => item.PublicId == Guid.Parse("40000000-0000-7000-8000-000000000006"))
            .Select(item => item.Id).SingleAsync(cancellationToken);
        var financeStationInternalId = await decisionCheck.Stations.AsNoTracking()
            .Where(item => item.PublicId == stationId)
            .Select(item => item.Id).SingleAsync(cancellationToken);
        var financeHints = (await decisionCheck.OutboxMessages.AsNoTracking()
            .Where(item => item.EventType == "account.changed.v1")
            .ToArrayAsync(cancellationToken))
            .Select(AccountChangeOutboxWriter.Decode)
            .Where(item => item.Resource == "finance_approved_services" &&
                item.ResourceId == operationId).ToArray();
        Assert.Equal(reviewOutcome == "Approved" ? 1 : 0, financeHints.Length);
        if (reviewOutcome == "Approved")
        {
            var hint = Assert.Single(financeHints);
            Assert.Equal(financeAccountInternalId, hint.RecipientAccountId);
            Assert.Equal(financeStationInternalId, hint.StationId);
        }

        string? approvedServiceName = null;
        await using (var financeScope = provider.CreateAsyncScope())
        {
            var finance = financeScope.ServiceProvider
                .GetRequiredService<IFinanceApprovedServicesReadStore>();
            var financeAccountId = Guid.Parse("40000000-0000-7000-8000-000000000006");
            var date = new DateOnly(2026, 8, 18);
            var evidence = await finance.GetAsync(financeAccountId, stationId,
                date, date, cancellationToken);
            Assert.NotNull(evidence);
            if (reviewOutcome == "Approved")
            {
                var billed = Assert.Single(evidence.Services,
                    item => item.Id == baggageServiceId);
                Assert.True(billed.Ready);
                Assert.True(billed.Amount > 0);
                Assert.Equal(handoffKey, billed.ApprovedSubmissionId);
                Assert.Equal(1m, billed.ExecutedQuantity);
                approvedServiceName = billed.ServiceName;
            }
            else
            {
                Assert.Empty(evidence.Services);
            }
            Assert.Null(await finance.GetAsync(occAccountId, stationId,
                date, date, cancellationToken));
            Assert.Null(await finance.GetAsync(financeAccountId,
                Guid.Parse("20000000-0000-7000-8000-000000000013"),
                date, date, cancellationToken));
        }

        if (reviewOutcome == "Approved")
        {
            await using (var catalog = CreateContext(database.ConnectionString))
            {
                var definitionId = await catalog.OperationServices.AsNoTracking()
                    .Where(item => item.PublicId == baggageServiceId)
                    .Select(item => item.ServiceDefinitionId)
                    .SingleAsync(cancellationToken);
                await catalog.ServiceDefinitions.Where(item => item.Id == definitionId)
                    .ExecuteUpdateAsync(setters => setters.SetProperty(
                        item => item.Name, "Renamed after OCC approval"), cancellationToken);
            }
            var financeAccountId = Guid.Parse("40000000-0000-7000-8000-000000000006");
            var date = new DateOnly(2026, 8, 18);
            var command = new CreatePreinvoiceDraftCommand(financeAccountId, stationId,
                date, date, Guid.NewGuid(), [baggageServiceId]);
            async Task<PreinvoiceDraftResult> CreateAsync(CreatePreinvoiceDraftCommand item)
            {
                await using var scope = provider.CreateAsyncScope();
                return await scope.ServiceProvider.GetRequiredService<IPreinvoiceDraftStore>()
                    .CreateAsync(item, cancellationToken);
            }

            var competing = await Task.WhenAll(CreateAsync(command), CreateAsync(command));
            Assert.All(competing, item => Assert.True(item.IsSuccess, item.Reason));
            var created = Assert.Single(competing, item => !item.Replayed);
            Assert.Single(competing, item => item.Replayed);
            Assert.True(created.IsSuccess, created.Reason);
            Assert.False(created.Replayed);
            var draftReplay = await CreateAsync(command);
            Assert.Equal(created.DraftId, draftReplay.DraftId);
            Assert.True(draftReplay.Replayed);
            Assert.Equal(PreinvoiceDraftFailure.Conflict,
                (await CreateAsync(command with { RequestId = Guid.NewGuid() })).Failure);
            Assert.Equal(PreinvoiceDraftFailure.Conflict,
                (await CreateAsync(command with { ServiceIds = [Guid.NewGuid()] })).Failure);

            await using var inspection = CreateContext(database.ConnectionString);
            var draft = await inspection.Preinvoices.AsNoTracking()
                .SingleAsync(item => item.PublicId == created.DraftId, cancellationToken);
            var line = await inspection.PreinvoiceLines.AsNoTracking()
                .SingleAsync(item => item.PreinvoiceId == draft.Id && item.Kind == PreinvoiceLineKind.Service,
                    cancellationToken);
            // The NIGHT surcharge the agent marked is billed as its own line under the service (15 %, ADR-0034).
            var nightLine = await inspection.PreinvoiceLines.AsNoTracking()
                .SingleAsync(item => item.PreinvoiceId == draft.Id && item.Kind == PreinvoiceLineKind.Charge,
                    cancellationToken);
            Assert.Equal(line.Id, nightLine.ParentLineId);
            Assert.Equal("NIGHT", nightLine.ServiceCode);
            Assert.Equal(decimal.Round(line.Amount * 0.15m, 4), nightLine.Amount);
            Assert.Equal(nightLine.Amount, nightLine.ComputedAmount);
            Assert.Equal(PreinvoiceStatus.Draft, draft.Status);
            Assert.Equal(draft.Total, line.Amount + nightLine.Amount);
            Assert.Equal(1m, line.ExecutedQuantity);
            Assert.True(line.UnitPrice > 0);
            Assert.Equal(approvedServiceName, line.ServiceName);
            await using (var evidenceScope = provider.CreateAsyncScope())
            {
                var evidence = await evidenceScope.ServiceProvider
                    .GetRequiredService<IFinanceApprovedServicesReadStore>()
                    .GetAsync(financeAccountId, stationId, date, date, cancellationToken);
                Assert.Equal(created.DraftId,
                    Assert.Single(Assert.IsType<FinanceApprovedServicesData>(evidence).Services,
                        item => item.Id == baggageServiceId).PreinvoiceId);
            }
            await using (var readScope = provider.CreateAsyncScope())
            {
                var drafts = readScope.ServiceProvider.GetRequiredService<IPreinvoiceDraftStore>();
                var detail = await drafts.GetAsync(financeAccountId,
                    created.DraftId!.Value, cancellationToken);
                Assert.NotNull(detail);
                Assert.Equal(draft.Total, detail.Total);
                Assert.Equal(baggageServiceId, Assert.Single(detail.Lines, item => item.Kind == "Service").OperationServiceId);
                Assert.Equal("Charge", Assert.Single(detail.Lines, item => item.ParentLineId != null).Kind);

                // Finance edits the surcharge and adds a discount before sending; computed values are kept.
                var edits = readScope.ServiceProvider.GetRequiredService<IPreinvoiceLineEditStore>();
                var charge = Assert.Single(detail.Lines, item => item.Kind == "Charge");
                Assert.Equal(FinanceCatalogFailure.Invalid, (await edits.EditLineAsync(financeAccountId, detail.Id,
                    charge.Id, new EditPreinvoiceLineInput(10m, false, "", detail.Version!), cancellationToken)).Failure);
                Assert.Equal(FinanceCatalogFailure.Conflict, (await edits.EditLineAsync(financeAccountId, detail.Id,
                    charge.Id, new EditPreinvoiceLineInput(10m, false, "Acordado", "c3RhbGU="), cancellationToken)).Failure);
                Assert.Equal(FinanceCatalogFailure.Forbidden, (await edits.EditLineAsync(occAccountId, detail.Id,
                    charge.Id, new EditPreinvoiceLineInput(10m, false, "Acordado", detail.Version!), cancellationToken)).Failure);
                Assert.True((await edits.EditLineAsync(financeAccountId, detail.Id, charge.Id,
                    new EditPreinvoiceLineInput(10m, false, "Recargo acordado con la aerolínea", detail.Version!),
                    cancellationToken)).IsSuccess);
                var edited = (await drafts.GetAsync(financeAccountId, detail.Id, cancellationToken))!;
                Assert.Equal(FinanceCatalogFailure.Invalid, (await edits.EditLineAsync(financeAccountId, detail.Id,
                    Assert.Single(edited.Lines, item => item.Kind == "Service").Id,
                    new EditPreinvoiceLineInput(null, true, "Quitar servicio", edited.Version!), cancellationToken)).Failure);
                Assert.True((await edits.AddAdjustmentAsync(financeAccountId, detail.Id,
                    new AddPreinvoiceAdjustmentInput("Descuento por demora propia", -5m, "Compensación comercial",
                        edited.Version!), cancellationToken)).IsSuccess);
                edited = (await drafts.GetAsync(financeAccountId, detail.Id, cancellationToken))!;
                var editedCharge = Assert.Single(edited.Lines, item => item.Kind == "Charge");
                Assert.Equal(10m, editedCharge.Amount);
                Assert.Equal(charge.Amount, editedCharge.ComputedAmount);
                Assert.NotNull(editedCharge.EditedAt);
                Assert.Equal(-5m, Assert.Single(edited.Lines, item => item.Kind == "Adjustment").Amount);
                Assert.Equal(line.Amount + 10m - 5m, edited.Total);
                Assert.Null(await drafts.GetAsync(occAccountId,
                    created.DraftId.Value, cancellationToken));
            }
            draft = await inspection.Preinvoices.AsNoTracking()
                .SingleAsync(item => item.PublicId == created.DraftId, cancellationToken);
            await using (var listScope = provider.CreateAsyncScope())
            {
                var list = listScope.ServiceProvider.GetRequiredService<IFinancePreinvoiceListStore>();
                var page = await list.ListAsync(financeAccountId, stationId, 1, 20,
                    cancellationToken);
                Assert.NotNull(page);
                var item = Assert.Single(page.Preinvoices);
                Assert.Equal(created.DraftId, item.Id);
                Assert.Equal("Draft", item.Status);
                Assert.Equal(3, item.LineCount);
                Assert.Equal(line.Amount + 5m, item.Total);
                Assert.Null(await list.ListAsync(occAccountId, stationId, 1, 20,
                    cancellationToken));
                Assert.Null(await list.ListAsync(financeAccountId, Guid.NewGuid(), 1, 20,
                    cancellationToken));
            }
            Assert.Single(await inspection.AuditEntries.AsNoTracking()
                .Where(item => item.EntityPublicId == created.DraftId &&
                    item.Action == "finance.preinvoice.draft.created")
                .ToArrayAsync(cancellationToken));
            var airlineOrganizationId = await (
                from airline in inspection.Airlines.AsNoTracking()
                join organization in inspection.Organizations.AsNoTracking()
                    on airline.OrganizationId equals organization.Id
                where airline.Id == draft.AirlineId
                select organization.PublicId).SingleAsync(cancellationToken);
            await using (var portalScope = provider.CreateAsyncScope())
            {
                var portal = portalScope.ServiceProvider.GetRequiredService<IAirlinePortalReadStore>();
                Assert.Null(await portal.GetPreinvoiceAsync(airlineOrganizationId,
                    created.DraftId!.Value, cancellationToken: cancellationToken));
            }
            var acceptCommand = new AcceptAirlinePreinvoiceCommand(
                Guid.Parse("40000000-0000-7000-8000-000000000003"),
                airlineOrganizationId, created.DraftId!.Value, Guid.NewGuid());
            async Task<AcceptAirlinePreinvoiceResult> AcceptAsync(
                AcceptAirlinePreinvoiceCommand request)
            {
                await using var acceptScope = provider.CreateAsyncScope();
                return await acceptScope.ServiceProvider
                    .GetRequiredService<IAirlinePreinvoiceAcceptanceStore>()
                    .AcceptAsync(request, cancellationToken);
            }
            Assert.Equal(AcceptAirlinePreinvoiceFailure.NotFound,
                (await AcceptAsync(acceptCommand)).Failure);
            var submitCommand = new SubmitPreinvoiceCommand(financeAccountId,
                created.DraftId!.Value, Guid.NewGuid());
            async Task<SubmitPreinvoiceResult> SubmitAsync(SubmitPreinvoiceCommand request)
            {
                await using var submitScope = provider.CreateAsyncScope();
                return await submitScope.ServiceProvider
                    .GetRequiredService<IPreinvoiceSubmissionStore>()
                    .SubmitAsync(request, cancellationToken);
            }
            var submissions = await Task.WhenAll(
                SubmitAsync(submitCommand), SubmitAsync(submitCommand));
            Assert.All(submissions, result => Assert.True(result.IsSuccess));
            Assert.Single(submissions, result => !result.Replayed);
            Assert.Single(submissions, result => result.Replayed);
            Assert.Equal(SubmitPreinvoiceFailure.Conflict,
                (await SubmitAsync(submitCommand with { RequestId = Guid.NewGuid() })).Failure);
            Assert.Equal(SubmitPreinvoiceFailure.Forbidden,
                (await SubmitAsync(submitCommand with { AccountId = occAccountId })).Failure);
            Assert.Single(await inspection.AuditEntries.AsNoTracking()
                .Where(item => item.EntityPublicId == created.DraftId &&
                    item.Action == "finance.preinvoice.submitted")
                .ToArrayAsync(cancellationToken));
            var publishedHints = (await inspection.OutboxMessages.AsNoTracking()
                .Where(item => item.EventType == "account.changed.v1")
                .ToArrayAsync(cancellationToken))
                .Select(AccountChangeOutboxWriter.Decode)
                .Where(item => item.Resource == "airline_preinvoices" &&
                    item.ResourceId == created.DraftId).ToArray();
            Assert.Single(publishedHints);
            Assert.Equal(airlineAccountInternalId, publishedHints[0].RecipientAccountId);
            await using (var portalScope = provider.CreateAsyncScope())
            {
                var portal = portalScope.ServiceProvider.GetRequiredService<IAirlinePortalReadStore>();
                var published = await portal.GetPreinvoiceAsync(airlineOrganizationId,
                    created.DraftId!.Value, cancellationToken: cancellationToken);
                Assert.NotNull(published);
                Assert.Equal("Submitted", published.Status);
                Assert.Equal(draft.Total, published.Total);
                Assert.Equal(3, published.Lines.Count);
                var snapshot = Assert.Single(published.Lines, item => item.Kind == "Service");
                Assert.Equal(snapshot.Id, Assert.Single(published.Lines, item => item.Kind == "Charge").ParentLineId);
                Assert.Equal("Compensación comercial",
                    Assert.Single(published.Lines, item => item.Kind == "Adjustment").Reason);
                Assert.Equal(line.OperationCode, snapshot.OperationCode);
                Assert.Equal(approvedServiceName, snapshot.ServiceName);
                Assert.Equal(line.Amount, snapshot.Amount);
                Assert.Null(await portal.GetPreinvoiceAsync(Guid.NewGuid(),
                    created.DraftId.Value, cancellationToken: cancellationToken));
            }
            var disputeCommand = new DisputeAirlinePreinvoiceCommand(
                acceptCommand.AccountId, airlineOrganizationId, created.DraftId.Value,
                Guid.NewGuid(), "Cantidad incorrecta",
                "La cantidad de GPU no coincide con el servicio aprobado.",
                [line.PublicId], new string('A', 64));
            async Task<DisputeAirlinePreinvoiceResult> DisputeAsync(
                DisputeAirlinePreinvoiceCommand request)
            {
                await using var disputeScope = provider.CreateAsyncScope();
                return await disputeScope.ServiceProvider
                    .GetRequiredService<IAirlinePreinvoiceDisputeStore>()
                    .DisputeAsync(request, cancellationToken);
            }
            Assert.Equal(DisputeAirlinePreinvoiceFailure.InvalidRequest,
                (await DisputeAsync(disputeCommand with { LineIds = [Guid.NewGuid()] })).Failure);
            Assert.Equal(DisputeAirlinePreinvoiceFailure.Forbidden,
                (await DisputeAsync(disputeCommand with { OrganizationId = Guid.NewGuid() })).Failure);
            var disputes = await Task.WhenAll(
                DisputeAsync(disputeCommand), DisputeAsync(disputeCommand));
            Assert.All(disputes, result => Assert.True(result.IsSuccess));
            Assert.Single(disputes, result => !result.Replayed);
            Assert.Single(disputes, result => result.Replayed);
            Assert.Equal(disputes[0].DisputeId, disputes[1].DisputeId);
            Assert.Equal(DisputeAirlinePreinvoiceFailure.Conflict,
                (await DisputeAsync(disputeCommand with { RequestId = Guid.NewGuid() })).Failure);
            Assert.Equal(DisputeAirlinePreinvoiceFailure.Conflict,
                (await DisputeAsync(disputeCommand with { PayloadHash = new string('B', 64) })).Failure);
            var storedDispute = Assert.Single(await inspection.PreinvoiceDisputes.AsNoTracking()
                .Where(item => item.PreinvoiceId == draft.Id).ToArrayAsync(cancellationToken));
            Assert.Equal(airlineAccountInternalId, storedDispute.SubmittedByAccountId);
            Assert.Equal(disputeCommand.Subject, storedDispute.Subject);
            Assert.Equal(line.Id, Assert.Single(await inspection.PreinvoiceDisputeLines.AsNoTracking()
                .Where(item => item.DisputeId == storedDispute.Id)
                .ToArrayAsync(cancellationToken)).PreinvoiceLineId);
            Assert.Equal(disputeCommand.RequestId,
                Assert.Single(await inspection.AuditEntries.AsNoTracking()
                    .Where(item => item.EntityPublicId == created.DraftId &&
                        item.Action == "airline.preinvoice.disputed")
                    .ToArrayAsync(cancellationToken)).CorrelationId);
            await using (var disputedReadScope = provider.CreateAsyncScope())
            {
                var financeDetail = await disputedReadScope.ServiceProvider
                    .GetRequiredService<IPreinvoiceDraftStore>()
                    .GetDisputesAsync(financeAccountId, created.DraftId.Value, cancellationToken);
                Assert.NotNull(financeDetail);
                var financeDispute = Assert.Single(financeDetail);
                Assert.Equal(disputeCommand.Description, financeDispute.Description);
                Assert.Equal(line.PublicId, Assert.Single(financeDispute.LineIds));
                var airlineDetail = await disputedReadScope.ServiceProvider
                    .GetRequiredService<IAirlinePortalReadStore>()
                    .GetPreinvoiceDisputesAsync(airlineOrganizationId, created.DraftId.Value,
                        cancellationToken: cancellationToken);
                Assert.NotNull(airlineDetail);
                Assert.Equal(financeDispute.Id, Assert.Single(airlineDetail).Id);
                Assert.Null(await disputedReadScope.ServiceProvider
                    .GetRequiredService<IAirlinePortalReadStore>()
                    .GetPreinvoiceDisputesAsync(Guid.NewGuid(), created.DraftId.Value,
                        cancellationToken: cancellationToken));
            }
            Assert.Equal(AcceptAirlinePreinvoiceFailure.Conflict,
                (await AcceptAsync(acceptCommand)).Failure);
            var resolutionCommand = new ResolvePreinvoiceDisputeCommand(
                financeAccountId, created.DraftId.Value, Guid.NewGuid(),
                "Maintain", "Verified approved service evidence and original price.");
            async Task<ResolvePreinvoiceDisputeResult> ResolveAsync(
                ResolvePreinvoiceDisputeCommand request)
            {
                await using var resolveScope = provider.CreateAsyncScope();
                return await resolveScope.ServiceProvider
                    .GetRequiredService<IPreinvoiceDisputeResolutionStore>()
                    .ResolveAsync(request, cancellationToken);
            }
            Assert.Equal(ResolvePreinvoiceDisputeFailure.Forbidden,
                (await ResolveAsync(resolutionCommand with { AccountId = occAccountId })).Failure);
            var resolutions = await Task.WhenAll(
                ResolveAsync(resolutionCommand), ResolveAsync(resolutionCommand));
            Assert.All(resolutions, result => Assert.True(result.IsSuccess));
            Assert.Single(resolutions, result => !result.Replayed);
            Assert.Single(resolutions, result => result.Replayed);
            Assert.Equal(PreinvoiceStatus.Submitted,
                await inspection.Preinvoices.AsNoTracking()
                    .Where(item => item.Id == draft.Id).Select(item => item.Status)
                    .SingleAsync(cancellationToken));
            Assert.Equal(ResolvePreinvoiceDisputeFailure.Conflict,
                (await ResolveAsync(resolutionCommand with { RequestId = Guid.NewGuid() })).Failure);
            Assert.Equal(ResolvePreinvoiceDisputeFailure.Conflict,
                (await ResolveAsync(resolutionCommand with { Reason = "Different decision reason" })).Failure);
            var recordedResolution = Assert.Single(await inspection.PreinvoiceDisputeResolutions
                .AsNoTracking().Where(item => item.DisputeId == storedDispute.Id)
                .ToArrayAsync(cancellationToken));
            Assert.Equal(resolutionCommand.RequestId, recordedResolution.RequestId);
            Assert.Equal("Maintain", recordedResolution.Decision);
            Assert.Equal(financeAccountInternalId, recordedResolution.ResolvedByAccountId);
            await using (var resolvedReadScope = provider.CreateAsyncScope())
            {
                var financeDisputes = await resolvedReadScope.ServiceProvider
                    .GetRequiredService<IPreinvoiceDraftStore>()
                    .GetDisputesAsync(financeAccountId, created.DraftId.Value, cancellationToken);
                Assert.Equal("Maintain", Assert.Single(financeDisputes!).Resolution?.Decision);
                var airlineDisputes = await resolvedReadScope.ServiceProvider
                    .GetRequiredService<IAirlinePortalReadStore>()
                    .GetPreinvoiceDisputesAsync(airlineOrganizationId, created.DraftId.Value,
                        cancellationToken: cancellationToken);
                Assert.Equal(resolutionCommand.Reason,
                    Assert.Single(airlineDisputes!).Resolution?.Reason);
            }
            var acceptances = await Task.WhenAll(
                AcceptAsync(acceptCommand), AcceptAsync(acceptCommand));
            Assert.All(acceptances, result => Assert.True(result.IsSuccess));
            Assert.Single(acceptances, result => !result.Replayed);
            Assert.Single(acceptances, result => result.Replayed);
            Assert.Equal(AcceptAirlinePreinvoiceFailure.Conflict,
                (await AcceptAsync(acceptCommand with { RequestId = Guid.NewGuid() })).Failure);
            Assert.Equal(AcceptAirlinePreinvoiceFailure.Forbidden,
                (await AcceptAsync(acceptCommand with { AccountId = occAccountId })).Failure);
            Assert.Equal(AcceptAirlinePreinvoiceFailure.Forbidden,
                (await AcceptAsync(acceptCommand with { OrganizationId = Guid.NewGuid() })).Failure);
            var acceptanceAudit = Assert.Single(await inspection.AuditEntries.AsNoTracking()
                .Where(item => item.EntityPublicId == created.DraftId &&
                    item.Action == "airline.preinvoice.accepted")
                .ToArrayAsync(cancellationToken));
            Assert.Equal(airlineAccountInternalId, acceptanceAudit.ActorAccountId);
            Assert.Equal(acceptCommand.RequestId, acceptanceAudit.CorrelationId);
            Assert.Equal(PreinvoiceStatus.Accepted,
                await inspection.Preinvoices.AsNoTracking()
                    .Where(item => item.Id == draft.Id).Select(item => item.Status)
                    .SingleAsync(cancellationToken));
            var acceptedHints = (await inspection.OutboxMessages.AsNoTracking()
                .Where(item => item.EventType == "account.changed.v1")
                .ToArrayAsync(cancellationToken))
                .Select(AccountChangeOutboxWriter.Decode)
                .Where(item => item.Resource == "airline_preinvoices" &&
                    item.ResourceId == created.DraftId).ToArray();
            Assert.Equal(4, acceptedHints.Length);
            Assert.All(acceptedHints, hint =>
                Assert.Equal(airlineAccountInternalId, hint.RecipientAccountId));
            var financeAcceptanceHints = (await inspection.OutboxMessages.AsNoTracking()
                .Where(item => item.EventType == "account.changed.v1")
                .ToArrayAsync(cancellationToken))
                .Select(AccountChangeOutboxWriter.Decode)
                .Where(item => item.Resource == "finance_preinvoices" &&
                    item.ResourceId == created.DraftId).ToArray();
            Assert.Equal(7, financeAcceptanceHints.Length); // draft + 2 edits + submission + dispute + resolution + acceptance
            Assert.All(financeAcceptanceHints, hint =>
                Assert.Equal(financeAccountInternalId, hint.RecipientAccountId));

            async Task<FinanceReconciliationPageData?> ReadReconciliationAsync(Guid actorId,
                Guid selectedStationId)
            {
                await using var readScope = provider.CreateAsyncScope();
                return await readScope.ServiceProvider
                    .GetRequiredService<IFinanceReconciliationReadStore>()
                    .ListAsync(actorId, selectedStationId, 1, 20, cancellationToken);
            }
            var acceptedForReconciliation = Assert.Single((await ReadReconciliationAsync(
                financeAccountId, stationId))!.Rows,
                item => item.PreinvoiceId == created.DraftId.Value);
            Assert.Equal("Accepted", acceptedForReconciliation.PreinvoiceStatus);
            Assert.Null(acceptedForReconciliation.InvoiceId);
            Assert.Null(acceptedForReconciliation.PaymentId);
            Assert.Null(await ReadReconciliationAsync(occAccountId, stationId));
            Assert.Null(await ReadReconciliationAsync(financeAccountId, Guid.NewGuid()));

            var invoiceCommand = new IssueFinanceInvoiceCommand(
                financeAccountId, created.DraftId.Value, Guid.NewGuid());
            async Task<IssueFinanceInvoiceResult> IssueAsync(IssueFinanceInvoiceCommand request)
            {
                await using var issueScope = provider.CreateAsyncScope();
                return await issueScope.ServiceProvider
                    .GetRequiredService<IFinanceInvoiceIssueStore>()
                    .IssueAsync(request, cancellationToken);
            }
            Assert.Equal(IssueFinanceInvoiceFailure.Forbidden,
                (await IssueAsync(invoiceCommand with { AccountId = occAccountId })).Failure);
            Assert.Equal(IssueFinanceInvoiceFailure.NotFound,
                (await IssueAsync(invoiceCommand with { PreinvoiceId = Guid.NewGuid() })).Failure);
            var issuances = await Task.WhenAll(IssueAsync(invoiceCommand), IssueAsync(invoiceCommand));
            Assert.All(issuances, result => Assert.True(result.IsSuccess));
            Assert.Single(issuances, result => !result.Replayed);
            Assert.Single(issuances, result => result.Replayed);
            Assert.Equal(issuances[0].InvoiceId, issuances[1].InvoiceId);
            Assert.Equal(IssueFinanceInvoiceFailure.Conflict,
                (await IssueAsync(invoiceCommand with { RequestId = Guid.NewGuid() })).Failure);
            var invoice = Assert.Single(await inspection.NonFiscalInvoices.AsNoTracking()
                .Where(item => item.PreinvoiceId == draft.Id).ToArrayAsync(cancellationToken));
            Assert.Equal($"NF-{invoice.PublicId:N}", invoice.Number);
            Assert.Equal(draft.Total, invoice.Total);
            Assert.Equal(draft.CurrencyCode, invoice.CurrencyCode);
            var invoiceLines = await inspection.NonFiscalInvoiceLines.AsNoTracking()
                .Where(item => item.InvoiceId == invoice.Id).OrderBy(item => item.LineNumber)
                .ToArrayAsync(cancellationToken);
            Assert.Equal([PreinvoiceLineKind.Service, PreinvoiceLineKind.Charge, PreinvoiceLineKind.Adjustment],
                invoiceLines.Select(item => item.Kind));
            Assert.Equal(invoiceLines[0].LineNumber, invoiceLines[1].ParentLineNumber);
            Assert.NotNull(invoice.DueDate);
            Assert.Equal(30, invoice.PaymentTermDays);
            var invoiceLine = invoiceLines[0];
            Assert.Equal(line.Id, invoiceLine.PreinvoiceLineId);
            Assert.Equal(line.Amount, invoiceLine.Amount);
            Assert.Equal(line.OperationCode, invoiceLine.OperationCode);
            Assert.Equal(PreinvoiceStatus.Invoiced, await inspection.Preinvoices.AsNoTracking()
                .Where(item => item.Id == draft.Id).Select(item => item.Status)
                .SingleAsync(cancellationToken));
            var awaitingPayment = Assert.Single((await ReadReconciliationAsync(
                financeAccountId, stationId))!.Rows,
                item => item.PreinvoiceId == created.DraftId.Value);
            Assert.Equal(invoice.PublicId, awaitingPayment.InvoiceId);
            Assert.Equal(invoice.Total, awaitingPayment.InvoiceTotal);
            Assert.Null(awaitingPayment.PaymentId);
            Assert.Equal(invoiceCommand.RequestId,
                Assert.Single(await inspection.AuditEntries.AsNoTracking()
                    .Where(item => item.EntityPublicId == invoice.PublicId &&
                        item.Action == "finance.invoice.non_fiscal.issued")
                    .ToArrayAsync(cancellationToken)).CorrelationId);
            await using (var invoiceReadScope = provider.CreateAsyncScope())
            {
                var reader = invoiceReadScope.ServiceProvider
                    .GetRequiredService<INonFiscalInvoiceReadStore>();
                var financeInvoice = await reader.GetForFinanceAsync(
                    financeAccountId, created.DraftId.Value, cancellationToken);
                Assert.NotNull(financeInvoice);
                Assert.Equal(invoice.Number, financeInvoice.Number);
                Assert.Equal(3, financeInvoice.Lines.Count);
                Assert.Equal(line.Amount, financeInvoice.Lines[0].Amount);
                var airlineInvoice = await reader.GetForAirlineAsync(
                    airlineOrganizationId, created.DraftId.Value, cancellationToken);
                Assert.NotNull(airlineInvoice);
                Assert.Equal(financeInvoice.Id, airlineInvoice.Id);
                Assert.Null(await reader.GetForAirlineAsync(
                    Guid.NewGuid(), created.DraftId.Value, cancellationToken));
                Assert.Null(await reader.GetForFinanceAsync(
                    occAccountId, created.DraftId.Value, cancellationToken));
            }

            // A first partial payment; the balance is settled later after a credit note.
            var paymentCommand = new RecordNonFiscalPaymentCommand(
                financeAccountId, invoice.PublicId, Guid.NewGuid(), "DEV-PAY-0002", 50m, PaymentMethod.Check,
                new DateOnly(2026, 8, 20));
            await using (var unpaidReadScope = provider.CreateAsyncScope())
            {
                var reader = unpaidReadScope.ServiceProvider
                    .GetRequiredService<INonFiscalPaymentReadStore>();
                var unpaid = await reader.GetForAirlineAsync(airlineOrganizationId,
                    invoice.PublicId, cancellationToken);
                Assert.NotNull(unpaid);
                Assert.Null(unpaid.Payment);
            }
            async Task<RecordNonFiscalPaymentResult> PayAsync(RecordNonFiscalPaymentCommand request)
            {
                await using var paymentScope = provider.CreateAsyncScope();
                return await paymentScope.ServiceProvider
                    .GetRequiredService<INonFiscalPaymentStore>()
                    .RecordAsync(request, cancellationToken);
            }
            Assert.Equal(RecordNonFiscalPaymentFailure.Forbidden,
                (await PayAsync(paymentCommand with { AccountId = occAccountId })).Failure);
            Assert.Equal(RecordNonFiscalPaymentFailure.NotFound,
                (await PayAsync(paymentCommand with { InvoiceId = Guid.NewGuid() })).Failure);
            var payments = await Task.WhenAll(PayAsync(paymentCommand), PayAsync(paymentCommand));
            Assert.All(payments, result => Assert.True(result.IsSuccess));
            Assert.Single(payments, result => !result.Replayed);
            Assert.Single(payments, result => result.Replayed);
            Assert.Equal(payments[0].PaymentId, payments[1].PaymentId);
            Assert.Equal(RecordNonFiscalPaymentFailure.Conflict,
                (await PayAsync(paymentCommand with { RequestId = Guid.NewGuid() })).Failure);
            var payment = Assert.Single(await inspection.NonFiscalPayments.AsNoTracking()
                .Where(item => item.InvoiceId == invoice.Id).ToArrayAsync(cancellationToken));
            Assert.Equal(50m, payment.Amount);
            Assert.Equal(PaymentMethod.Check, payment.Method);
            Assert.Equal(invoice.CurrencyCode, payment.CurrencyCode);
            Assert.Equal(RecordNonFiscalPaymentFailure.Conflict, (await PayAsync(paymentCommand with
            {
                RequestId = Guid.NewGuid(), Reference = "DEV-PAY-TOO-MUCH", Amount = invoice.Total,
            })).Failure);
            await using (var ledgerScope = provider.CreateAsyncScope())
            {
                var ledger = ledgerScope.ServiceProvider.GetRequiredService<IFinanceInvoiceLedgerStore>();
                var partial = (await ledger.GetAsync(financeAccountId, invoice.PublicId, cancellationToken))!;
                Assert.Equal("PartiallyPaid", partial.Summary.Status);
                Assert.Equal(invoice.Total - 50m, partial.Summary.Balance);
                var noteRequest = Guid.NewGuid();
                Assert.Equal(FinanceCatalogFailure.Conflict, (await ledger.IssueCreditNoteAsync(financeAccountId,
                    invoice.PublicId, new IssueCreditNoteInput(Guid.NewGuid(), invoice.Total, "Excede el saldo"),
                    cancellationToken)).Failure);
                var note = await ledger.IssueCreditNoteAsync(financeAccountId, invoice.PublicId,
                    new IssueCreditNoteInput(noteRequest, 10m, "Bonificación por servicio parcial"), cancellationToken);
                Assert.True(note.IsSuccess);
                Assert.Equal(note.Id, (await ledger.IssueCreditNoteAsync(financeAccountId, invoice.PublicId,
                    new IssueCreditNoteInput(noteRequest, 10m, "Bonificación por servicio parcial"),
                    cancellationToken)).Id);
                var settlement = await PayAsync(new RecordNonFiscalPaymentCommand(financeAccountId, invoice.PublicId,
                    Guid.NewGuid(), "DEV-PAY-0003"));
                Assert.Equal(invoice.Total - 60m, settlement.Amount);
                var paid = (await ledger.GetAsync(financeAccountId, invoice.PublicId, cancellationToken))!;
                Assert.Equal("Paid", paid.Summary.Status);
                Assert.Equal(0m, paid.Summary.Balance);
                Assert.Equal(2, paid.Payments.Count);
                Assert.Single(paid.CreditNotes);
                Assert.Contains((await ledger.ListAsync(financeAccountId, stationId, null, "Paid", 1, 25,
                    cancellationToken))!.Invoices, item => item.Id == invoice.PublicId);
                Assert.Null(await ledger.ListAsync(occAccountId, null, null, null, 1, 25, cancellationToken));

                // The airline sees its own statement: charge lines, payments and credit notes, no staff names.
                var statement = (await ledger.GetStatementForAirlineAsync(airlineOrganizationId, invoice.PublicId,
                    cancellationToken))!;
                Assert.Equal("Paid", statement.Status);
                Assert.Equal(0m, statement.Balance);
                Assert.Equal(paid.Lines.Count, statement.Lines.Count);
                Assert.Contains(statement.Lines, line => line.Kind == "Charge" && line.ParentLineNumber == 1);
                Assert.Equal(2, statement.Payments.Count);
                Assert.Equal("Bonificación por servicio parcial", Assert.Single(statement.CreditNotes).Reason);
                Assert.Null(await ledger.GetStatementForAirlineAsync(Guid.NewGuid(), invoice.PublicId,
                    cancellationToken));

                // Reports read the same ledger: revenue by kind, receivables, collections, charges and credit notes.
                var reports = ledgerScope.ServiceProvider.GetRequiredService<IFinanceReportStore>();
                var today = DateOnly.FromDateTime(DateTime.UtcNow);
                var period = new FinanceReportFilter(today.AddDays(-1), today.AddDays(1), stationId, null, null);
                var revenue = (await reports.GetAsync(financeAccountId, "revenue", period, cancellationToken))!;
                var revenueRow = Assert.Single(revenue.Rows);
                Assert.Equal("10.00", revenueRow[5]);
                Assert.Equal("-5.00", revenueRow[6]);
                Assert.Equal(invoice.Total.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture), revenueRow[7]);
                Assert.Empty((await reports.GetAsync(financeAccountId, "receivables", period, cancellationToken))!.Rows);
                // Collections use the payment date the cashier recorded (the check is dated in August).
                var collections = (await reports.GetAsync(financeAccountId, "collections",
                    period with { From = new DateOnly(2026, 8, 1) }, cancellationToken))!;
                Assert.Contains(collections.Rows, row => row[0] == "2026-08" && row[3] == "Check" && row[5] == "50.00");
                Assert.Contains(collections.Rows, row => row[3] == "Transfer");
                var chargeReport = (await reports.GetAsync(financeAccountId, "charges",
                    period with { From = new DateOnly(2026, 8, 1), To = new DateOnly(2026, 8, 31) }, cancellationToken))!;
                Assert.Contains(chargeReport.Rows, row => row[0] == "Cargo" && row[4] == "1" && row[6] == "10.00");
                Assert.Contains(chargeReport.Rows, row => row[0] == "Ajuste" && row[8] == "Compensación comercial");
                Assert.Single((await reports.GetAsync(financeAccountId, "credit-notes", period, cancellationToken))!.Rows);
                Assert.Null(await reports.GetAsync(occAccountId, "revenue", period, cancellationToken));
                Assert.Null(await reports.GetAsync(financeAccountId, "revenue", period with { StationId = Guid.NewGuid() },
                    cancellationToken));
            }
            payment = await inspection.NonFiscalPayments.AsNoTracking()
                .Where(item => item.InvoiceId == invoice.Id).OrderByDescending(item => item.CreatedAt)
                .FirstAsync(cancellationToken);
            var paidForReconciliation = Assert.Single((await ReadReconciliationAsync(
                financeAccountId, stationId))!.Rows,
                item => item.PreinvoiceId == created.DraftId.Value);
            Assert.Equal(payment.PublicId, paidForReconciliation.PaymentId);
            Assert.Equal(invoice.Total - 10m, paidForReconciliation.PaymentAmount);
            Assert.Equal(payment.Reference, paidForReconciliation.PaymentReference);
            Assert.Equal(paymentCommand.RequestId,
                Assert.Single(await inspection.AuditEntries.AsNoTracking()
                    .Where(item => item.EntityPublicId != payment.PublicId &&
                        item.Action == "finance.payment.non_fiscal.recorded" &&
                        item.CorrelationId == paymentCommand.RequestId)
                    .ToArrayAsync(cancellationToken)).CorrelationId);
            await using (var paymentReadScope = provider.CreateAsyncScope())
            {
                var reader = paymentReadScope.ServiceProvider
                    .GetRequiredService<INonFiscalPaymentReadStore>();
                var financePayment = await reader.GetForFinanceAsync(financeAccountId,
                    invoice.PublicId, cancellationToken);
                Assert.NotNull(financePayment?.Payment);
                Assert.Equal(payment.PublicId, financePayment.Payment.Id);
                var airlinePayment = await reader.GetForAirlineAsync(airlineOrganizationId,
                    invoice.PublicId, cancellationToken);
                Assert.NotNull(airlinePayment?.Payment);
                Assert.Equal(financePayment.Payment.Id, airlinePayment.Payment.Id);
                Assert.Null(await reader.GetForAirlineAsync(Guid.NewGuid(),
                    invoice.PublicId, cancellationToken));
            }

            var secondPreinvoice = new Preinvoice
            {
                PublicId = Guid.CreateVersion7(), AirlineId = draft.AirlineId,
                StationId = draft.StationId, CreatedByAccountId = draft.CreatedByAccountId,
                RequestId = Guid.NewGuid(), PayloadHash = draft.PayloadHash,
                From = draft.From, To = draft.To, CurrencyCode = draft.CurrencyCode,
                Total = draft.Total, Status = PreinvoiceStatus.Invoiced,
                CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            };
            inspection.Preinvoices.Add(secondPreinvoice);
            await inspection.SaveChangesAsync(cancellationToken);
            var secondInvoiceId = Guid.CreateVersion7();
            var secondInvoice = new NonFiscalInvoice
            {
                PublicId = secondInvoiceId, PreinvoiceId = secondPreinvoice.Id,
                AirlineId = invoice.AirlineId, StationId = invoice.StationId,
                IssuedByAccountId = invoice.IssuedByAccountId, RequestId = Guid.NewGuid(),
                Number = $"NF-{secondInvoiceId:N}", CurrencyCode = invoice.CurrencyCode,
                Total = invoice.Total, CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            inspection.NonFiscalInvoices.Add(secondInvoice);
            await inspection.SaveChangesAsync(cancellationToken);
            var competingPayments = await Task.WhenAll(
                PayAsync(paymentCommand with { InvoiceId = secondInvoiceId,
                    RequestId = Guid.NewGuid(), Reference = "DEV-PAY-RACE-A", Amount = null }),
                PayAsync(paymentCommand with { InvoiceId = secondInvoiceId,
                    RequestId = Guid.NewGuid(), Reference = "DEV-PAY-RACE-B", Amount = null }));
            Assert.Single(competingPayments, result => result.IsSuccess && !result.Replayed);
            Assert.Single(competingPayments, result =>
                result.Failure == RecordNonFiscalPaymentFailure.Conflict);
            Assert.Single(await inspection.NonFiscalPayments.AsNoTracking()
                .Where(item => item.InvoiceId == secondInvoice.Id)
                .ToArrayAsync(cancellationToken));

            var spareServiceId = await inspection.OperationServices.AsNoTracking()
                .Where(item => !inspection.PreinvoiceLines.AsNoTracking()
                    .Any(reservation => reservation.OperationServiceId == item.Id))
                .Select(item => item.Id).FirstAsync(cancellationToken);
            var voidedPreinvoice = new Preinvoice
            {
                PublicId = Guid.CreateVersion7(), AirlineId = draft.AirlineId,
                StationId = draft.StationId, CreatedByAccountId = draft.CreatedByAccountId,
                RequestId = Guid.NewGuid(), PayloadHash = draft.PayloadHash,
                From = draft.From, To = draft.To, CurrencyCode = draft.CurrencyCode,
                Total = line.Amount, Status = PreinvoiceStatus.Disputed,
                CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            };
            inspection.Preinvoices.Add(voidedPreinvoice);
            await inspection.SaveChangesAsync(cancellationToken);
            var voidedLine = new PreinvoiceLine
            {
                PublicId = Guid.CreateVersion7(), PreinvoiceId = voidedPreinvoice.Id,
                OperationServiceId = spareServiceId,
                ApprovedSubmissionId = line.ApprovedSubmissionId,
                LineNumber = 1, OperationCode = line.OperationCode,
                OperationDate = line.OperationDate, ServiceCode = line.ServiceCode,
                ServiceName = line.ServiceName, ExecutedQuantity = line.ExecutedQuantity,
                BillingUnit = line.BillingUnit, UnitPrice = line.UnitPrice,
                CurrencyCode = line.CurrencyCode, Amount = line.Amount,
                CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            };
            inspection.PreinvoiceLines.Add(voidedLine);
            var voidedDispute = new PreinvoiceDispute
            {
                PublicId = Guid.CreateVersion7(), PreinvoiceId = voidedPreinvoice.Id,
                SubmittedByAccountId = airlineAccountInternalId,
                RequestId = Guid.NewGuid(), PayloadHash = new string('B', 64),
                Subject = "Servicio incorrecto", Description = "Retirar el cargo del documento.",
                CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            };
            inspection.PreinvoiceDisputes.Add(voidedDispute);
            await inspection.SaveChangesAsync(cancellationToken);
            inspection.PreinvoiceDisputeLines.Add(new PreinvoiceDisputeLine
            {
                PublicId = Guid.CreateVersion7(), DisputeId = voidedDispute.Id,
                PreinvoiceLineId = voidedLine.Id,
                CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            });
            await inspection.SaveChangesAsync(cancellationToken);
            var voidCommand = resolutionCommand with
            {
                PreinvoiceId = voidedPreinvoice.PublicId, RequestId = Guid.NewGuid(),
                Decision = "Void", Reason = "The charged service was not delivered.",
            };
            var voidResults = await Task.WhenAll(ResolveAsync(voidCommand), ResolveAsync(voidCommand));
            Assert.All(voidResults, result => Assert.True(result.IsSuccess));
            Assert.Single(voidResults, result => result.Replayed);
            Assert.Equal(PreinvoiceStatus.Voided, await inspection.Preinvoices.AsNoTracking()
                .Where(item => item.Id == voidedPreinvoice.Id).Select(item => item.Status)
                .SingleAsync(cancellationToken));
            Assert.NotNull(await inspection.PreinvoiceLines.AsNoTracking()
                .Where(item => item.Id == voidedLine.Id).Select(item => item.ReleasedAt)
                .SingleAsync(cancellationToken));
            Assert.Equal(ResolvePreinvoiceDisputeFailure.Conflict,
                (await ResolveAsync(voidCommand with { RequestId = Guid.NewGuid() })).Failure);
            await using (var voidedReadScope = provider.CreateAsyncScope())
            {
                var airlineReader = voidedReadScope.ServiceProvider
                    .GetRequiredService<IAirlinePortalReadStore>();
                Assert.DoesNotContain((await airlineReader.GetPreinvoicesAsync(
                    airlineOrganizationId, 1, 50,
                    cancellationToken: cancellationToken))!.Preinvoices,
                    item => item.Id == voidedPreinvoice.PublicId);
                var visible = await airlineReader.GetPreinvoicesAsync(
                    airlineOrganizationId, 1, 50, includeVoided: true,
                    cancellationToken: cancellationToken);
                Assert.Contains(visible!.Preinvoices,
                    item => item.Id == voidedPreinvoice.PublicId && item.Status == "Voided");
                Assert.Null(await airlineReader.GetPreinvoiceAsync(
                    airlineOrganizationId, voidedPreinvoice.PublicId,
                    cancellationToken: cancellationToken));
                Assert.Equal("Voided", (await airlineReader.GetPreinvoiceAsync(
                    airlineOrganizationId, voidedPreinvoice.PublicId, includeVoided: true,
                    cancellationToken: cancellationToken))?.Status);
                Assert.Null(await airlineReader.GetPreinvoiceDisputesAsync(
                    airlineOrganizationId, voidedPreinvoice.PublicId,
                    cancellationToken: cancellationToken));
                var disputedHistory = await airlineReader.GetPreinvoiceDisputesAsync(
                    airlineOrganizationId, voidedPreinvoice.PublicId, includeVoided: true,
                    cancellationToken: cancellationToken);
                Assert.Equal("Void", Assert.Single(disputedHistory!).Resolution?.Decision);
                Assert.Null(await airlineReader.GetPreinvoiceAsync(
                    Guid.NewGuid(), voidedPreinvoice.PublicId,
                    cancellationToken: cancellationToken));
            }

            var replacement = new Preinvoice
            {
                PublicId = Guid.CreateVersion7(), AirlineId = draft.AirlineId,
                StationId = draft.StationId, CreatedByAccountId = draft.CreatedByAccountId,
                RequestId = Guid.NewGuid(), PayloadHash = draft.PayloadHash,
                From = draft.From, To = draft.To, CurrencyCode = draft.CurrencyCode,
                Total = line.Amount, Status = PreinvoiceStatus.Draft,
                CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            };
            inspection.Preinvoices.Add(replacement);
            await inspection.SaveChangesAsync(cancellationToken);
            inspection.PreinvoiceLines.Add(new PreinvoiceLine
            {
                PublicId = Guid.CreateVersion7(), PreinvoiceId = replacement.Id,
                OperationServiceId = spareServiceId,
                ApprovedSubmissionId = line.ApprovedSubmissionId,
                LineNumber = 1, OperationCode = line.OperationCode,
                OperationDate = line.OperationDate, ServiceCode = line.ServiceCode,
                ServiceName = line.ServiceName, ExecutedQuantity = line.ExecutedQuantity,
                BillingUnit = line.BillingUnit, UnitPrice = line.UnitPrice,
                CurrencyCode = line.CurrencyCode, Amount = line.Amount,
                CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            });
            await inspection.SaveChangesAsync(cancellationToken);
            Assert.Equal(2, await inspection.PreinvoiceLines.AsNoTracking()
                .CountAsync(item => item.OperationServiceId == spareServiceId, cancellationToken));
            var rollbackFailure = await Assert.ThrowsAsync<SqlException>(() =>
                inspection.GetService<IMigrator>().MigrateAsync(
                    "20260928170918_NonFiscalPayments", cancellationToken));
            // The newest guard to meet retained history stops the rollback.
            Assert.Contains("history must be retained", rollbackFailure.Message, StringComparison.Ordinal);
            Assert.Single(await inspection.PreinvoiceDisputeResolutions.AsNoTracking()
                .Where(item => item.DisputeId == voidedDispute.Id)
                .ToArrayAsync(cancellationToken));
            // The failed rollback stops at the guard after reversing newer migrations;
            // restore the latest schema before the remaining checks.
            await inspection.Database.MigrateAsync(cancellationToken);
        }

        if (reviewOutcome == "Approved")
        {
            await using (var dispatchScope = provider.CreateAsyncScope())
            {
                await dispatchScope.ServiceProvider
                    .GetRequiredService<IAccountChangeDispatcherStore>()
                    .DispatchPendingAsync(100, cancellationToken);
            }
            var financePublicId = Guid.Parse("40000000-0000-7000-8000-000000000006");
            await using (var readScope = provider.CreateAsyncScope())
            {
                var page = await readScope.ServiceProvider
                    .GetRequiredService<IAccountChangeReadStore>()
                    .ReadAsync(financePublicId, 0, 100, cancellationToken);
                Assert.Contains(Assert.IsType<AccountChangePage>(page).Changes,
                    item => item.Resource == "finance_approved_services" &&
                        item.ResourceId == operationId);
                Assert.Contains(Assert.IsType<AccountChangePage>(page).Changes,
                    item => item.Resource == "finance_preinvoices");
                Assert.DoesNotContain(Assert.IsType<AccountChangePage>(page).Changes,
                    item => item.Resource == "airline_preinvoices");
                var airlinePage = await readScope.ServiceProvider
                    .GetRequiredService<IAccountChangeReadStore>()
                    .ReadAsync(Guid.Parse("40000000-0000-7000-8000-000000000003"),
                        0, 100, cancellationToken);
                Assert.Contains(Assert.IsType<AccountChangePage>(airlinePage).Changes,
                    item => item.Resource == "airline_preinvoices");
            }
            await using (var voidInvoice = CreateContext(database.ConnectionString))
            {
                await voidInvoice.Preinvoices
                    .Where(item => item.StationId == financeStationInternalId &&
                        item.Status == PreinvoiceStatus.Invoiced)
                    .ExecuteUpdateAsync(setters => setters
                        .SetProperty(item => item.Status, PreinvoiceStatus.Voided),
                        cancellationToken);
            }
            await using (var readScope = provider.CreateAsyncScope())
            {
                var airlinePage = await readScope.ServiceProvider
                    .GetRequiredService<IAccountChangeReadStore>()
                    .ReadAsync(Guid.Parse("40000000-0000-7000-8000-000000000003"),
                        0, 100, cancellationToken);
                Assert.DoesNotContain(Assert.IsType<AccountChangePage>(airlinePage).Changes,
                    item => item.Resource == "airline_preinvoices");
            }
            await using (var revoke = CreateContext(database.ConnectionString))
            {
                await revoke.AccountStationScopes
                    .Where(item => item.AccountId == financeAccountInternalId &&
                        item.StationId == financeStationInternalId)
                    .ExecuteUpdateAsync(setters => setters
                        .SetProperty(item => item.RevokedAt, DateTimeOffset.UtcNow),
                        cancellationToken);
            }
            await using (var readScope = provider.CreateAsyncScope())
            {
                var page = await readScope.ServiceProvider
                    .GetRequiredService<IAccountChangeReadStore>()
                    .ReadAsync(financePublicId, 0, 100, cancellationToken);
                Assert.DoesNotContain(Assert.IsType<AccountChangePage>(page).Changes,
                    item => item.Resource == "finance_approved_services");
                var preinvoices = readScope.ServiceProvider
                    .GetRequiredService<IFinancePreinvoiceListStore>();
                Assert.Null(await preinvoices.ListAsync(financePublicId, stationId, 1, 20,
                    cancellationToken));
                Assert.Null(await readScope.ServiceProvider
                    .GetRequiredService<IFinanceReconciliationReadStore>()
                    .ListAsync(financePublicId, stationId, 1, 20, cancellationToken));
            }
            Guid revokedPreinvoiceId;
            Guid revokedOrganizationId;
            await using (var revokeAirline = CreateContext(database.ConnectionString))
            {
                revokedPreinvoiceId = await revokeAirline.AuditEntries.AsNoTracking()
                    .Where(item => item.Action == "airline.preinvoice.accepted")
                    .Select(item => item.EntityPublicId!.Value).SingleAsync(cancellationToken);
                var tenant = await (
                    from preinvoice in revokeAirline.Preinvoices.AsNoTracking()
                    join airline in revokeAirline.Airlines.AsNoTracking()
                        on preinvoice.AirlineId equals airline.Id
                    join organization in revokeAirline.Organizations.AsNoTracking()
                        on airline.OrganizationId equals organization.Id
                    where preinvoice.PublicId == revokedPreinvoiceId
                    select new { organization.Id, organization.PublicId })
                    .SingleAsync(cancellationToken);
                revokedOrganizationId = tenant.PublicId;
                await revokeAirline.OrganizationMemberships
                    .Where(item => item.AccountId == airlineAccountInternalId &&
                        item.OrganizationId == tenant.Id)
                    .ExecuteUpdateAsync(setters => setters.SetProperty(
                        item => item.Status, MembershipStatus.Ended), cancellationToken);
            }
            await using (var acceptanceScope = provider.CreateAsyncScope())
            {
                var result = await acceptanceScope.ServiceProvider
                    .GetRequiredService<IAirlinePreinvoiceAcceptanceStore>()
                    .AcceptAsync(new AcceptAirlinePreinvoiceCommand(
                        Guid.Parse("40000000-0000-7000-8000-000000000003"),
                        revokedOrganizationId, revokedPreinvoiceId, Guid.NewGuid()),
                        cancellationToken);
                Assert.Equal(AcceptAirlinePreinvoiceFailure.Forbidden, result.Failure);
            }
        }

        if (reviewOutcome == "Returned")
        {
            var correctionKey = Guid.Parse("86000000-0000-7000-8000-000000000021");
            async Task<RampOperationCorrectionWriteResult> ReopenAsync(Guid key)
            {
                await using var scope = provider.CreateAsyncScope();
                return await scope.ServiceProvider.GetRequiredService<IRampOperationCorrectionStore>()
                    .ReopenAsync(new RampOperationCorrectionWriteRequest(
                        accountId, [stationId], operationId, installationId,
                        key, key, "ramp-correction-sql-test"), cancellationToken);
            }

            var reopened = await ReopenAsync(correctionKey);
            Assert.True(reopened.IsSuccess);
            Assert.Equal(2, reopened.Correction!.RevisionNumber);
            Assert.Equal(CorrectionReason, reopened.Correction.ReturnReason);
            Assert.Equal(correctionKey, reopened.Correction.ChecklistId);
            Assert.Equal(reopened.Correction, (await ReopenAsync(correctionKey)).Correction);
            Assert.Equal(RampOperationsFailure.Conflict,
                (await ReopenAsync(Guid.Parse("86000000-0000-7000-8000-000000000022"))).Failure);

            RampOperationChecklistData correctionChecklist;
            await using (var scope = provider.CreateAsyncScope())
            {
                var read = await scope.ServiceProvider
                    .GetRequiredService<IRampOperationChecklistReadStore>()
                    .GetChecklistAsync(new RampOperationChecklistReadRequest(
                        accountId, [stationId], operationId), cancellationToken);
                correctionChecklist = Assert.IsType<RampOperationChecklistData>(read.Checklist);
            }
            Assert.Equal(correctionKey, correctionChecklist.Id);
            Assert.Equal("NotStarted", correctionChecklist.Status);
            Assert.All(correctionChecklist.Sections.SelectMany(section => section.Items),
                item => Assert.Null(item.Answer));
            var oldChecklistRetry = await SubmitChecklistAsync(
                Guid.Parse("86000000-0000-7000-8000-000000000023"),
                canonicalChecklist.Id, answers);
            Assert.Equal(RampChecklistSubmissionWriteFailure.Conflict, oldChecklistRetry.Failure);

            var restartedService = await TransitionServiceAsync(
                Guid.Parse("86000000-0000-7000-8000-000000000024"),
                baggageServiceId, ServiceExecutionStatus.InProgress, null,
                "OCC solicitó corregir la cantidad ejecutada");
            Assert.True(restartedService.IsSuccess);
            Assert.Equal(0m, restartedService.Transition!.Service.ExecutedQuantity);
            var correctedService = await TransitionServiceAsync(
                Guid.Parse("86000000-0000-7000-8000-000000000025"),
                baggageServiceId, ServiceExecutionStatus.Completed, 2m,
                "Cantidad contrastada con el agente");
            Assert.True(correctedService.IsSuccess);

            var correctedAnswers = correctionChecklist.Sections.SelectMany(section => section.Items)
                .Select(item => new RampChecklistAnswerWriteData(
                    item.Id, ChecklistAnswerValue.Ok, null)).ToArray();
            var correctedChecklist = await SubmitChecklistAsync(
                Guid.Parse("86000000-0000-7000-8000-000000000026"),
                correctionChecklist.Id, correctedAnswers);
            Assert.True(correctedChecklist.IsSuccess);
            var correctedHandoffKey = Guid.Parse("86000000-0000-7000-8000-000000000027");
            var correctedHandoff = await HandOffAsync(correctedHandoffKey,
                "Checklist y cantidad corregidos tras devolución OCC.");
            Assert.True(correctedHandoff.IsSuccess);
            Assert.Equal(2, correctedHandoff.Submission!.RevisionNumber);
            Assert.Equal(correctionChecklist.Id, correctedHandoff.Submission.ChecklistId);

            await using (var scope = provider.CreateAsyncScope())
            {
                var reviewStore = scope.ServiceProvider.GetRequiredService<IOccReviewStore>();
                var old = Assert.IsType<OccReviewDetailData>(
                    await reviewStore.GetSubmissionDetailAsync(
                        operationId, handoffKey, [stationId], cancellationToken));
                var current = Assert.IsType<OccReviewDetailData>(
                    await reviewStore.GetDetailAsync(operationId, [stationId], cancellationToken));
                Assert.Null(await reviewStore.GetSubmissionHistoryAsync(
                    operationId, [Guid.Parse("20000000-0000-7000-8000-000000000013")],
                    cancellationToken));
                var history = Assert.IsType<OccReviewSubmissionHistoryData>(
                    await reviewStore.GetSubmissionHistoryAsync(
                        operationId, [stationId], cancellationToken));
                Assert.Equal([correctedHandoffKey, handoffKey],
                    history.Submissions.Select(item => item.SubmissionId).ToArray());
                Assert.Equal([2, 1], history.Submissions.Select(item => item.RevisionNumber).ToArray());
                Assert.Equal("Returned", history.Submissions[1].Outcome);
                Assert.Equal(1, old.RevisionNumber);
                Assert.Equal("Returned", old.Status);
                Assert.Equal(CorrectionReason, old.Decision?.Reason);
                Assert.Equal(SensitiveChecklistNote,
                    Assert.Single(old.ChecklistAnswers, item => item.Value == "NotOk").Note);
                Assert.Equal(1m, Assert.Single(old.Services,
                    service => service.Id == baggageServiceId).ExecutedQuantity);
                Assert.Equal(2, current.RevisionNumber);
                Assert.Equal("PendingReview", current.Status);
                Assert.All(current.ChecklistAnswers, answer => Assert.Equal("Ok", answer.Value));
                Assert.Equal(2m, Assert.Single(current.Services,
                    service => service.Id == baggageServiceId).ExecutedQuantity);
                Assert.Null(current.Decision);
            }
            await using var correctionCheck = CreateContext(database.ConnectionString);
            var revisionNumbers = await correctionCheck.OperationSubmissions.AsNoTracking()
                .Where(item => item.GroundOperationId == operationInternalId)
                .OrderBy(item => item.RevisionNumber)
                .Select(item => item.RevisionNumber)
                .ToArrayAsync(cancellationToken);
            Assert.Equal(2, revisionNumbers.Length);
            Assert.Equal(1, revisionNumbers[0]);
            Assert.Equal(2, revisionNumbers[1]);
            Assert.Equal(45, await correctionCheck.Set<ChecklistAnswer>().AsNoTracking()
                .CountAsync(item => item.OperationChecklistId == submittedChecklist.Id,
                    cancellationToken));
        }
    }

    [Fact]
    public async Task RampIncidentsAreScopedIdempotentAndKeepDescriptionOutOfAudit()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
        {
            await migration.Database.MigrateAsync(cancellationToken);
        }
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var connection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seeder = CreateContext(connection))
        {
            await new DevelopmentDataSeeder(seeder).SeedAsync(InitialPasswords, cancellationToken);
        }

        var accountId = Guid.Parse("40000000-0000-7000-8000-000000000002");
        var stationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
        var operationId = Guid.Parse("70000000-0000-7000-8000-000000000005");
        var installationId = Guid.Parse("81000000-0000-7000-8000-000000000031");
        var startKey = Guid.Parse("82000000-0000-7000-8000-000000000031");
        var incidentKey = Guid.Parse("83000000-0000-7000-8000-000000000031");
        const string sensitiveDescription = "SENSITIVE-INCIDENT-DESCRIPTION-NOT-FOR-AUDIT";
        await using var provider = CreateAuthenticationProvider(
            database.ConnectionString, new PasswordHashCounter());

        await using (var scope = provider.CreateAsyncScope())
        {
            var registration = await scope.ServiceProvider
                .GetRequiredService<IMobileDeviceCommandStore>()
                .RegisterAsync(new MobileDeviceRegistrationWriteRequest(
                    accountId, installationId, MobilePlatform.Android,
                    "1.2.3", "Incident SQL test tablet", "Android 16"), cancellationToken);
            Assert.True(registration.IsSuccess);
        }
        await using (var scope = provider.CreateAsyncScope())
        {
            var started = await scope.ServiceProvider
                .GetRequiredService<IRampOperationsCommandStore>()
                .StartOperationAsync(new RampOperationStartWriteRequest(
                    accountId, [stationId], operationId, installationId,
                    startKey, startKey, "incident-test-start"), cancellationToken);
            Assert.True(started.IsSuccess);
        }

        DateTimeOffset occurredAt;
        await using (var context = CreateContext(database.ConnectionString))
        {
            occurredAt = await context.GroundOperations
                .Where(item => item.PublicId == operationId)
                .Select(item => item.ActualStartAt!.Value)
                .SingleAsync(cancellationToken);
        }

        async Task<RampIncidentWriteResult> ReportAsync(Guid key, string description)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IRampIncidentStore>()
                .ReportAsync(new RampIncidentWriteRequest(
                    accountId, [stationId], operationId, "Safety", IncidentSeverity.High,
                    description, occurredAt, installationId, key, key,
                    "incident-sql-test"), cancellationToken);
        }

        var reported = await ReportAsync(incidentKey, sensitiveDescription);
        Assert.True(reported.IsSuccess);
        Assert.Equal(incidentKey, reported.Receipt!.IncidentId);
        Assert.Equal("Open", reported.Receipt.Status);

        var replay = await ReportAsync(incidentKey, sensitiveDescription);
        Assert.True(replay.IsSuccess);
        Assert.Equal(reported.Receipt, replay.Receipt);
        Assert.Equal(reported.CommitReceiptId, replay.CommitReceiptId);

        var collision = await ReportAsync(incidentKey, "Otro incidente distinto");
        Assert.Equal(RampOperationsFailure.Conflict, collision.Failure);
        Assert.Null(collision.CommitReceiptId);

        await using (var scope = provider.CreateAsyncScope())
        {
            var read = await scope.ServiceProvider.GetRequiredService<IRampIncidentStore>()
                .GetAsync(new RampIncidentReadRequest(
                    accountId, [stationId], operationId), cancellationToken);
            Assert.True(read.IsSuccess);
            Assert.Equal(sensitiveDescription, Assert.Single(read.Incidents!).Description);
            var outsideScope = await scope.ServiceProvider.GetRequiredService<IRampIncidentStore>()
                .GetAsync(new RampIncidentReadRequest(
                    accountId, [Guid.NewGuid()], operationId), cancellationToken);
            Assert.False(outsideScope.IsSuccess);
        }

        await using var verify = CreateContext(database.ConnectionString);
        Assert.Single(await verify.Incidents.Where(item => item.PublicId == incidentKey)
            .ToArrayAsync(cancellationToken));
        var audit = Assert.Single(await verify.AuditEntries.Where(item =>
            item.Action == "ramp.operation.incident.reported" &&
            item.EntityPublicId == incidentKey).ToArrayAsync(cancellationToken));
        Assert.DoesNotContain(sensitiveDescription, audit.MetadataJson ?? string.Empty, StringComparison.Ordinal);
        var receipt = Assert.Single(await verify.MobileCommandReceipts.Where(item =>
            item.IdempotencyKey == incidentKey.ToString("D")).ToArrayAsync(cancellationToken));
        Assert.Equal(MobileCommandStatus.Processed, receipt.Status);
        Assert.DoesNotContain(sensitiveDescription, receipt.ResultJson ?? string.Empty, StringComparison.Ordinal);
    }

    [Fact]
    public async Task OperationalMessagesAndNotificationsPersistWithScopedIdempotentAccess()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var connection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seeder = CreateContext(connection))
            await new DevelopmentDataSeeder(seeder).SeedAsync(InitialPasswords, cancellationToken);
        var occId = Guid.Parse("40000000-0000-7000-8000-000000000001");
        var agentId = Guid.Parse("40000000-0000-7000-8000-000000000002");
        var stationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
        var operationId = Guid.Parse("70000000-0000-7000-8000-000000000005");
        var installationId = Guid.Parse("81000000-0000-7000-8000-000000000051");
        var agentKey = Guid.Parse("82000000-0000-7000-8000-000000000051");
        var occKey = Guid.Parse("82000000-0000-7000-8000-000000000052");
        var occAccess = new OperationalAccess(occId, "occ", [stationId]);
        var agentAccess = new OperationalAccess(agentId, "agent", [stationId]);
        await using var provider = CreateAuthenticationProvider(
            database.ConnectionString, new PasswordHashCounter());

        await using (var scope = provider.CreateAsyncScope())
        {
            var registered = await scope.ServiceProvider.GetRequiredService<IMobileDeviceCommandStore>()
                .RegisterAsync(new MobileDeviceRegistrationWriteRequest(
                    agentId, installationId, MobilePlatform.Android,
                    "1.2.3", "Chat SQL test tablet", "Android 16"), cancellationToken);
            Assert.True(registered.IsSuccess);
        }

        async Task<CommunicationResult<OperationMessageData>> SendAsync(
            OperationalAccess access, Guid key, Guid? device, string content)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IOperationalCommunicationStore>()
                .SendMessageAsync(new SendOperationMessageCommand(
                    access, operationId, key, device, content), cancellationToken);
        }

        var first = await SendAsync(agentAccess, agentKey, installationId, "Llegué a la posición");
        Assert.True(first.IsSuccess);
        var replay = await SendAsync(agentAccess, agentKey, installationId, "Llegué a la posición");
        Assert.True(replay.IsSuccess);
        Assert.Equal(first.Value!.Id, replay.Value!.Id);
        var collision = await SendAsync(agentAccess, agentKey, installationId, "Otro mensaje");
        Assert.Equal(OperationalCommunicationFailure.Conflict, collision.Failure);
        var wrongDevice = await SendAsync(agentAccess, Guid.NewGuid(), Guid.NewGuid(), "No autorizado");
        Assert.Equal(OperationalCommunicationFailure.NotFound, wrongDevice.Failure);

        await using (var scope = provider.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<IOperationalCommunicationStore>();
            var occInbox = await store.GetNotificationsAsync(occAccess, cancellationToken);
            var notification = Assert.Single(occInbox.Value!.Notifications);
            Assert.Equal("agent_message", notification.Kind);
            Assert.Null(notification.ReadAt);
            var marked = await store.SetNotificationReadAsync(
                occAccess, notification.Id, true, cancellationToken);
            Assert.NotNull(marked.Value!.ReadAt);
            var replayedRead = await store.SetNotificationReadAsync(
                occAccess, notification.Id, true, cancellationToken);
            Assert.Equal(marked.Value.ReadAt, replayedRead.Value!.ReadAt);
            var forbiddenRead = await store.SetNotificationReadAsync(
                agentAccess, notification.Id, true, cancellationToken);
            Assert.Equal(OperationalCommunicationFailure.NotFound, forbiddenRead.Failure);
        }

        var reply = await SendAsync(occAccess, occKey, null, "Recibido, continúa con la operación");
        Assert.True(reply.IsSuccess);
        await using (var scope = provider.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<IOperationalCommunicationStore>();
            var agentMessages = await store.GetMessagesAsync(agentAccess, operationId, cancellationToken);
            Assert.Equal([first.Value!.Id, reply.Value!.Id],
                agentMessages.Value!.Messages.Select(message => message.Id));
            var occMessages = await store.GetMessagesAsync(occAccess, operationId, cancellationToken);
            Assert.Equal(2, occMessages.Value!.Messages.Count);
            var participants = await store.GetPresenceParticipantsAsync(occAccess, [operationId], cancellationToken);
            Assert.True(participants.IsSuccess);
            var roster = Assert.Single(participants.Value!.Operations);
            Assert.Equal(operationId, roster.OperationId);
            Assert.Contains(roster.Participants, person => person.AccountId == first.Value!.SenderAccountId);
            Assert.All(roster.Participants, person => Assert.False(string.IsNullOrWhiteSpace(person.Name)));
            var inaccessible = await store.GetPresenceParticipantsAsync(occAccess, [Guid.NewGuid()], cancellationToken);
            Assert.Empty(inaccessible.Value!.Operations);
            var olderMessages = await store.GetMessagesAsync(occAccess, operationId, cancellationToken: cancellationToken, offset: 1);
            Assert.Equal(first.Value!.Id, Assert.Single(olderMessages.Value!.Messages).Id);
            Assert.False(olderMessages.Value.HasMore);
            var exhaustedMessages = await store.GetMessagesAsync(occAccess, operationId, cancellationToken: cancellationToken, offset: 2);
            Assert.Empty(exhaustedMessages.Value!.Messages);
            var occConversations = await store.GetConversationsAsync(occAccess, stationId, cancellationToken);
            Assert.Contains(occConversations.Value!.Conversations, conversation =>
                conversation.OperationId == operationId &&
                conversation.LastMessage?.Id == reply.Value!.Id);
            var agentConversations = await store.GetConversationsAsync(agentAccess, null, cancellationToken);
            Assert.Contains(agentConversations.Value!.Conversations, conversation =>
                conversation.OperationId == operationId &&
                conversation.LastMessage?.Id == reply.Value!.Id);
            var outside = await store.GetMessagesAsync(
                new OperationalAccess(occId, "occ", [Guid.NewGuid()]),
                operationId, cancellationToken);
            Assert.Equal(OperationalCommunicationFailure.NotFound, outside.Failure);
            var agentInbox = await store.GetNotificationsAsync(agentAccess, cancellationToken);
            Assert.Equal("occ_message", Assert.Single(agentInbox.Value!.Notifications).Kind);
        }

        await using var verify = CreateContext(database.ConnectionString);
        Assert.Equal(2, await verify.OperationMessages.AsNoTracking()
            .CountAsync(cancellationToken));
        Assert.Equal(2, await verify.OperationalNotifications.AsNoTracking()
            .CountAsync(cancellationToken));
        var changeHints = await verify.OutboxMessages.AsNoTracking()
            .Where(message => message.EventType == "account.changed.v1")
            .ToArrayAsync(cancellationToken);
        // ADR-0029: each message also reaches the other participant, not only the sender.
        Assert.Equal(6, changeHints.Length);
        Assert.Equal(6, changeHints.Select(message => message.PublicId).Distinct().Count());
        Assert.DoesNotContain(changeHints, message =>
            message.PayloadJson.Contains("Llegu", StringComparison.Ordinal) ||
            message.PayloadJson.Contains("Recibido", StringComparison.Ordinal));
    }

    [Fact]
    public async Task AccountChangeMigrationGrantsOnlyRequiredInfraDmlToApplicationRole()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await using var connection = await database.OpenAsDevelopmentAppAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT CASE WHEN
                HAS_PERMS_BY_NAME(N'infra.outbox_messages', N'OBJECT', N'SELECT') = 1 AND
                HAS_PERMS_BY_NAME(N'infra.outbox_messages', N'OBJECT', N'INSERT') = 1 AND
                HAS_PERMS_BY_NAME(N'infra.outbox_messages', N'OBJECT', N'UPDATE') = 1 AND
                HAS_PERMS_BY_NAME(N'infra.outbox_messages', N'OBJECT', N'DELETE') = 0 AND
                HAS_PERMS_BY_NAME(N'infra.account_changes', N'OBJECT', N'SELECT') = 1 AND
                HAS_PERMS_BY_NAME(N'infra.account_changes', N'OBJECT', N'INSERT') = 1 AND
                HAS_PERMS_BY_NAME(N'infra.account_changes', N'OBJECT', N'UPDATE') = 0 AND
                HAS_PERMS_BY_NAME(N'infra.account_changes', N'OBJECT', N'DELETE') = 0
                THEN 1 ELSE 0 END;
            """;
        Assert.Equal(1, (int)(await command.ExecuteScalarAsync(cancellationToken) ?? -1));

        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using var lockCommand = connection.CreateCommand();
        lockCommand.Transaction = (SqlTransaction)transaction;
        lockCommand.CommandText = """
            DECLARE @result int;
            EXEC @result = sys.sp_getapplock
                @Resource = N'ElevantAccountChangeDispatch',
                @LockMode = N'Exclusive',
                @LockOwner = N'Transaction',
                @LockTimeout = 0;
            SELECT @result;
            """;
        Assert.True((int)(await lockCommand.ExecuteScalarAsync(cancellationToken) ?? -1) >= 0);
        await transaction.RollbackAsync(cancellationToken);
    }

    [Fact]
    public async Task AccountChangeDispatchOrdersCommittedFeedAndDoesNotReplayOutbox()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var connection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seeder = CreateContext(connection))
            await new DevelopmentDataSeeder(seeder).SeedAsync(InitialPasswords, cancellationToken);
        await database.ConfigureAccountChangeAppPermissionsAsync(cancellationToken);

        Guid firstOutboxId;
        Guid secondOutboxId;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var accountId = await setup.Users.Where(account => account.NormalizedEmail ==
                    "ADMIN.OCC@DEV.ELEVANT.TEST")
                .Select(account => account.Id).SingleAsync(cancellationToken);
            var stationId = await setup.Stations.Where(station => station.Code == "PUJ")
                .Select(station => station.Id).SingleAsync(cancellationToken);
            AccountChangeOutboxWriter.Add(setup, accountId, stationId,
                "notifications", Guid.NewGuid(), DateTimeOffset.UtcNow);
            AccountChangeOutboxWriter.Add(setup, accountId, stationId,
                "operation_messages", Guid.NewGuid(), DateTimeOffset.UtcNow);
            var pending = setup.ChangeTracker.Entries<OutboxMessage>()
                .Select(entry => entry.Entity).ToArray();
            firstOutboxId = pending[0].PublicId;
            secondOutboxId = pending[1].PublicId;
            pending[0].ProcessedAt = DateTimeOffset.UtcNow;
            await setup.SaveChangesAsync(cancellationToken);
        }

        async Task<IReadOnlyList<AccountChangeDispatchNotice>> DispatchAsync()
        {
            await using var connection = await database.OpenAsDevelopmentAppAsync(cancellationToken);
            await using var appContext = CreateContext(connection);
            return await new EfAccountChangeDispatcherStore(appContext, TimeProvider.System)
                .DispatchPendingAsync(10, cancellationToken);
        }

        var second = Assert.Single(await DispatchAsync());
        Assert.Equal(secondOutboxId, second.OutboxPublicId);
        Assert.Empty(await DispatchAsync());

        var malformedId = Guid.NewGuid();
        await using (var setup = CreateContext(database.ConnectionString))
        {
            setup.OutboxMessages.Add(new OutboxMessage
            {
                PublicId = malformedId,
                EventType = "account.changed.v1",
                PayloadJson = "{invalid-json",
                OccurredAt = DateTimeOffset.UtcNow,
            });
            await setup.SaveChangesAsync(cancellationToken);
        }
        Assert.Empty(await DispatchAsync());
        Assert.Empty(await DispatchAsync());
        Assert.Empty(await DispatchAsync());
        Assert.Empty(await DispatchAsync());
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var earlier = await setup.OutboxMessages.SingleAsync(
                message => message.PublicId == firstOutboxId, cancellationToken);
            earlier.ProcessedAt = null;
            await setup.SaveChangesAsync(cancellationToken);
        }
        var first = Assert.Single(await DispatchAsync());
        Assert.Equal(firstOutboxId, first.OutboxPublicId);
        Assert.True(first.Sequence > second.Sequence);
        Assert.Empty(await DispatchAsync());

        await using (var setup = CreateContext(database.ConnectionString))
        {
            var replayedSource = await setup.OutboxMessages.SingleAsync(
                message => message.PublicId == secondOutboxId, cancellationToken);
            replayedSource.ProcessedAt = null;
            await setup.SaveChangesAsync(cancellationToken);
        }
        Assert.Empty(await DispatchAsync());

        await using var verify = CreateContext(database.ConnectionString);
        Assert.Equal(2, await verify.AccountChanges.CountAsync(cancellationToken));
        Assert.Equal(2, await verify.OutboxMessages
            .CountAsync(message => message.EventType == "account.changed.v1" &&
                message.ProcessedAt != null && message.LastError == null, cancellationToken));
        var malformed = await verify.OutboxMessages.AsNoTracking().SingleAsync(
            message => message.PublicId == malformedId, cancellationToken);
        Assert.Equal(3, malformed.AttemptCount);
        Assert.NotNull(malformed.ProcessedAt);
        Assert.Equal("Invalid account change payload", malformed.LastError);
    }

    [Fact]
    public async Task AccountChangeReadRechecksRecipientRevokedStationAndAirlineMembership()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var connection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seeder = CreateContext(connection))
            await new DevelopmentDataSeeder(seeder).SeedAsync(InitialPasswords, cancellationToken);

        var occPublicId = Guid.Parse("40000000-0000-7000-8000-000000000001");
        var agentPublicId = Guid.Parse("40000000-0000-7000-8000-000000000002");
        var airlinePublicId = Guid.Parse("40000000-0000-7000-8000-000000000003");
        var hrPublicId = Guid.Parse("40000000-0000-7000-8000-000000000004");
        long occInternalId;
        long airlineInternalId;
        long hrInternalId;
        long stationInternalId;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            occInternalId = await setup.Users.Where(account => account.PublicId == occPublicId)
                .Select(account => account.Id).SingleAsync(cancellationToken);
            var agentInternalId = await setup.Users.Where(account => account.PublicId == agentPublicId)
                .Select(account => account.Id).SingleAsync(cancellationToken);
            airlineInternalId = await setup.Users.Where(account => account.PublicId == airlinePublicId)
                .Select(account => account.Id).SingleAsync(cancellationToken);
            hrInternalId = await setup.Users.Where(account => account.PublicId == hrPublicId)
                .Select(account => account.Id).SingleAsync(cancellationToken);
            var contractsRoleId = await setup.Roles.Where(role => role.NormalizedName == "CONTRATOS")
                .Select(role => role.Id).SingleAsync(cancellationToken);
            setup.Set<IdentityUserRole<long>>().Add(new IdentityUserRole<long>
                { UserId = hrInternalId, RoleId = contractsRoleId });
            setup.Set<IdentityUserRole<long>>().Add(new IdentityUserRole<long>
                { UserId = occInternalId, RoleId = contractsRoleId });
            stationInternalId = await setup.Stations.Where(station => station.Code == "PUJ")
                .Select(station => station.Id).SingleAsync(cancellationToken);
            var stationPublicId = await setup.Stations.Where(station => station.Id == stationInternalId)
                .Select(station => station.PublicId).SingleAsync(cancellationToken);
            var now = DateTimeOffset.UtcNow;
            foreach (var (recipient, resource) in new[]
            {
                (occInternalId, "notifications"),
                (occInternalId, "operation_messages"),
                (occInternalId, "occ_planning"),
                (agentInternalId, "notifications"),
            })
            {
                setup.AccountChanges.Add(new AccountChange
                {
                    PublicId = Guid.NewGuid(),
                    OutboxPublicId = Guid.NewGuid(),
                    RecipientAccountId = recipient,
                    StationId = stationInternalId,
                    Resource = resource,
                    ResourceId = resource == "occ_planning" ? stationPublicId : Guid.NewGuid(),
                    OccurredAt = now,
                    CreatedAt = now,
                });
            }
            setup.AccountChanges.Add(new AccountChange
            {
                PublicId = Guid.NewGuid(),
                OutboxPublicId = Guid.NewGuid(),
                RecipientAccountId = airlineInternalId,
                Resource = "airline_operations",
                ResourceId = Guid.Parse("70000000-0000-7000-8000-000000000005"),
                OccurredAt = now,
                CreatedAt = now,
            });
            foreach (var resource in new[]
                { "hr_qualifications", "hr_shifts", "hr_permits", "hr_absences" })
                setup.AccountChanges.Add(new AccountChange
                {
                    PublicId = Guid.NewGuid(),
                    OutboxPublicId = Guid.NewGuid(),
                    RecipientAccountId = hrInternalId,
                    Resource = resource,
                    ResourceId = Guid.NewGuid(),
                    OccurredAt = now,
                    CreatedAt = now,
                });
            await setup.SaveChangesAsync(cancellationToken);
        }

        await using var provider = CreateAuthenticationProvider(
            database.ConnectionString, new PasswordHashCounter());
        async Task<AccountChangePage?> ReadAsync(Guid accountId, long after, int limit)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IAccountChangeReadStore>()
                .ReadAsync(accountId, after, limit, cancellationToken);
        }

        var first = await ReadAsync(occPublicId, 0, 1);
        Assert.NotNull(first);
        Assert.Single(first.Changes);
        Assert.True(first.HasMore);
        var next = await ReadAsync(occPublicId, first.Changes[0].Sequence, 10);
        Assert.NotNull(next);
        Assert.Equal(2, next.Changes.Count);
        Assert.Contains(next.Changes, item => item.Resource == "occ_planning");
        Assert.False(next.HasMore);
        var agent = await ReadAsync(agentPublicId, 0, 10);
        Assert.NotNull(agent);
        Assert.Single(agent.Changes);
        Assert.NotEqual(first.Changes[0].EventId, agent.Changes[0].EventId);
        var airline = await ReadAsync(airlinePublicId, 0, 10);
        Assert.NotNull(airline);
        Assert.Single(airline.Changes);
        var humanResources = await ReadAsync(hrPublicId, 0, 10);
        Assert.NotNull(humanResources);
        Assert.Equal(4, humanResources.Changes.Count);

        await using (var revokeRole = CreateContext(database.ConnectionString))
        {
            var occRoleId = await revokeRole.Roles.Where(role => role.NormalizedName == "ADMIN_OCC")
                .Select(role => role.Id).SingleAsync(cancellationToken);
            await revokeRole.Set<IdentityUserRole<long>>().Where(link =>
                link.UserId == occInternalId && link.RoleId == occRoleId)
                .ExecuteDeleteAsync(cancellationToken);
        }
        var afterRoleRevoke = await ReadAsync(occPublicId, 0, 10);
        Assert.NotNull(afterRoleRevoke);
        Assert.DoesNotContain(afterRoleRevoke.Changes, item => item.Resource == "occ_planning");
        Assert.Equal(2, afterRoleRevoke.Changes.Count);

        await using (var setup = CreateContext(database.ConnectionString))
        {
            var scope = await setup.AccountStationScopes.SingleAsync(item =>
                item.AccountId == occInternalId && item.StationId == stationInternalId,
                cancellationToken);
            scope.RevokedAt = DateTimeOffset.UtcNow;
            var airlineMembership = await setup.OrganizationMemberships.SingleAsync(item =>
                item.AccountId == airlineInternalId && item.Kind == MembershipKind.AirlineClient,
                cancellationToken);
            airlineMembership.Status = MembershipStatus.Ended;
            var hrRoleId = await setup.Roles.Where(role => role.NormalizedName == "GESTION_HUMANA")
                .Select(role => role.Id).SingleAsync(cancellationToken);
            await setup.Set<IdentityUserRole<long>>().Where(link =>
                link.UserId == hrInternalId && link.RoleId == hrRoleId)
                .ExecuteDeleteAsync(cancellationToken);
            var internalOrganizationId = await setup.Organizations
                .Where(item => item.Type == OrganizationType.AviamOperator)
                .Select(item => item.Id).SingleAsync(cancellationToken);
            setup.OrganizationMemberships.Add(new OrganizationMembership
            {
                PublicId = Guid.NewGuid(),
                AccountId = airlineInternalId,
                OrganizationId = internalOrganizationId,
                Kind = MembershipKind.InternalStaff,
                Status = MembershipStatus.Active,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await setup.SaveChangesAsync(cancellationToken);
        }
        var afterRevoke = await ReadAsync(occPublicId, 0, 10);
        Assert.NotNull(afterRevoke);
        Assert.Empty(afterRevoke.Changes);
        var airlineAfterRevoke = await ReadAsync(airlinePublicId, 0, 10);
        Assert.NotNull(airlineAfterRevoke);
        Assert.Empty(airlineAfterRevoke.Changes);
        var hrAfterRevoke = await ReadAsync(hrPublicId, 0, 10);
        Assert.NotNull(hrAfterRevoke);
        Assert.Empty(hrAfterRevoke.Changes);
    }

    [Fact]
    public async Task RampOperationsReadStoreDerivesAgentAndEnforcesAssignmentAndStationScope()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null)
        {
            return;
        }

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection,
            "Development",
            cancellationToken);
        await using (var migrationContext = CreateContext(database.ConnectionString))
        {
            await migrationContext.Database.MigrateAsync(cancellationToken);
        }

        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seederContext = CreateContext(seederConnection))
        {
            await new DevelopmentDataSeeder(seederContext)
                .SeedAsync(InitialPasswords, cancellationToken);
        }

        var accountId = Guid.Parse("40000000-0000-7000-8000-000000000002");
        var accountWithoutProfileId = Guid.Parse("40000000-0000-7000-8000-000000000001");
        var agentId = Guid.Parse("50000000-0000-7000-8000-000000000001");
        var stationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
        var otherStationId = Guid.Parse("91000000-0000-7000-8000-000000000001");
        var otherStationOperationId = Guid.Parse("91000000-0000-7000-8000-000000000003");
        var instant = new DateTimeOffset(2026, 8, 19, 10, 0, 0, TimeSpan.Zero);

        await using (var setupContext = CreateContext(database.ConnectionString))
        {
            var agent = await setupContext.RampAgents
                .SingleAsync(item => item.PublicId == agentId, cancellationToken);
            var position = await setupContext.OperationalPositions
                .SingleAsync(item => item.Code == "RAMP-AGENT", cancellationToken);
            var airline = await setupContext.Airlines
                .SingleAsync(item => item.IataCode == "ZZ", cancellationToken);
            var releasedOperation = await (
                    from operation in setupContext.GroundOperations
                    join turnaround in setupContext.Turnarounds
                        on operation.TurnaroundId equals turnaround.Id
                    where turnaround.OperationCode == "DEV-TAT-0002"
                    select operation)
                .SingleAsync(cancellationToken);
            var otherAgentPersonId = await setupContext.Users
                .Where(item => item.PublicId ==
                    Guid.Parse("40000000-0000-7000-8000-000000000003"))
                .Select(item => item.PersonId)
                .SingleAsync(cancellationToken);

            var otherAgent = NewTestAgent(
                otherAgentPersonId,
                "DEV-RA-OTHER",
                "91000000-0000-7000-8000-000000000004",
                instant);
            var otherAirport = new Airport
            {
                PublicId = Guid.Parse("91000000-0000-7000-8000-000000000008"),
                IataCode = "OTH",
                IcaoCode = "MDOT",
                Name = "Other test airport",
                City = "Test city",
                CountryCode = "DO",
                CreatedAt = instant,
                UpdatedAt = instant,
            };
            setupContext.RampAgents.Add(otherAgent);
            setupContext.Airports.Add(otherAirport);
            await setupContext.SaveChangesAsync(cancellationToken);

            setupContext.OperationAgentAssignments.AddRange(
                new OperationAgentAssignment
                {
                    PublicId = Guid.Parse("91000000-0000-7000-8000-000000000005"),
                    GroundOperationId = releasedOperation.Id,
                    RampAgentId = agent.Id,
                    OperationalPositionId = position.Id,
                    AssignmentRole = "released-test",
                    AssignedAt = instant,
                    ReleasedAt = instant.AddMinutes(5),
                    CreatedAt = instant,
                    UpdatedAt = instant.AddMinutes(5),
                },
                new OperationAgentAssignment
                {
                    PublicId = Guid.Parse("91000000-0000-7000-8000-000000000006"),
                    GroundOperationId = releasedOperation.Id,
                    RampAgentId = otherAgent.Id,
                    OperationalPositionId = position.Id,
                    AssignmentRole = "other-agent-test",
                    AssignedAt = instant,
                    CreatedAt = instant,
                    UpdatedAt = instant,
                });

            var otherStation = new Station
            {
                PublicId = otherStationId,
                AirportId = otherAirport.Id,
                Code = "OTH",
                Name = "Other test station",
                IanaTimeZone = "America/Santo_Domingo",
                IsActive = true,
                CreatedAt = instant,
                UpdatedAt = instant,
            };
            setupContext.Stations.Add(otherStation);
            await setupContext.SaveChangesAsync(cancellationToken);

            var otherTurnaround = new Turnaround
            {
                PublicId = Guid.Parse("91000000-0000-7000-8000-000000000002"),
                OperationCode = "RAMP-OTHER-STATION",
                AirlineId = airline.Id,
                StationId = otherStation.Id,
                OperationDate = new DateOnly(2026, 8, 20),
                CurrentStatus = TurnaroundStatus.Confirmed,
                Source = OperationalDataSource.Internal,
                CreatedAt = instant,
                UpdatedAt = instant,
            };
            setupContext.Turnarounds.Add(otherTurnaround);
            await setupContext.SaveChangesAsync(cancellationToken);

            var otherOperation = new GroundOperation
            {
                PublicId = otherStationOperationId,
                TurnaroundId = otherTurnaround.Id,
                CurrentStatus = GroundOperationStatus.Assigned,
                PlannedStartAt = instant.AddDays(1),
                PlannedEndAt = instant.AddDays(1).AddHours(1),
                CreatedAt = instant,
                UpdatedAt = instant,
            };
            setupContext.GroundOperations.Add(otherOperation);
            await setupContext.SaveChangesAsync(cancellationToken);

            setupContext.OperationAgentAssignments.Add(new OperationAgentAssignment
            {
                PublicId = Guid.Parse("91000000-0000-7000-8000-000000000007"),
                GroundOperationId = otherOperation.Id,
                RampAgentId = agent.Id,
                AssignmentRole = "other-station-test",
                AssignedAt = instant,
                CreatedAt = instant,
                UpdatedAt = instant,
            });
            await setupContext.SaveChangesAsync(cancellationToken);
        }

        await using var provider = CreateAuthenticationProvider(
            database.ConnectionString,
            new PasswordHashCounter());

        await using (var scope = provider.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<IRampOperationsReadStore>();

            var emptyScope = await store.GetActiveAssignedOperationsAsync(
                Guid.NewGuid(),
                [],
                cancellationToken);
            Assert.True(emptyScope.IsSuccess);
            Assert.Empty(emptyScope.Operations!);

            var missingProfile = await store.GetActiveAssignedOperationsAsync(
                accountWithoutProfileId,
                [stationId],
                cancellationToken);
            Assert.False(missingProfile.IsSuccess);
            Assert.Equal(
                RampOperationsReadFailure.AgentProfileUnavailable,
                missingProfile.Failure);

            var agentIdentifierIsNotAnAccount = await store.GetActiveAssignedOperationsAsync(
                agentId,
                [stationId],
                cancellationToken);
            Assert.False(agentIdentifierIsNotAnAccount.IsSuccess);
            Assert.Equal(
                RampOperationsReadFailure.AgentProfileUnavailable,
                agentIdentifierIsNotAnAccount.Failure);

            var ownStation = await store.GetActiveAssignedOperationsAsync(
                accountId,
                [Guid.Empty, stationId, stationId],
                cancellationToken);
            Assert.True(ownStation.IsSuccess);
            var operation = Assert.Single(ownStation.Operations!);
            Assert.Equal(agentId, operation.Assignment.AgentId);
            Assert.Equal("primary", operation.Assignment.AssignmentRole);
            Assert.Equal("RAMP-AGENT", operation.Assignment.Position?.Code);
            Assert.Equal("Assigned", operation.Operation.Status);
            Assert.Equal("DEV-TAT-0001", operation.Turnaround.OperationCode);
            Assert.Equal(stationId, operation.Turnaround.Station.Id);
            Assert.Equal("ZZ", operation.Turnaround.Airline.IataCode);
            Assert.Equal("A320", operation.Turnaround.Aircraft?.IcaoCode);
            Assert.Equal("HI-DEV", operation.Turnaround.Aircraft?.Registration);
            Assert.Equal("A01", operation.Turnaround.Stand?.Code);
            Assert.Equal("A", operation.Turnaround.Stand?.Terminal?.Code);
            Assert.Equal("ZZ100", operation.Turnaround.Arrival?.FlightNumber);
            Assert.Equal("ZZ101", operation.Turnaround.Departure?.FlightNumber);
            Assert.Collection(
                operation.Services,
                baggage =>
                {
                    Assert.Equal(1, baggage.LineNumber);
                    Assert.Equal("BAGGAGE", baggage.Code);
                },
                passengerBridge =>
                {
                    Assert.Equal(2, passengerBridge.LineNumber);
                    Assert.Equal("PASSENGER-BRIDGE", passengerBridge.Code);
                });

            var otherStation = await store.GetActiveAssignedOperationsAsync(
                accountId,
                [otherStationId],
                cancellationToken);
            Assert.True(otherStation.IsSuccess);
            Assert.Empty(otherStation.Operations!);
        }

        long rampAgentInternalId;
        DateOnly ownOperationDate;
        await using (var authorizationContext = CreateContext(database.ConnectionString))
        {
            rampAgentInternalId = await authorizationContext.RampAgents
                .Where(item => item.PublicId == agentId)
                .Select(item => item.Id)
                .SingleAsync(cancellationToken);
            ownOperationDate = await authorizationContext.Turnarounds
                .Where(item => item.OperationCode == "DEV-TAT-0001")
                .Select(item => item.OperationDate)
                .SingleAsync(cancellationToken);
            await authorizationContext.Set<RampAgentStationScope>()
                .Where(item => item.RampAgentId == rampAgentInternalId && item.ValidTo == null)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(
                        item => item.ValidTo,
                        ownOperationDate.AddDays(-1)),
                    cancellationToken);
        }

        await using (var scope = provider.CreateAsyncScope())
        {
            var expiredStationScope = await scope.ServiceProvider
                .GetRequiredService<IRampOperationsReadStore>()
                .GetActiveAssignedOperationsAsync(accountId, [stationId], cancellationToken);
            Assert.True(expiredStationScope.IsSuccess);
            Assert.Empty(expiredStationScope.Operations!);
        }

        await using (var authorizationContext = CreateContext(database.ConnectionString))
        {
            await authorizationContext.Set<RampAgentStationScope>()
                .Where(item => item.RampAgentId == rampAgentInternalId)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(item => item.ValidTo, (DateOnly?)null),
                    cancellationToken);
            await authorizationContext.Set<RampAgentTerminalScope>()
                .Where(item => item.RampAgentId == rampAgentInternalId && item.ValidTo == null)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(
                        item => item.ValidTo,
                        ownOperationDate.AddDays(-1)),
                    cancellationToken);
        }

        await using (var scope = provider.CreateAsyncScope())
        {
            var expiredTerminalScope = await scope.ServiceProvider
                .GetRequiredService<IRampOperationsReadStore>()
                .GetActiveAssignedOperationsAsync(accountId, [stationId], cancellationToken);
            Assert.True(expiredTerminalScope.IsSuccess);
            Assert.Empty(expiredTerminalScope.Operations!);
        }

        await using (var authorizationContext = CreateContext(database.ConnectionString))
        {
            await authorizationContext.Set<RampAgentTerminalScope>()
                .Where(item => item.RampAgentId == rampAgentInternalId)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(item => item.ValidTo, (DateOnly?)null),
                    cancellationToken);
        }

        await using (var profileContext = CreateContext(database.ConnectionString))
        {
            await profileContext.RampAgents
                .Where(item => item.PublicId == agentId)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(item => item.IsActive, false),
                    cancellationToken);
        }

        await using (var scope = provider.CreateAsyncScope())
        {
            var inactiveProfile = await scope.ServiceProvider
                .GetRequiredService<IRampOperationsReadStore>()
                .GetActiveAssignedOperationsAsync(
                    accountId,
                    [stationId],
                    cancellationToken);
            Assert.False(inactiveProfile.IsSuccess);
            Assert.Equal(
                RampOperationsReadFailure.AgentProfileUnavailable,
                inactiveProfile.Failure);
        }

        await using (var ambiguousProfileContext = CreateContext(database.ConnectionString))
        {
            await ambiguousProfileContext.RampAgents
                .Where(item => item.PublicId == agentId)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(item => item.IsActive, true),
                    cancellationToken);
            await ambiguousProfileContext.Database.ExecuteSqlRawAsync(
                "DROP INDEX [IX_ramp_agents_person_id] ON [hr].[ramp_agents];",
                cancellationToken);
            var personId = await ambiguousProfileContext.Users
                .Where(item => item.PublicId == accountId)
                .Select(item => item.PersonId)
                .SingleAsync(cancellationToken);
            ambiguousProfileContext.RampAgents.Add(NewTestAgent(
                personId,
                "DEV-RA-AMBIGUOUS",
                "91000000-0000-7000-8000-000000000009",
                instant));
            await ambiguousProfileContext.SaveChangesAsync(cancellationToken);
        }

        await using (var scope = provider.CreateAsyncScope())
        {
            var ambiguousProfile = await scope.ServiceProvider
                .GetRequiredService<IRampOperationsReadStore>()
                .GetActiveAssignedOperationsAsync(
                    accountId,
                    [stationId],
                    cancellationToken);
            Assert.False(ambiguousProfile.IsSuccess);
            Assert.Equal(
                RampOperationsReadFailure.AgentProfileUnavailable,
                ambiguousProfile.Failure);
        }
    }

    [Fact]
    public async Task FinancialPdfMetadataSurvivesConcurrentReadersAndRejectsCorruptedPrivateBytes()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var connection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seeder = CreateContext(connection))
            await new DevelopmentDataSeeder(seeder).SeedAsync(InitialPasswords, cancellationToken);

        var now = new DateTimeOffset(2026, 9, 28, 17, 0, 0, TimeSpan.Zero);
        var preinvoiceId = Guid.NewGuid();
        var invoiceId = Guid.NewGuid();
        var paymentId = Guid.NewGuid();
        long invoiceKey;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var airline = await setup.Airlines.FirstAsync(cancellationToken);
            var station = await setup.Stations.FirstAsync(item => item.Code == "PUJ", cancellationToken);
            var account = await setup.Users.FirstAsync(item =>
                item.NormalizedEmail == "FINANZAS@DEV.ELEVANT.TEST", cancellationToken);
            var preinvoice = new Preinvoice
            {
                PublicId = preinvoiceId, AirlineId = airline.Id, StationId = station.Id,
                CreatedByAccountId = account.Id, RequestId = Guid.NewGuid(),
                PayloadHash = new string('a', 64), From = new DateOnly(2026, 9, 28),
                To = new DateOnly(2026, 9, 28), CurrencyCode = "USD", Total = 125.50m,
                Status = PreinvoiceStatus.Invoiced, CreatedAt = now, UpdatedAt = now,
            };
            setup.Preinvoices.Add(preinvoice);
            await setup.SaveChangesAsync(cancellationToken);
            var invoice = new NonFiscalInvoice
            {
                PublicId = invoiceId, PreinvoiceId = preinvoice.Id,
                AirlineId = airline.Id, StationId = station.Id,
                IssuedByAccountId = account.Id, RequestId = Guid.NewGuid(),
                Number = $"NF-{invoiceId:N}", CurrencyCode = "USD", Total = 125.50m,
                CreatedAt = now, UpdatedAt = now,
            };
            setup.NonFiscalInvoices.Add(invoice);
            await setup.SaveChangesAsync(cancellationToken);
            invoiceKey = invoice.Id;
            setup.NonFiscalPayments.Add(new NonFiscalPayment
            {
                PublicId = paymentId, InvoiceId = invoice.Id,
                RecordedByAccountId = account.Id, RequestId = Guid.NewGuid(),
                Reference = "SYNTHETIC-PAY-001", CurrencyCode = "USD", Amount = 125.50m,
                CreatedAt = now, UpdatedAt = now,
            });
            await setup.SaveChangesAsync(cancellationToken);
        }

        var invoiceData = new NonFiscalInvoiceData(invoiceId, preinvoiceId,
            Guid.NewGuid(), Guid.NewGuid(), $"NF-{invoiceId:N}", "USD", 125.50m, now, []);
        var paymentData = new NonFiscalPaymentData(paymentId, invoiceId,
            "SYNTHETIC-PAY-001", "USD", 125.50m, now);
        await using (var failingContext = CreateContext(database.ConnectionString))
        {
            var renderingFailure = new EfFinancialDocumentStore(failingContext,
                new InMemoryFinancialObjects(), new ThrowingFinancialPdfRenderer(),
                TimeProvider.System);
            var failure = await Assert.ThrowsAsync<FinancialDocumentUnavailableException>(() =>
                renderingFailure.OpenInvoiceAsync(invoiceData, cancellationToken));
            Assert.Equal(FinancialDocumentFailureStage.Rendering, failure.Stage);
            Assert.IsType<InvalidOperationException>(failure.InnerException);
        }
        await using (var failingContext = CreateContext(database.ConnectionString))
        {
            var storageFailure = new EfFinancialDocumentStore(failingContext,
                new InMemoryFinancialObjects(failPuts: true),
                new SyntheticFinancialPdfRenderer(), TimeProvider.System);
            var failure = await Assert.ThrowsAsync<FinancialDocumentUnavailableException>(() =>
                storageFailure.OpenInvoiceAsync(invoiceData, cancellationToken));
            Assert.Equal(FinancialDocumentFailureStage.StorageWrite, failure.Stage);
            Assert.IsType<InvalidOperationException>(failure.InnerException);
        }
        var objects = new InMemoryFinancialObjects(holdFirstTwoPuts: true);
        var renderer = new SyntheticFinancialPdfRenderer();
        await using var firstContext = CreateContext(database.ConnectionString);
        await using var secondContext = CreateContext(database.ConnectionString);
        var first = new EfFinancialDocumentStore(firstContext, objects, renderer, TimeProvider.System);
        var second = new EfFinancialDocumentStore(secondContext, objects, renderer, TimeProvider.System);
        var concurrent = await Task.WhenAll(
            first.OpenInvoiceAsync(invoiceData, cancellationToken),
            second.OpenInvoiceAsync(invoiceData, cancellationToken));
        Assert.Equal(concurrent[0].Id, concurrent[1].Id);
        Assert.Single(objects.Keys);

        await using var inspection = CreateContext(database.ConnectionString);
        var invoiceRow = Assert.Single(await inspection.FinancialDocuments.AsNoTracking()
            .Where(item => item.InvoiceId == invoiceKey && item.Kind == "Invoice")
            .ToArrayAsync(cancellationToken));
        Assert.Equal(concurrent[0].Sha256, invoiceRow.Sha256);
        var receipt = await first.OpenReceiptAsync(paymentData, invoiceData.Number,
            cancellationToken);
        Assert.Equal("Receipt", receipt.Kind);
        Assert.Equal(2, await inspection.FinancialDocuments.CountAsync(cancellationToken));

        await using var restartedContext = CreateContext(database.ConnectionString);
        var restarted = new EfFinancialDocumentStore(restartedContext, objects,
            renderer, TimeProvider.System);
        Assert.Equal(concurrent[0].Content,
            (await restarted.OpenInvoiceAsync(invoiceData, cancellationToken)).Content);
        objects.Corrupt(invoiceRow.ObjectKey);
        await Assert.ThrowsAsync<FinancialDocumentUnavailableException>(() =>
            restarted.OpenInvoiceAsync(invoiceData, cancellationToken));
        Assert.Equal(2, await inspection.FinancialDocuments.CountAsync(cancellationToken));
    }

    private sealed class InMemoryFinancialObjects(bool holdFirstTwoPuts = false,
        bool failPuts = false)
        : IPrivateFinancialObjectStore
    {
        private readonly ConcurrentDictionary<string, byte[]> _objects = new();
        private readonly TaskCompletionSource bothPutsStarted = new(
            TaskCreationOptions.RunContinuationsAsynchronously);
        private int putCount;

        public string[] Keys => _objects.Keys.ToArray();

        public async Task PutAsync(string key, byte[] content,
            CancellationToken cancellationToken = default)
        {
            if (failPuts) throw new InvalidOperationException("Synthetic object-store failure.");
            _objects[key] = content;
            var count = Interlocked.Increment(ref putCount);
            if (holdFirstTwoPuts && count <= 2)
            {
                if (count == 2) bothPutsStarted.TrySetResult();
                await bothPutsStarted.Task.WaitAsync(TimeSpan.FromSeconds(10), cancellationToken);
            }
        }

        public Task<byte[]?> GetAsync(string key,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(_objects.TryGetValue(key, out var bytes) ? bytes : null);

        public Task DeleteAsync(string key, CancellationToken cancellationToken = default)
        {
            _objects.TryRemove(key, out _);
            return Task.CompletedTask;
        }

        public void Corrupt(string key) => _objects[key] = "%PDF-corrupted"u8.ToArray();
    }

    private sealed class SyntheticFinancialPdfRenderer : IFinancialDocumentPdfRenderer
    {
        public byte[] RenderInvoice(NonFiscalInvoiceData invoice) =>
            System.Text.Encoding.UTF8.GetBytes($"%PDF-1.7\nInvoice {invoice.Number}\n%%EOF");

        public byte[] RenderReceipt(NonFiscalPaymentData payment, string invoiceNumber) =>
            System.Text.Encoding.UTF8.GetBytes(
                $"%PDF-1.7\nReceipt {payment.Reference} {invoiceNumber}\n%%EOF");

        public byte[] RenderReport(FinanceReportData report, string filterSummary) =>
            System.Text.Encoding.UTF8.GetBytes($"%PDF-1.7\nReport {report.Key}\n%%EOF");
    }

    private sealed class ThrowingFinancialPdfRenderer : IFinancialDocumentPdfRenderer
    {
        public byte[] RenderInvoice(NonFiscalInvoiceData invoice) =>
            throw new InvalidOperationException("Synthetic renderer failure.");

        public byte[] RenderReceipt(NonFiscalPaymentData payment, string invoiceNumber) =>
            throw new InvalidOperationException("Synthetic renderer failure.");

        public byte[] RenderReport(FinanceReportData report, string filterSummary) =>
            throw new InvalidOperationException("Synthetic renderer failure.");
    }

    private static ServiceProvider CreateAuthenticationProvider(
        string connectionString,
        PasswordHashCounter passwordCounter)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ElevantDatabase"] = connectionString,
            })
            .Build();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(TimeProvider.System);
        services.AddPersistence(configuration);
        services.AddSingleton(passwordCounter);
        services.AddScoped<IPasswordHasher<ApplicationUser>>(_ =>
            new CountingPasswordHasher(passwordCounter));
        return services.BuildServiceProvider(new ServiceProviderOptions
        {
            ValidateOnBuild = true,
            ValidateScopes = true,
        });
    }

    private static async Task<VerifiedCredential?> VerifyAsync(
        ServiceProvider provider,
        string email,
        string password,
        CancellationToken cancellationToken)
    {
        await using var scope = provider.CreateAsyncScope();
        return await scope.ServiceProvider
            .GetRequiredService<ICredentialVerifier>()
            .VerifyAsync(email, password, cancellationToken);
    }

    private static async Task<ActorContext?> ResolveActorAsync(
        ServiceProvider provider,
        Guid accountId,
        CancellationToken cancellationToken)
    {
        await using var scope = provider.CreateAsyncScope();
        return await scope.ServiceProvider
            .GetRequiredService<IActorContextResolver>()
            .ResolveAsync(accountId, cancellationToken);
    }

    private static async Task UpdateAccountPublicIdAsync(
        string connectionString,
        long? accountId,
        Guid publicId,
        CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = accountId is null
            ? "UPDATE [iam].[accounts] SET [public_id] = @publicId WHERE [normalized_email] = N'ADMIN.OCC@DEV.ELEVANT.TEST';"
            : "UPDATE [iam].[accounts] SET [public_id] = @publicId WHERE [id] = @accountId;";
        command.Parameters.AddWithValue("@publicId", publicId);
        if (accountId is not null)
        {
            command.Parameters.AddWithValue("@accountId", accountId.Value);
        }

        Assert.Equal(1, await command.ExecuteNonQueryAsync(cancellationToken));
    }

    private sealed class PasswordHashCounter
    {
        private PasswordVerificationGate? verificationGate;
        private int verificationCount;

        public int VerificationCount => Volatile.Read(ref verificationCount);

        public void Count() => Interlocked.Increment(ref verificationCount);

        public PasswordVerificationGate PauseOnceAfterVerification()
        {
            var gate = new PasswordVerificationGate();
            if (Interlocked.CompareExchange(ref verificationGate, gate, null) is not null)
            {
                gate.Dispose();
                throw new InvalidOperationException("A password verification gate is already armed.");
            }

            return gate;
        }

        public void CompleteVerification(
            ApplicationUser user,
            PasswordVerificationResult result) =>
            Interlocked.Exchange(ref verificationGate, null)?.Pause(user.Id, result);
    }

    private sealed class PasswordVerificationGate : IDisposable
    {
        private readonly TaskCompletionSource<PasswordVerificationObservation> reached = new(
            TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly ManualResetEventSlim release = new(initialState: false);

        public Task<PasswordVerificationObservation> Reached => reached.Task;

        public void Release() => release.Set();

        public void Dispose()
        {
            release.Set();
            release.Dispose();
        }

        public void Pause(long accountId, PasswordVerificationResult result)
        {
            reached.TrySetResult(new PasswordVerificationObservation(accountId, result));
            release.Wait();
        }
    }

    private sealed record PasswordVerificationObservation(
        long AccountId,
        PasswordVerificationResult Result);

    private sealed class CountingPasswordHasher(PasswordHashCounter counter)
        : IPasswordHasher<ApplicationUser>
    {
        private readonly PasswordHasher<ApplicationUser> inner = new();

        public string HashPassword(ApplicationUser user, string password) =>
            inner.HashPassword(user, password);

        public PasswordVerificationResult VerifyHashedPassword(
            ApplicationUser user,
            string hashedPassword,
            string providedPassword)
        {
            counter.Count();
            var result = inner.VerifyHashedPassword(user, hashedPassword, providedPassword);
            counter.CompleteVerification(user, result);
            return result;
        }
    }

    private static async Task<Dictionary<string, ApplicationUser>> LoadAccountsAsync(
        ElevantDbContext context,
        CancellationToken cancellationToken) => await context.Users
        .AsNoTracking()
        .Where(account => account.NormalizedEmail != null)
        .ToDictionaryAsync(
            account => account.NormalizedEmail!,
            StringComparer.Ordinal,
            cancellationToken);

    private static void AssertPasswordSet(
        Dictionary<string, ApplicationUser> accounts,
        DevelopmentAccountPasswords passwords)
    {
        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["ADMIN.OCC@DEV.ELEVANT.TEST"] = passwords.AdminOcc,
            ["RAMP.AGENT@DEV.ELEVANT.TEST"] = passwords.RampAgent,
            ["AIRLINE.CLIENT@DEV.ELEVANT.TEST"] = passwords.AirlineClient,
            ["GESTION.HUMANA@DEV.ELEVANT.TEST"] = passwords.HumanResources,
            ["CONTRATOS@DEV.ELEVANT.TEST"] = passwords.Contracts,
            ["FINANZAS@DEV.ELEVANT.TEST"] = passwords.Finance,
        };
        Assert.Equal(expected.Count, accounts.Count);
        foreach (var (email, password) in expected)
        {
            AssertPassword(accounts[email], password, expected
                .Where(pair => pair.Key != email)
                .Select(pair => pair.Value)
                .ToArray());
        }
    }

    private static void AssertPassword(
        ApplicationUser account,
        string expected,
        params string[] rejected)
    {
        Assert.True(account.LockoutEnabled);
        Assert.False(string.IsNullOrWhiteSpace(account.PasswordHash));
        var hasher = new PasswordHasher<ApplicationUser>();
        Assert.NotEqual(
            PasswordVerificationResult.Failed,
            hasher.VerifyHashedPassword(account, account.PasswordHash!, expected));
        Assert.All(rejected, candidate => Assert.Equal(
            PasswordVerificationResult.Failed,
            hasher.VerifyHashedPassword(account, account.PasswordHash!, candidate)));
    }

    private static ElevantDbContext CreateContext(string connectionString)
    {
        var options = new DbContextOptionsBuilder<ElevantDbContext>()
            .UseSqlServer(connectionString, ElevantSqlServerOptions.Configure)
            .Options;
        return new ElevantDbContext(options);
    }

    private sealed class SavingChangesGate : SaveChangesInterceptor
    {
        private readonly TaskCompletionSource<bool> _entered = new(
            TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<bool> _released = new(
            TaskCreationOptions.RunContinuationsAsynchronously);

        public Task Entered => _entered.Task;
        public void Release() => _released.TrySetResult(true);

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            _entered.TrySetResult(true);
            await _released.Task.WaitAsync(TimeSpan.FromSeconds(15), cancellationToken);
            return result;
        }
    }

    private static RampAgent NewTestAgent(
        long personId,
        string employeeNumber,
        string publicId,
        DateTimeOffset instant) => new()
        {
            PublicId = Guid.Parse(publicId),
            PersonId = personId,
            EmployeeNumber = employeeNumber,
            Category = "Development test",
            HireDate = new DateOnly(2026, 1, 1),
            IsActive = true,
            CreatedAt = instant,
            UpdatedAt = instant,
        };

    private static ElevantDbContext CreateContext(SqlConnection connection)
    {
        var options = new DbContextOptionsBuilder<ElevantDbContext>()
            .UseSqlServer(connection, ElevantSqlServerOptions.Configure)
            .Options;
        return new ElevantDbContext(options);
    }

    [Fact]
    public async Task AttendanceValidationPreservesBothDraftsAndRejectsStaleDecisions()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var connection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seeder = CreateContext(connection))
            await new DevelopmentDataSeeder(seeder).SeedAsync(InitialPasswords, cancellationToken);

        await using (var secondStation = CreateContext(database.ConnectionString))
        {
            var now = new DateTimeOffset(2026, 10, 2, 15, 0, 0, TimeSpan.Zero);
            var airport = new Airport
            {
                PublicId = Guid.Parse("20000000-0000-7000-8000-000000000098"),
                IataCode = "TST", IcaoCode = "MTST", Name = "Synthetic test airport",
                City = "Test", CountryCode = "DO", CreatedAt = now, UpdatedAt = now,
            };
            secondStation.Airports.Add(airport);
            await secondStation.SaveChangesAsync(cancellationToken);
            secondStation.Stations.Add(new Station
            {
                PublicId = Guid.Parse("20000000-0000-7000-8000-000000000099"),
                AirportId = airport.Id, Code = "TST", Name = "Synthetic test station",
                IanaTimeZone = "America/Santo_Domingo", IsActive = true,
                CreatedAt = now, UpdatedAt = now,
            });
            await secondStation.SaveChangesAsync(cancellationToken);
        }

        var occId = Guid.Parse("40000000-0000-7000-8000-000000000001");
        var agentId = Guid.Parse("40000000-0000-7000-8000-000000000002");
        var humanResourcesId = Guid.Parse("40000000-0000-7000-8000-000000000004");
        var contractsId = Guid.Parse("40000000-0000-7000-8000-000000000005");
        var operationId = Guid.Parse("70000000-0000-7000-8000-000000000005");
        var assignmentId = Guid.Parse("70000000-0000-7000-8000-000000000006");
        var installationId = Guid.CreateVersion7();
        var start = new DateTimeOffset(2026, 10, 2, 12, 0, 0, TimeSpan.Zero);
        Guid stationId;
        Guid otherStationId;
        DateOnly operationDate;
        await using (var metadata = CreateContext(database.ConnectionString))
        {
            var operation = await metadata.GroundOperations.SingleAsync(item =>
                item.PublicId == operationId, cancellationToken);
            var turnaround = await metadata.Turnarounds.SingleAsync(item =>
                item.Id == operation.TurnaroundId, cancellationToken);
            stationId = await metadata.Stations.Where(item => item.Id == turnaround.StationId)
                .Select(item => item.PublicId).SingleAsync(cancellationToken);
            otherStationId = await metadata.Stations.Where(item => item.Code == "TST")
                .Select(item => item.PublicId).SingleAsync(cancellationToken);
            operationDate = turnaround.OperationDate;
            var otherStationInternalId = await metadata.Stations
                .Where(item => item.PublicId == otherStationId)
                .Select(item => item.Id).SingleAsync(cancellationToken);
            var otherTurnaround = new Turnaround
            {
                PublicId = Guid.Parse("70000000-0000-7000-8000-000000000097"),
                OperationCode = "TST-TAT-0001", AirlineId = turnaround.AirlineId,
                StationId = otherStationInternalId, OperationDate = operationDate,
                CurrentStatus = TurnaroundStatus.Scheduled,
                Source = OperationalDataSource.Internal,
                CreatedAt = start, UpdatedAt = start,
            };
            metadata.Turnarounds.Add(otherTurnaround);
            await metadata.SaveChangesAsync(cancellationToken);
            var otherOperation = new GroundOperation
            {
                PublicId = Guid.Parse("70000000-0000-7000-8000-000000000098"),
                TurnaroundId = otherTurnaround.Id,
                CurrentStatus = GroundOperationStatus.Planned,
                CreatedAt = start, UpdatedAt = start,
            };
            metadata.GroundOperations.Add(otherOperation);
            await metadata.SaveChangesAsync(cancellationToken);
            var existingAssignment = await metadata.OperationAgentAssignments
                .SingleAsync(item => item.PublicId == assignmentId, cancellationToken);
            metadata.OperationAgentAssignments.Add(new OperationAgentAssignment
            {
                PublicId = Guid.Parse("70000000-0000-7000-8000-000000000099"),
                GroundOperationId = otherOperation.Id,
                RampAgentId = existingAssignment.RampAgentId,
                AssignmentRole = "RampAgent", AssignedAt = start,
                CreatedAt = start, UpdatedAt = start,
            });
            await metadata.SaveChangesAsync(cancellationToken);
        }

        await using var provider = CreateAuthenticationProvider(
            database.ConnectionString, new PasswordHashCounter());
        await using (var scope = provider.CreateAsyncScope())
        {
            var registration = await scope.ServiceProvider
                .GetRequiredService<IMobileDeviceCommandStore>()
                .RegisterAsync(new MobileDeviceRegistrationWriteRequest(
                    agentId, installationId, MobilePlatform.Android,
                    "1.2.3", "Attendance validation tablet", "Android 16"), cancellationToken);
            Assert.True(registration.IsSuccess);
        }

        async Task<AttendanceDraftWriteResult> SaveDraftAsync(Guid actor,
            AttendanceDraftLane lane, int expectedRevision,
            DateTimeOffset observedStart, DateTimeOffset observedEnd, Guid key)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IAttendanceDraftStore>()
                .SaveAsync(new AttendanceDraftWriteRequest(actor, operationId, assignmentId,
                    lane, expectedRevision, observedStart, observedEnd, "Observación manual",
                    key, lane == AttendanceDraftLane.RampAgent ? installationId : null,
                    "attendance-validation-test"), cancellationToken);
        }

        async Task<HumanResourcesAttendancePage?> ListAsync(Guid actor, Guid station)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IAttendanceValidationStore>()
                .ListAsync(actor, station, operationDate, operationDate, 1, 20,
                    cancellationToken);
        }

        async Task<AttendanceValidationResult> ValidateAsync(
            AttendanceValidationCommand command)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IAttendanceValidationStore>()
                .ValidateAsync(command, cancellationToken);
        }

        Assert.True((await SaveDraftAsync(occId, AttendanceDraftLane.Occ, 0,
            start, start.AddHours(2), Guid.CreateVersion7())).IsSuccess);
        Assert.True((await SaveDraftAsync(agentId, AttendanceDraftLane.RampAgent, 0,
            start.AddMinutes(5), start.AddHours(2).AddMinutes(10), Guid.CreateVersion7())).IsSuccess);
        Assert.Null(await ListAsync(contractsId, stationId));
        Assert.Empty((await ListAsync(humanResourcesId, otherStationId))!.Items);
        Assert.DoesNotContain((await ListAsync(humanResourcesId, stationId))!.Items,
            row => row.OperationCode == "TST-TAT-0001");
        var pending = Assert.Single((await ListAsync(humanResourcesId, stationId))!.Items,
            row => row.AssignmentId == assignmentId);
        Assert.Equal(1, pending.Occ!.Revision);
        Assert.Equal(1, pending.RampAgent!.Revision);
        Assert.Null(pending.LatestDecision);

        var key = Guid.CreateVersion7();
        var command = new AttendanceValidationCommand(humanResourcesId,
            stationId, assignmentId, 1, 1, "Occ", "RampAgent",
            "Diferencia revisada", key, "attendance-validation-test");
        Assert.Equal(AttendanceValidationFailure.Forbidden,
            (await ValidateAsync(command with { ActorAccountId = contractsId })).Failure);
        Assert.Equal(AttendanceValidationFailure.NotFound,
            (await ValidateAsync(command with { StationId = otherStationId })).Failure);
        var approved = await ValidateAsync(command);
        Assert.Null(approved.Failure);
        Assert.Equal(start, approved.Decision!.StartAt);
        Assert.Equal(start.AddHours(2).AddMinutes(10), approved.Decision.EndAt);
        Assert.Equal(1, approved.Decision.OccRevision);
        Assert.Equal(1, approved.Decision.RampAgentRevision);
        var replay = await ValidateAsync(command);
        Assert.True(replay.Replayed);
        Assert.Equal(approved.Decision.Id, replay.Decision!.Id);
        Assert.Equal(AttendanceValidationFailure.Conflict,
            (await ValidateAsync(command with { Reason = "Cambiado" })).Failure);
        Assert.Equal(AttendanceValidationFailure.Conflict,
            (await ValidateAsync(command with { IdempotencyKey = Guid.CreateVersion7() })).Failure);
        Assert.True(Assert.Single((await ListAsync(humanResourcesId, stationId))!.Items,
            row => row.AssignmentId == assignmentId).IsDecisionCurrent);

        Assert.True((await SaveDraftAsync(occId, AttendanceDraftLane.Occ, 1,
            start.AddMinutes(1), start.AddHours(2), Guid.CreateVersion7())).IsSuccess);
        var stale = Assert.Single((await ListAsync(humanResourcesId, stationId))!.Items,
            row => row.AssignmentId == assignmentId);
        Assert.False(stale.IsDecisionCurrent);
        Assert.Equal(approved.Decision.Id, stale.LatestDecision!.Id);
        Assert.Equal(AttendanceValidationFailure.Conflict,
            (await ValidateAsync(command with { IdempotencyKey = Guid.CreateVersion7() })).Failure);
        var secondRevision = command with
        {
            ExpectedOccRevision = 2,
            IdempotencyKey = Guid.CreateVersion7(),
        };
        var competing = await Task.WhenAll(
            ValidateAsync(secondRevision),
            ValidateAsync(secondRevision with { IdempotencyKey = Guid.CreateVersion7() }));
        Assert.Single(competing, item => item.Failure is null);
        Assert.Single(competing, item => item.Failure == AttendanceValidationFailure.Conflict);
        Assert.Equal(2, competing.Single(item => item.Failure is null).Decision!.OccRevision);
        await using var verify = CreateContext(database.ConnectionString);
        Assert.Equal(2, await verify.OperationAttendanceValidations.CountAsync(cancellationToken));
        Assert.Equal(3, await verify.OperationAttendanceContributionRevisions.CountAsync(cancellationToken));
        Assert.Equal(2, await verify.AuditEntries.CountAsync(item =>
            item.Action == "hr.attendance.validated", cancellationToken));
        var airlineOrganizationId = await (
            from operation in verify.GroundOperations.AsNoTracking()
            join turnaround in verify.Turnarounds.AsNoTracking()
                on operation.TurnaroundId equals turnaround.Id
            join airline in verify.Airlines.AsNoTracking()
                on turnaround.AirlineId equals airline.Id
            where operation.PublicId == operationId
            select airline.OrganizationId).SingleAsync(cancellationToken);
        var validationAudits = await verify.AuditEntries.AsNoTracking()
            .Where(item => item.Action == "hr.attendance.validated")
            .ToArrayAsync(cancellationToken);
        Assert.All(validationAudits, audit =>
        {
            Assert.Equal(airlineOrganizationId, audit.OrganizationId);
            Assert.DoesNotContain("Diferencia revisada", audit.MetadataJson ?? string.Empty);
        });
        Assert.True(await verify.OutboxMessages.AnyAsync(item =>
            item.EventType == "account.changed.v1" &&
            item.PayloadJson.Contains("attendance_validation"), cancellationToken));
        await using (var scope = provider.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<IAccountChangeDispatcherStore>()
                .DispatchPendingAsync(100, cancellationToken);
        async Task<AccountChangePage?> FeedAsync(Guid actor, Guid? device = null)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IAccountChangeReadStore>()
                .ReadAsync(actor, 0, 100, device, cancellationToken);
        }
        Assert.Contains((await FeedAsync(humanResourcesId))!.Changes,
            item => item.Resource == "attendance_validation" && item.ResourceId == operationId);
        Assert.Contains((await FeedAsync(agentId, installationId))!.Changes,
            item => item.Resource == "attendance_validation" && item.ResourceId == operationId);
        Assert.DoesNotContain((await FeedAsync(agentId))!.Changes,
            item => item.Resource == "attendance_validation");
        await using (var revokeRole = CreateContext(database.ConnectionString))
        {
            var accountId = await revokeRole.Users.Where(item =>
                item.PublicId == humanResourcesId).Select(item => item.Id)
                .SingleAsync(cancellationToken);
            var roleId = await revokeRole.Roles.Where(item =>
                item.NormalizedName == "GESTION_HUMANA").Select(item => item.Id)
                .SingleAsync(cancellationToken);
            var contractsRoleId = await revokeRole.Roles.Where(item =>
                item.NormalizedName == "CONTRATOS").Select(item => item.Id)
                .SingleAsync(cancellationToken);
            revokeRole.Set<IdentityUserRole<long>>().Add(new IdentityUserRole<long>
            {
                UserId = accountId, RoleId = contractsRoleId,
            });
            await revokeRole.SaveChangesAsync(cancellationToken);
            await revokeRole.Set<IdentityUserRole<long>>().Where(item =>
                item.UserId == accountId && item.RoleId == roleId)
                .ExecuteDeleteAsync(cancellationToken);
        }
        Assert.DoesNotContain((await FeedAsync(humanResourcesId))!.Changes,
            item => item.Resource == "attendance_validation");
    }

    [Fact]
    public async Task AttendanceDraftKeepsOccAndAgentRevisionsSeparateAndRetrySafe()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var connection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seeder = CreateContext(connection))
            await new DevelopmentDataSeeder(seeder).SeedAsync(InitialPasswords, cancellationToken);

        var occId = Guid.Parse("40000000-0000-7000-8000-000000000001");
        var agentId = Guid.Parse("40000000-0000-7000-8000-000000000002");
        var operationId = Guid.Parse("70000000-0000-7000-8000-000000000005");
        var assignmentId = Guid.Parse("70000000-0000-7000-8000-000000000006");
        var installationId = Guid.CreateVersion7();
        var secondInstallationId = Guid.CreateVersion7();
        var occKey = Guid.CreateVersion7();
        var agentKey = Guid.CreateVersion7();
        var startedAt = new DateTimeOffset(2026, 10, 2, 12, 0, 0, TimeSpan.Zero);
        await using var provider = CreateAuthenticationProvider(
            database.ConnectionString, new PasswordHashCounter());

        await using (var scope = provider.CreateAsyncScope())
        {
            var registration = await scope.ServiceProvider
                .GetRequiredService<IMobileDeviceCommandStore>()
                .RegisterAsync(new MobileDeviceRegistrationWriteRequest(
                    agentId, installationId, MobilePlatform.Android,
                    "1.2.3", "Attendance SQL test tablet", "Android 16"), cancellationToken);
            Assert.True(registration.IsSuccess);
            var secondRegistration = await scope.ServiceProvider
                .GetRequiredService<IMobileDeviceCommandStore>()
                .RegisterAsync(new MobileDeviceRegistrationWriteRequest(
                    agentId, secondInstallationId, MobilePlatform.Android,
                    "1.2.3", "Attendance SQL test second tablet", "Android 16"), cancellationToken);
            Assert.True(secondRegistration.IsSuccess);
        }

        async Task<AttendanceDraftReadResult> ReadAsync(Guid actor, Guid? device)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IAttendanceDraftStore>()
                .GetAsync(actor, operationId, assignmentId, device, cancellationToken);
        }

        async Task<AttendanceDraftWriteResult> SaveAsync(Guid actor, AttendanceDraftLane lane,
            int revision, DateTimeOffset? start, string? note, Guid key, Guid? device)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IAttendanceDraftStore>()
                .SaveAsync(new AttendanceDraftWriteRequest(actor, operationId, assignmentId,
                    lane, revision, start, null, note, key, device, "attendance-sql-test"),
                    cancellationToken);
        }

        var empty = await ReadAsync(occId, null);
        Assert.True(empty.IsSuccess);
        Assert.Null(empty.Snapshot!.Occ);
        Assert.Null(empty.Snapshot.RampAgent);
        Assert.Equal(AttendanceDraftFailure.Forbidden, (await ReadAsync(agentId, null)).Failure);

        var concurrent = await Task.WhenAll(
            SaveAsync(occId, AttendanceDraftLane.Occ, 0,
                startedAt, "Equipo listo", occKey, null),
            SaveAsync(agentId, AttendanceDraftLane.RampAgent, 0,
                startedAt.AddMinutes(2), "Rampa lista", agentKey, installationId));
        var occ = concurrent[0];
        Assert.True(occ.IsSuccess);
        Assert.Equal(1, occ.Contribution!.Revision);
        var agent = concurrent[1];
        Assert.True(agent.IsSuccess);
        Assert.Equal(1, agent.Contribution!.Revision);
        var both = await ReadAsync(agentId, installationId);
        Assert.True(both.IsSuccess);
        Assert.Equal("Equipo listo", both.Snapshot!.Occ!.IncidentNote);
        Assert.Equal("Rampa lista", both.Snapshot.RampAgent!.IncidentNote);

        var replay = await SaveAsync(occId, AttendanceDraftLane.Occ, 0,
            startedAt, "Equipo listo", occKey, null);
        Assert.True(replay.IsSuccess);
        Assert.True(replay.Replayed);
        Assert.Equal(occ.Contribution, replay.Contribution);
        Assert.Equal(AttendanceDraftFailure.Conflict,
            (await SaveAsync(occId, AttendanceDraftLane.Occ, 0,
                startedAt, "Cambiado", occKey, null)).Failure);
        Assert.Equal(AttendanceDraftFailure.Conflict,
            (await SaveAsync(occId, AttendanceDraftLane.Occ, 0,
                startedAt, " Equipo listo ", occKey, null)).Failure);
        Assert.Equal(AttendanceDraftFailure.Conflict,
            (await SaveAsync(occId, AttendanceDraftLane.Occ, 0,
                startedAt, "Nueva revisión", Guid.CreateVersion7(), null)).Failure);

        var second = await SaveAsync(occId, AttendanceDraftLane.Occ, 1,
            startedAt.AddMinutes(1), "Equipo revisado", Guid.CreateVersion7(), null);
        Assert.True(second.IsSuccess);
        Assert.Equal(2, second.Contribution!.Revision);
        var firstAfterSecond = await SaveAsync(occId, AttendanceDraftLane.Occ, 0,
            startedAt, "Equipo listo", occKey, null);
        Assert.True(firstAfterSecond.Replayed);
        Assert.Equal(1, firstAfterSecond.Contribution!.Revision);

        await using var verify = CreateContext(database.ConnectionString);
        Assert.Equal(3, await verify.OperationAttendanceContributionRevisions.CountAsync(cancellationToken));
        Assert.Equal(3, await verify.AuditEntries.CountAsync(item =>
            item.Action == "ops.attendance_draft.saved", cancellationToken));
        var auditRows = await verify.AuditEntries.AsNoTracking()
            .Where(item => item.Action == "ops.attendance_draft.saved")
            .ToArrayAsync(cancellationToken);
        var occInternalIdForAudit = await verify.Users.Where(item => item.PublicId == occId)
            .Select(item => item.Id).SingleAsync(cancellationToken);
        var agentInternalIdForAudit = await verify.Users.Where(item => item.PublicId == agentId)
            .Select(item => item.Id).SingleAsync(cancellationToken);
        Assert.Equal(2, auditRows.Count(item => item.ActorAccountId == occInternalIdForAudit &&
            item.Source == AuditSource.Api));
        Assert.Single(auditRows, item => item.ActorAccountId == agentInternalIdForAudit &&
            item.Source == AuditSource.MobileSync);
        Assert.All(auditRows, item =>
        {
            Assert.NotEqual(default, item.OccurredAt);
            Assert.DoesNotContain("Equipo listo", item.MetadataJson ?? string.Empty);
            Assert.DoesNotContain("Rampa lista", item.MetadataJson ?? string.Empty);
        });
        Assert.True(await verify.OutboxMessages.CountAsync(item =>
            item.EventType == "account.changed.v1" &&
            item.PayloadJson.Contains("attendance_draft"), cancellationToken) >= 2);

        await using (var scope = provider.CreateAsyncScope())
        {
            var dispatch = scope.ServiceProvider.GetRequiredService<IAccountChangeDispatcherStore>();
            await dispatch.DispatchPendingAsync(100, cancellationToken);
        }
        async Task<AccountChangePage?> FeedAsync(Guid actor, Guid? device = null)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IAccountChangeReadStore>()
                .ReadAsync(actor, 0, 100, device, cancellationToken);
        }
        Assert.Contains((await FeedAsync(occId))!.Changes,
            item => item.Resource == "attendance_draft" && item.ResourceId == operationId);
        Assert.Contains((await FeedAsync(agentId, installationId))!.Changes,
            item => item.Resource == "attendance_draft" && item.ResourceId == operationId);
        Assert.Contains((await FeedAsync(agentId, secondInstallationId))!.Changes,
            item => item.Resource == "attendance_draft" && item.ResourceId == operationId);
        Assert.DoesNotContain((await FeedAsync(agentId))!.Changes,
            item => item.Resource == "attendance_draft");
        Assert.DoesNotContain((await FeedAsync(Guid.Parse(
            "40000000-0000-7000-8000-000000000003")))!.Changes,
            item => item.Resource == "attendance_draft");

        var outboxBeforeRevocation = await verify.OutboxMessages.CountAsync(item =>
            item.EventType == "account.changed.v1" &&
            item.PayloadJson.Contains("attendance_draft"), cancellationToken);
        await using (var revokeDevice = CreateContext(database.ConnectionString))
        {
            await revokeDevice.MobileDevices.Where(item => item.InstallationId == installationId)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.RevokedAt,
                    DateTimeOffset.UtcNow), cancellationToken);
        }
        Assert.Equal(AttendanceDraftFailure.Forbidden,
            (await ReadAsync(agentId, installationId)).Failure);
        Assert.Equal(AttendanceDraftFailure.Forbidden,
            (await SaveAsync(agentId, AttendanceDraftLane.RampAgent, 1,
                startedAt.AddMinutes(4), "Sin dispositivo", Guid.CreateVersion7(),
                installationId)).Failure);
        Assert.DoesNotContain((await FeedAsync(agentId, installationId))!.Changes,
            item => item.Resource == "attendance_draft");
        Assert.Contains((await FeedAsync(agentId, secondInstallationId))!.Changes,
            item => item.Resource == "attendance_draft" && item.ResourceId == operationId);

        await using (var release = CreateContext(database.ConnectionString))
            await release.OperationAgentAssignments.Where(item => item.PublicId == assignmentId)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.ReleasedAt,
                    DateTimeOffset.UtcNow), cancellationToken);
        Assert.Equal(AttendanceDraftFailure.NotFound,
            (await SaveAsync(occId, AttendanceDraftLane.Occ, 2,
                startedAt.AddMinutes(5), "Después de liberar", Guid.CreateVersion7(),
                null)).Failure);
        Assert.Equal(outboxBeforeRevocation,
            await verify.OutboxMessages.CountAsync(item =>
                item.EventType == "account.changed.v1" &&
                item.PayloadJson.Contains("attendance_draft"), cancellationToken));

        await using (var revokeStation = CreateContext(database.ConnectionString))
        {
            var occInternalId = await revokeStation.Users.Where(item => item.PublicId == occId)
                .Select(item => item.Id).SingleAsync(cancellationToken);
            await revokeStation.AccountStationScopes.Where(item =>
                item.AccountId == occInternalId && item.RevokedAt == null)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.RevokedAt,
                    DateTimeOffset.UtcNow), cancellationToken);
        }
        Assert.Equal(AttendanceDraftFailure.NotFound, (await ReadAsync(occId, null)).Failure);
        Assert.DoesNotContain((await FeedAsync(occId))!.Changes,
            item => item.Resource == "attendance_draft");
    }

    private static string? ResolveMasterConnection()
    {
        var configured = Environment.GetEnvironmentVariable(MasterConnectionEnvironmentVariable);
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return configured;
        }

        return OperatingSystem.IsWindows()
            ? "Server=(localdb)\\MSSQLLocalDB;Initial Catalog=master;Integrated Security=true;TrustServerCertificate=true;Connect Timeout=30"
            : null;
    }

    private sealed class TemporaryDatabase : IAsyncDisposable
    {
        private readonly string _masterConnectionString;
        private readonly string _databaseName;

        private TemporaryDatabase(string masterConnectionString, string databaseName, string connectionString)
        {
            _masterConnectionString = masterConnectionString;
            _databaseName = databaseName;
            ConnectionString = connectionString;
        }

        public string ConnectionString { get; }

        public async Task ConfigureDevelopmentSeederPermissionsAsync(CancellationToken cancellationToken)
        {
            await using var connection = new SqlConnection(ConnectionString);
            await connection.OpenAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = """
                GRANT SELECT, INSERT ON SCHEMA::[iam] TO [elevant_seeder_role];
                GRANT SELECT, INSERT ON SCHEMA::[ref] TO [elevant_seeder_role];
                GRANT SELECT, INSERT ON SCHEMA::[hr] TO [elevant_seeder_role];
                GRANT SELECT, INSERT ON SCHEMA::[commercial] TO [elevant_seeder_role];
                GRANT SELECT, INSERT ON SCHEMA::[ops] TO [elevant_seeder_role];
                REVOKE UPDATE, DELETE, EXECUTE ON SCHEMA::[iam] FROM [elevant_seeder_role];
                GRANT SELECT ON OBJECT::[infra].[database_instances] TO [elevant_test_seeder];
                GRANT EXECUTE ON SCHEMA::[iam] TO [elevant_app_role];
                """;
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        public async Task ConfigureAccountChangeAppPermissionsAsync(CancellationToken cancellationToken)
        {
            await using var connection = new SqlConnection(ConnectionString);
            await connection.OpenAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = """
                GRANT SELECT ON SCHEMA::[iam] TO [elevant_app_role];
                GRANT SELECT ON SCHEMA::[ref] TO [elevant_app_role];
                """;
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        public Task<SqlConnection> OpenAsDevelopmentSeederAsync(CancellationToken cancellationToken) =>
            OpenAsUserAsync("elevant_test_seeder", cancellationToken);

        public Task<SqlConnection> OpenAsDevelopmentAppAsync(CancellationToken cancellationToken) =>
            OpenAsUserAsync("elevant_test_app", cancellationToken);

        private async Task<SqlConnection> OpenAsUserAsync(
            string userName,
            CancellationToken cancellationToken)
        {
            var impersonatedConnectionString = new SqlConnectionStringBuilder(ConnectionString)
            {
                Pooling = false,
            }.ConnectionString;
            var connection = new SqlConnection(impersonatedConnectionString);
            try
            {
                await connection.OpenAsync(cancellationToken);
                await using var command = connection.CreateCommand();
                command.CommandText = $"EXECUTE AS USER = N'{userName}';";
                await command.ExecuteNonQueryAsync(cancellationToken);
                return connection;
            }
            catch
            {
                await connection.DisposeAsync();
                throw;
            }
        }

        public static async Task<TemporaryDatabase> CreateAsync(
            string masterConnectionString,
            string environmentName,
            CancellationToken cancellationToken)
        {
            var databaseName = $"ElevantDbV1Test_{Guid.NewGuid():N}";
            var quotedName = QuoteIdentifier(databaseName);

            await using (var master = new SqlConnection(masterConnectionString))
            {
                await master.OpenAsync(cancellationToken);
                await using var create = master.CreateCommand();
                create.CommandText = $"CREATE DATABASE {quotedName};";
                await create.ExecuteNonQueryAsync(cancellationToken);
            }

            try
            {
                var databaseBuilder = new SqlConnectionStringBuilder(masterConnectionString)
                {
                    InitialCatalog = databaseName,
                };

                await using (var database = new SqlConnection(databaseBuilder.ConnectionString))
                {
                    await database.OpenAsync(cancellationToken);
                    await using (var createSchema = database.CreateCommand())
                    {
                        createSchema.CommandText = "CREATE SCHEMA [infra];";
                        await createSchema.ExecuteNonQueryAsync(cancellationToken);
                    }

                    await using var bootstrap = database.CreateCommand();
                    bootstrap.CommandText = """
                        CREATE TABLE [infra].[database_instances]
                        (
                            [id] tinyint NOT NULL CONSTRAINT [pk_database_instances] PRIMARY KEY,
                            [instance_id] uniqueidentifier NOT NULL,
                            [environment_name] nvarchar(32) NOT NULL,
                            [created_at] datetimeoffset(3) NOT NULL,
                            CONSTRAINT [ck_database_instances_singleton] CHECK ([id] = 1),
                            CONSTRAINT [ck_database_instances_environment] CHECK ([environment_name] IN (N'Development', N'Production'))
                        );
                        INSERT INTO [infra].[database_instances] ([id], [instance_id], [environment_name], [created_at])
                        VALUES (1, @instanceId, @environmentName, SYSUTCDATETIME());
                        """;
                    bootstrap.Parameters.AddWithValue("@instanceId", Guid.NewGuid());
                    bootstrap.Parameters.AddWithValue("@environmentName", environmentName);
                    await bootstrap.ExecuteNonQueryAsync(cancellationToken);

                    if (string.Equals(environmentName, "Development", StringComparison.Ordinal))
                    {
                        await using var createSeeder = database.CreateCommand();
                        createSeeder.CommandText = """
                            CREATE ROLE [elevant_seeder_role] AUTHORIZATION [dbo];
                            CREATE ROLE [elevant_app_role] AUTHORIZATION [dbo];
                            CREATE USER [elevant_test_seeder] WITHOUT LOGIN;
                            CREATE USER [elevant_test_app] WITHOUT LOGIN;
                            ALTER ROLE [elevant_seeder_role] ADD MEMBER [elevant_test_seeder];
                            ALTER ROLE [elevant_app_role] ADD MEMBER [elevant_test_app];
                            """;
                        await createSeeder.ExecuteNonQueryAsync(cancellationToken);
                    }
                }

                return new TemporaryDatabase(masterConnectionString, databaseName, databaseBuilder.ConnectionString);
            }
            catch
            {
                await DropDatabaseAsync(masterConnectionString, databaseName);
                throw;
            }
        }

        public async ValueTask DisposeAsync()
        {
            if (!_databaseName.StartsWith("ElevantDbV1Test_", StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Refusing to remove a database outside the test namespace.");
            }

            await DropDatabaseAsync(_masterConnectionString, _databaseName);
        }

        private static async Task DropDatabaseAsync(string masterConnectionString, string databaseName)
        {
            if (!databaseName.StartsWith("ElevantDbV1Test_", StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Refusing to remove a database outside the test namespace.");
            }

            SqlConnection.ClearAllPools();
            await using var master = new SqlConnection(masterConnectionString);
            await master.OpenAsync();
            await using var drop = master.CreateCommand();
            var quotedName = QuoteIdentifier(databaseName);
            drop.CommandText = $"IF DB_ID(@databaseName) IS NOT NULL BEGIN ALTER DATABASE {quotedName} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE {quotedName}; END";
            drop.Parameters.AddWithValue("@databaseName", databaseName);
            await drop.ExecuteNonQueryAsync();
        }

        private static string QuoteIdentifier(string value) => $"[{value.Replace("]", "]]", StringComparison.Ordinal)}]";
    }
}
