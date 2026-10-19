using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

internal sealed partial class FinancePayablesStore(ElevantDbContext context, IActorContextResolver actors,
    IPrivateFinancialObjectStore objects, TimeProvider clock) : IFinancePayablesStore
{
    private sealed record Actor(long Id, long PersonId, ActorContext Context, long[] Stations, Employee? Employee);
    private sealed class Fault(string code) : Exception(code) { public string Code { get; } = code; }
    private static void Require(bool condition, string code = "invalid") { if (!condition) throw new Fault(code); }
    private static string Version(byte[] value) => Convert.ToBase64String(value);
    private static void Match(byte[] value, string? expected) => Require(!string.IsNullOrEmpty(expected) && Version(value) == expected, "conflict");
    private static bool Text(string? value, int max) => !string.IsNullOrWhiteSpace(value) && value.Trim().Length <= max;
    private static bool OptionalText(string? value, int max) => value is null || value.Trim().Length <= max;
    private static bool Finance(Actor a, string permission) => a.Context.EffectiveAccess?.Department == Department.Finance && a.Context.HasPermission(permission);
    private static void Scope(Actor a, long station) => Require(a.Stations.Contains(station), "not_found");
    private DateOnly SettlementToday => DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
    private DateTimeOffset SettlementCutoff => new(SettlementToday.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc));
    private void RequireSettlementDate(DateOnly date) => Require(date != default && date <= SettlementToday);
    // Current projections use the same inclusive UTC day as the as-of AP/expense reports.
    private IQueryable<FinancePayablesApplication> CurrentApplications()
    {
        var today = SettlementToday; var end = SettlementCutoff;
        return from application in context.Set<FinancePayablesApplication>()
            join payment in context.Set<FinancePayablesPayment>() on application.PaymentId equals payment.Id
            where payment.PaidOn <= today && payment.CreatedAt < end && application.AppliedAt < end
            select application;
    }
    private IQueryable<EmployeeExpensePayment> CurrentReimbursements()
    {
        var today = SettlementToday; var end = SettlementCutoff;
        return context.Set<EmployeeExpensePayment>().Where(p => p.PaidOn <= today && p.CreatedAt < end);
    }
    private async Task<Actor> ActorAsync(Guid id, string permission, CancellationToken ct)
    {
        var actor = await actors.ResolveAsync(id, ct);
        Require(actor is not null, "unauthorized");
        Require(actor!.Memberships.Any(m => m.Kind == MembershipKind.InternalStaff && m.OrganizationType == OrganizationType.AviamOperator), "forbidden");
        var user = await context.Users.AsNoTracking().SingleOrDefaultAsync(u => u.PublicId == id, ct);
        Require(user is not null, "unauthorized");
        var publicIds = actor.StationScopes.Select(s => s.StationId).ToArray();
        var stations = await context.Set<Station>().Where(s => publicIds.Contains(s.PublicId)).Select(s => s.Id).ToArrayAsync(ct);
        var employee = await context.Set<Employee>().AsNoTracking().SingleOrDefaultAsync(e => e.PersonId == user!.PersonId && e.Status == EmployeeStatus.Active, ct);
        var governedBackOffice = actor.Roles.Any(r => r.Portal == PortalKind.BackOffice) && actor.EffectiveAccess is not null;
        Require(permission.Length == 0
            ? governedBackOffice || FinancePayablesPolicy.CanUseOwnExpenses(actor, employee is not null)
            : governedBackOffice && actor.HasPermission(permission), "forbidden");
        return new Actor(user!.Id, user.PersonId, actor, stations, employee);
    }
    private async Task<long> StationAsync(Actor a, Guid id, CancellationToken ct)
    {
        var station = await context.Set<Station>().Where(s => s.PublicId == id).Select(s => (long?)s.Id).SingleOrDefaultAsync(ct);
        Require(station is not null, "not_found"); Scope(a, station!.Value); return station.Value;
    }
    private async Task<FinancePayablesResult<T>> ReadAsync<T>(Guid actorId, string permission,
        Func<Actor, Task<T>> work, CancellationToken ct)
    {
        try { var actor = await ActorAsync(actorId, permission, ct); context.ChangeTracker.Clear(); return new(await work(actor)); }
        catch (Fault f) { return FinancePayablesResult<T>.Fail(f.Code); }
        catch (FinancialDocumentUnavailableException) { return FinancePayablesResult<T>.Fail("unavailable"); }
    }
    private async Task<FinancePayablesResult<FinancePayablesMutation>> WriteAsync(Guid actorId, Guid requestId,
        string operation, Guid? resourceId, object payload, string permission, Func<Actor, Task<Guid>> work, CancellationToken ct)
    {
        try
        {
            Require(requestId != Guid.Empty);
            var actor = await ActorAsync(actorId, permission, ct);
            if (!operation.StartsWith("expense.", StringComparison.Ordinal) || operation == "expense.reimburse")
                Require(Finance(actor, permission), "forbidden");
            var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { operation, resourceId, payload }))));
            return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
                var receipt = await context.Set<FinancePayablesCommand>().SingleOrDefaultAsync(x => x.ActorAccountId == actor.Id && x.RequestId == requestId, ct);
                if (receipt is not null)
                {
                    Require(receipt.ContentHash == hash && receipt.Operation == operation, "conflict");
                    var replayId = resourceId ?? receipt.ResourceId;
                    if (operation.StartsWith("supplier.", StringComparison.Ordinal)) await SupplierAsync(actor, replayId, ct);
                    else if (operation.StartsWith("payable.payment.", StringComparison.Ordinal)) await PaymentAsync(actor, replayId, ct);
                    else if (operation.StartsWith("payable.", StringComparison.Ordinal)) await InvoiceAsync(actor, replayId, ct);
                    else await ExpenseAsync(actor, replayId, ct);
                    await transaction.CommitAsync(ct);
                    return new FinancePayablesResult<FinancePayablesMutation>(new(receipt.ResourceId, true));
                }
                var result = await work(actor);
                await NotifyMutationAsync(operation, resourceId, result, ct);
                context.Set<FinancePayablesCommand>().Add(new FinancePayablesCommand { ActorAccountId = actor.Id, RequestId = requestId,
                    ContentHash = hash, ResourceId = result, Operation = operation, CreatedAt = clock.GetUtcNow() });
                await context.SaveChangesAsync(ct);
                await transaction.CommitAsync(ct);
                return new FinancePayablesResult<FinancePayablesMutation>(new(result, false));
            });
        }
        catch (Fault f) { context.ChangeTracker.Clear(); return FinancePayablesResult<FinancePayablesMutation>.Fail(f.Code); }
        catch (FinancialDocumentUnavailableException) { context.ChangeTracker.Clear(); return FinancePayablesResult<FinancePayablesMutation>.Fail("unavailable"); }
        catch (DbUpdateConcurrencyException) { context.ChangeTracker.Clear(); return FinancePayablesResult<FinancePayablesMutation>.Fail("conflict"); }
        catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 2601 or 2627 or 547 or 1205 })
        { context.ChangeTracker.Clear(); return FinancePayablesResult<FinancePayablesMutation>.Fail("conflict"); }
        catch (SqlException ex) when (ex.Number == 1205)
        { context.ChangeTracker.Clear(); return FinancePayablesResult<FinancePayablesMutation>.Fail("conflict"); }
    }
    private void Audit(Actor actor, string action, string entity, Guid id, string? reason = null) =>
        CommercialAuditWriter.Add(context, actor.Id, action, entity, id, reason?.Trim());

    private static decimal ValidateLines(IReadOnlyList<FinancePayablesLineInput>? lines)
    {
        Require(lines is { Count: > 0 and <= 100 }); decimal total = 0;
        try
        {
            foreach (var line in lines!)
            {
                Require(line is not null && Text(line.Description, 500) && FinancePayablesPolicy.Quantity(line.Quantity) &&
                    FinancePayablesPolicy.Money(line.UnitPrice) && FinancePayablesPolicy.Money(line.TaxAmount));
                var amount = FinancePayablesPolicy.LineTotal(line!.Quantity, line.UnitPrice, line.TaxAmount);
                Require(FinancePayablesPolicy.Money(amount)); total += amount;
                Require(FinancePayablesPolicy.Money(total));
            }
        }
        catch (OverflowException) { throw new Fault("invalid"); }
        Require(total > 0); return total;
    }
    private static decimal ValidateFx(FinancePayablesFx? fx, decimal total, DateOnly date)
    {
        Require(fx is not null && FinancePayablesPolicy.ValidFx(fx.Currency, fx.RateToDop, fx.Source, fx.RateDate) && fx.RateDate <= date);
        try { var dop = FinancePayablesPolicy.Round(total * fx!.RateToDop!.Value); Require(dop > 0 && FinancePayablesPolicy.Money(dop)); return dop; }
        catch (OverflowException) { throw new Fault("invalid"); }
    }
    private sealed record Dimensions(long? Station, long? Airline, long? Turnaround, long? Service);
    private async Task<Dimensions> DimensionsAsync(Actor actor, long scope, FinancePayablesDimensions? input, CancellationToken ct)
    {
        Require(input is not null);
        long? station = null, airline = null, turn = null, service = null;
        if (input!.StationId is { } stationId) { station = await StationAsync(actor, stationId, ct); Require(station == scope); }
        if (input.AirlineId is { } airlineId)
        {
            airline = await context.Set<Airline>().Where(x => x.PublicId == airlineId).Select(x => (long?)x.Id).SingleOrDefaultAsync(ct);
            Require(airline is not null);
        }
        if (input.TurnaroundId is { } turnId)
        {
            var item = await context.Turnarounds.AsNoTracking().SingleOrDefaultAsync(x => x.PublicId == turnId, ct);
            Require(item is not null && item.StationId == scope && (airline is null || airline == item.AirlineId));
            turn = item!.Id; airline ??= item.AirlineId;
        }
        if (input.ServiceId is { } serviceId)
        {
            service = await context.Set<ServiceDefinition>().Where(x => x.PublicId == serviceId && x.IsActive).Select(x => (long?)x.Id).SingleOrDefaultAsync(ct);
            Require(service is not null);
            if (turn is not null) Require(await (from os in context.OperationServices join go in context.GroundOperations on os.GroundOperationId equals go.Id
                where go.TurnaroundId == turn && os.ServiceDefinitionId == service select os.Id).AnyAsync(ct));
        }
        return new(station, airline, turn, service);
    }
    private static void Filter(FinancePayablesFilter f)
    {
        Require(f.Skip >= 0 && f.Take is > 0 and <= 200 && (f.From is null || f.To is null || f.From <= f.To) && OptionalText(f.Search, 100));
    }
    private async Task<long?> FilterStationAsync(Actor actor, FinancePayablesFilter filter, CancellationToken ct) =>
        filter.ScopeStationId is { } id ? await StationAsync(actor, id, ct) : null;
    private static decimal ApplicationRate(string from, decimal fromFx, string to, decimal toFx, decimal? supplied)
    {
        var rate = from == to ? 1m : decimal.Round(fromFx / toFx, 8, MidpointRounding.AwayFromZero);
        Require(rate > 0 && rate <= 99_999_999_999.99999999m && supplied == rate); return rate;
    }
}
