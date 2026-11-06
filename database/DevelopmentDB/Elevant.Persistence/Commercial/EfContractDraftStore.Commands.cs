using System.Globalization;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Application.Common;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Persistence.Finance;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

internal sealed partial class EfContractDraftStore
{
    private const string UpdateAction = "contract.draft.update";
    private const string SubmitAction = "contract.draft.submit";
    private const string ScopeAction = "contract.draft.scope";
    private const string DiscardAction = "contract.draft.discard";
    private const string CommentAction = "contract.draft.comment";
    private const string ReplyAction = "contract.draft.reply";
    private const int CommentMaxLength = 2000;

    public async Task<ContractDraftResult> AddAirlineCommentAsync(Guid actorId, Guid versionId,
        AirlineDraftCommentInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        var airlineIds = await AuthorizedAirlineIdsAsync(actorId, cancellationToken);
        if (airlineIds is null) return ContractDraftResult.Failed(ContractDraftFailure.Forbidden);
        // Expand phase: older portals send neither; a portal that sends the key must send the version.
        if (idempotencyKey is { } key && HeaderFailure(key, input?.ExpectedVersion) is { } headerFailure)
            return headerFailure;
        var body = input?.Body?.Trim();
        if (body is not { Length: >= 1 and <= CommentMaxLength }) return Invalid("comment_required");
        var actor = await ActorDatabaseIdAsync(actorId, cancellationToken);
        return await RunAsync(actor, idempotencyKey, CommentAction, new { versionId, input!.ExpectedVersion, body },
            async now =>
            {
                // Another airline's version is simply not found.
                var row = await DraftAsync(versionId, false, cancellationToken, airlineIds);
                if (row is null) return NotFound();
                if (input.ExpectedVersion is { } expected && Version(row.Version) != expected)
                    return Conflict("version_conflict");
                // 1-N15: the airline can comment while Contratos edits and while Finance reviews.
                if (StateCode(row, allowPending: true) is { } state) return Conflict(state);
                var comment = AddComment(row.Version.Id, actor, body, now);
                CommercialAuditWriter.Add(context, actor, "commercial.draft.commented",
                    "commercial.contract_versions", row.Version.PublicId);
                await ContractDraftAudience.NotifyContractsAsync(context, "contract_draft_comments",
                    row.Version.PublicId, now, cancellationToken);
                await DepartmentNotificationWriter.NotifyAsync(context, Department.Contracts,
                    "contracts.drafts.read", "draft_comment", row.Version.PublicId, row.Airline, now, cancellationToken);
                return ContractDraftResult.Success(comment.PublicId);
            }, cancellationToken);
    }

    public async Task<ContractDraftResult> ReplyAsync(Guid actorId, Guid versionId, Guid idempotencyKey,
        ReplyContractDraftInput input, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.drafts.update", cancellationToken))
            return ContractDraftResult.Failed(ContractDraftFailure.Forbidden);
        if (HeaderFailure(idempotencyKey, input?.ExpectedVersion) is { } headerFailure) return headerFailure;
        var body = input!.Body?.Trim();
        if (body is not { Length: >= 1 and <= CommentMaxLength }) return Invalid("comment_required");
        var actor = await ActorDatabaseIdAsync(actorId, cancellationToken);
        return await RunAsync(actor, idempotencyKey, ReplyAction, new { versionId, input.ExpectedVersion, body },
            async now =>
            {
                var row = await DraftAsync(versionId, false, cancellationToken);
                if (row is null) return NotFound();
                if (Version(row.Version) != input.ExpectedVersion) return Conflict("version_conflict");
                if (StateCode(row, allowPending: true) is { } state) return Conflict(state);
                var comment = AddComment(row.Version.Id, actor, body, now);
                CommercialAuditWriter.Add(context, actor, "commercial.draft.replied",
                    "commercial.contract_versions", row.Version.PublicId);
                await ContractDraftAudience.NotifyContractsAsync(context, "contract_draft_comments",
                    row.Version.PublicId, now, cancellationToken);
                await ContractDraftAudience.NotifyAirlineAsync(context, row.Contract, now, cancellationToken);
                return ContractDraftResult.Success(comment.PublicId);
            }, cancellationToken);
    }

