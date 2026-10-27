using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

internal sealed class EfFinancePreinvoiceReviewStore(ElevantDbContext context, IActorContextResolver actors, TimeProvider clock) : IFinancePreinvoiceReviewStore
{
    private async Task<long?> AuthorizeAsync(Guid id, long stationId, string permission, CancellationToken ct)
    {
        var actor = await actors.ResolveAsync(id, ct);
        var station = await context.Stations.AsNoTracking().Where(x => x.Id == stationId).Select(x => x.PublicId).SingleAsync(ct);
        if (actor is null || !actor.HasPermission(permission) || !actor.StationScopes.Any(x => x.StationId == station) || !actor.Memberships.Any(x => x.Kind == MembershipKind.InternalStaff && x.OrganizationType == OrganizationType.AviamOperator)) return null;
        return await context.Users.Where(x => x.PublicId == id).Select(x => (long?)x.Id).SingleAsync(ct);
    }
    public async Task<IReadOnlyList<FinanceLineCalculation>?> CalculationsAsync(Guid actorId, Guid preinvoiceId, CancellationToken cancellationToken = default)
    {
        var draft = await context.Preinvoices.AsNoTracking().SingleOrDefaultAsync(x => x.PublicId == preinvoiceId, cancellationToken);
        if (draft is null || await AuthorizeAsync(actorId, draft.StationId, "finance.preinvoices.read", cancellationToken) is null) return null;
        var rows = await (from line in context.PreinvoiceLines.AsNoTracking()
            join source in context.OperationServices.AsNoTracking() on line.OperationServiceId equals (long?)source.Id into sourceRows
            from source in sourceRows.DefaultIfEmpty()
            join submission in context.OperationSubmissions.AsNoTracking() on line.ApprovedSubmissionId equals (long?)submission.Id into submissionRows
            from submission in submissionRows.DefaultIfEmpty()
            where line.PreinvoiceId == draft.Id orderby line.LineNumber
            select new { Line = line, ServiceId = source == null ? (Guid?)null : source.PublicId, SubmissionId = submission == null ? (Guid?)null : submission.PublicId }).ToArrayAsync(cancellationToken);
        var result = new List<FinanceLineCalculation>();
        foreach (var row in rows)
        {
            var steps = new List<FinanceCalculationStep> { new("Cantidad registrada", row.Line.ExecutedQuantity, row.Line.BillingUnit, null), new("Precio", row.Line.UnitPrice, null, row.Line.CurrencyCode), new("Importe de origen", row.Line.ComputedAmount ?? row.Line.Amount, null, row.Line.CurrencyCode), new("Importe revisado", row.Line.Amount, null, row.Line.CurrencyCode) };
            if (row.Line.CalculationJson is { } json)
            {
                using var document = JsonDocument.Parse(json); var root = document.RootElement;
                foreach (var (key, label) in new[] { ("consumedBefore", "Consumo anterior del ámbito"), ("includedLimit", "Cantidad incluida"), ("includedQuantity", "Cobertura aplicada"), ("excessQuantity", "Consumo excedente"), ("excessBlockSize", "Tamaño del bloque"), ("excessBlocksAfter", "Bloques acumulados") })
                    {
                        var value = root.EnumerateObject().FirstOrDefault(property => string.Equals(property.Name, key, StringComparison.OrdinalIgnoreCase)).Value;
                        if (value.ValueKind == JsonValueKind.Number && value.TryGetDecimal(out var number)) steps.Add(new(label, number, null, null));
                    }
            }
            result.Add(new(row.Line.PublicId, row.Line.Kind.ToString(), row.Line.ServiceName + (row.Line.AdjustmentReason is null ? "" : " · " + row.Line.AdjustmentReason), row.ServiceId, row.SubmissionId, steps));
        }
        return result;
    }
    public Task<PackageWriteResult> CancelAsync(Guid actorId, Guid preinvoiceId, PreinvoiceReviewInput input, CancellationToken cancellationToken = default) => ChangeAsync(actorId, preinvoiceId, input, true, cancellationToken);
    public Task<PackageWriteResult> RestoreCalculationAsync(Guid actorId, Guid preinvoiceId, PreinvoiceReviewInput input, CancellationToken cancellationToken = default) => ChangeAsync(actorId, preinvoiceId, input, false, cancellationToken);
    private async Task<PackageWriteResult> ChangeAsync(Guid actorId, Guid id, PreinvoiceReviewInput input, bool cancel, CancellationToken ct)
    {
        var existing = await context.Preinvoices.AsNoTracking().SingleOrDefaultAsync(x => x.PublicId == id, ct);
        if (existing is null) return PackageWriteResult.Fail("not_found");
        var actor = await AuthorizeAsync(actorId, existing.StationId, "finance.preinvoices.update", ct);
        if (actor is null) return PackageWriteResult.Fail("forbidden");
        if (input.RequestId == Guid.Empty || string.IsNullOrWhiteSpace(input.ExpectedVersion) || string.IsNullOrWhiteSpace(input.Reason) || input.Reason.Trim().Length is < 3 or > 500) return PackageWriteResult.Fail("invalid_request");
        var action = cancel ? "finance.preinvoice.cancelled" : "finance.preinvoice.calculation_restored";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { id, input, cancel }))));
        try
        {
            return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear(); await using var tx = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
                var receipt = await context.Set<FinancePricingCommand>().SingleOrDefaultAsync(x => x.RequestId == input.RequestId, ct);
                if (receipt is not null) return receipt.ActorAccountId == actor && receipt.Action == action && receipt.PayloadHash == hash ? PackageWriteResult.Success(receipt.ResultId) : PackageWriteResult.Fail("idempotency_conflict");
                var draft = await context.Preinvoices.SingleAsync(x => x.PublicId == id, ct);
                if (draft.Status != PreinvoiceStatus.Draft || Convert.ToBase64String(draft.RowVersion) != input.ExpectedVersion) return PackageWriteResult.Fail("version_conflict");
                var lines = await context.PreinvoiceLines.Where(x => x.PreinvoiceId == draft.Id).ToArrayAsync(ct);
                var before = draft.Total; var now = clock.GetUtcNow();
                if (cancel)
                {
                    draft.Status = PreinvoiceStatus.Voided; foreach (var line in lines) { line.ReleasedAt = now; line.UpdatedAt = now; }
                }
                else
                {
                    foreach (var line in lines.Where(x => x.Kind != PreinvoiceLineKind.Adjustment && x.ComputedAmount.HasValue))
                    {
                        line.Amount = line.ComputedAmount!.Value; line.IsExcluded = line.ComputedIsExcluded ?? line.IsExcluded; line.EditedByAccountId = actor; line.EditedAt = now; line.AdjustmentReason = input.Reason.Trim(); line.UpdatedAt = now;
                    }
                    FinanceTaxSnapshotWriter.RestoreComputed(lines.Where(x => x.Kind != PreinvoiceLineKind.Adjustment && x.ComputedAmount.HasValue).ToArray());
                    draft.Total = lines.Where(x => !x.IsExcluded).Sum(x => x.Amount);
                    if (draft.Total < 0) return PackageWriteResult.Fail("invalid_amount");
                }
                draft.UpdatedAt = now;
                CommercialAuditWriter.Add(context, actor.Value, action, "commercial.preinvoices", draft.PublicId, input.Reason.Trim(), new Elevant.Application.Abstractions.Identity.AuditFieldChangeData("total", before.ToString(System.Globalization.CultureInfo.InvariantCulture), draft.Total.ToString(System.Globalization.CultureInfo.InvariantCulture)));
                context.Set<FinancePricingCommand>().Add(new() { PublicId = Guid.CreateVersion7(), RequestId = input.RequestId, ActorAccountId = actor.Value, Action = action, PayloadHash = hash, ResultId = id, CreatedAt = now, UpdatedAt = now });
                await FinanceApprovedServiceChangeWriter.AddAsync(context, draft.StationId, id, now, "finance_preinvoices", ct);
                await context.SaveChangesAsync(ct); await tx.CommitAsync(ct); return PackageWriteResult.Success(id);
            });
        }
        catch (DbUpdateException) { context.ChangeTracker.Clear(); return PackageWriteResult.Fail("version_conflict"); }
    }
}
