using System.Data;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Messaging;
using Elevant.Application.Commercial;
using Elevant.Application.Identity.AccountEmails;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Domain.Validation;
using Elevant.Infrastructure.Persistence;
using Elevant.Infrastructure.Persistence.Seed;
using Elevant.Persistence.Finance;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Realtime;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// Contratos' review of the public commercial requests: inbox, airline verification, representative
/// confirmation, cancellation and decision. Commands run serializable with an idempotency receipt
/// (<see cref="CommercialCommandReceipts"/>) and expect the version the reviewer saw (the request's
/// rowversion and its airline profile's); approval rejects an airline that already operates with
/// AVIAM (1-N01) and every decision emails the applicant (1-N02).
/// </summary>
internal sealed class EfCommercialWorkflowStore(
    ElevantDbContext context, CommercialPermissionGuard permissions)
    : ICommercialWorkflowStore
{
    private const string OtherAirlinesRegion = "Otras aerolíneas";
    private const string VerifyAction = "commercial.request.verify_airline";
    private const string ConfirmAction = "commercial.request.confirm_representative";
    private const string CancelAction = "commercial.request.cancel";
    private const string DecideAction = "commercial.request.decide";

    private sealed record AirlineIdentity(string LegalName, string CountryCode, string? IataCode, string IcaoCode,
        string SourceUrl);

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
            ServicesOf(items, item.request.Id, servicePublicIds), item.request.ContactDistrict)).ToArray();
    }

    public async Task<CommercialInboxData?> ListInboxAsync(Guid actorId, CommercialInboxQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        if (!query.IsValid) throw new ArgumentException("The inbox query is invalid.", nameof(query));
        if (!await permissions.HasAsync(actorId, "contracts.requests.read", cancellationToken))
            return null;
        var counts = await context.ServiceRequests.AsNoTracking()
            .GroupBy(request => request.Status)
            .Select(group => new { Status = group.Key, Count = group.Count() })
            .ToArrayAsync(cancellationToken);
        int CountOf(CommercialRequestStatus status) => counts.Where(item => item.Status == status).Sum(item => item.Count);

        var filtered = context.ServiceRequests.AsNoTracking();
        // Open work is served first come, first served; closed requests show the latest first.
        var oldestFirst = true;
        if (query.Status == CommercialInboxQuery.Open)
            filtered = filtered.Where(request => request.Status == CommercialRequestStatus.Pending ||
                request.Status == CommercialRequestStatus.InReview);
        else if (query.Status == CommercialInboxQuery.All)
            oldestFirst = false;
        else
        {
            var status = Enum.Parse<CommercialRequestStatus>(query.Status);
            filtered = filtered.Where(request => request.Status == status);
            oldestFirst = IsOpen(status);
        }
        if (query.Search?.Trim() is { Length: > 0 } search)
            filtered = filtered.Where(request => request.RequestCode.Contains(search) ||
                request.RequestedAirlineName.Contains(search) || request.ContactEmail.Contains(search) ||
                request.ContactName.Contains(search));
        var total = await filtered.CountAsync(cancellationToken);
        var ordered = oldestFirst
            ? filtered.OrderBy(request => request.SubmittedAt).ThenBy(request => request.Id)
            : filtered.OrderByDescending(request => request.SubmittedAt).ThenByDescending(request => request.Id);
        var page = await ordered.Skip((query.Page - 1) * query.Limit).Take(query.Limit)
            .ToArrayAsync(cancellationToken);

        var profileIds = page.Where(request => request.AirlineProfileId != null)
            .Select(request => request.AirlineProfileId!.Value).Distinct().ToArray();
        var profiles = await context.CommercialAirlineProfiles.AsNoTracking()
            .Where(profile => profileIds.Contains(profile.Id))
            .ToDictionaryAsync(profile => profile.Id, cancellationToken);
        var requestIds = page.Select(request => request.Id).ToArray();
        var items = await context.Set<ServiceRequestItem>().AsNoTracking()
            .Where(item => requestIds.Contains(item.ServiceRequestId))
            .ToArrayAsync(cancellationToken);
        var contracts = (await context.Contracts.AsNoTracking()
                .Where(contract => contract.OriginatingServiceRequestId != null &&
                    requestIds.Contains(contract.OriginatingServiceRequestId.Value))
                .Select(contract => new { RequestId = contract.OriginatingServiceRequestId!.Value, contract.PublicId })
                .ToArrayAsync(cancellationToken))
            .GroupBy(contract => contract.RequestId)
            .ToDictionary(group => group.Key, group => group.First().PublicId);
        var serviceIds = items.Where(item => item.ServiceDefinitionId != null)
            .Select(item => item.ServiceDefinitionId!.Value).Distinct().ToArray();
        var servicePublicIds = await context.ServiceDefinitions.AsNoTracking()
            .Where(service => serviceIds.Contains(service.Id))
            .Select(service => new { service.Id, service.PublicId })
            .ToDictionaryAsync(service => service.Id, service => service.PublicId, cancellationToken);
        var confirmerIds = page.Where(request => request.RepresentativeConfirmedByAccountId != null)
            .Select(request => request.RepresentativeConfirmedByAccountId!.Value).Distinct().ToArray();
        var confirmers = await (from user in context.Users.AsNoTracking()
                join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
                where confirmerIds.Contains(user.Id)
                select new { user.Id, person.FirstName, person.LastName })
            .ToDictionaryAsync(item => item.Id, item => $"{item.FirstName} {item.LastName}".Trim(), cancellationToken);
        var customers = await ExistingCustomersAsync(profiles.Values
            .Where(profile => profile.CanonicalAirlineId != null)
            .Select(profile => profile.CanonicalAirlineId!.Value).Distinct().ToArray(), cancellationToken);

        var requests = page.Select(request =>
        {
            var profile = request.AirlineProfileId is long profileId ? profiles.GetValueOrDefault(profileId) : null;
            var legalName = profile is null ? request.AirlineLegalNameSnapshot
                // An open request shows what Contratos verified last; a decided one, what was decided.
                : IsOpen(request.Status) ? profile.LegalName ?? request.AirlineLegalNameSnapshot
                : request.AirlineLegalNameSnapshot ?? profile.LegalName;
            return new CommercialInboxRequestData(
                request.PublicId, request.RequestCode, request.RequestedAirlineName, profile?.PublicId,
                legalName,
                profile is null ? request.ProposedAirlineCountryCode : profile.CountryCode,
                profile is null ? request.ProposedAirlineIataCode : profile.IataCode,
                profile is null ? request.ProposedAirlineIcaoCode : profile.IcaoCode,
                profile is null ? null
                    : profile.LogoObjectKey ?? AviamAirlineReference.LogoPaths.GetValueOrDefault(profile.SourceName),
                profile is { VerifiedAt: not null, VerifiedByAccountId: not null },
                profile?.VerificationSourceUrl, profile?.SourceUrl ?? request.ProposedAirlineWebsiteUrl,
                request.ContactName, request.ContactTitle ?? string.Empty,
                request.ContactEmail, request.ContactPhone ?? string.Empty,
                request.ContactNationalityCode, request.ContactAddress, request.ContactCountry,
                request.ContactProvince, request.ContactMunicipality, request.ContactDistrict,
                request.ContactDocumentType, request.ContactDocumentNumber,
                request.AuthorityDeclared, request.Status.ToString(), request.SubmittedAt,
                request.ReviewedAt, request.CancelledAt, request.DecisionReason,
                contracts.TryGetValue(request.Id, out var contractId) ? contractId : null,
                request.RepresentativeConfirmedAt is { } confirmedAt
                    ? new CommercialRepresentativeConfirmationData(confirmedAt,
                        request.RepresentativeConfirmedByAccountId is long confirmer
                            ? confirmers.GetValueOrDefault(confirmer) ?? string.Empty : string.Empty,
                        request.RepresentativeConfirmationNote ?? string.Empty)
                    : null,
                request.ProposedAirlineIcaoCode is { } proposedIcao
                    ? new CommercialProposedAirlineData(request.RequestedAirlineName,
                        request.ProposedAirlineCountryCode, request.ProposedAirlineIataCode, proposedIcao,
                        request.ProposedAirlineWebsiteUrl)
                    : null,
                profile?.CanonicalAirlineId is long airlineId && customers.Contains(airlineId),
                ServicesOf(items, request.Id, servicePublicIds), Version(request, profile));
        }).ToArray();
        return new CommercialInboxData(query.Page, query.Limit, total, (long)query.Page * query.Limit < total,
            new CommercialInboxCountsData(CountOf(CommercialRequestStatus.Pending),
                CountOf(CommercialRequestStatus.InReview), CountOf(CommercialRequestStatus.Approved),
                CountOf(CommercialRequestStatus.Rejected), CountOf(CommercialRequestStatus.Cancelled)),
            requests);
    }

    public async Task<CommercialWorkflowResult> VerifyRequestAirlineAsync(Guid actorId, Guid requestId,
        Guid idempotencyKey, VerifyRequestAirlineInput input, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.requests.verify", cancellationToken))
            return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Forbidden);
        if (CommandHeaderFailure(idempotencyKey, input?.ExpectedVersion) is { } headerFailure) return headerFailure;
        var identityGiven = new[] { input!.LegalName, input.CountryCode, input.IataCode, input.IcaoCode,
            input.VerificationSourceUrl }.Any(value => !string.IsNullOrWhiteSpace(value));
        var identity = identityGiven ? Identity(input.LegalName, input.CountryCode, input.IataCode, input.IcaoCode,
            input.VerificationSourceUrl) : null;
        if (identityGiven && identity is null || !identityGiven && input.LinkProfileId is null)
            return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Invalid, "invalid_airline");
        if (input.LinkProfileId == Guid.Empty)
            return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Invalid, "profile_not_found");
        var actor = await ActorDatabaseIdAsync(actorId, cancellationToken);
        var payload = new { requestId, input.ExpectedVersion, input.LinkProfileId, identity };
        return await RunAsync(actor, idempotencyKey, VerifyAction, payload, async now =>
        {
            var request = await context.ServiceRequests.SingleOrDefaultAsync(
                item => item.PublicId == requestId, cancellationToken);
            if (request is null) return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.NotFound, "not_found");
            var profile = await LinkedProfileAsync(request, cancellationToken);
            if (Version(request, profile) != input.ExpectedVersion)
                return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict, "version_conflict");
            if (!IsOpen(request.Status))
                return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict, "request_closed");
            if (input.LinkProfileId is { } linkId)
            {
                // Linking is how a proposed airline (1-N25) joins a profile that already exists.
                if (request.AirlineProfileId is not null)
                    return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict, "airline_already_linked");
                profile = await context.CommercialAirlineProfiles.SingleOrDefaultAsync(
                    item => item.PublicId == linkId, cancellationToken);
                if (profile is null)
                    return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Invalid, "profile_not_found");
                if (identity is null && (profile.VerifiedAt is null || profile.VerifiedByAccountId is null))
                    return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Invalid, "invalid_airline");
            }
            var previousProfile = request.AirlineProfileId;
            if (identity is not null)
            {
                if (profile is null)
                {
                    if (await ConflictingProfileAsync(null, identity, cancellationToken))
                        return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict, "airline_profile_conflict");
                    profile = await CreateProfileAsync(request, identity, actor, now, cancellationToken);
                }
                else if (await ApplyIdentityAsync(profile, identity, actor, now, cancellationToken) is { } conflict)
                    return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict, conflict);
            }
            if (request.AirlineProfileId is null)
            {
                request.AirlineProfileId = profile!.Id;
                request.AirlineId = profile.CanonicalAirlineId;
            }
            StartReview(request, actor, now, "Verificación de la aerolínea");
            request.UpdatedAt = now;
            CommercialAuditWriter.Add(context, actor, "commercial.request.airline_verified",
                "commercial.service_requests", request.PublicId, null,
                new AuditFieldChangeData("request.airline_profile",
                    previousProfile is null ? null : profile!.PublicId.ToString("D"), profile!.PublicId.ToString("D")));
            await NotifyRequestReadersAsync(request.PublicId, cancellationToken);
            await NotifyAirlineReadersAsync(profile.PublicId, now, cancellationToken);
            return CommercialWorkflowResult.Success(request.PublicId);
        }, cancellationToken);
    }

    public async Task<CommercialWorkflowResult> ConfirmRepresentativeAsync(Guid actorId, Guid requestId,
        Guid idempotencyKey, ConfirmCommercialRepresentativeInput input, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.requests.verify", cancellationToken))
            return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Forbidden);
        if (CommandHeaderFailure(idempotencyKey, input?.ExpectedVersion) is { } headerFailure) return headerFailure;
        var note = input!.Note?.Trim();
        if (note is not { Length: >= 5 and <= 1000 })
            return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Invalid, "confirmation_note_required");
        var actor = await ActorDatabaseIdAsync(actorId, cancellationToken);
        return await RunAsync(actor, idempotencyKey, ConfirmAction, new { requestId, input.ExpectedVersion, note },
            async now =>
            {
                var request = await context.ServiceRequests.SingleOrDefaultAsync(
                    item => item.PublicId == requestId, cancellationToken);
                if (request is null) return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.NotFound, "not_found");
                if (Version(request, await LinkedProfileAsync(request, cancellationToken)) != input.ExpectedVersion)
                    return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict, "version_conflict");
                if (!IsOpen(request.Status))
                    return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict, "request_closed");
                // The confirmation is the evidence behind the approval: it is recorded once, never rewritten.
                if (request.RepresentativeConfirmedAt is not null)
                    return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict,
                        "representative_already_confirmed");
                request.RepresentativeConfirmedAt = now;
                request.RepresentativeConfirmedByAccountId = actor;
                request.RepresentativeConfirmationNote = note;
                StartReview(request, actor, now, "Confirmación del representante");
                request.UpdatedAt = now;
                CommercialAuditWriter.Add(context, actor, "commercial.request.representative_confirmed",
                    "commercial.service_requests", request.PublicId, note);
                await NotifyRequestReadersAsync(request.PublicId, cancellationToken);
                return CommercialWorkflowResult.Success(request.PublicId);
            }, cancellationToken);
    }

    public async Task<CommercialWorkflowResult> CancelAsync(Guid actorId, Guid requestId, Guid idempotencyKey,
        CancelCommercialRequestInput input, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.requests.cancel", cancellationToken))
            return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Forbidden);
        if (CommandHeaderFailure(idempotencyKey, input?.ExpectedVersion) is { } headerFailure) return headerFailure;
        var reason = input!.Reason?.Trim();
        if (reason is not { Length: >= 5 and <= 1000 })
            return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Invalid, "reason_required");
        var actor = await ActorDatabaseIdAsync(actorId, cancellationToken);
        return await RunAsync(actor, idempotencyKey, CancelAction, new { requestId, input.ExpectedVersion, reason },
            async now =>
            {
                var request = await context.ServiceRequests.SingleOrDefaultAsync(
                    item => item.PublicId == requestId, cancellationToken);
                if (request is null) return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.NotFound, "not_found");
                if (Version(request, await LinkedProfileAsync(request, cancellationToken)) != input.ExpectedVersion)
                    return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict, "version_conflict");
                if (!IsOpen(request.Status))
                    return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict, "request_closed");
                var from = request.Status;
                request.Status = CommercialRequestStatus.Cancelled;
                request.CancelledAt = now;
                request.DecisionReason = reason;
                request.ReviewedAt = now;
                request.ReviewedByAccountId = actor;
                request.UpdatedAt = now;
                AddStatusEvent(request.Id, from, request.Status, actor, now, reason);
                CommercialAuditWriter.Add(context, actor, "commercial.request.cancelled",
                    "commercial.service_requests", request.PublicId, reason);
                EmailApplicant(AccountEmailTemplates.CommercialRequestCancelled(request.ContactEmail,
                    request.ContactName, request.RequestedAirlineName, request.RequestCode, reason), now);
                await NotifyRequestReadersAsync(request.PublicId, cancellationToken);
                return CommercialWorkflowResult.Success(request.PublicId);
            }, cancellationToken);
    }

    public async Task<CommercialWorkflowResult> DecideAsync(Guid actorId,
        Guid requestId, ReviewCommercialInput input, Guid? idempotencyKey,
        CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId,
            input?.Approve == true ? "contracts.requests.approve" : "contracts.requests.reject",
            cancellationToken))
            return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Forbidden);
        if (input is null || input.StationIds is null)
            return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Invalid, "invalid_commercial_request");
        // Expand phase: older clients send neither; a client that sends the key must send the version.
        if (idempotencyKey is { } key && CommandHeaderFailure(key, input.ExpectedVersion) is { } headerFailure)
            return headerFailure;
        if (input.Approve && (input.StationIds.Count is < 1 or > 30 ||
                input.StationIds.Distinct().Count() != input.StationIds.Count))
            return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Invalid, "stations_invalid");
        if (!input.Approve && !ValidText(input.Reason, 1000))
            return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Invalid, "reason_required");
        var actorDatabaseId = await ActorDatabaseIdAsync(actorId, cancellationToken);
        var reason = input.Approve ? null : input.Reason!.Trim();
        var stationIds = input.Approve ? input.StationIds.Order().ToArray() : [];
        var payload = new { requestId, input.Approve, reason, stationIds, input.ExpectedVersion };
        return await RunAsync(actorDatabaseId, idempotencyKey, DecideAction, payload, async now =>
        {
            var request = await context.ServiceRequests.SingleOrDefaultAsync(
                item => item.PublicId == requestId, cancellationToken);
            if (request is null)
                return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.NotFound, "not_found");
            // The approval freezes the profile's identity: a screen older than either row is stale (1-D).
            var profile = await LinkedProfileAsync(request, cancellationToken);
            if (input.ExpectedVersion is { } expected && Version(request, profile) != expected)
                return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict, "version_conflict");
            if (!IsOpen(request.Status))
                return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict, "request_closed");
            var oldStatus = request.Status;
            if (!input.Approve)
            {
                request.Status = CommercialRequestStatus.Rejected;
                request.DecisionReason = reason;
                request.ReviewedByAccountId = actorDatabaseId;
                request.ReviewedAt = now;
                request.UpdatedAt = now;
                AddStatusEvent(request.Id, oldStatus, request.Status, actorDatabaseId, now, request.DecisionReason);
                CommercialAuditWriter.Add(context, actorDatabaseId,
                    "commercial.request.rejected", "commercial.service_requests",
                    request.PublicId, request.DecisionReason);
                EmailApplicant(AccountEmailTemplates.CommercialRequestRejected(request.ContactEmail,
                    request.ContactName, request.RequestedAirlineName, request.RequestCode, reason!), now);
                await NotifyRequestReadersAsync(request.PublicId, cancellationToken);
                return CommercialWorkflowResult.Success(request.PublicId);
            }

            // Approval rests on two recorded checks: the representative (1-N18) and the airline identity.
            if (request.RepresentativeConfirmedAt is null)
                return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict, "representative_unconfirmed");
            if (profile is null || profile.VerifiedAt is null || profile.VerifiedByAccountId is null ||
                string.IsNullOrWhiteSpace(profile.LegalName) ||
                string.IsNullOrWhiteSpace(profile.IcaoCode) ||
                string.IsNullOrWhiteSpace(profile.CountryCode))
                return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.AirlineUnverified, "airline_unverified");
            var stations = await context.Stations.Where(station =>
                input.StationIds.Contains(station.PublicId) && station.IsActive)
                .ToArrayAsync(cancellationToken);
            if (stations.Length != input.StationIds.Count)
                return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Invalid, "stations_invalid");
            // An airline that already operates with AVIAM extends its contract (amendment or renewal);
            // a second affiliation would leave two contracts and a second portal entry (1-N01).
            if (await AlreadyContractedAsync(request, profile, cancellationToken))
                return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict, "airline_already_contracted");

            long airlineId;
            if (profile.CanonicalAirlineId is long existingId)
            {
                if (await HasPortalAccountsAsync(existingId, cancellationToken))
                    return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict,
                        "airline_has_portal_account");
                airlineId = existingId;
            }
            else
            {
                var iata = profile.IataCode;
                var icao = profile.IcaoCode;
                if (await context.Airlines.AnyAsync(item =>
                    iata != null && item.IataCode == iata || item.IcaoCode == icao,
                    cancellationToken))
                    return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict, "airline_code_in_use");
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
                    // An operator without IATA designator is identified by its ICAO code (1-N17).
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
            request.UpdatedAt = now;
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
            // The draft starts from the Finance base tariff; Contracts negotiates from there. The station
            // rule is the one the editor and the Finance comparison use (1-N06). A retired service is
            // copied too and stays marked in the draft until Contratos removes it (1-N10).
            var baseRates = await FinanceTariffLookup.ServiceRatesAsync(context, version.CurrencyCode,
                version.ValidFrom, ContractDraftRules.BaseStation(stations.Select(station => station.Id).ToArray()),
                requestedServices.Where(item => item.ServiceDefinitionId != null)
                    .Select(item => item.ServiceDefinitionId!.Value).ToArray(), cancellationToken);
            // 1-E: a rate without a base price keeps the requested unit as a code of ref.billing_units.
            var units = await BillingUnitCodes.LoadAsync(context, cancellationToken);
            foreach (var service in requestedServices)
            {
                if (service.ServiceDefinitionId is not long definitionId)
                    return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Invalid, "invalid_commercial_request");
                var baseRate = baseRates.GetValueOrDefault(definitionId);
                context.ContractServiceRates.Add(new ContractServiceRate
                {
                    PublicId = Guid.CreateVersion7(), ContractVersionId = version.Id,
                    ServiceDefinitionId = definitionId,
                    BillingUnit = baseRate?.BillingUnit ?? units.CodeOrDefault(service.RequestedUnit),
                    UnitPrice = baseRate?.UnitPrice ?? 0, MinimumQuantity = baseRate?.MinimumBillableQuantity ?? 0,
                    IsConfirmed = false,
                });
            }
            AddStatusEvent(request.Id, oldStatus, request.Status, actorDatabaseId, now, null);
            CommercialAuditWriter.Add(context, actorDatabaseId,
                "commercial.request.approved", "commercial.service_requests", request.PublicId);
            EmailApplicant(AccountEmailTemplates.CommercialRequestApproved(request.ContactEmail,
                request.ContactName, request.RequestedAirlineName, request.RequestCode), now);
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
            return CommercialWorkflowResult.Success(contract.PublicId);
        }, cancellationToken);
    }

    /// <summary>
    /// Runs one command serializable: the receipt of its Idempotency-Key is resolved before anything
    /// else (a legitimate retry sees the rowversion already changed), the command applies its rules
    /// and changes, and the receipt is written in the same transaction. A failed rule rolls back.
    /// </summary>
    private async Task<CommercialWorkflowResult> RunAsync(long actorDatabaseId, Guid? idempotencyKey,
        string action, object payload, Func<DateTimeOffset, Task<CommercialWorkflowResult>> command,
        CancellationToken cancellationToken)
    {
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
                    var prior = await CommercialCommandReceipts.FindAsync(context, key, actorDatabaseId, action, hash,
                        cancellationToken);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay)
                        return CommercialWorkflowResult.Success(prior.ResultId);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                        return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict, "idempotency_conflict");
                }
                var now = DateTimeOffset.UtcNow;
                var result = await command(now);
                if (!result.IsSuccess)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    context.ChangeTracker.Clear();
                    return result;
                }
                if (idempotencyKey is { } receipt)
                    CommercialCommandReceipts.Add(context, receipt, actorDatabaseId, action, hash,
                        result.ResourceId!.Value, now);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return result;
            });
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict, "version_conflict");
        }
        catch (DbUpdateException exception) when (idempotencyKey is { } key &&
            CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            // A concurrent command with the same key committed first.
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, key, actorDatabaseId, action, hash,
                cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? CommercialWorkflowResult.Success(concurrent.ResultId)
                : CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict, "idempotency_conflict");
        }
        catch (DbUpdateException exception) when (UniqueViolationCode(exception) is { } code)
        {
            context.ChangeTracker.Clear();
            return CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Conflict, code);
        }
    }

    private static CommercialWorkflowResult? CommandHeaderFailure(Guid idempotencyKey, string? expectedVersion) =>
        idempotencyKey == Guid.Empty
            ? CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Invalid, "idempotency_key_required")
            : string.IsNullOrWhiteSpace(expectedVersion)
                ? CommercialWorkflowResult.Failed(CommercialWorkflowFailure.Invalid, "expected_version_required")
                : null;

    /// <summary>
    /// The airline already has a Draft, Active or Suspended contract, or another approved request whose
    /// contract is still alive or not created yet. Only Terminated or Expired contracts allow a new one.
    /// </summary>
    private async Task<bool> AlreadyContractedAsync(ServiceRequest request, CommercialAirlineProfile profile,
        CancellationToken cancellationToken)
    {
        var airlineId = profile.CanonicalAirlineId;
        if (airlineId is long id && await context.Contracts.AnyAsync(contract => contract.AirlineId == id &&
                (contract.Status == ContractStatus.Draft || contract.Status == ContractStatus.Active ||
                 contract.Status == ContractStatus.Suspended), cancellationToken))
            return true;
        return await context.ServiceRequests.AnyAsync(other => other.Id != request.Id &&
            other.Status == CommercialRequestStatus.Approved &&
            (other.AirlineProfileId == profile.Id || airlineId != null && other.AirlineId == airlineId) &&
            !context.Contracts.Any(contract => contract.OriginatingServiceRequestId == other.Id &&
                (contract.Status == ContractStatus.Terminated || contract.Status == ContractStatus.Expired)),
            cancellationToken);
    }

    /// <summary>Active portal accounts of the airline's organization, invited ones included.</summary>
    private Task<bool> HasPortalAccountsAsync(long airlineId, CancellationToken cancellationToken) =>
        (from airline in context.Airlines
         join membership in context.OrganizationMemberships on airline.OrganizationId equals membership.OrganizationId
         join user in context.Users on membership.AccountId equals user.Id
         where airline.Id == airlineId && membership.Kind == MembershipKind.AirlineClient &&
             membership.Status == MembershipStatus.Active && user.Status == AccountLifecycleStatus.Active
         select membership.Id).AnyAsync(cancellationToken);

    private async Task<HashSet<long>> ExistingCustomersAsync(long[] airlineIds, CancellationToken cancellationToken)
    {
        if (airlineIds.Length == 0) return [];
        var contracted = await context.Contracts.AsNoTracking()
            .Where(contract => airlineIds.Contains(contract.AirlineId) && (contract.Status == ContractStatus.Draft ||
                contract.Status == ContractStatus.Active || contract.Status == ContractStatus.Suspended))
            .Select(contract => contract.AirlineId).Distinct().ToArrayAsync(cancellationToken);
        var withAccounts = await (from airline in context.Airlines.AsNoTracking()
                join membership in context.OrganizationMemberships.AsNoTracking()
                    on airline.OrganizationId equals membership.OrganizationId
                join user in context.Users.AsNoTracking() on membership.AccountId equals user.Id
                where airlineIds.Contains(airline.Id) && membership.Kind == MembershipKind.AirlineClient &&
                    membership.Status == MembershipStatus.Active && user.Status == AccountLifecycleStatus.Active
                select airline.Id).Distinct().ToArrayAsync(cancellationToken);
        return [.. contracted, .. withAccounts];
    }

    /// <summary>
    /// Writes a verified identity on a profile. The identity of an airline that already operates
    /// (ref.airlines, or an approved request) is in contracts and invoices and is never rewritten.
    /// </summary>
    private async Task<string?> ApplyIdentityAsync(CommercialAirlineProfile profile, AirlineIdentity identity,
        long actorDatabaseId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (profile.CanonicalAirlineId is not null || await context.ServiceRequests.AnyAsync(request =>
                request.AirlineProfileId == profile.Id && request.Status == CommercialRequestStatus.Approved,
                cancellationToken))
            return "airline_identity_locked";
        if (await ConflictingProfileAsync(profile.Id, identity, cancellationToken))
            return "airline_profile_conflict";
        var before = (profile.CountryCode, profile.IataCode, profile.IcaoCode);
        // A public-registry check is about the codes it saw; new codes make it stale (ADR-0023).
        if (profile.IataCode != identity.IataCode || profile.IcaoCode != identity.IcaoCode)
        {
            profile.RegistryStatus = null;
            profile.RegistrySource = null;
            profile.RegistryCheckedAt = null;
            profile.RegistryEntityUrl = null;
        }
        profile.LegalName = identity.LegalName;
        profile.CountryCode = identity.CountryCode;
        profile.IataCode = identity.IataCode;
        profile.IcaoCode = identity.IcaoCode;
        profile.VerificationSourceUrl = identity.SourceUrl;
        profile.VerifiedByAccountId = actorDatabaseId;
        profile.VerifiedAt = now;
        profile.UpdatedAt = now;
        CommercialAuditWriter.Add(context, actorDatabaseId, "commercial.airline.verified",
            "commercial.airline_profiles", profile.PublicId, null,
            new AuditFieldChangeData("airline.country", before.CountryCode, profile.CountryCode),
            new AuditFieldChangeData("airline.iata", before.IataCode, profile.IataCode),
            new AuditFieldChangeData("airline.icao", before.IcaoCode, profile.IcaoCode));
        return null;
    }

    private Task<bool> ConflictingProfileAsync(long? profileId, AirlineIdentity identity,
        CancellationToken cancellationToken) =>
        context.CommercialAirlineProfiles.AnyAsync(item => item.Id != profileId && item.VerifiedAt != null &&
            (identity.IataCode != null && item.IataCode == identity.IataCode || item.IcaoCode == identity.IcaoCode),
            cancellationToken);

    /// <summary>
    /// Verified and published profile for an airline the applicant proposed (1-N25), shown under
    /// «Otras aerolíneas» from now on. Its source key avoids the names already in the catalog.
    /// </summary>
    private async Task<CommercialAirlineProfile> CreateProfileAsync(ServiceRequest request, AirlineIdentity identity,
        long actorDatabaseId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var name = Truncate(request.RequestedAirlineName.Trim(), 160);
        var key = name.ToUpperInvariant();
        string? sourceName = null;
        foreach (var candidate in new[] { key, $"{key} · {identity.IcaoCode}", $"{key} · {request.RequestCode.ToUpperInvariant()}" })
        {
            var value = Truncate(candidate, 160);
            if (await context.CommercialAirlineProfiles.AnyAsync(item => item.SourceName == value, cancellationToken))
                continue;
            sourceName = value;
            break;
        }
        var profile = new CommercialAirlineProfile
        {
            PublicId = Guid.CreateVersion7(),
            SourceName = sourceName ?? request.PublicId.ToString("N").ToUpperInvariant(),
            DisplayName = name,
            LegalName = identity.LegalName,
            Region = OtherAirlinesRegion,
            CountryCode = identity.CountryCode,
            IataCode = identity.IataCode,
            IcaoCode = identity.IcaoCode,
            SourceUrl = request.ProposedAirlineWebsiteUrl ?? identity.SourceUrl,
            VerificationSourceUrl = identity.SourceUrl,
            VerifiedAt = now,
            VerifiedByAccountId = actorDatabaseId,
            IsPublished = true,
            CreatedAt = now,
            UpdatedAt = now,
        };
        context.CommercialAirlineProfiles.Add(profile);
        await context.SaveChangesAsync(cancellationToken);
        CommercialAuditWriter.Add(context, actorDatabaseId, "commercial.airline.created",
            "commercial.airline_profiles", profile.PublicId, $"Solicitud {request.RequestCode}",
            new AuditFieldChangeData("airline.country", null, profile.CountryCode),
            new AuditFieldChangeData("airline.iata", null, profile.IataCode),
            new AuditFieldChangeData("airline.icao", null, profile.IcaoCode),
            new AuditFieldChangeData("airline.published", null, true.ToString()),
            new AuditFieldChangeData("airline.verified", null, true.ToString()));
        return profile;
    }

    private void StartReview(ServiceRequest request, long actorDatabaseId, DateTimeOffset now, string reason)
    {
        // Opening a request never changes it; the first verification or confirmation does.
        if (request.Status != CommercialRequestStatus.Pending) return;
        request.Status = CommercialRequestStatus.InReview;
        AddStatusEvent(request.Id, CommercialRequestStatus.Pending, CommercialRequestStatus.InReview,
            actorDatabaseId, now, reason);
    }

    private void AddStatusEvent(long requestId, CommercialRequestStatus from,
        CommercialRequestStatus to, long actorId, DateTimeOffset now, string? reason) =>
        context.Set<ServiceRequestStatusEvent>().Add(new ServiceRequestStatusEvent
        {
            ServiceRequestId = requestId, FromStatus = from, ToStatus = to,
            ActorAccountId = actorId, OccurredAt = now, Reason = reason,
        });

    /// <summary>The decision email goes in the command's transaction: a replay never sends it twice.</summary>
    private void EmailApplicant(EmailMessage message, DateTimeOffset now) =>
        EfEmailOutboxStore.Add(context, message, EmailPurpose.CommercialDecision, now);

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

    /// <summary>The airline catalog changed: the same readers the Superadmin airline store notifies.</summary>
    private async Task NotifyAirlineReadersAsync(Guid profileId, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var recipients = await CommercialNotificationRecipients.WithPermissionAsync(context,
            "contracts.catalog.read", cancellationToken);
        foreach (var recipient in recipients)
            AccountChangeOutboxWriter.Add(context, recipient, null, "commercial_airlines", profileId, now);
    }

    private Task<long> ActorDatabaseIdAsync(Guid actorId, CancellationToken cancellationToken) =>
        context.Users.Where(user => user.PublicId == actorId).Select(user => user.Id).SingleAsync(cancellationToken);

    private static CommercialRequestItemData[] ServicesOf(IEnumerable<ServiceRequestItem> items, long requestId,
        IReadOnlyDictionary<long, Guid> servicePublicIds) =>
        items.Where(service => service.ServiceRequestId == requestId)
            .Select(service => new CommercialRequestItemData(
                service.ServiceDefinitionId is long id && servicePublicIds.TryGetValue(id, out var publicId)
                    ? publicId : Guid.Empty,
                service.RequestedServiceName, service.RequestedUnit ?? string.Empty))
            .ToArray();

    /// <summary>Official identity: legal name, ISO country, ICAO always and IATA only when the airline has one.</summary>
    private static AirlineIdentity? Identity(string? legalName, string? countryCode, string? iataCode,
        string? icaoCode, string? sourceUrl)
    {
        var country = countryCode?.Trim().ToUpperInvariant();
        var iata = string.IsNullOrWhiteSpace(iataCode) ? null : iataCode.Trim().ToUpperInvariant();
        var icao = icaoCode?.Trim().ToUpperInvariant();
        var source = sourceUrl?.Trim();
        if (!ValidText(legalName, 200) || !AirlineCodes.IsCountry(country) ||
            iata is not null && !AirlineCodes.IsIata(iata) || !AirlineCodes.IsIcao(icao) ||
            source is null || source.Length > 512 || !Uri.TryCreate(source, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps || uri.UserInfo.Length != 0)
            return null;
        return new AirlineIdentity(legalName!.Trim(), country!, iata, icao!, source);
    }

    /// <summary>Unique indexes a command can hit: a designator of another verified profile or airline.</summary>
    private static string? UniqueViolationCode(DbUpdateException exception) =>
        exception.InnerException is SqlException { Number: 2601 or 2627 } sql
            ? sql.Message.Contains("ux_airline_profiles_verified", StringComparison.Ordinal) ? "airline_profile_conflict"
                : sql.Message.Contains("IX_airlines_iata_code", StringComparison.Ordinal) ||
                  sql.Message.Contains("IX_airlines_icao_code", StringComparison.Ordinal) ? "airline_code_in_use"
                : null
            : null;

    private static bool IsOpen(CommercialRequestStatus status) =>
        status is CommercialRequestStatus.Pending or CommercialRequestStatus.InReview;

    /// <summary>The airline profile the request is linked to; none for a proposal not linked yet (1-N25).</summary>
    private async Task<CommercialAirlineProfile?> LinkedProfileAsync(ServiceRequest request,
        CancellationToken cancellationToken) =>
        request.AirlineProfileId is long profileId
            ? await context.CommercialAirlineProfiles.SingleOrDefaultAsync(item => item.Id == profileId, cancellationToken)
            : null;

    /// <summary>
    /// What a command expects (1-D): the request's rowversion followed by its airline profile's. The approval
    /// freezes the profile's identity, which another request of the same airline or Superadministración may
    /// change without touching this request, so a change of either row makes the reviewer's screen stale.
    /// </summary>
    private static string Version(ServiceRequest request, CommercialAirlineProfile? profile) =>
        Convert.ToBase64String(profile is null ? request.RowVersion : [.. request.RowVersion, .. profile.RowVersion]);

    private static string Truncate(string value, int length) => value.Length > length ? value[..length] : value;

    private static bool ValidText(string? value, int max) =>
        !string.IsNullOrWhiteSpace(value) && value.Trim().Length <= max;
}
