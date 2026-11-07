using System.Data;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

/// <summary>Finance tariffs, charges, exchange rates and contract approvals.</summary>
internal sealed partial class EfFinanceTariffBookStore(
    ElevantDbContext context,
    IActorContextResolver actors,
    TimeProvider timeProvider) : IFinanceTariffBookStore
{
    private static readonly string[] Currencies = ["USD", "DOP"];

    private sealed record Actor(long Id, ActorContext Context);

    /// <summary>Internal AVIAM staff holding <paramref name="permission"/>; null otherwise.</summary>
    private async Task<Actor?> AuthorizeAsync(Guid actorId, string permission, CancellationToken cancellationToken)
    {
        if (actorId == Guid.Empty) return null;
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null || !actor.HasPermission(permission) || !actor.Memberships.Any(membership =>
                membership.Kind == MembershipKind.InternalStaff &&
                membership.OrganizationType == OrganizationType.AviamOperator))
            return null;
        var id = await context.Users.Where(user => user.PublicId == actorId).Select(user => user.Id)
            .SingleAsync(cancellationToken);
        return new Actor(id, actor);
    }

    private static string Version(byte[] rowVersion) => Convert.ToBase64String(rowVersion);

    private static bool ValidCurrency(string? code) => code is not null && Currencies.Contains(code);

    private const string IdempotencyConflict = "idempotency_conflict";

    /// <summary>
    /// Runs a command of the tariff books serializable. With an Idempotency-Key the receipt is resolved
    /// first, before the rules and the expected version: a retry of a command whose answer was lost replays
    /// the first result instead of failing on the rowversion it already changed. The receipt of a success is
    /// written in the same transaction, so a replay never repeats the audit or the notices. Without a key
    /// (older clients, expand) the command runs as before; an empty key is <c>idempotency_key_required</c>.
    /// The payload is the route identifier and the normalized body, never the key.
    /// </summary>
    private async Task<FinanceCatalogResult> CommandAsync(Actor actor, Guid? idempotencyKey, string action,
        object payload, Func<Task<FinanceCatalogResult>> work, CancellationToken cancellationToken)
    {
        if (idempotencyKey == Guid.Empty)
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid, "idempotency_key_required");
        var hash = CommercialCommandReceipts.Hash(payload);
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);
                if (idempotencyKey is { } key)
                {
                    var prior = await CommercialCommandReceipts.FindAsync(context, key, actor.Id, action, hash,
                        cancellationToken);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay)
                        return FinanceCatalogResult.Success(prior.ResultId);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                        return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict, IdempotencyConflict);
                }
                var result = await work();
                if (!result.IsSuccess)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    context.ChangeTracker.Clear();
                    return result;
                }
                if (idempotencyKey is { } receipt)
                    CommercialCommandReceipts.Add(context, receipt, actor.Id, action, hash, result.Id!.Value,
                        timeProvider.GetUtcNow());
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return result;
            });
        }
        catch (DbUpdateException exception) when (idempotencyKey is { } key &&
            CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            // A concurrent command with the same key committed first: its receipt decides.
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, key, actor.Id, action, hash,
                cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? FinanceCatalogResult.Success(concurrent.ResultId)
                : FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict, IdempotencyConflict);
        }
        catch (DbUpdateException)
        {
            context.ChangeTracker.Clear();
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict, "version_conflict");
        }
    }

    /// <summary>Announces a Finance reference change to everyone who reads it; clients re-read through REST.</summary>
    private async Task NotifyAsync(string permission, string resource, Guid resourceId, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        foreach (var recipient in await DepartmentAccessQueries.AccountsWithPermissionAsync(context, permission,
                     cancellationToken))
            AccountChangeOutboxWriter.Add(context, recipient, null, resource, resourceId, now);
    }

    private void Audit(long actorId, string action, string entityType, Guid entityId, string? reason = null,
        params AuditFieldChangeData[] changes) =>
        CommercialAuditWriter.Add(context, actorId, action, entityType, entityId, reason, changes);

    /// <summary>
    /// Catalog services Finance can price, including inactive ones still present in tariffs. The default
    /// unit is a unit code (1-E): a legacy name stored by the catalog («operación») is read as its code,
    /// so the tariff screen proposes a unit the save accepts.
    /// </summary>
    public async Task<IReadOnlyList<FinanceServiceOptionData>?> ListServicesAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        if (await AuthorizeAsync(actorId, "finance.tariffs.read", cancellationToken) is null) return null;
        var units = await BillingUnitCodes.LoadAsync(context, cancellationToken);
        return (await context.ServiceDefinitions.AsNoTracking().OrderBy(service => service.Code)
                .Select(service => new { service.PublicId, service.Code, service.Name, service.DefaultBillingUnit, service.IsActive })
                .ToArrayAsync(cancellationToken))
            .Select(service => new FinanceServiceOptionData(service.PublicId, service.Code, service.Name,
                units.Normalize(service.DefaultBillingUnit), service.IsActive)).ToArray();
    }

    public async Task<IReadOnlyList<BillingUnitData>?> ListBillingUnitsAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null || !(actor.HasPermission("finance.billing_units.read") || actor.HasPermission("finance.tariffs.read") ||
                actor.HasPermission("contracts.catalog.read") ||
                actor.HasPermission("contracts.drafts.read")))
            return null;
        return (await context.BillingUnits.AsNoTracking().OrderBy(unit => unit.Code).ToArrayAsync(cancellationToken))
            .Select(unit => new BillingUnitData(unit.PublicId, unit.Code, unit.Name, unit.QuantityScale, unit.IsActive,
                Version(unit.RowVersion))).ToArray();
    }

    public async Task<FinanceCatalogResult> SaveBillingUnitAsync(Guid actorId, Guid? unitId, SaveBillingUnitInput input,
        Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        var actor = await AuthorizeAsync(actorId, unitId is null ? "finance.billing_units.create" : "finance.billing_units.update",
            cancellationToken);
        if (actor is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.Forbidden);
        var code = input?.Code?.Trim().ToLowerInvariant();
        if (input is null || code is null || code.Length is < 2 or > 32 ||
            !code.All(character => char.IsAsciiLetterLower(character) || char.IsAsciiDigit(character) || character == '-') ||
            string.IsNullOrWhiteSpace(input.Name) || input.Name.Trim().Length > 80 ||
            input.QuantityScale is < 0 or > 4 || unitId is not null && string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid, "invalid_billing_unit");
        return await CommandAsync(actor, idempotencyKey,
            unitId is null ? "finance.billing_unit.create" : "finance.billing_unit.update",
            new { unitId, code, name = input.Name.Trim(), input.QuantityScale, input.IsActive, input.ExpectedVersion },
            async () =>
        {
            var now = timeProvider.GetUtcNow();
            BillingUnit? unit = null;
            if (unitId is { } id)
            {
                unit = await context.BillingUnits.SingleOrDefaultAsync(item => item.PublicId == id, cancellationToken);
                if (unit is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.NotFound, "not_found");
                if (Version(unit.RowVersion) != input.ExpectedVersion)
                    return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict, "version_conflict");
                // Rates and services keep the code: it never changes once created.
                if (unit.Code != code)
                    return FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid, "billing_unit_code_locked");
            }
            else
            {
                if (await context.BillingUnits.AnyAsync(item => item.Code == code, cancellationToken))
                    return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict, "billing_unit_exists");
                unit = new BillingUnit { PublicId = Guid.CreateVersion7(), Code = code, CreatedAt = now };
                context.BillingUnits.Add(unit);
            }
            unit.Name = input.Name.Trim();
            unit.QuantityScale = (byte)input.QuantityScale;
            unit.IsActive = input.IsActive;
            unit.UpdatedAt = now;
            Audit(actor.Id, unitId is null ? "finance.billing_unit.created" : "finance.billing_unit.updated",
                "ref.billing_units", unit.PublicId, null, new AuditFieldChangeData("unit", null, $"{code}:{unit.Name}"));
            await NotifyAsync("finance.billing_units.read", "finance_tariff_book", unit.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return FinanceCatalogResult.Success(unit.PublicId);
        }, cancellationToken);
    }

}
