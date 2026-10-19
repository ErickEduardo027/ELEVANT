using System.Data;
using System.Globalization;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

/// <summary>Finance edits of draft preinvoice lines: amounts, exclusions and manual adjustments.</summary>
internal sealed class EfPreinvoiceLineEditStore(
    ElevantDbContext context,
    IActorContextResolver actors,
    TimeProvider timeProvider) : IPreinvoiceLineEditStore
{
    private const decimal MaximumMoney = 900_000_000_000m;

    public Task<FinanceCatalogResult> EditLineAsync(Guid actorId, Guid preinvoiceId, Guid lineId,
        EditPreinvoiceLineInput input, CancellationToken cancellationToken = default) =>
        MutateAsync(actorId, preinvoiceId, input?.ExpectedVersion, async (draft, actor, now) =>
        {
            if (input is null || input.Reason?.Trim().Length is not (>= 3 and <= 500) ||
                !input.Exclude && input.Amount is not (>= 0 and <= MaximumMoney))
                return FinanceCatalogFailure.Invalid;
            var line = await context.PreinvoiceLines.SingleOrDefaultAsync(item =>
                item.PublicId == lineId && item.PreinvoiceId == draft.Id, cancellationToken);
            if (line is null) return FinanceCatalogFailure.NotFound;
            // A service is removed by voiding the draft, never by silently excluding its line.
            if (input.Exclude && line.Kind == PreinvoiceLineKind.Service) return FinanceCatalogFailure.Invalid;
            // Check ambiguity without replacing an already captured explicit treatment with today's policy.
            await FinanceTaxSnapshotWriter.ResolveAsync(context, draft, line, cancellationToken);
            FinanceTaxCalculator.Capture(line, null, now);
            var before = line.IsExcluded ? "excluded" : line.Amount.ToString(CultureInfo.InvariantCulture);
            line.IsExcluded = input.Exclude;
            FinanceTaxCalculator.RepriceGross(line, input.Exclude ? 0m : input.Amount!.Value);
            line.AdjustmentReason = input.Reason.Trim();
            line.EditedByAccountId = actor;
            line.EditedAt = now;
            line.UpdatedAt = now;
            CommercialAuditWriter.Add(context, actor, "finance.preinvoice.line_edited", "commercial.preinvoice_lines",
                line.PublicId, line.AdjustmentReason, new AuditFieldChangeData("line.amount", before,
                    line.IsExcluded ? "excluded" : line.Amount.ToString(CultureInfo.InvariantCulture)));
            return null;
        }, cancellationToken);

    public Task<FinanceCatalogResult> AddAdjustmentAsync(Guid actorId, Guid preinvoiceId,
        AddPreinvoiceAdjustmentInput input, CancellationToken cancellationToken = default) =>
        MutateAsync(actorId, preinvoiceId, input?.ExpectedVersion, async (draft, actor, now) =>
        {
            if (input is null || input.Amount == 0 || Math.Abs(input.Amount) > MaximumMoney ||
                input.Description?.Trim().Length is not (>= 3 and <= 160) ||
                input.Reason?.Trim().Length is not (>= 3 and <= 500))
                return FinanceCatalogFailure.Invalid;
            PreinvoiceLine? parent = null;
            if (input.ParentLineId is { } parentId)
            {
                parent = await context.PreinvoiceLines.AsNoTracking().SingleOrDefaultAsync(item =>
                    item.PublicId == parentId && item.PreinvoiceId == draft.Id && item.Kind == PreinvoiceLineKind.Service,
                    cancellationToken);
                if (parent is null) return FinanceCatalogFailure.Invalid;
            }
            var lastNumber = await context.PreinvoiceLines.Where(item => item.PreinvoiceId == draft.Id)
                .MaxAsync(item => item.LineNumber, cancellationToken);
            var amount = decimal.Round(input.Amount, 4, MidpointRounding.AwayFromZero);
            var line = new PreinvoiceLine
            {
                PublicId = Guid.CreateVersion7(), PreinvoiceId = draft.Id, Kind = PreinvoiceLineKind.Adjustment,
                ParentLineId = parent?.Id, OperationServiceId = parent?.OperationServiceId,
                LineNumber = lastNumber + 1, OperationCode = parent?.OperationCode ?? "AJUSTE",
                OperationDate = parent?.OperationDate ?? draft.To, ServiceCode = "AJUSTE",
                ServiceName = input.Description.Trim(), ExecutedQuantity = 1m, BillingUnit = "unit",
                UnitPrice = Math.Abs(amount), CurrencyCode = draft.CurrencyCode, Amount = amount,
                ComputedQuantity = null, ComputedAmount = null, AdjustmentReason = input.Reason.Trim(),
                EditedByAccountId = actor, EditedAt = now, CreatedAt = now, UpdatedAt = now,
            };
            var policy = await FinanceTaxSnapshotWriter.ResolveAsync(context, draft, line, cancellationToken);
            FinanceTaxCalculator.Capture(line, policy, now);
            FinanceTaxCalculator.RepriceGross(line, amount);
            line.UnitPrice = Math.Abs(line.NetAmount!.Value);
            context.PreinvoiceLines.Add(line);
            CommercialAuditWriter.Add(context, actor, "finance.preinvoice.adjustment_added", "commercial.preinvoice_lines",
                line.PublicId, line.AdjustmentReason,
                new AuditFieldChangeData("adjustment.amount", null, amount.ToString(CultureInfo.InvariantCulture)));
            return null;
        }, cancellationToken);

    /// <summary>Runs one edit on a draft in the actor's station and recalculates its total.</summary>
    private async Task<FinanceCatalogResult> MutateAsync(Guid actorId, Guid preinvoiceId, string? expectedVersion,
        Func<Preinvoice, long, DateTimeOffset, Task<FinanceCatalogFailure?>> edit, CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null || !actor.HasPermission("finance.preinvoices.manage") || !actor.Memberships.Any(membership =>
                membership.Kind == MembershipKind.InternalStaff &&
                membership.OrganizationType == OrganizationType.AviamOperator))
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Forbidden);
        if (string.IsNullOrWhiteSpace(expectedVersion)) return FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid);
        var stations = actor.StationScopes.Select(scope => scope.StationId).ToArray();
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable,
                    cancellationToken);
                var now = timeProvider.GetUtcNow();
                var draft = await (from item in context.Preinvoices
                                   join station in context.Stations on item.StationId equals station.Id
                                   where item.PublicId == preinvoiceId && stations.Contains(station.PublicId)
                                   select item).SingleOrDefaultAsync(cancellationToken);
                if (draft is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.NotFound);
                if (draft.Status != PreinvoiceStatus.Draft ||
                    Convert.ToBase64String(draft.RowVersion) != expectedVersion)
                    return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict);
                var accountId = await context.Users.Where(user => user.PublicId == actorId).Select(user => user.Id)
                    .SingleAsync(cancellationToken);
                if (await edit(draft, accountId, now) is { } failure)
                    return FinanceCatalogResult.Failed(failure);
                await context.SaveChangesAsync(cancellationToken);
                var total = await context.PreinvoiceLines.Where(line => line.PreinvoiceId == draft.Id && !line.IsExcluded)
                    .SumAsync(line => line.Amount, cancellationToken);
                if (total is < 0 or > MaximumMoney)
                    return FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid);
                draft.Total = total;
                draft.UpdatedAt = now;
                await FinanceApprovedServiceChangeWriter.AddAsync(context, draft.StationId, draft.PublicId, now,
                    "finance_preinvoices", cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return FinanceCatalogResult.Success(draft.PublicId);
            });
        }
        catch (FinanceTaxRuleException)
        {
            context.ChangeTracker.Clear();
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict);
        }
        catch (DbUpdateException)
        {
            context.ChangeTracker.Clear();
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict);
        }
    }
}