    public async Task<ContractDraftResult> UpdateAsync(Guid actorId, Guid versionId,
        UpdateContractDraftInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.drafts.update", cancellationToken))
            return ContractDraftResult.Failed(ContractDraftFailure.Forbidden);
        if (!ValidUpdate(input)) return Invalid("invalid_draft");
        if (idempotencyKey is { } key && HeaderFailure(key, input.ExpectedVersion) is { } headerFailure)
            return headerFailure;
        var actor = await ActorDatabaseIdAsync(actorId, cancellationToken);
        var terms = input.Terms.Trim();
        var payload = new
        {
            versionId, input.ExpectedVersion, input.ValidFrom, input.ValidTo, input.CurrencyCode, terms,
            rates = input.Rates.OrderBy(rate => rate.Id).Select(rate => new { rate.Id, BillingUnit = rate.BillingUnit.Trim(),
                rate.UnitPrice, rate.MinimumQuantity, rate.IsConfirmed }).ToArray(),
            charges = input.ChargeRates?.OrderBy(rate => rate.ChargeId).ToArray(),
        };
        return await RunAsync(actor, idempotencyKey, UpdateAction, payload, async now =>
        {
            var row = await DraftAsync(versionId, true, cancellationToken);
            if (row is null) return NotFound();
            if (input.ExpectedVersion is { } expected && Version(row.Version) != expected)
                return Conflict("version_conflict");
            if (StateCode(row, allowPending: false) is { } state) return Conflict(state);
            var rates = await context.ContractServiceRates.Where(rate =>
                rate.ContractVersionId == row.Version.Id).ToArrayAsync(cancellationToken);
            // The services changed since the editor read the draft (scope saved elsewhere).
            if (rates.Length != input.Rates.Count || rates.Any(rate => input.Rates.All(item => item.Id != rate.PublicId)))
                return Conflict("version_conflict");
            // 1-E: every rate keeps a unit code of ref.billing_units; a unit name is saved as its code.
            var units = await BillingUnitCodes.LoadAsync(context, cancellationToken);
            var rateUnits = input.Rates.ToDictionary(item => item.Id, item => units.Resolve(item.BillingUnit));
            if (rateUnits.Values.Any(unit => unit is null)) return Invalid("billing_unit_unknown");
            var chargeKeys = input.ChargeRates?.Select(rate => rate.ChargeId).ToArray() ?? [];
            var chargeIds = await context.ChargeDefinitions.AsNoTracking()
                .Where(charge => chargeKeys.Contains(charge.PublicId))
                .ToDictionaryAsync(charge => charge.PublicId, charge => charge.Id, cancellationToken);
            if (chargeIds.Count != chargeKeys.Length) return Invalid("invalid_draft");
            // A renewal or an amendment starts after the approved version in force (1-C, 1-B).
            if (!ContractDraftRules.StartsAfterCurrent(input.ValidFrom,
                    await CurrentApprovedStartAsync(row.Contract.Id, row.Version.Id, cancellationToken)))
                return Conflict(ContractDraftIssues.ValidFromNotAfterCurrent);
            // 1-N07: a new currency or validity must keep every linked package in rule.
            var currencyChanged = row.Version.CurrencyCode != input.CurrencyCode;
            if ((currencyChanged || row.Version.ValidFrom != input.ValidFrom || row.Version.ValidTo != input.ValidTo) &&
                (await LinkedPackagesAsync(row.Version.Id, cancellationToken)).Any(package =>
                    !PackageFits(package, input.CurrencyCode, input.ValidFrom, input.ValidTo)))
                return Conflict(ContractDraftIssues.PackageNotEligible);
            if (input.ChargeRates is not null)
            {
                context.ContractChargeRates.RemoveRange(await context.ContractChargeRates
                    .Where(rate => rate.ContractVersionId == row.Version.Id).ToArrayAsync(cancellationToken));
                foreach (var charge in input.ChargeRates.Where(rate => rate.IsExcluded || rate.Value is not null))
                    context.ContractChargeRates.Add(new ContractChargeRate
                    {
                        PublicId = Guid.CreateVersion7(), ContractVersionId = row.Version.Id,
                        ChargeDefinitionId = chargeIds[charge.ChargeId], IsExcluded = charge.IsExcluded,
                        Value = charge.IsExcluded ? null : charge.Value, CreatedAt = now, UpdatedAt = now,
                    });
            }
            var beforePrices = Prices(rates);
            var beforeConfirmation = Confirmations(rates);
            var beforeTerms = $"{row.Version.CurrencyCode} {row.Version.ValidFrom:O}–{row.Version.ValidTo:O}";
            row.Version.Terms = terms;
            row.Version.CurrencyCode = input.CurrencyCode;
            row.Version.ValidFrom = input.ValidFrom;
            row.Version.ValidTo = input.ValidTo;
            row.Version.UpdatedAt = now;
            foreach (var rate in rates)
            {
                var inputRate = input.Rates.Single(item => item.Id == rate.PublicId);
                rate.BillingUnit = rateUnits[inputRate.Id]!;
                rate.UnitPrice = inputRate.UnitPrice;
                rate.MinimumQuantity = inputRate.MinimumQuantity;
                // Prices in another currency are other prices: every rate is confirmed again (1-N07).
                rate.IsConfirmed = !currencyChanged && inputRate.IsConfirmed;
                rate.UpdatedAt = now;
            }
            CommercialAuditWriter.Add(context, actor, "commercial.draft.updated",
                "commercial.contract_versions", row.Version.PublicId, null,
                new AuditFieldChangeData("draft.currency_validity", beforeTerms,
                    $"{row.Version.CurrencyCode} {row.Version.ValidFrom:O}–{row.Version.ValidTo:O}"),
                new AuditFieldChangeData("rate.price", beforePrices, Prices(rates)),
                new AuditFieldChangeData("rate.confirmed", beforeConfirmation, Confirmations(rates)));
            await ContractDraftAudience.NotifyAirlineAsync(context, row.Contract, now, cancellationToken);
            await ContractDraftAudience.NotifyContractsAsync(context, ContractDraftAudience.DraftsResource,
                row.Version.PublicId, now, cancellationToken);
            return ContractDraftResult.Success(versionId);
        }, cancellationToken);
    }

