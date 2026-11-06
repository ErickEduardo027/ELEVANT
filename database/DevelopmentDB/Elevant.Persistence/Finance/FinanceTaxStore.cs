using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

public sealed class FinanceTaxStore(ElevantDbContext context, IActorContextResolver actors, TimeProvider clock) : IFinanceTaxStore
{
    private async Task<ActorContext?> AuthorizeAsync(Guid id, string permission, CancellationToken ct)
    {
        var actor = await actors.ResolveAsync(id, ct);
        return actor is not null && actor.HasPermission(permission) && actor.Memberships.Any(m =>
            m.Kind == MembershipKind.InternalStaff && m.OrganizationType == OrganizationType.AviamOperator) ? actor : null;
    }
    public async Task<FinanceTaxContextData?> ContextAsync(Guid actorId, CancellationToken ct = default)
    {
        var actor = await AuthorizeAsync(actorId, "finance.taxes.read", ct); if (actor is null) return null;
        var ids = actor.StationScopes.Select(s => s.StationId).ToArray();
        return new(await context.Airlines.AsNoTracking().Where(a => a.IsActive).OrderBy(a => a.Name)
            .Select(a => new FinanceTaxOption(a.PublicId, a.IataCode ?? a.IcaoCode, a.Name)).ToArrayAsync(ct),
            await context.Stations.AsNoTracking().Where(s => s.IsActive && ids.Contains(s.PublicId)).OrderBy(s => s.Code)
                .Select(s => new FinanceTaxOption(s.PublicId, s.Code, s.Name)).ToArrayAsync(ct));
    }
    public async Task<IReadOnlyList<FinanceTaxPolicyData>?> ListAsync(Guid actorId, CancellationToken ct = default)
    {
        var actor = await AuthorizeAsync(actorId, "finance.taxes.read", ct); if (actor is null) return null;
        var ids = actor.StationScopes.Select(s => s.StationId).ToArray();
        return await (from p in context.Set<FinanceTaxPolicy>().AsNoTracking()
            join a in context.Airlines on p.AirlineId equals a.Id
            join s in context.Stations on p.StationId equals s.Id
            join prior in context.Set<FinanceTaxPolicy>() on p.ReplacesPolicyId equals (long?)prior.Id into predecessors
            from prior in predecessors.DefaultIfEmpty()
            where ids.Contains(s.PublicId) orderby p.CreatedAt descending, p.Id descending
            select new FinanceTaxPolicyData(p.PublicId, a.PublicId, a.Name, s.PublicId, s.Code, p.CurrencyCode,
                p.ConceptKind.ToString(), p.ConceptCode, p.Treatment.ToString(), p.Rate, p.Basis, p.ValidFrom, p.ValidTo,
                p.Status.ToString(), prior == null ? null : prior.PublicId, Convert.ToBase64String(p.RowVersion))).ToArrayAsync(ct);
    }
    public Task<FinanceTaxWriteResult> CreateAsync(Guid actorId, FinanceTaxPolicyInput input, CancellationToken ct = default) =>
        WriteAsync(actorId, "create", null, input.RequestId, input, async (actor, account, now) =>
        {
            if (!Enum.TryParse<PreinvoiceLineKind>(input.ConceptKind, false, out var kind) ||
                !Enum.TryParse<FinanceTaxTreatment>(input.Treatment, false, out var treatment)) return FinanceTaxWriteResult.Fail("invalid_tax_policy");
            var airline = await context.Airlines.SingleOrDefaultAsync(a => a.PublicId == input.AirlineId && a.IsActive, ct);
            var station = await context.Stations.SingleOrDefaultAsync(s => s.PublicId == input.StationId && s.IsActive, ct);
            if (airline is null || station is null || !actor.StationScopes.Any(s => s.StationId == station.PublicId))
                return FinanceTaxWriteResult.Fail("invalid_tax_context");
            var p = new FinanceTaxPolicy { PublicId = Guid.CreateVersion7(), AirlineId = airline.Id, StationId = station.Id,
                CurrencyCode = input.CurrencyCode ?? "", ConceptKind = kind, ConceptCode = input.ConceptCode?.Trim().ToUpperInvariant() ?? "",
                Treatment = treatment, Rate = input.Rate, Basis = input.Basis?.Trim(), ValidFrom = input.ValidFrom,
                ValidTo = input.ValidTo, Status = FinanceTaxPolicyStatus.Draft, CreatedByAccountId = account, CreatedAt = now, UpdatedAt = now };
            FinanceTaxCalculator.Validate(p);
            if (input.ReplacesPolicyId is { } previous)
            {
                var prior = await context.Set<FinanceTaxPolicy>().SingleOrDefaultAsync(x => x.PublicId == previous, ct);
                if (prior is null || prior.Status != FinanceTaxPolicyStatus.Published || !SameConcept(p, prior))
                    return FinanceTaxWriteResult.Fail("invalid_tax_replacement");
                if (Convert.ToBase64String(prior.RowVersion) != input.ExpectedVersion) return FinanceTaxWriteResult.Fail("version_conflict");
                p.ReplacesPolicyId = prior.Id;
            }
            else if (!string.IsNullOrEmpty(input.ExpectedVersion)) return FinanceTaxWriteResult.Fail("invalid_request");
            context.Set<FinanceTaxPolicy>().Add(p);
            return FinanceTaxWriteResult.Success(p.PublicId);
        }, ct);

