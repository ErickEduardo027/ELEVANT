using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Entities;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Operations;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
namespace Elevant.Persistence.Finance;

internal sealed partial class FinanceTreasuryStore(ElevantDbContext context, IActorContextResolver actors,
    TimeProvider timeProvider) : IFinanceTreasuryStore
{
    private sealed class ReceiptScope { public FinanceTreasuryReceipt Receipt { get; init; } = null!; public Guid AirlineId { get; init; } public Guid StationId { get; init; } public long OrganizationId { get; init; } }
    private sealed class InvoiceScope { public NonFiscalInvoice Invoice { get; init; } = null!; public Guid AirlineId { get; init; } public Guid StationId { get; init; } public long OrganizationId { get; init; } }
    private DateOnly Today => DateOnly.FromDateTime(timeProvider.GetUtcNow().UtcDateTime);
    private static string Version(AuditableEntity? entity) => entity is null ? "0" : Convert.ToBase64String(entity.RowVersion);
    private static bool Reason(string? value) => value?.Trim().Length is >= 3 and <= 1000;
    private bool DateValid(DateOnly value) => value != default && value <= Today;
    private static FinanceTreasuryResult Fail(FinanceTreasuryFailure value) => FinanceTreasuryResult.Failed(value);
    private static string Hash<T>(T input) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(input))));

    private async Task<ActorContext?> ActorAsync(Guid id, string permission, CancellationToken ct)
    {
        var actor = await actors.ResolveAsync(id, ct);
        return actor is not null && id != Guid.Empty && actor.AccountId == id && actor.HasPermission(permission) && actor.Memberships.Any(m =>
            m.Kind == MembershipKind.InternalStaff && m.OrganizationType == OrganizationType.AviamOperator) ? actor : null;
    }
    private IQueryable<ReceiptScope> Receipts(ActorContext actor)
    {
        var ids = actor.StationScopes.Select(s => s.StationId).ToArray();
        return from r in context.Set<FinanceTreasuryReceipt>()
               join a in context.Airlines on r.AirlineId equals a.Id
               join o in context.Organizations on a.OrganizationId equals o.Id
               join s in context.Stations on r.StationId equals s.Id
               where ids.Contains(s.PublicId) && s.IsActive && a.IsActive &&
                   o.Type == OrganizationType.AirlineCustomer && o.Status == OrganizationStatus.Active
               select new ReceiptScope { Receipt = r, AirlineId = a.PublicId, StationId = s.PublicId, OrganizationId = o.Id };
    }
    private IQueryable<InvoiceScope> Invoices(ActorContext actor)
    {
        var ids = actor.StationScopes.Select(s => s.StationId).ToArray();
        return from i in context.Set<NonFiscalInvoice>()
               join a in context.Airlines on i.AirlineId equals a.Id
               join o in context.Organizations on a.OrganizationId equals o.Id
               join s in context.Stations on i.StationId equals s.Id
               where ids.Contains(s.PublicId) && s.IsActive && a.IsActive &&
                   o.Type == OrganizationType.AirlineCustomer && o.Status == OrganizationStatus.Active
               select new InvoiceScope { Invoice = i, AirlineId = a.PublicId, StationId = s.PublicId, OrganizationId = o.Id };
    }
    private async Task<FinanceTreasuryReceipt> LockReceiptAsync(long id, CancellationToken ct) =>
        await context.Set<FinanceTreasuryReceipt>().FromSqlInterpolated(
            $"SELECT * FROM [commercial].[finance_treasury_receipts] WITH (UPDLOCK, HOLDLOCK) WHERE [id] = {id}").SingleAsync(ct);
    private async Task LockInvoiceAsync(long id, CancellationToken ct) =>
        _ = await context.Set<NonFiscalInvoice>().FromSqlInterpolated(
            $"SELECT * FROM [commercial].[non_fiscal_invoices] WITH (UPDLOCK, HOLDLOCK) WHERE [id] = {id}").SingleAsync(ct);
    private async Task<FinanceTreasuryInvoiceAccount?> InvoiceAccountAsync(long id, CancellationToken ct) =>
        await context.Set<FinanceTreasuryInvoiceAccount>().SingleOrDefaultAsync(a => a.InvoiceId == id, ct);
    private FinanceTreasuryInvoiceAccount NewAccount(long invoiceId)
    {
        var account = new FinanceTreasuryInvoiceAccount { PublicId = Guid.CreateVersion7(), InvoiceId = invoiceId,
            CreatedAt = timeProvider.GetUtcNow(), UpdatedAt = timeProvider.GetUtcNow() };
        context.Add(account); return account;
    }
    private async Task<FinanceTreasuryResult?> ReplayAsync(Guid actorId, Guid requestId, Guid resource, string operation,
        string hash, CancellationToken ct)
    {
        var prior = await context.Set<FinanceTreasuryRequest>().AsNoTracking().SingleOrDefaultAsync(r => r.RequestId == requestId, ct);
        if (prior is null) return null;
        var owner = await context.Users.AnyAsync(a => a.Id == prior.ActorAccountId && a.PublicId == actorId, ct);
        return owner && prior.ResourceId == resource && prior.Operation == operation && prior.PayloadHash == hash
            ? new(prior.ResultId, prior.ResultVersion, true, null) : Fail(FinanceTreasuryFailure.Conflict);
    }
    private async Task<FinanceTreasuryResult> ExecuteAsync(Guid actorId, Guid requestId, string permission,
        Func<ActorContext, long, Task<FinanceTreasuryResult>> action, CancellationToken ct, bool recoverUnique = true)
    {
        if (requestId == Guid.Empty) return Fail(FinanceTreasuryFailure.Invalid);
        try
        {
            return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var tx = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
                var actor = await ActorAsync(actorId, permission, ct);
                if (actor is null) return Fail(FinanceTreasuryFailure.Forbidden);
                var account = await context.Users.Where(a => a.PublicId == actorId).Select(a => (long?)a.Id).SingleOrDefaultAsync(ct);
                if (account is null) return Fail(FinanceTreasuryFailure.Forbidden);
                var result = await action(actor, account.Value);
                if (result.IsSuccess) await tx.CommitAsync(ct);
                else context.ChangeTracker.Clear();
                return result;
            });
        }
        catch (Exception e) when (e is DbUpdateConcurrencyException ||
            ((e is DbUpdateException or SqlException or RetryLimitExceededException) && Conflict(e.GetBaseException())))
        {
            context.ChangeTracker.Clear();
            // A committed competing request may own this unique key. Reauthorize and replay once.
            if (recoverUnique && e.GetBaseException() is SqlException { Number: 2601 or 2627 })
                return await ExecuteAsync(actorId, requestId, permission, action, ct, false);
            return Fail(FinanceTreasuryFailure.Conflict);
        }
    }
    private static bool Conflict(Exception e) => e is SqlException s && s.Number is 1205 or 2601 or 2627 or 3960;
    private async Task<FinanceTreasuryResult> CompleteAsync(long actorId, Guid requestId, Guid resource, string operation,
        string hash, Guid resultId, AuditableEntity aggregate, long organizationId, long stationId, string reason, CancellationToken ct)
    {
        var now = timeProvider.GetUtcNow(); Touch(aggregate);
        context.Set<AuditEntry>().Add(new AuditEntry { PublicId = Guid.CreateVersion7(), OccurredAt = now,
            ActorType = AuditActorType.Account, ActorAccountId = actorId, Action = "finance.treasury." + operation,
            EntityType = operation == "receipt.recorded" ? nameof(FinanceTreasuryReceipt) : operation == "adjustment.issued"
                ? nameof(FinanceTreasuryAdjustmentNote) : nameof(FinanceTreasuryMovement), EntityPublicId = resultId, OrganizationId = organizationId,
            StationId = stationId, Source = AuditSource.Api, CorrelationId = requestId, RequestId = requestId.ToString("D"), Reason = reason,
            MetadataJson = JsonSerializer.Serialize(new { ResourceId = resource, PayloadHash = hash }) });
        await FinanceApprovedServiceChangeWriter.AddAsync(context, stationId, resultId, now, "finance_receipts", ct);
        var airlineId = await context.Airlines.AsNoTracking().Where(a => a.OrganizationId == organizationId)
            .Select(a => a.PublicId).SingleAsync(ct);
        await AirlineOperationChangeWriter.AddTreasuryAsync(context, organizationId, airlineId, now, ct);
        await context.SaveChangesAsync(ct);
        var version = Version(aggregate);
        context.Set<FinanceTreasuryRequest>().Add(new FinanceTreasuryRequest { PublicId = Guid.CreateVersion7(),
            RequestId = requestId, ResourceId = resource, ActorAccountId = actorId, Operation = operation, PayloadHash = hash,
            ResultId = resultId, ResultVersion = version, CreatedAt = now, UpdatedAt = now });
        await context.SaveChangesAsync(ct);
        return new(resultId, version, false, null);
    }
    private void Touch(AuditableEntity aggregate)
    {
        aggregate.UpdatedAt = timeProvider.GetUtcNow();
        if (context.Entry(aggregate).State != EntityState.Added)
            context.Entry(aggregate).Property(a => a.UpdatedAt).IsModified = true;
    }
    private async Task<FinanceTreasuryMovement[]> ReceiptMovementsAsync(long id, CancellationToken ct) =>
        await context.Set<FinanceTreasuryMovement>().AsNoTracking().Where(m => m.ReceiptId == id).ToArrayAsync(ct);
    private static decimal Applied(IEnumerable<FinanceTreasuryMovement> moves) => moves.Sum(m => m.Kind switch {
        FinanceTreasuryMovementKind.Application => m.ReceiptAmount, FinanceTreasuryMovementKind.ApplicationReversal => -m.ReceiptAmount, _ => 0m });
    private static decimal Available(FinanceTreasuryReceipt receipt, FinanceTreasuryMovement[] moves) =>
        FinanceTreasuryRules.Available(receipt.Amount, Applied(moves), moves.Where(m => m.Kind == FinanceTreasuryMovementKind.Refund).Sum(m => m.ReceiptAmount),
            moves.Any(m => m.Kind == FinanceTreasuryMovementKind.ReceiptReversal));
    private FinanceTreasuryMovement Movement(long actor, Guid request, FinanceTreasuryReceipt receipt,
        FinanceTreasuryMovementKind kind, DateOnly date, decimal amount, string reason) => new() {
            PublicId = Guid.CreateVersion7(), ReceiptId = receipt.Id, ActorAccountId = actor, RequestId = request,
            Kind = kind, EffectiveOn = date, ReceiptAmount = amount, ReceiptCurrency = receipt.CurrencyCode,
            ExchangeRate = 1m, ExchangeRateOn = date, Reason = reason.Trim(), CreatedAt = timeProvider.GetUtcNow(), UpdatedAt = timeProvider.GetUtcNow() };
}
