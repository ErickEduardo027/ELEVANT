using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

internal sealed partial class EfFinanceTariffBookStore
{
    public async Task<IReadOnlyList<TariffVersionSummaryData>?> ListServiceTariffsAsync(Guid actorId,
        string? currencyCode, CancellationToken cancellationToken = default)
    {
        if (await AuthorizeAsync(actorId, "finance.tariffs.read", cancellationToken) is null) return null;
        var versions = await context.ServiceTariffVersions.AsNoTracking()
            .Where(version => currencyCode == null || version.CurrencyCode == currencyCode)
            .OrderBy(version => version.CurrencyCode).ThenByDescending(version => version.ValidFrom)
            .ToArrayAsync(cancellationToken);
        var ids = versions.Select(version => version.Id).ToArray();
        var counts = await context.ServiceTariffRates.AsNoTracking().Where(rate => ids.Contains(rate.ServiceTariffVersionId))
            .GroupBy(rate => rate.ServiceTariffVersionId).Select(group => new { group.Key, Count = group.Count() })
            .ToDictionaryAsync(item => item.Key, item => item.Count, cancellationToken);
        var publishers = await PublisherNamesAsync(versions.Select(version => version.PublishedByAccountId), cancellationToken);
        return versions.Select(version => Summary(version.PublicId, version.CurrencyCode, version.ValidFrom,
            version.ValidTo, version.Status, version.Note, version.PublishedAt,
            version.PublishedByAccountId is { } by ? publishers.GetValueOrDefault(by) : null,
            counts.GetValueOrDefault(version.Id), version.RowVersion)).ToArray();
    }

    public async Task<ServiceTariffVersionData?> GetServiceTariffAsync(Guid actorId, Guid versionId,
        CancellationToken cancellationToken = default)
    {
        if (await AuthorizeAsync(actorId, "finance.tariffs.read", cancellationToken) is null) return null;
        var version = await context.ServiceTariffVersions.AsNoTracking()
            .SingleOrDefaultAsync(item => item.PublicId == versionId, cancellationToken);
        if (version is null) return null;
        var rates = await (from rate in context.ServiceTariffRates.AsNoTracking()
                           join service in context.ServiceDefinitions.AsNoTracking() on rate.ServiceDefinitionId equals service.Id
                           join station in context.Stations.AsNoTracking() on rate.StationId equals (long?)station.Id into stations
                           from station in stations.DefaultIfEmpty()
                           where rate.ServiceTariffVersionId == version.Id
                           orderby service.Code, station.Code
                           select new ServiceTariffRateData(service.PublicId, service.Code, service.Name,
                               station == null ? null : station.PublicId, station == null ? null : station.Code,
                               rate.BillingUnit, rate.UnitPrice, rate.MinimumBillableQuantity))
            .ToArrayAsync(cancellationToken);
        var publishers = await PublisherNamesAsync([version.PublishedByAccountId], cancellationToken);
        return new ServiceTariffVersionData(Summary(version.PublicId, version.CurrencyCode, version.ValidFrom,
            version.ValidTo, version.Status, version.Note, version.PublishedAt,
            version.PublishedByAccountId is { } by ? publishers.GetValueOrDefault(by) : null, rates.Length,
            version.RowVersion), rates);
    }