    public async Task<ContractDraftResult> ActivateAsync(Guid actorId, Guid versionId,
        SubmitContractDraftInput? input, Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.drafts.activate", cancellationToken))
            return ContractDraftResult.Failed(ContractDraftFailure.Forbidden);
        var expected = input?.ExpectedVersion;
        if (idempotencyKey is { } key && HeaderFailure(key, expected) is { } headerFailure) return headerFailure;
        var actor = await ActorDatabaseIdAsync(actorId, cancellationToken);
        return await RunAsync(actor, idempotencyKey, SubmitAction, new { versionId, expected }, async now =>
        {
            var row = await DraftAsync(versionId, true, cancellationToken);
            if (row is null) return NotFound();
            if (expected is not null && Version(row.Version) != expected) return Conflict("version_conflict");
            if (StateCode(row, allowPending: false) is { } state) return Conflict(state);
            // One code per cause, the same the readiness endpoint and the button show (1-D, 1-N14).
            var (issues, _) = await EvaluateAsync(row, now, cancellationToken);
            if (issues.Count > 0) return Conflict(issues[0].Code);
            // 2-N15: nothing starts on or after the scheduled termination of its contract.
            if (ContractLifecycle.ClosedFor(row.Contract.Status, row.Contract.TerminatedOn, row.Version.ValidFrom) is { } closed)
                return Conflict(closed);
            // Contratos submits the reviewed draft to Finance. After approval come the validity step and
            // both signatures (airline first); only then the contract activates (ADR-0024, ADR-0025).
            row.Version.Status = ContractVersionStatus.PendingFinanceApproval;
            row.Version.UpdatedAt = now;
            // 1-N19: only Finance reviewers who cover every station of the version hear about it.
            var stations = await ContractDraftAudience.StationsAsync(context, row.Version.Id, cancellationToken);
            foreach (var recipient in await ContractDraftAudience.FinanceReviewersAsync(context,
                         "finance.contract_approvals.read", stations, now, cancellationToken))
                AccountChangeOutboxWriter.Add(context, recipient, null, "contract_approvals", row.Version.PublicId, now);
            await DepartmentNotificationWriter.NotifyAsync(context, Department.Finance,
                "finance.contract_approvals.read", "contract_approval", row.Version.PublicId, row.Airline, now,
                cancellationToken, coveringStationIds: stations);
            await ContractDraftAudience.NotifyContractsAsync(context, "contract_approvals", row.Version.PublicId, now,
                cancellationToken);
            await ContractDraftAudience.NotifyAirlineAsync(context, row.Contract, now, cancellationToken);
            CommercialAuditWriter.Add(context, actor, "commercial.contract.submitted_to_finance",
                "commercial.contract_versions", row.Version.PublicId);
            return ContractDraftResult.Success(row.Contract.PublicId);
        }, cancellationToken);
    }

