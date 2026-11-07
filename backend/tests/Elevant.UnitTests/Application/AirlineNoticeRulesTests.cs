using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Application.Identity;
using Elevant.Application.Identity.AccountEmails;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>
/// Phase 2, block B: what the airline is told and when (2-N12, 2-N13, 2-N30), and where it stands in its
/// portal (2-N32, 2-N35).
/// </summary>
public sealed class AirlineNoticeRulesTests
{
    private static readonly DateOnly Today = new(2026, 11, 6);

    [Theory]
    [InlineData(null, 30)]
    [InlineData(0, 0)]
    [InlineData(45, 45)]
    [InlineData(180, 180)]
    public void TheExpiryNoticeUsesTheDaysTheVersionSignedOrThirty(int? signedDays, int expected) =>
        Assert.Equal(expected, ContractLifecycle.ExpiryNoticeDays(signedDays));

    [Theory]
    [InlineData(-1, 30, false)]
    [InlineData(0, 30, true)]
    [InlineData(30, 30, true)]
    [InlineData(31, 30, false)]
    [InlineData(90, 90, true)]
    [InlineData(91, 90, false)]
    [InlineData(0, 0, true)]
    [InlineData(1, 0, false)]
    public void TheExpiryNoticeIsDueWithinItsDaysAndNeverAfterTheEnd(int daysToEnd, int noticeDays, bool due) =>
        Assert.Equal(due, ContractLifecycle.ExpiryNoticeDue(Today.AddDays(daysToEnd), noticeDays, Today));

    [Fact]
    public void ThePermitNamesAreSpanish()
    {
        Assert.Equal("permiso de operación", AirlinePermitNames.Of(AirlinePermitKind.OperatingPermit));
        Assert.Equal("póliza de seguro", AirlinePermitNames.Of(AirlinePermitKind.Insurance));
        Assert.Equal("documento", AirlinePermitNames.Of(AirlinePermitKind.Other));
    }

    [Fact]
    public void AnActivationBeforeTheStartSaysFromWhenTheContractIsInForce()
    {
        var upcoming = AccountEmailTemplates.ContractActivated("ana@example.test", "Demo Airlines", "CTR-2026-0007",
            Today.AddDays(25), Today.AddYears(1), Today);
        var current = AccountEmailTemplates.ContractActivated("ana@example.test", "Demo Airlines", "CTR-2026-0007",
            Today, Today.AddYears(1), Today);

        Assert.DoesNotContain("está en vigor", upcoming.TextBody);
        Assert.Contains("entra en vigor el 01/12/2026", upcoming.TextBody);
        Assert.Contains("vigente desde el 01/12/2026", upcoming.Subject);
        Assert.Contains("está en vigor", current.TextBody);
        Assert.Equal("Contrato CTR-2026-0007 activo · ELEVANT", current.Subject);
    }

    [Fact]
    public void TheReadyToSignEmailTellsANewContractFromARenewal()
    {
        var first = AccountEmailTemplates.ContractReadyToSign("ana@example.test", "A&B Air", "CTR-2026-0007", 1,
            Today, Today.AddYears(1).AddDays(-1), contractInForce: false);
        var renewal = AccountEmailTemplates.ContractReadyToSign("ana@example.test", "A&B Air", "CTR-2026-0007", 2,
            Today.AddYears(1), Today.AddYears(2).AddDays(-1), contractInForce: true);

        Assert.Equal("Contrato CTR-2026-0007 listo para firmar · ELEVANT", first.Subject);
        Assert.Contains("del 06/11/2026 al 05/11/2027", first.TextBody);
        Assert.Contains("permiso de operación (JAC)", first.TextBody);
        Assert.Contains("versión 2", renewal.TextBody);
        Assert.Contains("sigue vigente la versión actual", renewal.TextBody);
        Assert.Contains("A&amp;B Air", first.HtmlBody);
    }

    [Fact]
    public void PermitEmailsCarryTheNoteOrTheReasonAndNameTheSuspendedContracts()
    {
        var rejected = AccountEmailTemplates.PermitRejected("ana@example.test", "Demo Airlines", "permiso de operación",
            "JAC-001", "El número <b>no</b> coincide.");
        var revoked = AccountEmailTemplates.PermitRevoked("ana@example.test", "Demo Airlines", "permiso de operación",
            "JAC-001", "Se verificó por error.", ["CTR-2026-0007"]);
        var unchanged = AccountEmailTemplates.PermitRevoked("ana@example.test", "Demo Airlines", "póliza de seguro",
            "POL-9", "Póliza anulada por la aseguradora.", []);

        Assert.Contains("Motivo: El número <b>no</b> coincide.", rejected.TextBody);
        Assert.DoesNotContain("<b>", rejected.HtmlBody);
        Assert.Contains("Motivo: Se verificó por error.", revoked.TextBody);
        Assert.Contains("quedaron suspendidos: CTR-2026-0007", revoked.TextBody);
        Assert.Contains("Ningún contrato cambió de estado", unchanged.TextBody);
    }

