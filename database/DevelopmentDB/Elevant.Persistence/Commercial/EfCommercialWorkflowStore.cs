using System.Data;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Domain.Validation;
using Elevant.Infrastructure.Persistence;
using Elevant.Infrastructure.Persistence.Seed;
using Elevant.Persistence.Realtime;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

using Elevant.Persistence.Finance;

namespace Elevant.Persistence.Commercial;

internal sealed class EfCommercialWorkflowStore(
    ElevantDbContext context, CommercialPermissionGuard permissions)
    : ICommercialWorkflowStore
{
    public async Task<IReadOnlyList<CommercialStationData>?> ListStationsAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.requests.read", cancellationToken))
            return null;
        return await context.Stations.AsNoTracking().Where(station => station.IsActive)
            .OrderBy(station => station.Code)
            .Select(station => new CommercialStationData(station.PublicId,
                station.Code, station.Name)).ToArrayAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<CommercialRequestData>?> ListRequestsAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.requests.read", cancellationToken))
            return null;
        var requests = await (from request in context.ServiceRequests.AsNoTracking()
            join profile in context.CommercialAirlineProfiles.AsNoTracking()
                on request.AirlineProfileId equals profile.Id
            orderby request.SubmittedAt descending
            select new { request, profile }).Take(200).ToArrayAsync(cancellationToken);
        var requestIds = requests.Select(item => item.request.Id).ToArray();
        var items = await context.Set<ServiceRequestItem>().AsNoTracking()
            .Where(item => requestIds.Contains(item.ServiceRequestId))
            .ToArrayAsync(cancellationToken);
        var contracts = await context.Contracts.AsNoTracking()
            .Where(contract => contract.OriginatingServiceRequestId != null &&
                requestIds.Contains(contract.OriginatingServiceRequestId.Value))
            .ToArrayAsync(cancellationToken);
        var serviceIds = items.Where(item => item.ServiceDefinitionId != null)
            .Select(item => item.ServiceDefinitionId!.Value).Distinct().ToArray();
        var servicePublicIds = await context.ServiceDefinitions.AsNoTracking()
            .Where(service => serviceIds.Contains(service.Id))
            .Select(service => new { service.Id, service.PublicId })
            .ToDictionaryAsync(service => service.Id, service => service.PublicId, cancellationToken);
        return requests.Select(item => new CommercialRequestData(
            item.request.PublicId, item.request.RequestCode,
            item.request.RequestedAirlineName, item.profile.PublicId,
            item.request.AirlineLegalNameSnapshot ?? item.profile.LegalName,
            item.profile.CountryCode, item.profile.IataCode, item.profile.IcaoCode,
            item.profile.LogoObjectKey ?? AviamAirlineReference.LogoPaths.GetValueOrDefault(item.profile.SourceName),
            item.profile.VerifiedAt is not null && item.profile.VerifiedByAccountId is not null,
            item.profile.VerificationSourceUrl,
            item.request.ContactName, item.request.ContactTitle ?? string.Empty,
            item.request.ContactEmail, item.request.ContactPhone ?? string.Empty,
            item.request.ContactNationalityCode, item.request.ContactAddress,
            item.request.ContactCountry, item.request.ContactProvince,
            item.request.ContactMunicipality, item.request.ContactDocumentType,
            item.request.ContactDocumentNumber,
            item.request.AuthorityDeclared, item.request.Status.ToString(),
            item.request.SubmittedAt, item.request.DecisionReason,
            contracts.FirstOrDefault(contract => contract.OriginatingServiceRequestId == item.request.Id)?.PublicId,
            items.Where(service => service.ServiceRequestId == item.request.Id)
                .Select(service => new CommercialRequestItemData(
                    service.ServiceDefinitionId is long id && servicePublicIds.TryGetValue(id, out var publicId)
                        ? publicId : Guid.Empty,
                    service.RequestedServiceName, service.RequestedUnit ?? string.Empty))
                .ToArray(), item.request.ContactDistrict)).ToArray();
    }

    public async Task<CommercialWorkflowResult> VerifyAirlineAsync(Guid actorId,
        Guid profileId, VerifyAirlineInput input, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.requests.verify", cancellationToken))
            return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Forbidden);
        if (input is null || !ValidText(input.LegalName, 200) ||
            !AirlineCodes.IsCountry(input.CountryCode?.ToUpperInvariant()) ||
            !AirlineCodes.IsIata(input.IataCode?.ToUpperInvariant()) ||
            !AirlineCodes.IsIcao(input.IcaoCode?.ToUpperInvariant()) ||
            !Uri.TryCreate(input.VerificationSourceUrl, UriKind.Absolute, out var source) ||
            source.Scheme != Uri.UriSchemeHttps || source.UserInfo.Length != 0 ||
            input.VerificationSourceUrl.Length > 512 || !ValidLegacyLogo(input.LogoUrl))
            return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Invalid);
        var profile = await context.CommercialAirlineProfiles.SingleOrDefaultAsync(
            item => item.PublicId == profileId && item.IsPublished, cancellationToken);
        if (profile is null)
            return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.NotFound);
        if (await context.ServiceRequests.AnyAsync(request =>
            request.AirlineProfileId == profile.Id &&
            request.Status == CommercialRequestStatus.Approved, cancellationToken))
            return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict);
        var iata = input.IataCode.ToUpperInvariant();
        var icao = input.IcaoCode.ToUpperInvariant();
        if (await context.CommercialAirlineProfiles.AnyAsync(item => item.Id != profile.Id &&
            item.VerifiedAt != null &&
            (item.IataCode == iata || item.IcaoCode == icao), cancellationToken))
            return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict);
        var accountId = await context.Users.Where(user => user.PublicId == actorId)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        profile.LegalName = input.LegalName.Trim();
        profile.CountryCode = input.CountryCode.ToUpperInvariant();
        profile.IataCode = iata;
        profile.IcaoCode = icao;
        // Older independently deployed clients still send this optional v1 field.
        // An empty field must not erase a logo uploaded in Superadministración.
        if (!string.IsNullOrWhiteSpace(input.LogoUrl))
            profile.LogoObjectKey = input.LogoUrl.Trim();
        profile.VerificationSourceUrl = input.VerificationSourceUrl.Trim();
        profile.VerifiedByAccountId = accountId;
        profile.VerifiedAt = DateTimeOffset.UtcNow;
        profile.UpdatedAt = DateTimeOffset.UtcNow;
        CommercialAuditWriter.Add(context, accountId, "commercial.airline.verified",
            "commercial.airline_profiles", profile.PublicId);
        // The resource invalidates the list, so one existing request is sufficient per reader.
        var affectedRequestId = await context.ServiceRequests.AsNoTracking()
            .Where(request => request.AirlineProfileId == profile.Id &&
                (request.Status == CommercialRequestStatus.Pending ||
                 request.Status == CommercialRequestStatus.InReview))
            .Select(request => request.PublicId).FirstOrDefaultAsync(cancellationToken);
        if (affectedRequestId != Guid.Empty)
            await NotifyRequestReadersAsync(affectedRequestId, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return CommercialWorkflowResult.Success(profile.PublicId);
    }

    public async Task<CommercialWorkflowResult> DecideAsync(Guid actorId,
        Guid requestId, ReviewCommercialInput input, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId,
            input?.Approve == true ? "contracts.requests.approve" : "contracts.requests.reject",
            cancellationToken))
            return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Forbidden);
        if (input is null || input.StationIds is null ||
            (input.Approve && (input.StationIds.Count is < 1 or > 30 ||
                input.StationIds.Distinct().Count() != input.StationIds.Count)) ||
            (!input.Approve && !ValidText(input.Reason, 1000)))
            return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Invalid);

        var strategy = context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(
                IsolationLevel.Serializable, cancellationToken);
            var request = await context.ServiceRequests.SingleOrDefaultAsync(
                item => item.PublicId == requestId, cancellationToken);
            if (request is null)
                return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.NotFound);
            if (request.Status is not (CommercialRequestStatus.Pending or CommercialRequestStatus.InReview))
                return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict);
            var actorDatabaseId = await context.Users.Where(user => user.PublicId == actorId)
                .Select(user => user.Id).SingleAsync(cancellationToken);
            var now = DateTimeOffset.UtcNow;
            var oldStatus = request.Status;
            if (!input.Approve)
            {
                request.Status = CommercialRequestStatus.Rejected;
                request.DecisionReason = input.Reason!.Trim();
                request.ReviewedByAccountId = actorDatabaseId;
                request.ReviewedAt = now;
                AddStatusEvent(request.Id, oldStatus, request.Status, actorDatabaseId, now, request.DecisionReason);
                CommercialAuditWriter.Add(context, actorDatabaseId,
                    "commercial.request.rejected", "commercial.service_requests",
                    request.PublicId, request.DecisionReason);
                await NotifyRequestReadersAsync(request.PublicId, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return CommercialWorkflowResult.Success(request.PublicId);
            }

            var profile = await context.CommercialAirlineProfiles.SingleOrDefaultAsync(
                item => item.Id == request.AirlineProfileId, cancellationToken);
            if (profile is null || profile.VerifiedAt is null || profile.VerifiedByAccountId is null ||
                string.IsNullOrWhiteSpace(profile.LegalName) ||
                string.IsNullOrWhiteSpace(profile.IataCode) ||
                string.IsNullOrWhiteSpace(profile.IcaoCode) ||
                string.IsNullOrWhiteSpace(profile.CountryCode))
                return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.AirlineUnverified);
            var stations = await context.Stations.Where(station =>
                input.StationIds.Contains(station.PublicId) && station.IsActive)
                .ToArrayAsync(cancellationToken);
            if (stations.Length != input.StationIds.Count)
                return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Invalid);

            long airlineId;
            if (profile.CanonicalAirlineId is long existingId)
                airlineId = existingId;
            else
            {
                if (await context.Airlines.AnyAsync(item =>
                    item.IataCode == profile.IataCode || item.IcaoCode == profile.IcaoCode,
                    cancellationToken))
                    return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict);
                var organization = new Organization
                {
                    PublicId = Guid.CreateVersion7(),
                    Code = $"AIR-{request.PublicId.ToString("N")[..20]}",
                    LegalName = profile.LegalName,
                    DisplayName = profile.DisplayName,
                    Type = OrganizationType.AirlineCustomer,
                    Status = OrganizationStatus.Active,
                };
                context.Organizations.Add(organization);
                await context.SaveChangesAsync(cancellationToken);
                var airline = new Airline
                {
                    PublicId = Guid.CreateVersion7(),
                    OrganizationId = organization.Id,
                    IataCode = profile.IataCode,
                    IcaoCode = profile.IcaoCode,
                    Name = profile.DisplayName,
                    IsActive = true,
                };
                context.Airlines.Add(airline);
                await context.SaveChangesAsync(cancellationToken);
                airlineId = airline.Id;
                profile.CanonicalAirlineId = airlineId;
            }

            request.AirlineId = airlineId;
            request.AirlineLegalNameSnapshot = profile.LegalName;
            request.Status = CommercialRequestStatus.Approved;
            request.ReviewedAt = now;
            request.ReviewedByAccountId = actorDatabaseId;
            request.DecisionReason = null;
            var contract = new Contract
            {
                PublicId = Guid.CreateVersion7(),
                AirlineId = airlineId,
                OriginatingServiceRequestId = request.Id,
                ContractCode = $"DRAFT-{request.PublicId:N}"[..38],
                Status = ContractStatus.Draft,
            };
            context.Contracts.Add(contract);
            await context.SaveChangesAsync(cancellationToken);
            var version = new ContractVersion
            {
                PublicId = Guid.CreateVersion7(), ContractId = contract.Id,
                VersionNumber = 1, Status = ContractVersionStatus.Draft,
                ValidFrom = DateOnly.FromDateTime(now.UtcDateTime), CurrencyCode = "USD",
            };
            context.ContractVersions.Add(version);
            await context.SaveChangesAsync(cancellationToken);
            foreach (var station in stations)
                context.Set<ContractVersionStation>().Add(new ContractVersionStation
                { ContractVersionId = version.Id, StationId = station.Id });
            var requestedServices = await context.Set<ServiceRequestItem>()
                .Where(item => item.ServiceRequestId == request.Id)
                .ToArrayAsync(cancellationToken);
            // The draft starts from the Finance base tariff; Contracts negotiates from there.
            var baseRates = await FinanceTariffLookup.ServiceRatesAsync(context, version.CurrencyCode,
                version.ValidFrom, stations.Length == 1 ? stations[0].Id : null,
                requestedServices.Where(item => item.ServiceDefinitionId != null)
                    .Select(item => item.ServiceDefinitionId!.Value).ToArray(), cancellationToken);
            foreach (var service in requestedServices)
            {
                if (service.ServiceDefinitionId is not long definitionId)
                    return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Invalid);
                var baseRate = baseRates.GetValueOrDefault(definitionId);
                context.ContractServiceRates.Add(new ContractServiceRate
                {
                    PublicId = Guid.CreateVersion7(), ContractVersionId = version.Id,
                    ServiceDefinitionId = definitionId,
                    BillingUnit = baseRate?.BillingUnit ?? service.RequestedUnit ?? "operación",
                    UnitPrice = baseRate?.UnitPrice ?? 0, MinimumQuantity = baseRate?.MinimumBillableQuantity ?? 0,
                    IsConfirmed = false,
                });
            }
            AddStatusEvent(request.Id, oldStatus, request.Status, actorDatabaseId, now, null);
            CommercialAuditWriter.Add(context, actorDatabaseId,
                "commercial.request.approved", "commercial.service_requests", request.PublicId);
            await NotifyRequestReadersAsync(request.PublicId, cancellationToken);
            var superAdminIds = await (from assignment in context.Set<IdentityUserRole<long>>()
                join role in context.Roles on assignment.RoleId equals role.Id
                join user in context.Users on assignment.UserId equals user.Id
                where role.NormalizedName == "SUPERADMIN" && role.IsActive &&
                    user.Status == AccountLifecycleStatus.Active
                select user.Id).Distinct().ToArrayAsync(cancellationToken);
            foreach (var recipientId in superAdminIds)
                AccountChangeOutboxWriter.Add(context, recipientId, null,
                    "account_provisioning", request.PublicId, now);
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return CommercialWorkflowResult.Success(contract.PublicId);
        });
    }

    private void AddStatusEvent(long requestId, CommercialRequestStatus from,
        CommercialRequestStatus to, long actorId, DateTimeOffset now, string? reason) =>
        context.Set<ServiceRequestStatusEvent>().Add(new ServiceRequestStatusEvent
        {
            ServiceRequestId = requestId, FromStatus = from, ToStatus = to,
            ActorAccountId = actorId, OccurredAt = now, Reason = reason,
        });

    private async Task NotifyRequestReadersAsync(Guid requestId,
        CancellationToken cancellationToken)
    {
        var recipients = await CommercialNotificationRecipients.WithPermissionAsync(context,
            "contracts.requests.read", cancellationToken);
        var now = DateTimeOffset.UtcNow;
        foreach (var recipient in recipients)
            AccountChangeOutboxWriter.Add(context, recipient, null,
                "commercial_requests", requestId, now);
    }

    private static bool ValidText(string? value, int max) =>
        !string.IsNullOrWhiteSpace(value) && value.Trim().Length <= max;
    private static bool ValidLegacyLogo(string? value) =>
        string.IsNullOrWhiteSpace(value) || value.Length <= 512 &&
        (value.StartsWith("/assets/", StringComparison.Ordinal) ||
         Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
         uri.Scheme == Uri.UriSchemeHttps && uri.UserInfo.Length == 0);
}