    public async Task<ContractDraftResult> SetScopeAsync(Guid actorId, Guid versionId, Guid idempotencyKey,
        SetContractDraftScopeInput input, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.drafts.update", cancellationToken))
            return ContractDraftResult.Failed(ContractDraftFailure.Forbidden);
        if (HeaderFailure(idempotencyKey, input?.ExpectedVersion) is { } headerFailure) return headerFailure;
        if (input!.ServiceIds is not { Count: >= 1 and <= 100 } || input.StationIds is not { Count: >= 1 and <= 30 } ||
            input.ServiceIds.Contains(Guid.Empty) || input.StationIds.Contains(Guid.Empty) ||
            input.ServiceIds.Distinct().Count() != input.ServiceIds.Count ||
            input.StationIds.Distinct().Count() != input.StationIds.Count)
            return Invalid("scope_invalid");
        var serviceKeys = input.ServiceIds.Order().ToArray();
        var stationKeys = input.StationIds.Order().ToArray();
        var actor = await ActorDatabaseIdAsync(actorId, cancellationToken);
        return await RunAsync(actor, idempotencyKey, ScopeAction,
            new { versionId, input.ExpectedVersion, services = serviceKeys, stations = stationKeys }, async now =>
            {
                var row = await DraftAsync(versionId, true, cancellationToken);
                if (row is null) return NotFound();
                if (Version(row.Version) != input.ExpectedVersion) return Conflict("version_conflict");
                if (StateCode(row, allowPending: false) is { } state) return Conflict(state);
                var services = await context.ServiceDefinitions.AsNoTracking()
                    .Where(service => serviceKeys.Contains(service.PublicId)).ToArrayAsync(cancellationToken);
                if (services.Length != serviceKeys.Length) return Invalid("service_not_found");
                var stations = await context.Stations.AsNoTracking()
                    .Where(station => stationKeys.Contains(station.PublicId)).ToArrayAsync(cancellationToken);
                if (stations.Length != stationKeys.Length || stations.Any(station => !station.IsActive))
                    return Invalid("stations_invalid");
                var rates = await context.ContractServiceRates.Where(rate => rate.ContractVersionId == row.Version.Id)
                    .ToArrayAsync(cancellationToken);
                var current = rates.Select(rate => rate.ServiceDefinitionId).ToHashSet();
                var wanted = services.Select(service => service.Id).ToHashSet();
                var added = services.Where(service => !current.Contains(service.Id)).ToArray();
                // 1-N10: a retired service never enters a draft; one already in it stays marked until removed.
                if (added.Any(service => !service.IsActive)) return Conflict(ContractDraftIssues.ServiceRetired);
                var removed = rates.Where(rate => !wanted.Contains(rate.ServiceDefinitionId)).ToArray();
                var packaged = await PackagedServicesAsync(row.Version.Id, cancellationToken);
                if (removed.Any(rate => packaged.Contains(rate.ServiceDefinitionId))) return Conflict("service_in_package");
                var links = await context.Set<ContractVersionStation>()
                    .Where(link => link.ContractVersionId == row.Version.Id).ToArrayAsync(cancellationToken);
                var stationIds = stations.Select(station => station.Id).ToHashSet();
                var droppedStations = links.Where(link => !stationIds.Contains(link.StationId)).ToArray();
                var newStations = stationIds.Where(id => links.All(link => link.StationId != id)).ToArray();
                if (added.Length == 0 && removed.Length == 0 && droppedStations.Length == 0 && newStations.Length == 0)
                    return ContractDraftResult.Success(versionId);

                var serviceIds = current.Union(wanted).ToArray();
                var codes = await context.ServiceDefinitions.AsNoTracking()
                    .Where(service => serviceIds.Contains(service.Id))
                    .ToDictionaryAsync(service => service.Id, service => service.Code, cancellationToken);
                var allStationIds = stationIds.Union(links.Select(link => link.StationId)).ToArray();
                var stationCodes = await context.Stations.AsNoTracking()
                    .Where(station => allStationIds.Contains(station.Id))
                    .ToDictionaryAsync(station => station.Id, station => station.Code, cancellationToken);
                string Services(IEnumerable<long> ids) => string.Join(", ", ids.Select(id => codes[id]).Order(StringComparer.Ordinal));
                string Stations(IEnumerable<long> ids) => string.Join(", ", ids.Select(id => stationCodes[id]).Order(StringComparer.Ordinal));
                var beforeServices = Services(current);
                var beforeStations = Stations(links.Select(link => link.StationId));

                context.Set<ContractVersionStation>().RemoveRange(droppedStations);
                foreach (var stationId in newStations)
                    context.Set<ContractVersionStation>().Add(new ContractVersionStation
                    { ContractVersionId = row.Version.Id, StationId = stationId });
                context.ContractServiceRates.RemoveRange(removed);
                // New services start from the Finance base tariff of the new scope, unconfirmed (1-N04, 1-N06).
                var baseRates = await FinanceTariffLookup.ServiceRatesAsync(context, row.Version.CurrencyCode,
                    row.Version.ValidFrom, ContractDraftRules.BaseStation(stationIds),
                    added.Select(service => service.Id).ToArray(), cancellationToken);
                var units = await BillingUnitCodes.LoadAsync(context, cancellationToken);
                foreach (var service in added)
                {
                    var baseRate = baseRates.GetValueOrDefault(service.Id);
                    context.ContractServiceRates.Add(new ContractServiceRate
                    {
                        PublicId = Guid.CreateVersion7(), ContractVersionId = row.Version.Id,
                        ServiceDefinitionId = service.Id,
                        BillingUnit = baseRate?.BillingUnit ?? units.CodeOrDefault(service.DefaultBillingUnit),
                        UnitPrice = baseRate?.UnitPrice ?? 0, MinimumQuantity = baseRate?.MinimumBillableQuantity ?? 0,
                        IsConfirmed = false, CreatedAt = now, UpdatedAt = now,
                    });
                }
                row.Version.UpdatedAt = now;
                CommercialAuditWriter.Add(context, actor, "commercial.draft.scope_changed",
                    "commercial.contract_versions", row.Version.PublicId, null,
                    new AuditFieldChangeData("draft.services", beforeServices, Services(wanted)),
                    new AuditFieldChangeData("draft.stations", beforeStations, Stations(stationIds)));
                await ContractDraftAudience.NotifyAirlineAsync(context, row.Contract, now, cancellationToken);
                await ContractDraftAudience.NotifyContractsAsync(context, ContractDraftAudience.DraftsResource,
                    row.Version.PublicId, now, cancellationToken);
                return ContractDraftResult.Success(versionId);
            }, cancellationToken);
    }

