using System.Data;
using Elevant.Application.Commercial;
using Elevant.Application.Finance;
using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

internal sealed partial class EfFinanceTariffBookStore
{
    public async Task<IReadOnlyList<ExchangeRateData>?> ListExchangeRatesAsync(Guid actorId, DateOnly from, DateOnly to,
        bool includeHistory, CancellationToken cancellationToken = default)
    {
        if (to < from || to.DayNumber - from.DayNumber > 400) return null;
        if (await AuthorizeAsync(actorId, "finance.exchange_rates.read", cancellationToken) is null) return null;
        var rows = await (from rate in context.ExchangeRates.AsNoTracking()
                          join user in context.Users.AsNoTracking() on rate.RecordedByAccountId equals user.Id
                          join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
                          join previous in context.ExchangeRates.AsNoTracking() on rate.SupersedesId equals (long?)previous.Id into previousRows
                          from previous in previousRows.DefaultIfEmpty()
                          where rate.RateDate >= @from && rate.RateDate <= to && (includeHistory || rate.IsCurrent)
                          orderby rate.RateDate descending, rate.CreatedAt descending
                          select new ExchangeRateData(rate.PublicId, rate.RateDate, rate.FromCurrency, rate.ToCurrency,
                              rate.Rate, rate.Source, person.FirstName + " " + person.LastName, rate.CreatedAt,
                              rate.IsCurrent, previous == null ? null : previous.PublicId,
                              Convert.ToBase64String(rate.RowVersion)))
            .ToArrayAsync(cancellationToken);
        return rows;
    }

