using System.Text.Json;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

/// <summary>Finance's ground time allowances and holiday calendar, audited on every change (ADR-0034).</summary>
internal sealed class EfFinanceCloseRulesStore(ElevantDbContext context, TimeProvider timeProvider)
    : IFinanceCloseRulesStore
{
    private const int HolidayLimit = 400;

    public async Task<FinanceCloseRulesData> ReadAsync(CancellationToken cancellationToken = default)
    {
        var allowances = await context.GroundTimeAllowances.AsNoTracking()
            .OrderBy(item => item.SizeCategory).ToArrayAsync(cancellationToken);
        var holidays = await context.FinanceHolidays.AsNoTracking().Where(item => item.RemovedAt == null)
            .OrderBy(item => item.Date).Take(HolidayLimit)
            .Select(item => new FinanceHolidayData(item.PublicId, item.Date, item.Name)).ToArrayAsync(cancellationToken);
        return new FinanceCloseRulesData(allowances.Select(Map).ToArray(), holidays);
    }

    public async Task<(GroundTimeAllowanceData? Data, FinanceCloseRulesFailure? Failure)> SetAllowanceAsync(
        Guid accountId, AircraftSizeCategory category, int allowedMinutes, string? expectedVersion, string? requestId,
        CancellationToken cancellationToken = default)
    {
        var account = await AccountAsync(accountId, cancellationToken);
        if (account is null) return (null, FinanceCloseRulesFailure.Forbidden);
        var now = Now();
        var allowance = await context.GroundTimeAllowances.SingleOrDefaultAsync(item => item.SizeCategory == category,
            cancellationToken);
        int? previous = allowance?.AllowedMinutes;
        if (allowance is null)
        {
            if (expectedVersion is not null) return (null, FinanceCloseRulesFailure.Conflict);
            allowance = new GroundTimeAllowance
            {
                PublicId = Guid.CreateVersion7(), SizeCategory = category, CreatedAt = now,
            };
            context.GroundTimeAllowances.Add(allowance);
        }
        else if (expectedVersion != Version(allowance.RowVersion))
        {
            return (null, FinanceCloseRulesFailure.Conflict);
        }
        else if (allowance.AllowedMinutes == allowedMinutes)
        {
            return (Map(allowance), null);
        }
        allowance.AllowedMinutes = allowedMinutes;
        allowance.UpdatedByAccountId = account.Value.Id;
        allowance.UpdatedAt = now;
        Audit(account.Value, "finance.ground_time_allowance.updated", allowance.PublicId, requestId, now,
            new { category = category.ToString(), previous, allowedMinutes });
        return await SaveAsync(() => Map(allowance), cancellationToken);
    }

    public async Task<(FinanceHolidayData? Data, FinanceCloseRulesFailure? Failure)> AddHolidayAsync(Guid accountId,
        DateOnly date, string name, string? requestId, CancellationToken cancellationToken = default)
    {
        var account = await AccountAsync(accountId, cancellationToken);
        if (account is null) return (null, FinanceCloseRulesFailure.Forbidden);
        var existing = await context.FinanceHolidays.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Date == date && item.RemovedAt == null, cancellationToken);
        if (existing is not null)
            return existing.Name == name
                ? (new FinanceHolidayData(existing.PublicId, existing.Date, existing.Name), null)
                : (null, FinanceCloseRulesFailure.Conflict);
        var now = Now();
        var holiday = new FinanceHoliday
        {
            PublicId = Guid.CreateVersion7(), Date = date, Name = name, CreatedByAccountId = account.Value.Id,
            CreatedAt = now, UpdatedAt = now,
        };
        context.FinanceHolidays.Add(holiday);
        Audit(account.Value, "finance.holiday.added", holiday.PublicId, requestId, now, new { date, name });
        return await SaveAsync(() => new FinanceHolidayData(holiday.PublicId, holiday.Date, holiday.Name), cancellationToken);
    }

    public async Task<FinanceCloseRulesFailure?> RemoveHolidayAsync(Guid accountId, Guid holidayId, string? requestId,
        CancellationToken cancellationToken = default)
    {
        var account = await AccountAsync(accountId, cancellationToken);
        if (account is null) return FinanceCloseRulesFailure.Forbidden;
        var holiday = await context.FinanceHolidays.SingleOrDefaultAsync(item => item.PublicId == holidayId,
            cancellationToken);
        if (holiday is null) return FinanceCloseRulesFailure.NotFound;
        if (holiday.RemovedAt is not null) return null;
        var now = Now();
        holiday.RemovedAt = now;
        holiday.RemovedByAccountId = account.Value.Id;
        holiday.UpdatedAt = now;
        Audit(account.Value, "finance.holiday.removed", holiday.PublicId, requestId, now,
            new { date = holiday.Date, name = holiday.Name });
        return (await SaveAsync(() => true, cancellationToken)).Failure;
    }

    private async Task<(T? Data, FinanceCloseRulesFailure? Failure)> SaveAsync<T>(Func<T> result,
        CancellationToken cancellationToken)
    {
        try
        {
            await context.SaveChangesAsync(cancellationToken);
            return (result(), null);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return (default, FinanceCloseRulesFailure.Conflict);
        }
        catch (DbUpdateException exception) when (exception.GetBaseException() is SqlException { Number: 2601 or 2627 })
        {
            context.ChangeTracker.Clear();
            return (default, FinanceCloseRulesFailure.Conflict);
        }
    }

    private async Task<(long Id, string Name)?> AccountAsync(Guid accountId, CancellationToken cancellationToken)
    {
        var account = await context.Users.AsNoTracking().Where(user => user.PublicId == accountId)
            .Select(user => new { user.Id, user.UserName }).SingleOrDefaultAsync(cancellationToken);
        return account is null ? null : (account.Id, account.UserName ?? string.Empty);
    }

    private void Audit((long Id, string Name) account, string action, Guid entityId, string? requestId,
        DateTimeOffset now, object metadata) =>
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account,
            ActorAccountId = account.Id, ActorDisplay = account.Name, Action = action,
            EntityType = action.StartsWith("finance.holiday", StringComparison.Ordinal)
                ? nameof(FinanceHoliday) : nameof(GroundTimeAllowance),
            EntityPublicId = entityId, Source = AuditSource.Api, CorrelationId = Guid.NewGuid(), RequestId = requestId,
            Reason = "Finanzas cambió las reglas de cierre de la operación.",
            MetadataJson = JsonSerializer.Serialize(metadata),
        });

    private DateTimeOffset Now()
    {
        var utc = timeProvider.GetUtcNow().ToUniversalTime();
        return new DateTimeOffset(utc.Ticks - utc.Ticks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
    }

    private static GroundTimeAllowanceData Map(GroundTimeAllowance item) =>
        new(item.SizeCategory.ToString(), item.AllowedMinutes, item.UpdatedAt, Version(item.RowVersion));

    private static string Version(byte[] rowVersion) => Convert.ToHexString(rowVersion).ToLowerInvariant();
}