    public async Task<ContractDraftResult> DiscardAsync(Guid actorId, Guid versionId, Guid idempotencyKey,
        DiscardContractDraftInput input, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.drafts.delete", cancellationToken))
            return ContractDraftResult.Failed(ContractDraftFailure.Forbidden);
        if (HeaderFailure(idempotencyKey, input?.ExpectedVersion) is { } headerFailure) return headerFailure;
        if (!ContractDraftRules.ValidReason(input!.Reason)) return Invalid("reason_required");
        var reason = input.Reason.Trim();
        var actor = await ActorDatabaseIdAsync(actorId, cancellationToken);
        return await RunAsync(actor, idempotencyKey, DiscardAction, new { versionId, input.ExpectedVersion, reason },
            async now =>
            {
                var row = await DraftAsync(versionId, true, cancellationToken);
                if (row is null) return NotFound();
                if (Version(row.Version) != input.ExpectedVersion) return Conflict("version_conflict");
                if (StateCode(row, allowPending: true) is { } state) return Conflict(state);
                var wasPending = row.Version.Status == ContractVersionStatus.PendingFinanceApproval;
                // Nothing is deleted: the version stays, closed, with its rates, comments and history.
                row.Version.Status = ContractVersionStatus.Rejected;
                row.Version.UpdatedAt = now;
                CommercialAuditWriter.Add(context, actor, "commercial.draft.discarded",
                    "commercial.contract_versions", row.Version.PublicId, reason);
                // A contract that never activated closes with its only live version.
                if (row.Contract.Status == ContractStatus.Draft && !await context.ContractVersions.AnyAsync(item =>
                        item.ContractId == row.Contract.Id && item.Id != row.Version.Id &&
                        (item.Status == ContractVersionStatus.Draft ||
                         item.Status == ContractVersionStatus.PendingFinanceApproval ||
                         item.Status == ContractVersionStatus.Approved), cancellationToken))
                {
                    var today = BusinessCalendar.Today(now);
                    context.Set<ContractStatusEvent>().Add(new ContractStatusEvent
                    {
                        ContractId = row.Contract.Id, FromStatus = ContractStatus.Draft, ToStatus = ContractStatus.Terminated,
                        OccurredAt = now, ActorAccountId = actor, Reason = reason,
                    });
                    row.Contract.Status = ContractStatus.Terminated;
                    row.Contract.TerminatedOn = row.Contract.SignedOn is { } signed && signed > today ? signed : today;
                    row.Contract.UpdatedAt = now;
                    CommercialAuditWriter.Add(context, actor, "commercial.contract.discarded",
                        "commercial.contracts", row.Contract.PublicId, reason);
                    await ContractActivation.AnnounceAsync(context, row.Contract, "contract_lifecycle", now, cancellationToken);
                }
                else await ContractDraftAudience.NotifyAirlineAsync(context, row.Contract, now, cancellationToken);
                if (wasPending)
                    foreach (var recipient in await CommercialNotificationRecipients.WithPermissionAsync(context,
                                 "finance.contract_approvals.read", cancellationToken))
                        AccountChangeOutboxWriter.Add(context, recipient, null, "contract_approvals", row.Version.PublicId, now);
                await ContractDraftAudience.NotifyContractsAsync(context, ContractDraftAudience.DraftsResource,
                    row.Version.PublicId, now, cancellationToken);
                return ContractDraftResult.Success(versionId);
            }, cancellationToken);
    }

