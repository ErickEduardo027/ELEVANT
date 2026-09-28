using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class RecordNonFiscalPaymentHandlerTests
{
    [Fact]
    public async Task RequiresFinanceAuthorityAndAStableReferenceBeforeRecording()
    {
        var accountId = Guid.NewGuid();
        var invoiceId = Guid.NewGuid();
        var requestId = Guid.NewGuid();
        var store = new Stub();
        var anonymous = new RecordNonFiscalPaymentHandler(new Resolver(null), store);
        Assert.Equal(RecordNonFiscalPaymentFailure.Unauthorized,
            (await anonymous.HandleAsync(accountId, invoiceId, requestId,
                "DEV-PAY-001", TestContext.Current.CancellationToken)).Failure);
        Assert.Null(store.Command);

        var actor = new ActorContext(accountId, "finance@dev.elevant.test", "Finance",
            [new ActorRole(Guid.NewGuid(), "FINANZAS", "Finance", PortalKind.BackOffice, "finance")],
            [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM",
                OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
            [new ActorStationScope(Guid.NewGuid(), "PUJ")]);
        var handler = new RecordNonFiscalPaymentHandler(new Resolver(actor), store);
        Assert.Equal(RecordNonFiscalPaymentFailure.InvalidRequest,
            (await handler.HandleAsync(accountId, invoiceId, requestId,
                "not valid!", TestContext.Current.CancellationToken)).Failure);
        Assert.Null(store.Command);
        var result = await handler.HandleAsync(accountId, invoiceId, requestId,
            "DEV-PAY-001", TestContext.Current.CancellationToken);
        Assert.True(result.IsSuccess);
        Assert.Equal(new RecordNonFiscalPaymentCommand(accountId, invoiceId,
            requestId, "DEV-PAY-001"), store.Command);
    }

    private sealed class Resolver(ActorContext? actor) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId,
            CancellationToken cancellationToken = default) => Task.FromResult(actor);
    }

    private sealed class Stub : INonFiscalPaymentStore
    {
        public RecordNonFiscalPaymentCommand? Command { get; private set; }
        public Task<RecordNonFiscalPaymentResult> RecordAsync(RecordNonFiscalPaymentCommand command,
            CancellationToken cancellationToken = default)
        {
            Command = command;
            return Task.FromResult(RecordNonFiscalPaymentResult.Success(
                Guid.NewGuid(), command.Reference, 10m, "USD", false));
        }
    }
}