    [Fact]
    public void ExpiryEmailsTellTheDateAndHowTheContractContinues()
    {
        var permit = AccountEmailTemplates.PermitExpiring("ana@example.test", "Demo Airlines", "permiso de operación",
            "JAC-001", Today.AddDays(30), operatingPermit: true);
        var manual = AccountEmailTemplates.ContractExpiring("ana@example.test", "Demo Airlines", "CTR-2026-0007",
            Today.AddDays(60), null);
        var automatic = AccountEmailTemplates.ContractExpiring("ana@example.test", "Demo Airlines", "CTR-2026-0007",
            Today.AddDays(60), 12);

        Assert.Contains("06/12/2026", permit.Subject);
        Assert.Contains("tus contratos se suspenden", permit.TextBody);
        Assert.Contains("05/01/2027", manual.Subject);
        Assert.Contains("contacta a Contratos de AVIAM para renovarlo", manual.TextBody);
        Assert.Contains("Se renueva automáticamente por 12 meses", automatic.TextBody);
    }

    [Theory]
    [InlineData(ContractSuspensionCause.Manual, "se pondrá en contacto", "venció")]
    [InlineData(ContractSuspensionCause.PermitExpired, "venció su permiso de operación", "revocó")]
    [InlineData(ContractSuspensionCause.PermitRevoked, "revocó la verificación", "venció su permiso")]
    public void TheSuspensionEmailExplainsTheCauseButNeverTheInternalReason(ContractSuspensionCause cause, string says,
        string doesNotSay)
    {
        var email = AccountEmailTemplates.ContractSuspended("ana@example.test", "Demo Airlines", "CTR-2026-0007", cause);

        Assert.Equal("Contrato CTR-2026-0007 suspendido · ELEVANT", email.Subject);
        Assert.Contains(says, email.TextBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(doesNotSay, email.TextBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Motivo", email.TextBody);
    }

    [Theory]
    [InlineData(new[] { ContractStatus.Active, ContractStatus.Terminated }, AirlinePortalStandings.Active)]
    [InlineData(new[] { ContractStatus.Suspended, ContractStatus.Draft }, AirlinePortalStandings.Suspended)]
    [InlineData(new[] { ContractStatus.Draft, ContractStatus.Expired }, AirlinePortalStandings.Pending)]
    [InlineData(new[] { ContractStatus.Expired, ContractStatus.Terminated }, AirlinePortalStandings.Expired)]
    [InlineData(new[] { ContractStatus.Terminated }, AirlinePortalStandings.Terminated)]
    [InlineData(new ContractStatus[0], AirlinePortalStandings.None)]
    public void TheOverallStandingFollowsTheContractThatMattersMost(ContractStatus[] statuses, string expected) =>
        Assert.Equal(expected, AirlinePortalStandings.Overall(statuses));

    [Theory]
    [InlineData(ContractStatus.Draft, true, false, AirlinePortalStandings.PendingSignatures)]
    [InlineData(ContractStatus.Draft, true, true, AirlinePortalStandings.PendingSignatures)]
    [InlineData(ContractStatus.Draft, false, false, AirlinePortalStandings.PendingOperatingPermit)]
    [InlineData(ContractStatus.Draft, false, true, null)]
    [InlineData(ContractStatus.Active, true, false, null)]
    [InlineData(ContractStatus.Suspended, false, false, null)]
    public void AContractThatNeverActivatedWaitsForSignaturesOrForThePermit(ContractStatus status, bool awaiting,
        bool usablePermit, string? expected) =>
        Assert.Equal(expected, AirlinePortalStandings.PendingReason(status, awaiting, usablePermit));

    [Fact]
    public async Task TheStandingIsResolvedFromTheSessionAndDatedByTheBusinessDay()
    {
        var organization = Guid.NewGuid();
        var account = Guid.NewGuid();
        var store = new StandingStore(new AirlinePortalStandingData(organization, AirlinePortalStandings.Suspended, true, [], []));
        var actor = new ActorContext(account, "ana@example.test", "Ana",
            [new ActorRole(Guid.NewGuid(), "AIRLINE_CLIENT", "Airline Client", PortalKind.AirlinePortal, "airline_client")],
            [new ActorMembership(Guid.NewGuid(), organization, "DEMO", "Demo Airlines", OrganizationType.AirlineCustomer,
                MembershipKind.AirlineClient)], []);
        // 21:30 in Santo Domingo is already the next UTC day; the standing is dated by AVIAM's day.
        var handler = new GetAirlinePortalStandingHandler(new Resolver(actor), store,
            new FixedTime(new DateTimeOffset(2026, 11, 7, 1, 30, 0, TimeSpan.Zero)));

        var result = await handler.HandleAsync(account, TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Equal((organization, new DateOnly(2026, 11, 6)), (store.Organization, store.Day));
        Assert.Equal(AirlinePortalFailure.Unauthorized, (await handler.HandleAsync(Guid.Empty,
            TestContext.Current.CancellationToken)).Failure);
        var foreign = new GetAirlinePortalStandingHandler(new Resolver(actor),
            new StandingStore(new AirlinePortalStandingData(Guid.NewGuid(), AirlinePortalStandings.Active, false, [], [])),
            TimeProvider.System);
        Assert.Equal(AirlinePortalFailure.NotFound, (await foreign.HandleAsync(account,
            TestContext.Current.CancellationToken)).Failure);
    }

    private sealed class Resolver(ActorContext actor) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult<ActorContext?>(accountId == actor.AccountId ? actor : null);
    }

    private sealed class StandingStore(AirlinePortalStandingData standing) : IAirlinePortalStandingStore
    {
        public Guid? Organization { get; private set; }

        public DateOnly? Day { get; private set; }

        public Task<AirlinePortalStandingData?> GetStandingAsync(Guid organizationId, DateOnly onDate,
            CancellationToken cancellationToken = default)
        {
            (Organization, Day) = (organizationId, onDate);
            return Task.FromResult<AirlinePortalStandingData?>(standing);
        }
    }

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