    private ContractDraftComment AddComment(long versionId, long authorId, string body, DateTimeOffset now)
    {
        var comment = new ContractDraftComment
        {
            PublicId = Guid.CreateVersion7(), ContractVersionId = versionId, AuthorAccountId = authorId,
            Body = body, CreatedAt = now, UpdatedAt = now,
        };
        context.ContractDraftComments.Add(comment);
        return comment;
    }

    private static bool ValidUpdate(UpdateContractDraftInput? input) =>
        input is not null && !string.IsNullOrWhiteSpace(input.Terms) && input.Terms.Trim().Length <= 10000 &&
        input.CurrencyCode is "USD" or "DOP" && input.ChargeRates is not { Count: > 100 } &&
        input.ChargeRates?.Any(rate => rate.IsExcluded ? rate.Value is not null : rate.Value is < 0 or > 900_000_000m) != true &&
        (input.ChargeRates is null || input.ChargeRates.Select(rate => rate.ChargeId).Distinct().Count() == input.ChargeRates.Count) &&
        (input.ValidTo is null || input.ValidTo >= input.ValidFrom) &&
        input.Rates is { Count: >= 1 and <= 100 } &&
        input.Rates.Select(rate => rate.Id).Distinct().Count() == input.Rates.Count &&
        !input.Rates.Any(rate => rate.UnitPrice < 0 || rate.MinimumQuantity < 0 ||
            string.IsNullOrWhiteSpace(rate.BillingUnit) || rate.BillingUnit.Length > 32);

    private static string Prices(IEnumerable<ContractServiceRate> rates) =>
        string.Join(", ", rates.OrderBy(rate => rate.PublicId)
            .Select(rate => $"{rate.PublicId}:{rate.UnitPrice.ToString(CultureInfo.InvariantCulture)}"));

    private static string Confirmations(IEnumerable<ContractServiceRate> rates) =>
        string.Join(", ", rates.OrderBy(rate => rate.PublicId)
            .Select(rate => $"{rate.PublicId}:{(rate.IsConfirmed == true ? "confirmed" : "pending")}"));
}
