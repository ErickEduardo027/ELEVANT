using Elevant.Application.Abstractions.Commercial;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// A superadministrator corrects the identity of an airline that already operates with AVIAM only with a reason and
/// an official source: audited, verified again by them, its registry check cleared, the canonical airline untouched.
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public async Task AnOperatingAirlineIdentityIsCorrectedOnlyWithAReasonAndKeepsDesignatorsUnique()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var store = scope.ServiceProvider.GetRequiredService<ICommercialAirlineManagementStore>();
        var input = new ManagedAirlineInput("JUNK TEST", "Junk Air", "eeeeeeee", "Caribe", "DO", "Q7", "QJK", null,
            "https://junk.example.com", "https://junk.example.com/aoc", IsVerified: true, IsPublished: true, Version: null);
        var created = (await store.SaveAsync(SuperAdministratorAccount, null, input, null, ct)).Airline!;
        var operating = await context.Airlines.AsNoTracking().Where(item => item.IcaoCode == "DZZ").FirstAsync(ct);
        await context.CommercialAirlineProfiles.Where(item => item.PublicId == created.Id).ExecuteUpdateAsync(update => update
            .SetProperty(item => item.CanonicalAirlineId, operating.Id)
            .SetProperty(item => item.RegistryStatus, Elevant.Domain.Enumerations.AirlineRegistryStatus.Found)
            .SetProperty(item => item.RegistrySource, "OpenFlights"), ct);
        var locked = (await store.ListAsync(SuperAdministratorAccount, ct))!.Single(item => item.Id == created.Id);
        Assert.True(locked.IdentityLocked);
        var correction = input with
        {
            LegalName = "Junk Air Corrected S.R.L.", IataCode = "Q6", IcaoCode = "QJL",
            VerificationSourceUrl = "https://aoc.example.gob.do/qjl", Version = locked.Version,
        };

        // Without a reason the lock behaves as before; a too short reason or a dropped verification is refused.
        Assert.Equal("airline_identity_locked", (await store.SaveAsync(SuperAdministratorAccount, created.Id, correction,
            Guid.NewGuid(), ct)).Code);
        Assert.Equal(CatalogMutationFailure.Invalid, (await store.SaveAsync(SuperAdministratorAccount, created.Id,
            correction with { IdentityCorrectionReason = "corto" }, Guid.NewGuid(), ct)).Failure);
        Assert.Equal("identity_correction_requires_verification", (await store.SaveAsync(SuperAdministratorAccount,
            created.Id, correction with
            {
                IsVerified = false, IsPublished = false, IdentityCorrectionReason = "Datos de prueba reemplazados por los oficiales.",
            }, Guid.NewGuid(), ct)).Code);

        // Another verified airline's designator is refused by the unique index.
        Assert.Equal("airline_profile_conflict", (await store.SaveAsync(SuperAdministratorAccount, created.Id, correction with
        {
            IcaoCode = "CMP", IdentityCorrectionReason = "Datos de prueba reemplazados por los oficiales.",
        }, Guid.NewGuid(), ct)).Code);

        // With a reason and the official source the correction is saved, audited and verified again.
        var reason = "Datos de prueba reemplazados por los del certificado de operador.";
        var corrected = await store.SaveAsync(SuperAdministratorAccount, created.Id,
            correction with { IdentityCorrectionReason = reason }, Guid.NewGuid(), ct);
        Assert.Null(corrected.Failure);
        Assert.Equal(("Junk Air Corrected S.R.L.", "Q6", "QJL", true, (string?)null),
            (corrected.Airline!.LegalName, corrected.Airline.IataCode, corrected.Airline.IcaoCode, corrected.Airline.IsVerified,
                corrected.Airline.RegistryStatus));
        var audit = await context.AuditEntries.AsNoTracking().SingleAsync(entry => entry.EntityPublicId == created.Id &&
            entry.Action == "commercial.airline.identity_corrected", ct);
        Assert.Equal(reason, audit.Reason);
        Assert.Contains("eeeeeeee", audit.MetadataJson);
        Assert.Contains("Junk Air Corrected S.R.L.", audit.MetadataJson);
        Assert.Contains("airline.icao", audit.MetadataJson);
        // The canonical airline keeps what contracts, invoices and flights were made with.
        Assert.Equal((operating.IcaoCode, operating.IataCode, operating.Name), await context.Airlines.AsNoTracking()
            .Where(item => item.Id == operating.Id)
            .Select(item => new ValueTuple<string?, string?, string>(item.IcaoCode, item.IataCode, item.Name)).SingleAsync(ct));
    }
}