    public async Task<FinanceCatalogResult> RecordExchangeRateAsync(Guid actorId, RecordExchangeRateInput input,
        CancellationToken cancellationToken = default)
    {
        var actor = await AuthorizeAsync(actorId, "finance.exchange_rates.create", cancellationToken);
        if (actor is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.Forbidden);
        if (input is null || !ValidCurrency(input.FromCurrency) || !ValidCurrency(input.ToCurrency) ||
            input.FromCurrency == input.ToCurrency || input.Rate is <= 0 or > 1_000_000m || input.RateDate == default ||
            input.RateDate > DateOnly.FromDateTime(timeProvider.GetUtcNow().UtcDateTime.AddDays(1)) ||
            string.IsNullOrWhiteSpace(input.Source) || input.Source.Trim().Length > 120)
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid, "invalid_exchange_rate");
        return await InTransactionAsync(async () =>
        {
            var now = timeProvider.GetUtcNow();
            if (await context.ExchangeRates.AnyAsync(rate => rate.IsCurrent && rate.RateDate == input.RateDate &&
                    (rate.FromCurrency == input.FromCurrency && rate.ToCurrency == input.ToCurrency ||
                        rate.FromCurrency == input.ToCurrency && rate.ToCurrency == input.FromCurrency), cancellationToken))
                return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict, "exchange_rate_exists");
            var rate = new ExchangeRate
            {
                PublicId = Guid.CreateVersion7(), RateDate = input.RateDate, FromCurrency = input.FromCurrency,
                ToCurrency = input.ToCurrency, Rate = decimal.Round(input.Rate, 6), Source = input.Source.Trim(),
                RecordedByAccountId = actor.Id, IsCurrent = true, CreatedAt = now, UpdatedAt = now,
            };
            context.ExchangeRates.Add(rate);
            Audit(actor.Id, "finance.exchange_rate.recorded", "commercial.exchange_rates", rate.PublicId, null,
                new AuditFieldChangeData("rate", null, $"{rate.RateDate:O} {rate.FromCurrency}->{rate.ToCurrency} {rate.Rate}"));
            await NotifyAsync("finance.exchange_rates.read", "finance_tariff_book", rate.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return FinanceCatalogResult.Success(rate.PublicId);
        }, cancellationToken);
    }

    /// <summary>A correction never overwrites: the old row stops being current and the new one points to it.</summary>
    public async Task<FinanceCatalogResult> CorrectExchangeRateAsync(Guid actorId, Guid rateId,
        CorrectExchangeRateInput input, CancellationToken cancellationToken = default)
    {
        var actor = await AuthorizeAsync(actorId, "finance.exchange_rates.update", cancellationToken);
        if (actor is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.Forbidden);
        if (input is null || input.Rate is <= 0 or > 1_000_000m || string.IsNullOrWhiteSpace(input.Source) ||
            input.Source.Trim().Length > 120 || string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid, "invalid_exchange_rate");
        return await InTransactionAsync(async () =>
        {
            var now = timeProvider.GetUtcNow();
            var current = await context.ExchangeRates.SingleOrDefaultAsync(rate => rate.PublicId == rateId, cancellationToken);
            if (current is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.NotFound, "not_found");
            if (!current.IsCurrent || Version(current.RowVersion) != input.ExpectedVersion)
                return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict, "version_conflict");
            current.IsCurrent = false;
            current.UpdatedAt = now;
            await context.SaveChangesAsync(cancellationToken);
            var correction = new ExchangeRate
            {
                PublicId = Guid.CreateVersion7(), RateDate = current.RateDate, FromCurrency = current.FromCurrency,
                ToCurrency = current.ToCurrency, Rate = decimal.Round(input.Rate, 6), Source = input.Source.Trim(),
                RecordedByAccountId = actor.Id, SupersedesId = current.Id, IsCurrent = true, CreatedAt = now, UpdatedAt = now,
            };
            context.ExchangeRates.Add(correction);
            Audit(actor.Id, "finance.exchange_rate.corrected", "commercial.exchange_rates", correction.PublicId, null,
                new AuditFieldChangeData("rate", current.Rate.ToString(), correction.Rate.ToString()));
            await NotifyAsync("finance.exchange_rates.read", "finance_tariff_book", correction.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return FinanceCatalogResult.Success(correction.PublicId);
        }, cancellationToken);
    }

    public async Task<IReadOnlyList<ContractApprovalSummaryData>?> ListContractApprovalsAsync(Guid actorId,
        bool pendingOnly, CancellationToken cancellationToken = default)
    {
        var actor = await AuthorizeAsync(actorId, "finance.contract_approvals.read", cancellationToken);
        if (actor is null) return null;
        var scope = actor.Context.StationScopes.Select(x => x.StationId).ToArray();
        var since = timeProvider.GetUtcNow().AddDays(-90);
        var versionIds = await context.ContractVersions.AsNoTracking()
            .Where(version => (version.Status == ContractVersionStatus.PendingFinanceApproval ||
                !pendingOnly && context.ContractFinanceReviews.Any(review =>
                    review.ContractVersionId == version.Id && review.DecidedAt >= since)) && context.Set<ContractVersionStation>().Any(link => link.ContractVersionId == version.Id) &&
                !context.Set<ContractVersionStation>().Any(link => link.ContractVersionId == version.Id && !context.Stations.Any(station => station.Id == link.StationId && scope.Contains(station.PublicId))))
            .OrderByDescending(version => version.UpdatedAt).Select(version => version.Id).Take(200)
            .ToArrayAsync(cancellationToken);
        var summaries = new List<ContractApprovalSummaryData>();
        foreach (var id in versionIds)
            summaries.Add((await ComparisonAsync(id, cancellationToken)).Summary);
        return summaries;
    }

    public async Task<ContractApprovalDetailData?> GetContractApprovalAsync(Guid actorId, Guid versionId,
        CancellationToken cancellationToken = default)
    {
        var actor = await AuthorizeAsync(actorId, "finance.contract_approvals.read", cancellationToken);
        if (actor is null) return null;
        var id = await context.ContractVersions.AsNoTracking().Where(version => version.PublicId == versionId)
            .Select(version => (long?)version.Id).SingleOrDefaultAsync(cancellationToken);
        return id is null || !await ApprovalInScopeAsync(actor, id.Value, cancellationToken) ? null : await ComparisonAsync(id.Value, cancellationToken);
    }

    /// <summary>The contract version beside the Finance base tariff and charges that applied on its start date.</summary>
    private async Task<ContractApprovalDetailData> ComparisonAsync(long versionId, CancellationToken cancellationToken)
    {
        var row = await (from version in context.ContractVersions.AsNoTracking()
                         join contract in context.Contracts.AsNoTracking() on version.ContractId equals contract.Id
                         join airline in context.Airlines.AsNoTracking() on contract.AirlineId equals airline.Id
                         where version.Id == versionId
                         select new { version, contract, Airline = airline.Name }).SingleAsync(cancellationToken);
        var stations = await (from link in context.Set<ContractVersionStation>().AsNoTracking()
                              join station in context.Stations.AsNoTracking() on link.StationId equals station.Id
                              where link.ContractVersionId == versionId
                              select new { station.Id, station.Code }).ToArrayAsync(cancellationToken);
        var rates = await (from rate in context.ContractServiceRates.AsNoTracking()
                           join service in context.ServiceDefinitions.AsNoTracking() on rate.ServiceDefinitionId equals service.Id
                           where rate.ContractVersionId == versionId
                           orderby service.Code
                           select new { rate, service.Code, service.Name }).ToArrayAsync(cancellationToken);
        // 1-N06: the station rule of the draft creation and the Contratos editor, so all see one base price.
        var baseStation = ContractDraftRules.BaseStation(stations.Select(item => item.Id).ToArray());
        var baseRates = await FinanceTariffLookup.ServiceRatesAsync(context, row.version.CurrencyCode, row.version.ValidFrom,
            baseStation, rates.Select(item => item.rate.ServiceDefinitionId).ToArray(), cancellationToken);
        var comparisons = rates.Select(item =>
        {
            var baseRate = baseRates.GetValueOrDefault(item.rate.ServiceDefinitionId);
            decimal? difference = baseRate is { UnitPrice: > 0 }
                ? decimal.Round((item.rate.UnitPrice - baseRate.UnitPrice) / baseRate.UnitPrice * 100m, 2)
                : null;
            return new ContractRateComparisonData(item.rate.PublicId, item.Code, item.Name, item.rate.BillingUnit,
                item.rate.UnitPrice, item.rate.MinimumQuantity, baseRate?.UnitPrice, baseRate?.MinimumBillableQuantity,
                difference);
        }).ToArray();
        var baseCharges = await FinanceTariffLookup.ChargeRatesAsync(context, row.version.CurrencyCode,
            row.version.ValidFrom, cancellationToken);
        var contractCharges = await context.ContractChargeRates.AsNoTracking()
            .Where(rate => rate.ContractVersionId == versionId)
            .ToDictionaryAsync(rate => rate.ChargeDefinitionId, cancellationToken);
        var charges = (await context.ChargeDefinitions.AsNoTracking().Where(charge => charge.IsActive)
                .OrderBy(charge => charge.Code).ToArrayAsync(cancellationToken))
            .Select(charge =>
            {
                var negotiated = contractCharges.GetValueOrDefault(charge.Id);
                return new ContractChargeComparisonData(charge.PublicId, charge.Code, charge.Name, charge.Method.ToString(),
                    negotiated?.IsExcluded == true, negotiated?.Value, baseCharges.GetValueOrDefault(charge.Id)?.Value);
            }).ToArray();
        var history = await (from review in context.ContractFinanceReviews.AsNoTracking()
                             join user in context.Users.AsNoTracking() on review.DecidedByAccountId equals user.Id
                             join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
                             where review.ContractVersionId == versionId
                             orderby review.DecidedAt descending
                             select new ContractFinanceReviewData(review.Decision.ToString(), review.Reason,
                                 person.FirstName + " " + person.LastName, review.DecidedAt))
            .ToArrayAsync(cancellationToken);
        var summary = new ContractApprovalSummaryData(row.version.PublicId, row.contract.PublicId, row.contract.ContractCode,
            row.Airline, row.version.CurrencyCode, row.version.ValidFrom, row.version.ValidTo, row.version.Status.ToString(),
            row.version.UpdatedAt, comparisons.Count(item => item.DifferencePercent < 0),
            comparisons.Count(item => item.BasePrice is null), Version(row.version.RowVersion));
        var packages = await (from link in context.Set<ContractServicePackage>().AsNoTracking()
            join package in context.Set<ServicePackageVersion>().AsNoTracking() on link.PackageVersionId equals package.Id
            where link.ContractVersionId == versionId
            select new ContractPackageApprovalData(package.PublicId, package.Code, package.Name, package.VersionNumber, package.Scope.ToString(), package.BasePrice, package.CurrencyCode)).ToArrayAsync(cancellationToken);
        return new ContractApprovalDetailData(summary, row.version.Terms,
            stations.Select(item => item.Code).OrderBy(code => code).ToArray(), comparisons, charges, history, packages);
    }

    private const string DecideAction = "finance.contract.decide";

    /// <summary>
    /// Finance approves the prices of a version or returns it to Contratos with the reason. Approval
    /// does not activate the contract: the validity step and both signatures follow (ADR-0024). Each
    /// blocking cause has its code (1-N07): a package out of the version's currency or validity, a
    /// retired service (1-N10), a start not after the approved version in force. The Idempotency-Key is
    /// optional while older clients exist (expand); with it the same key and body replay the result.
    /// </summary>
    public async Task<FinanceCatalogResult> DecideContractApprovalAsync(Guid actorId, Guid versionId,
        DecideContractApprovalInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        var actor = await AuthorizeAsync(actorId, "finance.contract_approvals.decide", cancellationToken);
        if (actor is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.Forbidden);
        if (idempotencyKey == Guid.Empty)
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid, "idempotency_key_required");
        if (input is null || !Enum.TryParse<ContractFinanceDecision>(input.Decision, false, out var decision) ||
            !Enum.IsDefined(decision) || decision is not (ContractFinanceDecision.Approved or ContractFinanceDecision.Returned) ||
            input.Reason?.Length > 1000 ||
            decision == ContractFinanceDecision.Returned && (input.Reason is null || input.Reason.Trim().Length < 3))
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid, "invalid_contract_decision");
        if (string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid, "expected_version_required");
        var reason = input.Reason?.Trim();
        var hash = CommercialCommandReceipts.Hash(new { versionId, decision, reason, input.ExpectedVersion });
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
                    var prior = await CommercialCommandReceipts.FindAsync(context, key, actor.Id, DecideAction, hash,
                        cancellationToken);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay)
                        return FinanceCatalogResult.Success(prior.ResultId);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                        return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict, "idempotency_conflict");
                }
                var now = timeProvider.GetUtcNow();
                var result = await DecideAsync(actor, versionId, decision, reason, input.ExpectedVersion, now,
                    cancellationToken);
                if (!result.IsSuccess)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    context.ChangeTracker.Clear();
                    return result;
                }
                if (idempotencyKey is { } receipt)
                    CommercialCommandReceipts.Add(context, receipt, actor.Id, DecideAction, hash, result.Id!.Value, now);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return result;
            });
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict, "version_conflict");
        }
        catch (DbUpdateException exception) when (idempotencyKey is { } key &&
            CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, key, actor.Id, DecideAction, hash,
                cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? FinanceCatalogResult.Success(concurrent.ResultId)
                : FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict, "idempotency_conflict");
        }
        catch (DbUpdateException)
        {
            context.ChangeTracker.Clear();
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict, "version_conflict");
        }
    }

    private async Task<FinanceCatalogResult> DecideAsync(Actor actor, Guid versionId, ContractFinanceDecision decision,
        string? reason, string expectedVersion, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var row = await (from version in context.ContractVersions
                         join contract in context.Contracts on version.ContractId equals contract.Id
                         join airline in context.Airlines on contract.AirlineId equals airline.Id
                         where version.PublicId == versionId
                         select new { Version = version, Contract = contract, Airline = airline.Name })
            .SingleOrDefaultAsync(cancellationToken);
        if (row is null || !await ApprovalInScopeAsync(actor, row.Version.Id, cancellationToken))
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.NotFound, "not_found");
        if (row.Version.Status != ContractVersionStatus.PendingFinanceApproval ||
            Version(row.Version.RowVersion) != expectedVersion)
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict, "version_conflict");
        var subject = $"{row.Contract.ContractCode} · {row.Airline}";
        if (decision == ContractFinanceDecision.Approved &&
            await ApprovalBlockAsync(row.Version, row.Contract, cancellationToken) is { } blocked)
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict, blocked);
        var comparison = await ComparisonAsync(row.Version.Id, cancellationToken);
        context.ContractFinanceReviews.Add(new ContractFinanceReview
        {
            PublicId = Guid.CreateVersion7(), ContractVersionId = row.Version.Id, Decision = decision,
            Reason = reason, DecidedByAccountId = actor.Id, DecidedAt = now,
            ComparisonJson = JsonSerializer.Serialize(new { comparison.Rates, comparison.Charges, comparison.Packages }),
            CreatedAt = now, UpdatedAt = now,
        });
        if (decision == ContractFinanceDecision.Returned)
        {
            row.Version.Status = ContractVersionStatus.Draft;
            row.Version.UpdatedAt = now;
            Audit(actor.Id, "finance.contract.returned", "commercial.contract_versions", row.Version.PublicId, reason);
            // 1-N14: Contratos hears that the draft is back. The airline only sees that it was returned (1-N05).
            await DepartmentNotificationWriter.NotifyAsync(context, Department.Contracts, "contracts.drafts.read",
                "contract_returned", row.Version.PublicId, subject, now, cancellationToken);
        }
        else
        {
            var previousVersions = await context.ContractVersions.Where(v => v.ContractId == row.Contract.Id &&
                v.Id != row.Version.Id && v.Status == ContractVersionStatus.Approved).ToArrayAsync(cancellationToken);
            foreach (var previous in previousVersions)
            {
                previous.Status = ContractVersionStatus.Superseded;
                previous.ValidTo = row.Version.ValidFrom.AddDays(-1);
                previous.UpdatedAt = now;
            }
            var inheritedChargeRates = await FinanceTariffLookup.ChargeRatesAsync(context, row.Version.CurrencyCode, row.Version.ValidFrom, cancellationToken);
            var chargeDefinitions = await context.ChargeDefinitions.Where(c => c.IsActive).ToArrayAsync(cancellationToken);
            var frozenChargeRates = await context.ContractChargeRates.Where(c => c.ContractVersionId == row.Version.Id).ToDictionaryAsync(c => c.ChargeDefinitionId, cancellationToken);
            foreach (var definition in chargeDefinitions)
            {
                if (!frozenChargeRates.TryGetValue(definition.Id, out var frozen))
                {
                    if (!inheritedChargeRates.TryGetValue(definition.Id, out var inherited)) continue;
                    frozen = new ContractChargeRate { PublicId = Guid.CreateVersion7(), ContractVersionId = row.Version.Id, ChargeDefinitionId = definition.Id, Value = inherited.Value, MinimumAmount = inherited.MinimumAmount, CreatedAt = now, UpdatedAt = now };
                    context.ContractChargeRates.Add(frozen);
                }
                frozen.DefinitionSnapshotJson = JsonSerializer.Serialize(new ContractChargePolicySnapshot(definition.Code, definition.Name, definition.BillingUnit, definition.Method, definition.QuantityRule, definition.GraceMinutes, definition.RoundingIncrement));
                frozen.UpdatedAt = now;
            }
            row.Version.PricingPolicyVersion = 1;
            row.Version.Status = ContractVersionStatus.Approved;
            row.Version.ApprovedAt = now;
            row.Version.ApprovedByAccountId = actor.Id;
            row.Version.UpdatedAt = now;
            // Approval does not activate the contract: both parties sign this version first and the
            // airline needs a verified operating permit (ADR-0024). A new version restarts the
            // expiry notice.
            row.Contract.ExpiryNoticeSentAt = null;
            row.Contract.UpdatedAt = now;
            foreach (var account in await ContractDraftAudience.AirlineAccountsAsync(context, row.Contract.AirlineId,
                         cancellationToken))
                AccountChangeOutboxWriter.Add(context, account, null, "airline_contracts", row.Contract.PublicId, now);
            foreach (var station in await context.Set<ContractVersionStation>().AsNoTracking()
                         .Where(link => link.ContractVersionId == row.Version.Id).Select(link => link.StationId)
                         .ToArrayAsync(cancellationToken))
                await FinanceApprovedServiceChangeWriter.AddAsync(context, station, row.Version.PublicId, now,
                    "finance_tariffs", cancellationToken);
            Audit(actor.Id, "finance.contract.approved", "commercial.contracts", row.Contract.PublicId, reason);
            // 1-N14: Contratos continues with the validity and the signatures.
            await DepartmentNotificationWriter.NotifyAsync(context, Department.Contracts, "contracts.agreements.read",
                "contract_approved", row.Version.PublicId, subject, now, cancellationToken);
        }
        await NotifyAsync("contracts.drafts.read", "contract_approvals", row.Version.PublicId, now, cancellationToken);
        await NotifyAsync("finance.contract_approvals.read", "contract_approvals", row.Version.PublicId, now,
            cancellationToken);
        return FinanceCatalogResult.Success(row.Version.PublicId);
    }

    /// <summary>
    /// Why Finance cannot approve the prices as they are; Finance returns the version so Contratos
    /// fixes it. The rules match the draft readiness of Contratos (1-N07, 1-N10, 1-N27).
    /// </summary>
    private async Task<string?> ApprovalBlockAsync(ContractVersion version, Contract contract,
        CancellationToken cancellationToken)
    {
        var packageRows = await (from link in context.Set<ContractServicePackage>().AsNoTracking()
            join package in context.Set<ServicePackageVersion>().AsNoTracking() on link.PackageVersionId equals package.Id
            where link.ContractVersionId == version.Id select package).ToArrayAsync(cancellationToken);
        // 1-N27: a package Finance retired after Contratos linked it is no longer approved.
        if (packageRows.Any(package => package.Status == TariffVersionStatus.Retired))
            return ContractDraftIssues.PackageRetired;
        if (packageRows.Any(package => !EfContractDraftStore.PackageFits(package, version.CurrencyCode, version.ValidFrom,
                version.ValidTo)))
            return ContractDraftIssues.PackageNotEligible;
        var packageIds = packageRows.Select(package => package.Id).ToArray();
        var coveredServices = await context.Set<ServicePackageComponent>().AsNoTracking()
            .Where(component => packageIds.Contains(component.PackageVersionId))
            .Select(component => component.ServiceDefinitionId).ToArrayAsync(cancellationToken);
        if (coveredServices.Distinct().Count() != coveredServices.Length) return "ambiguous_package_coverage";
        var contractServices = await context.ContractServiceRates.AsNoTracking()
            .Where(rate => rate.ContractVersionId == version.Id)
            .Select(rate => rate.ServiceDefinitionId).ToArrayAsync(cancellationToken);
        if (coveredServices.Any(service => !contractServices.Contains(service))) return "package_service_not_in_contract";
        // 1-N10: OCC could never plan a retired service; Contratos removes it before approval.
        if (await context.ServiceDefinitions.AsNoTracking().AnyAsync(service =>
                contractServices.Contains(service.Id) && !service.IsActive, cancellationToken))
            return ContractDraftIssues.ServiceRetired;
        var currentStart = await context.ContractVersions.AsNoTracking()
            .Where(item => item.ContractId == contract.Id && item.Id != version.Id &&
                item.Status == ContractVersionStatus.Approved)
            .MaxAsync(item => (DateOnly?)item.ValidFrom, cancellationToken);
        return ContractDraftRules.StartsAfterCurrent(version.ValidFrom, currentStart)
            ? null : ContractDraftIssues.ValidFromNotAfterCurrent;
    }

    private async Task<bool> ApprovalInScopeAsync(Actor actor, long versionId, CancellationToken ct)
    {
        var allowed = actor.Context.StationScopes.Select(x => x.StationId).ToArray();
        return await context.Set<ContractVersionStation>().AnyAsync(link => link.ContractVersionId == versionId, ct) &&
            !await context.Set<ContractVersionStation>().AnyAsync(link => link.ContractVersionId == versionId && !context.Stations.Any(station => station.Id == link.StationId && allowed.Contains(station.PublicId)), ct);
    }

}