    public Task<FinanceTaxWriteResult> PublishAsync(Guid actorId, Guid id, FinanceTaxCommandInput input, CancellationToken ct = default) =>
        WriteAsync(actorId, "publish", id, input.RequestId, input, async (actor, account, now) =>
        {
            var p = await ScopedPolicyAsync(actor, id, ct); if (p is null) return FinanceTaxWriteResult.Fail("not_found");
            if (p.Status != FinanceTaxPolicyStatus.Draft || Convert.ToBase64String(p.RowVersion) != input.ExpectedVersion)
                return FinanceTaxWriteResult.Fail("version_conflict");
            FinanceTaxCalculator.Validate(p);
            var all = await context.Set<FinanceTaxPolicy>().Where(x => x.AirlineId == p.AirlineId && x.StationId == p.StationId &&
                x.CurrencyCode == p.CurrencyCode && x.ConceptKind == p.ConceptKind && x.ConceptCode == p.ConceptCode &&
                x.Status == FinanceTaxPolicyStatus.Published).ToArrayAsync(ct);
            var ancestors = new HashSet<long>(); var prior = p.ReplacesPolicyId;
            while (prior is { } key && ancestors.Add(key)) prior = all.SingleOrDefault(x => x.Id == key)?.ReplacesPolicyId;
            if (all.Any(x => !ancestors.Contains(x.Id) && x.ValidFrom <= (p.ValidTo ?? DateOnly.MaxValue) &&
                (x.ValidTo ?? DateOnly.MaxValue) >= p.ValidFrom)) return FinanceTaxWriteResult.Fail("ambiguous_tax_policy");
            p.Status = FinanceTaxPolicyStatus.Published; p.PublishedByAccountId = account; p.PublishedAt = now; p.UpdatedAt = now;
            return FinanceTaxWriteResult.Success(id);
        }, ct);

    private Task<FinanceTaxPolicy?> ScopedPolicyAsync(ActorContext actor, Guid id, CancellationToken ct)
    {
        var ids = actor.StationScopes.Select(s => s.StationId).ToArray();
        return context.Set<FinanceTaxPolicy>().SingleOrDefaultAsync(p => p.PublicId == id &&
            context.Stations.Any(s => s.Id == p.StationId && ids.Contains(s.PublicId)), ct);
    }
    private static bool SameConcept(FinanceTaxPolicy a, FinanceTaxPolicy b) => a.AirlineId == b.AirlineId &&
        a.StationId == b.StationId && a.CurrencyCode == b.CurrencyCode && a.ConceptKind == b.ConceptKind && a.ConceptCode == b.ConceptCode;

