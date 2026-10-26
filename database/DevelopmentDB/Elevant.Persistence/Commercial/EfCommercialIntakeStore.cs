using System.Data;
using System.Security.Cryptography;
using System.Text;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

internal sealed class EfCommercialIntakeStore(ElevantDbContext context,
    IActorContextResolver actors) : ICommercialIntakeStore
{
    public async Task<IReadOnlyList<AirlineCommercialRequestData>?> ListOwnAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null || actor.AccountId != actorId ||
            !actor.Roles.Any(role => role.Code == "AIRLINE_CLIENT" &&
                role.Portal == PortalKind.AirlinePortal))
            return null;
        var organizations = actor.Memberships.Where(membership =>
                membership.OrganizationType == OrganizationType.AirlineCustomer &&
                membership.Kind == MembershipKind.AirlineClient)
            .Select(membership => membership.OrganizationId).Distinct().ToArray();
        if (organizations.Length != 1)
            return null;
        var account = await context.Users.AsNoTracking().SingleOrDefaultAsync(user =>
            user.PublicId == actorId, cancellationToken);
        if (account is null || account.Status != AccountLifecycleStatus.Active ||
            account.InvitationStatus != InvitationStatus.Accepted ||
            !account.EmailConfirmed || account.MustChangePassword)
            return null;
        var airlineId = await (from airline in context.Airlines.AsNoTracking()
            join organization in context.Organizations.AsNoTracking()
                on airline.OrganizationId equals organization.Id
            where organization.PublicId == organizations[0] &&
                organization.Status == OrganizationStatus.Active && airline.IsActive
            select (long?)airline.Id).SingleOrDefaultAsync(cancellationToken);
        if (airlineId is null)
            return null;
        var requests = await context.ServiceRequests.AsNoTracking()
            .Where(request => request.AirlineId == airlineId)
            .OrderByDescending(request => request.SubmittedAt)
            .Take(200).ToArrayAsync(cancellationToken);
        var requestIds = requests.Select(request => request.Id).ToArray();
        var items = await (from item in context.Set<ServiceRequestItem>().AsNoTracking()
            join service in context.ServiceDefinitions.AsNoTracking()
                on item.ServiceDefinitionId equals service.Id
            where requestIds.Contains(item.ServiceRequestId)
            select new { item.ServiceRequestId, item.ServiceDefinitionId,
                Data = new CommercialRequestItemData(service.PublicId,
                    item.RequestedServiceName, item.RequestedUnit ?? string.Empty) })
            .ToArrayAsync(cancellationToken);
        var packages = await (from selection in context.Set<ServiceRequestPackageSelection>().AsNoTracking()
            join package in context.Set<ServicePackageVersion>().AsNoTracking()
                on selection.PackageVersionId equals package.Id
            where requestIds.Contains(selection.ServiceRequestId)
            select new { selection.ServiceRequestId, selection.PackageVersionId,
                package.PublicId, package.Code, package.Name,
                package.VersionNumber, package.CurrencyCode })
            .ToArrayAsync(cancellationToken);
        var packageIds = packages.Select(package => package.PackageVersionId)
            .Distinct().ToArray();
        var packageComponents = await context.Set<ServicePackageComponent>().AsNoTracking()
            .Where(component => packageIds.Contains(component.PackageVersionId))
            .Select(component => new { component.PackageVersionId,
                component.ServiceDefinitionId, component.BillingUnit,
                component.IncludedQuantity }).ToArrayAsync(cancellationToken);
        var contracts = await context.Contracts.AsNoTracking()
            .Where(contract => contract.OriginatingServiceRequestId != null &&
                requestIds.Contains(contract.OriginatingServiceRequestId.Value))
            .Select(contract => new { contract.OriginatingServiceRequestId, contract.PublicId })
            .ToArrayAsync(cancellationToken);
        return requests.Select(request => new AirlineCommercialRequestData(
            request.PublicId, request.RequestCode, request.Status.ToString(),
            request.SubmittedAt, request.DecisionReason,
            contracts.FirstOrDefault(contract =>
                contract.OriginatingServiceRequestId == request.Id)?.PublicId,
            items.Where(item => item.ServiceRequestId == request.Id)
                .Select(item => item.Data).ToArray(),
            packages.Where(package => package.ServiceRequestId == request.Id)
                .Select(package => new CommercialRequestPackageData(package.PublicId,
                    package.Code, package.Name, package.VersionNumber,
                    package.CurrencyCode,
                    packageComponents.Where(component =>
                            component.PackageVersionId == package.PackageVersionId)
                        .Select(component =>
                        {
                            var requestedItem = items.First(item =>
                                item.ServiceRequestId == request.Id &&
                                item.ServiceDefinitionId == component.ServiceDefinitionId);
                            return new CommercialRequestPackageComponentData(
                                requestedItem.Data.ServiceId, requestedItem.Data.Name,
                                component.BillingUnit, component.IncludedQuantity);
                        }).ToArray())).ToArray())).ToArray();
    }

    public async Task<CommercialSubmissionResult> SubmitAdditionalAsync(Guid actorId,
        Elevant.Application.Commercial.SubmitAdditionalServiceRequestCommand input,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null || actor.AccountId != actorId ||
            !actor.Roles.Any(role => role.Code == "AIRLINE_CLIENT" &&
                role.Portal == PortalKind.AirlinePortal))
            return CommercialSubmissionResult.Failed(CommercialSubmissionFailure.Forbidden);
        var organizations = actor.Memberships.Where(membership =>
                membership.OrganizationType == OrganizationType.AirlineCustomer &&
                membership.Kind == MembershipKind.AirlineClient)
            .Select(membership => membership.OrganizationId).Distinct().ToArray();
        if (organizations.Length != 1)
            return CommercialSubmissionResult.Failed(CommercialSubmissionFailure.Forbidden);
        var account = await context.Users.AsNoTracking().SingleOrDefaultAsync(user =>
            user.PublicId == actorId, cancellationToken);
        if (account is null || account.Status != AccountLifecycleStatus.Active ||
            account.InvitationStatus != InvitationStatus.Accepted ||
            !account.EmailConfirmed || account.MustChangePassword ||
            !string.Equals(account.Email, input.RepresentativeEmail,
                StringComparison.OrdinalIgnoreCase))
            return CommercialSubmissionResult.Failed(CommercialSubmissionFailure.Forbidden);
        var profile = await (from airline in context.Airlines.AsNoTracking()
            join organization in context.Organizations.AsNoTracking()
                on airline.OrganizationId equals organization.Id
            join candidate in context.CommercialAirlineProfiles.AsNoTracking()
                on airline.Id equals candidate.CanonicalAirlineId
            where organization.PublicId == organizations[0] &&
                  organization.Status == OrganizationStatus.Active && airline.IsActive &&
                  candidate.IsPublished
            select candidate.PublicId).FirstOrDefaultAsync(cancellationToken);
        if (profile == Guid.Empty)
            return CommercialSubmissionResult.Failed(CommercialSubmissionFailure.AirlineUnavailable);
        return await SubmitCoreAsync(new SubmitCommercialRequestCommand(
            input.RequestId, profile, input.ServiceIds,
            input.RepresentativeName, input.RepresentativeTitle,
            input.RepresentativeEmail, input.RepresentativePhone,
            input.AuthorityDeclared, PackageVersionIds: input.PackageVersionIds),
            CommercialRequestType.AdditionalService,
            actorId, cancellationToken);
    }
    public async Task<string?> LookupReceiptAsync(SubmitCommercialRequestCommand command,
        CancellationToken cancellationToken = default)
    {
        var hash = ComputeHash(command);
        var previous = await context.ServiceRequests.AsNoTracking()
            .Where(request => request.PublicId == command.RequestId)
            .Select(request => new { request.RequestCode, request.SubmissionHash })
            .SingleOrDefaultAsync(cancellationToken);
        return previous?.SubmissionHash == hash ? previous.RequestCode : null;
    }

    public async Task<CommercialSubmissionResult> SubmitAsync(
        SubmitCommercialRequestCommand command, CancellationToken cancellationToken = default)
        => await SubmitCoreAsync(command, CommercialRequestType.Affiliation,
            null, cancellationToken);

    private async Task<CommercialSubmissionResult> SubmitCoreAsync(
        SubmitCommercialRequestCommand command, CommercialRequestType requestType,
        Guid? actorId, CancellationToken cancellationToken)
    {
        var hash = ComputeHash(command);
        var reference = command.RequestId.ToString("N");
        var previous = await context.ServiceRequests.AsNoTracking()
            .Where(request => request.PublicId == command.RequestId)
            .Select(request => new { request.RequestCode, request.SubmissionHash })
            .SingleOrDefaultAsync(cancellationToken);
        if (previous is not null)
            return previous.SubmissionHash == hash
                ? CommercialSubmissionResult.Success(previous.RequestCode, true)
                : CommercialSubmissionResult.Failed(CommercialSubmissionFailure.Conflict);

        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);
                try
                {
                    var airline = await context.CommercialAirlineProfiles.AsNoTracking()
                        .SingleOrDefaultAsync(profile => profile.PublicId == command.AirlineProfileId &&
                            profile.IsPublished, cancellationToken);
                    if (airline is null)
                        return CommercialSubmissionResult.Failed(CommercialSubmissionFailure.AirlineUnavailable);

                    var services = await context.ServiceDefinitions.AsNoTracking()
                        .Where(PublicCommercialServiceVisibility.PublishedActive)
                        .Where(service => command.ServiceIds.Contains(service.PublicId))
                        .ToArrayAsync(cancellationToken);
                    if (services.Length != command.ServiceIds.Count)
                        return CommercialSubmissionResult.Failed(CommercialSubmissionFailure.ServiceUnavailable);

                    var requestedPackageIds = command.PackageVersionIds ?? [];
                    var today = DateOnly.FromDateTime(DateTime.UtcNow);
                    var packages = await context.Set<ServicePackageVersion>().AsNoTracking()
                        .Where(package => requestedPackageIds.Contains(package.PublicId) &&
                            package.Status == TariffVersionStatus.Published &&
                            package.ValidFrom <= today &&
                            (package.ValidTo == null || package.ValidTo >= today))
                        .ToArrayAsync(cancellationToken);
                    if (packages.Length != requestedPackageIds.Count)
                        return CommercialSubmissionResult.Failed(CommercialSubmissionFailure.ServiceUnavailable);
                    if (packages.Select(package => package.CurrencyCode)
                        .Distinct(StringComparer.Ordinal).Count() > 1)
                        return CommercialSubmissionResult.Failed(CommercialSubmissionFailure.ServiceUnavailable);
                    var packageIds = packages.Select(package => package.Id).ToArray();
                    var components = await context.Set<ServicePackageComponent>().AsNoTracking()
                        .Where(component => packageIds.Contains(component.PackageVersionId))
                        .ToArrayAsync(cancellationToken);
                    if (packages.Any(package => !components.Any(component =>
                            component.PackageVersionId == package.Id)) ||
                        components.GroupBy(component => component.ServiceDefinitionId)
                            .Any(group => group.Count() > 1))
                        return CommercialSubmissionResult.Failed(CommercialSubmissionFailure.ServiceUnavailable);
                    var componentIds = components.Select(component => component.ServiceDefinitionId)
                        .Distinct().ToArray();
                    var includedServices = await context.ServiceDefinitions.AsNoTracking()
                        .Where(PublicCommercialServiceVisibility.PublishedActive)
                        .Where(service => componentIds.Contains(service.Id))
                        .ToArrayAsync(cancellationToken);
                    if (includedServices.Length != componentIds.Length)
                        return CommercialSubmissionResult.Failed(CommercialSubmissionFailure.ServiceUnavailable);
                    var allServices = services.Concat(includedServices)
                        .DistinctBy(service => service.Id).ToArray();
                    if (allServices.Length is < 1 or > 100)
                        return CommercialSubmissionResult.Failed(CommercialSubmissionFailure.ServiceUnavailable);

                    var request = new ServiceRequest
                    {
                        PublicId = command.RequestId,
                        RequestCode = reference,
                        AirlineProfileId = airline.Id,
                        AirlineId = airline.CanonicalAirlineId,
                        RequestedAirlineName = airline.DisplayName,
                        AirlineLegalNameSnapshot = airline.LegalName,
                        SubmissionHash = hash,
                        Type = requestType,
                        Status = CommercialRequestStatus.Pending,
                        ContactName = command.RepresentativeName.Trim(),
                        ContactTitle = command.RepresentativeTitle.Trim(),
                        ContactEmail = command.RepresentativeEmail.Trim(),
                        ContactPhone = command.RepresentativePhone.Trim(),
                        ContactNationalityCode = Optional(command.RepresentativeNationalityCode),
                        ContactAddress = Optional(command.RepresentativeAddress),
                        ContactCountry = Optional(command.RepresentativeCountry),
                        ContactProvince = Optional(command.RepresentativeProvince),
                        ContactMunicipality = Optional(command.RepresentativeMunicipality),
                        ContactDocumentType = Optional(command.RepresentativeDocumentType),
                        ContactDocumentNumber = Optional(command.RepresentativeDocumentNumber),
                        AuthorityDeclared = command.AuthorityDeclared,
                        SubmittedAt = DateTimeOffset.UtcNow,
                    };
                    if (actorId is { } accountPublicId)
                        request.ProvisionedAccountId = await context.Users
                            .Where(user => user.PublicId == accountPublicId)
                            .Select(user => (long?)user.Id).SingleAsync(cancellationToken);
                    context.ServiceRequests.Add(request);
                    foreach (var service in allServices)
                    {
                        context.Set<ServiceRequestItem>().Add(new ServiceRequestItem
                        {
                            ServiceRequest = request,
                            ServiceDefinitionId = service.Id,
                            RequestedServiceName = service.Name,
                            RequestedUnit = service.DefaultBillingUnit,
                        });
                    }
                    foreach (var package in packages)
                        context.Set<ServiceRequestPackageSelection>().Add(
                            new ServiceRequestPackageSelection
                            {
                                ServiceRequest = request, PackageVersionId = package.Id,
                            });

                    var recipients = await CommercialNotificationRecipients.WithPermissionAsync(context,
                        "contracts.requests.read", cancellationToken);
                    foreach (var recipient in recipients)
                        AccountChangeOutboxWriter.Add(context, recipient, null,
                            "commercial_requests", request.PublicId, request.SubmittedAt);

                    await context.SaveChangesAsync(cancellationToken);
                    await transaction.CommitAsync(cancellationToken);
                    return CommercialSubmissionResult.Success(reference, false);
                }
                catch
                {
                    context.ChangeTracker.Clear();
                    throw;
                }
            });
        }
        catch (DbUpdateException exception) when (exception.InnerException is SqlException { Number: 2601 or 2627 })
        {
            context.ChangeTracker.Clear();
            var concurrent = await context.ServiceRequests.AsNoTracking()
                .Where(item => item.PublicId == command.RequestId)
                .Select(item => new { item.RequestCode, item.SubmissionHash })
                .SingleOrDefaultAsync(cancellationToken);
            return concurrent is not null && concurrent.SubmissionHash == hash
                ? CommercialSubmissionResult.Success(concurrent.RequestCode, true)
                : CommercialSubmissionResult.Failed(CommercialSubmissionFailure.Conflict);
        }
    }

    private static string ComputeHash(SubmitCommercialRequestCommand command)
    {
        var canonical = string.Join('\n',
            command.AirlineProfileId.ToString("N"),
            string.Join(',', command.ServiceIds.OrderBy(id => id).Select(id => id.ToString("N"))),
            command.RepresentativeName.Trim(), command.RepresentativeTitle.Trim(),
            command.RepresentativeEmail.Trim().ToLowerInvariant(),
            command.RepresentativePhone.Trim(), command.AuthorityDeclared.ToString(),
            Optional(command.RepresentativeNationalityCode) ?? string.Empty,
            Optional(command.RepresentativeAddress) ?? string.Empty,
            Optional(command.RepresentativeCountry) ?? string.Empty,
            Optional(command.RepresentativeProvince) ?? string.Empty,
            Optional(command.RepresentativeMunicipality) ?? string.Empty,
            Optional(command.RepresentativeDocumentType) ?? string.Empty,
            Optional(command.RepresentativeDocumentNumber) ?? string.Empty);
        // Preserve the hash of pre-package requests so a receipt remains replayable.
        if (command.PackageVersionIds is { Count: > 0 } packages)
            canonical += "\npackages:" + string.Join(',', packages.OrderBy(id => id)
                .Select(id => id.ToString("N")));
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
    }

    private static string? Optional(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