    public async Task<FinanceCatalogResult> CreateServiceTariffDraftAsync(Guid actorId, CreateTariffDraftInput input,
        CancellationToken cancellationToken = default)
    {
        var actor = await AuthorizeAsync(actorId, "finance.tariffs.create", cancellationToken);
        if (actor is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.Forbidden);
        if (input is null || !ValidCurrency(input.CurrencyCode) || input.ValidFrom == default || input.Note?.Length > 500)
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid);
        return await InTransactionAsync(async () =>
        {
            var now = timeProvider.GetUtcNow();
            if (await context.ServiceTariffVersions.AnyAsync(version => version.CurrencyCode == input.CurrencyCode &&
                    version.Status == TariffVersionStatus.Draft, cancellationToken))
                return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict);
            ServiceTariffVersion? source = null;
            if (input.CopyFromVersionId is { } sourceId)
            {
                source = await context.ServiceTariffVersions.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.PublicId == sourceId, cancellationToken);
                if (source is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.NotFound);
            }
            var draft = new ServiceTariffVersion
            {
                PublicId = Guid.CreateVersion7(), CurrencyCode = input.CurrencyCode, ValidFrom = input.ValidFrom,
                Status = TariffVersionStatus.Draft, Note = input.Note?.Trim(), CreatedByAccountId = actor.Id,
                CreatedAt = now, UpdatedAt = now,
            };
            context.ServiceTariffVersions.Add(draft);
            await context.SaveChangesAsync(cancellationToken);
            if (source is not null)
            {
                // Copying between currencies keeps the structure; Finance reprices before publishing.
                var sameCurrency = source.CurrencyCode == input.CurrencyCode;
                foreach (var rate in await context.ServiceTariffRates.AsNoTracking()
                             .Where(rate => rate.ServiceTariffVersionId == source.Id).ToArrayAsync(cancellationToken))
                    context.ServiceTariffRates.Add(new ServiceTariffRate
                    {
                        PublicId = Guid.CreateVersion7(), ServiceTariffVersionId = draft.Id,
                        ServiceDefinitionId = rate.ServiceDefinitionId, StationId = rate.StationId,
                        BillingUnit = rate.BillingUnit, UnitPrice = sameCurrency ? rate.UnitPrice : 0m,
                        MinimumBillableQuantity = rate.MinimumBillableQuantity, CreatedAt = now, UpdatedAt = now,
                    });
            }
            Audit(actor.Id, "finance.service_tariff.draft_created", "commercial.service_tariff_versions", draft.PublicId,
                null, new AuditFieldChangeData("tariff.currency", null, draft.CurrencyCode));
            await NotifyAsync("finance.tariffs.read", "finance_tariff_book", draft.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return FinanceCatalogResult.Success(draft.PublicId);
        }, cancellationToken);
    }

    public async Task<FinanceCatalogResult> SaveServiceTariffDraftAsync(Guid actorId, Guid versionId,
        SaveServiceTariffDraftInput input, CancellationToken cancellationToken = default)
    {
        var actor = await AuthorizeAsync(actorId, "finance.tariffs.update", cancellationToken);
        if (actor is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.Forbidden);
        if (input is null || input.ValidFrom == default || input.ValidTo < input.ValidFrom || input.Note?.Length > 500 ||
            string.IsNullOrWhiteSpace(input.ExpectedVersion) || input.Rates is null or { Count: > 500 } ||
            input.Rates.Any(rate => rate.UnitPrice < 0 || rate.UnitPrice > 900_000_000m ||
                rate.MinimumBillableQuantity < 0 || rate.MinimumBillableQuantity > 1_000_000m) ||
            input.Rates.Select(rate => (rate.ServiceId, rate.StationId)).Distinct().Count() != input.Rates.Count)
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid);
        var serviceIds = input.Rates.Select(rate => rate.ServiceId).Distinct().ToArray();
        var services = await context.ServiceDefinitions.AsNoTracking().Where(service => serviceIds.Contains(service.PublicId))
            .ToDictionaryAsync(service => service.PublicId, service => service.Id, cancellationToken);
        var stationIds = input.Rates.Where(rate => rate.StationId != null).Select(rate => rate.StationId!.Value).Distinct().ToArray();
        var stations = await context.Stations.AsNoTracking().Where(station => stationIds.Contains(station.PublicId))
            .ToDictionaryAsync(station => station.PublicId, station => station.Id, cancellationToken);
        var units = input.Rates.Select(rate => rate.BillingUnit?.Trim()).Distinct().ToArray();
        var activeUnits = await context.BillingUnits.AsNoTracking().Where(unit => units.Contains(unit.Code) && unit.IsActive)
            .Select(unit => unit.Code).ToArrayAsync(cancellationToken);
        if (services.Count != serviceIds.Length || stations.Count != stationIds.Length ||
            units.Any(unit => unit is null || !activeUnits.Contains(unit)))
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid);

        return await InTransactionAsync(async () =>
        {
            var now = timeProvider.GetUtcNow();
            var draft = await context.ServiceTariffVersions.SingleOrDefaultAsync(item => item.PublicId == versionId,
                cancellationToken);
            if (draft is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.NotFound);
            if (draft.Status != TariffVersionStatus.Draft || Version(draft.RowVersion) != input.ExpectedVersion)
                return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict);
            draft.ValidFrom = input.ValidFrom;
            draft.ValidTo = input.ValidTo;
            draft.Note = input.Note?.Trim();
            draft.UpdatedAt = now;
            context.ServiceTariffRates.RemoveRange(await context.ServiceTariffRates
                .Where(rate => rate.ServiceTariffVersionId == draft.Id).ToArrayAsync(cancellationToken));
            await context.SaveChangesAsync(cancellationToken);
            foreach (var rate in input.Rates)
                context.ServiceTariffRates.Add(new ServiceTariffRate
                {
                    PublicId = Guid.CreateVersion7(), ServiceTariffVersionId = draft.Id,
                    ServiceDefinitionId = services[rate.ServiceId],
                    StationId = rate.StationId is { } station ? stations[station] : null,
                    BillingUnit = rate.BillingUnit.Trim(), UnitPrice = rate.UnitPrice,
                    MinimumBillableQuantity = rate.MinimumBillableQuantity, CreatedAt = now, UpdatedAt = now,
                });
            Audit(actor.Id, "finance.service_tariff.draft_saved", "commercial.service_tariff_versions", draft.PublicId,
                null, new AuditFieldChangeData("tariff.rates", null, input.Rates.Count.ToString()));
            await context.SaveChangesAsync(cancellationToken);
            return FinanceCatalogResult.Success(draft.PublicId);
        }, cancellationToken);
    }

    /// <summary>
    /// Publishing freezes the draft. The version it replaces (same currency) ends the
    /// day before, so historic dates still resolve to the price that applied then.
    /// </summary>
    public async Task<FinanceCatalogResult> PublishServiceTariffAsync(Guid actorId, Guid versionId,
        string expectedVersion, CancellationToken cancellationToken = default)
    {
        var actor = await AuthorizeAsync(actorId, "finance.tariffs.publish", cancellationToken);
        if (actor is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.Forbidden);
        if (string.IsNullOrWhiteSpace(expectedVersion)) return FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid);
        return await InTransactionAsync(async () =>
        {
            var now = timeProvider.GetUtcNow();
            var draft = await context.ServiceTariffVersions.SingleOrDefaultAsync(item => item.PublicId == versionId,
                cancellationToken);
            if (draft is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.NotFound);
            if (draft.Status != TariffVersionStatus.Draft || Version(draft.RowVersion) != expectedVersion ||
                !await context.ServiceTariffRates.AnyAsync(rate => rate.ServiceTariffVersionId == draft.Id, cancellationToken))
                return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict);
            var previous = await context.ServiceTariffVersions.Where(version => version.CurrencyCode == draft.CurrencyCode &&
                    version.Status != TariffVersionStatus.Draft && (version.ValidTo == null || version.ValidTo >= draft.ValidFrom))
                .ToArrayAsync(cancellationToken);
            if (previous.Any(version => version.ValidFrom >= draft.ValidFrom))
                return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict);
            foreach (var version in previous)
            {
                version.ValidTo = draft.ValidFrom.AddDays(-1);
                version.Status = TariffVersionStatus.Superseded;
                version.UpdatedAt = now;
            }
            draft.Status = TariffVersionStatus.Published;
            draft.PublishedAt = now;
            draft.PublishedByAccountId = actor.Id;
            draft.UpdatedAt = now;
            Audit(actor.Id, "finance.service_tariff.published", "commercial.service_tariff_versions", draft.PublicId,
                null, new AuditFieldChangeData("tariff.valid_from", null, draft.ValidFrom.ToString("O")));
            await NotifyAsync("finance.tariffs.read", "finance_tariff_book", draft.PublicId, now, cancellationToken);
            await NotifyAsync("contracts.drafts.read", "finance_tariff_book", draft.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return FinanceCatalogResult.Success(draft.PublicId);
        }, cancellationToken);
    }

    public async Task<FinanceCatalogResult> DeleteServiceTariffDraftAsync(Guid actorId, Guid versionId,
        string expectedVersion, CancellationToken cancellationToken = default)
    {
        var actor = await AuthorizeAsync(actorId, "finance.tariffs.delete", cancellationToken);
        if (actor is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.Forbidden);
        return await InTransactionAsync(async () =>
        {
            var draft = await context.ServiceTariffVersions.SingleOrDefaultAsync(item => item.PublicId == versionId,
                cancellationToken);
            if (draft is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.NotFound);
            if (draft.Status != TariffVersionStatus.Draft || Version(draft.RowVersion) != expectedVersion)
                return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict);
            context.ServiceTariffRates.RemoveRange(await context.ServiceTariffRates
                .Where(rate => rate.ServiceTariffVersionId == draft.Id).ToArrayAsync(cancellationToken));
            context.ServiceTariffVersions.Remove(draft);
            Audit(actor.Id, "finance.service_tariff.draft_deleted", "commercial.service_tariff_versions", draft.PublicId);
            await context.SaveChangesAsync(cancellationToken);
            return FinanceCatalogResult.Success(draft.PublicId);
        }, cancellationToken);
    }

    private static TariffVersionSummaryData Summary(Guid id, string currency, DateOnly validFrom, DateOnly? validTo,
        TariffVersionStatus status, string? note, DateTimeOffset? publishedAt, string? publishedBy, int rateCount,
        byte[] rowVersion) =>
        new(id, currency, validFrom, validTo, status.ToString(), note, publishedAt, publishedBy, rateCount,
            Version(rowVersion));

    private async Task<IReadOnlyDictionary<long, string>> PublisherNamesAsync(IEnumerable<long?> accountIds,
        CancellationToken cancellationToken)
    {
        var ids = accountIds.Where(id => id != null).Select(id => id!.Value).Distinct().ToArray();
        return await (from user in context.Users.AsNoTracking()
                      join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
                      where ids.Contains(user.Id)
                      select new { user.Id, Name = person.FirstName + " " + person.LastName })
            .ToDictionaryAsync(item => item.Id, item => item.Name, cancellationToken);
    }
}