    public async Task<FinanceTaxDetailData?> GetPreinvoiceAsync(Guid actorId, Guid id, CancellationToken ct = default)
    {
        var actor = await AuthorizeAsync(actorId, "finance.taxes.read", ct); if (actor is null) return null;
        var draft = await ScopedDraftAsync(actor, id, ct); if (draft is null) return null;
        var lines = await context.PreinvoiceLines.AsNoTracking().Where(l => l.PreinvoiceId == draft.Id).OrderBy(l => l.LineNumber).ToArrayAsync(ct);
        var included = lines.Where(l => !l.IsExcluded).ToArray(); var configured = included.Length > 0 && included.All(FinanceTaxCalculator.IsConfigured);
        return new(id, Convert.ToBase64String(draft.RowVersion), draft.CurrencyCode,
            included.Sum(l => l.NetAmount ?? l.Amount), included.Sum(l => l.DiscountAmount ?? 0),
            configured ? included.Sum(l => l.TaxAmount ?? 0) : null, draft.Total, configured,
            lines.Select(l => new FinanceTaxLineData(l.PublicId, l.LineNumber, l.Kind.ToString(), l.ServiceCode, l.ServiceName,
                l.TaxTreatment.ToString(), l.TaxPolicyPublicId, l.TaxRate, l.TaxBasis, l.NetAmount ?? l.Amount,
                l.DiscountAmount ?? 0, l.TaxAmount, l.GrossAmount ?? l.Amount, FinanceTaxCalculator.IsConfigured(l), l.IsExcluded)).ToArray());
    }
    private Task<Preinvoice?> ScopedDraftAsync(ActorContext actor, Guid id, CancellationToken ct)
    {
        var ids = actor.StationScopes.Select(s => s.StationId).ToArray();
        return context.Preinvoices.SingleOrDefaultAsync(p => p.PublicId == id && context.Stations.Any(s =>
            s.Id == p.StationId && ids.Contains(s.PublicId)), ct);
    }
    public Task<FinanceTaxWriteResult> ApplyAsync(Guid actorId, Guid id, FinanceTaxCommandInput input, CancellationToken ct = default) =>
        WriteAsync(actorId, "apply", id, input.RequestId, input, async (actor, _, now) =>
        {
            var draft = await ScopedDraftAsync(actor, id, ct); if (draft is null) return FinanceTaxWriteResult.Fail("not_found");
            if (draft.Status != PreinvoiceStatus.Draft || Convert.ToBase64String(draft.RowVersion) != input.ExpectedVersion)
                return FinanceTaxWriteResult.Fail("version_conflict");
            var lines = await context.PreinvoiceLines.Where(l => l.PreinvoiceId == draft.Id).ToArrayAsync(ct);
            await FinanceTaxSnapshotWriter.ApplyOnceAsync(context, draft, lines, now, ct, configureMissing: true);
            if (draft.Total is < 0 or > 900_000_000_000m) return FinanceTaxWriteResult.Fail("invalid_amount");
            draft.UpdatedAt = now;
            await FinanceApprovedServiceChangeWriter.AddAsync(context, draft.StationId, id, now, "finance_preinvoices", ct);
            return FinanceTaxWriteResult.Success(id);
        }, ct);

    private async Task<FinanceTaxWriteResult> WriteAsync(Guid actorId, string action, Guid? id, Guid requestId, object payload,
        Func<ActorContext, long, DateTimeOffset, Task<FinanceTaxWriteResult>> write, CancellationToken ct)
    {
        var actor = await AuthorizeAsync(actorId, action == "create" ? "finance.taxes.create" : "finance.taxes.update", ct); if (actor is null) return FinanceTaxWriteResult.Fail("forbidden");
        if (requestId == Guid.Empty) return FinanceTaxWriteResult.Fail("invalid_request");
        var account = await context.Users.Where(u => u.PublicId == actorId).Select(u => u.Id).SingleAsync(ct);
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { action, id, payload }))));
        try
        {
            return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var tx = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
                var old = await context.Set<FinanceTaxCommand>().SingleOrDefaultAsync(c => c.RequestId == requestId, ct);
                if (old is not null) return old.ActorAccountId == account && old.Action == action && old.PayloadHash == hash
                    ? FinanceTaxWriteResult.Success(old.ResultId) : FinanceTaxWriteResult.Fail("idempotency_conflict");
                var now = clock.GetUtcNow(); var result = await write(actor, account, now);
                if (!result.IsSuccess) { context.ChangeTracker.Clear(); return result; }
                context.Set<FinanceTaxCommand>().Add(new() { PublicId = Guid.CreateVersion7(), RequestId = requestId,
                    ActorAccountId = account, Action = action, PayloadHash = hash, ResultId = result.Id!.Value, CreatedAt = now, UpdatedAt = now });
                CommercialAuditWriter.Add(context, account, "finance.tax." + action, "commercial.finance_tax_policies", result.Id.Value,
                    "Explicit governed tax configuration/snapshot command.");
                await context.SaveChangesAsync(ct); await tx.CommitAsync(ct); return result;
            });
        }
        catch (FinanceTaxRuleException e) { context.ChangeTracker.Clear(); return FinanceTaxWriteResult.Fail(e.Code); }
        catch (DbUpdateException) { context.ChangeTracker.Clear(); return FinanceTaxWriteResult.Fail("version_conflict"); }
    }
}
