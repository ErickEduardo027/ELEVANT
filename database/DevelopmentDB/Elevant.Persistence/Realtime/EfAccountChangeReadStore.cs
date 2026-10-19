using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Realtime;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Workforce;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;

namespace Elevant.Persistence.Realtime;

/// <summary>Rechecks the actor and live station scope on every feed page.</summary>
internal sealed class EfAccountChangeReadStore(
    ElevantDbContext context,
    IActorContextResolver actors) : IAccountChangeReadStore
{
    public Task<AccountChangePage?> ReadAsync(Guid accountId, long after, int limit,
        CancellationToken cancellationToken = default) =>
        ReadAsync(accountId, after, limit, null, cancellationToken);

    public async Task<AccountChangePage?> ReadAsync(Guid accountId, long after, int limit,
        Guid? installationId, CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty || after < 0 || limit is < 1 or > 100)
            throw new ArgumentOutOfRangeException(nameof(limit));

        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        if (actor is null || actor.Roles.Count == 0 || actor.Memberships.Count == 0)
            return null;

        var accountInternalId = await context.Users.AsNoTracking()
            .Where(account => account.PublicId == accountId)
            .Select(account => account.Id)
            .SingleOrDefaultAsync(cancellationToken);
        if (accountInternalId <= 0)
            return null;

        var allowedStations = actor.StationScopes
            .Select(scope => scope.StationId)
            .ToArray();
        var airlineOrganizationIds = actor.Memberships
            .Where(membership => membership.Kind == MembershipKind.AirlineClient &&
                membership.OrganizationType == OrganizationType.AirlineCustomer)
            .Select(membership => membership.OrganizationId)
            .ToArray();
        var hasAirlinePortalRole = actor.Roles.Any(role =>
            role.Code == "AIRLINE_CLIENT" && role.Portal == PortalKind.AirlinePortal);
        var hasInternalMembership = actor.Memberships.Any(membership =>
            membership.Kind == MembershipKind.InternalStaff &&
            membership.OrganizationType == OrganizationType.AviamOperator);
        // Department governance decides who may read each internal hint stream.
        var access = hasInternalMembership ? actor.EffectiveAccess : null;
        var isSuperAdmin = access?.IsSuperAdministrator == true;
        var hasFinanceAccess = access?.Department == Department.Finance;
        var hasHumanResourcesAccess = isSuperAdmin || access?.Department == Department.HumanResources;
        var hasOccPlanningAccess = access?.Department == Department.Operations &&
            access.Has("operations.planning.read");
        var hasRampAccess = hasInternalMembership && actor.Roles.Any(role =>
            role.Code == "RAMP_AGENT" && role.Portal == PortalKind.RampMobileApp);
        var hasCatalogAccess = access?.Has("contracts.catalog.read") == true || access?.Has("finance.catalog.read") == true;
        var hasRequestsAccess = access?.Has("contracts.requests.read") == true;
        var hasClosureAccess = access?.Has("contracts.service_closures.read") == true ||
            access?.Has("operations.service_closures.read") == true;
        var hasReceiptsAccess = access?.Has("finance.receipts.read") == true;
        var hasPayablesAccess = access?.Has("finance.payables.read") == true || access?.Has("finance.suppliers.read") == true;
        var hasExpensesAccess = access?.Has("finance.expenses.read") == true || access?.Kind == DepartmentAssignmentKind.Administrator;
        var hasFiscalAccess = access?.Has("finance.fiscal.read") == true;
        var rows = await context.AccountChanges.AsNoTracking()
            .Where(change => change.RecipientAccountId == accountInternalId &&
                change.Id > after &&
                (change.StationId == null || context.Stations.Any(station =>
                    station.Id == change.StationId &&
                    allowedStations.Contains(station.PublicId))) &&
                ((change.Resource != "hr_qualifications" && change.Resource != "hr_shifts" &&
                  change.Resource != "hr_permits" && change.Resource != "hr_absences") ||
                    hasHumanResourcesAccess) &&
                (change.Resource != "occ_planning" ||
                    (hasOccPlanningAccess && change.StationId != null &&
                     context.Stations.Any(station => station.Id == change.StationId &&
                         station.PublicId == change.ResourceId))) &&
                ((change.Resource != "attendance_draft" &&
                  change.Resource != "attendance_validation") ||
                    (change.StationId != null &&
                     context.GroundOperations.Any(operation =>
                         operation.PublicId == change.ResourceId &&
                         context.Turnarounds.Any(turnaround =>
                             turnaround.Id == operation.TurnaroundId &&
                             turnaround.StationId == change.StationId &&
                             context.OperationAgentAssignments.Any(assignment =>
                                 assignment.GroundOperationId == operation.Id &&
                                 (hasOccPlanningAccess || hasHumanResourcesAccess ||
                                  hasRampAccess && assignment.ReleasedAt == null &&
                                  context.Users.Any(user => user.Id == accountInternalId &&
                                      context.RampAgents.Any(agent =>
                                          agent.PersonId == user.PersonId && agent.IsActive &&
                                          agent.Id == assignment.RampAgentId &&
                                          context.Set<RampAgentStationScope>().Any(scope =>
                                              scope.RampAgentId == agent.Id &&
                                              scope.StationId == turnaround.StationId &&
                                              scope.ValidFrom <= turnaround.OperationDate &&
                                              (scope.ValidTo == null ||
                                               scope.ValidTo >= turnaround.OperationDate)) &&
                                          installationId != null &&
                                          context.Set<MobileDeviceAccountBinding>().Any(binding =>
                                              binding.AccountId == accountInternalId &&
                                              binding.UnboundAt == null &&
                                              context.MobileDevices.Any(device =>
                                                  device.Id == binding.MobileDeviceId &&
                                                  device.InstallationId == installationId &&
                                                  device.RevokedAt == null)))))))))) &&
                (change.Resource != "finance_approved_services" ||
                    (hasFinanceAccess && change.StationId != null &&
                     context.GroundOperations.Any(operation =>
                         operation.PublicId == change.ResourceId &&
                         operation.CurrentStatus == GroundOperationStatus.Approved &&
                         context.Turnarounds.Any(turnaround =>
                             turnaround.Id == operation.TurnaroundId &&
                             turnaround.StationId == change.StationId)))) &&
                (change.Resource != "finance_receipts" || hasReceiptsAccess) &&
                (change.Resource != "finance_payables" || hasPayablesAccess) &&
                (change.Resource != "finance_expenses" || hasExpensesAccess) &&
                (change.Resource != "finance_fiscal" || hasFiscalAccess) &&
                (change.Resource != "finance_preinvoices" ||
                    (hasFinanceAccess && change.StationId != null &&
                     context.Preinvoices.Any(draft =>
                         draft.PublicId == change.ResourceId &&
                         draft.StationId == change.StationId))) &&
                (change.Resource != "finance_tariffs" ||
                    (hasFinanceAccess && change.StationId != null &&
                     context.ContractVersions.Any(version =>
                         version.PublicId == change.ResourceId &&
                         (version.Status == ContractVersionStatus.Approved ||
                          version.Status == ContractVersionStatus.Superseded) &&
                         context.Set<ContractVersionStation>().Any(coverage =>
                             coverage.ContractVersionId == version.Id &&
                             coverage.StationId == change.StationId)))) &&
                (change.Resource != "airline_operations" ||
                    (hasAirlinePortalRole && context.GroundOperations.Any(operation =>
                        operation.PublicId == change.ResourceId &&
                        context.Turnarounds.Any(turnaround =>
                            turnaround.Id == operation.TurnaroundId &&
                            context.Airlines.Any(airline =>
                                airline.Id == turnaround.AirlineId &&
                                context.Organizations.Any(organization =>
                                    organization.Id == airline.OrganizationId &&
                                    airlineOrganizationIds.Contains(organization.PublicId))))))) &&
                (change.Resource != "airline_preinvoices" ||
                    (hasAirlinePortalRole && context.Preinvoices.Any(preinvoice =>
                        preinvoice.PublicId == change.ResourceId &&
                        preinvoice.Status != PreinvoiceStatus.Draft &&
                        preinvoice.Status != PreinvoiceStatus.Voided &&
                        context.Airlines.Any(airline => airline.Id == preinvoice.AirlineId &&
                            context.Organizations.Any(organization =>
                                organization.Id == airline.OrganizationId &&
                                airlineOrganizationIds.Contains(organization.PublicId)))))) &&
                (change.Resource != "airline_treasury" ||
                    (hasAirlinePortalRole && context.Airlines.Any(airline => airline.PublicId == change.ResourceId &&
                        airline.IsActive && context.Organizations.Any(organization => organization.Id == airline.OrganizationId &&
                            organization.Status == OrganizationStatus.Active && airlineOrganizationIds.Contains(organization.PublicId))))) &&
                (change.Resource != "commercial_catalog" ||
                    ((hasCatalogAccess || hasClosureAccess) && context.ServiceDefinitions.Any(service =>
                        service.PublicId == change.ResourceId))) &&
                (change.Resource != "commercial_requests" ||
                    (hasRequestsAccess && context.ServiceRequests.Any(request =>
                        request.PublicId == change.ResourceId))) &&
                (change.Resource != "service_closures" ||
                    (hasClosureAccess && context.ServiceClosureRequests.Any(request =>
                        request.PublicId == change.ResourceId))) &&
                (change.Resource != "account_provisioning" ||
                    (isSuperAdmin && context.ServiceRequests.Any(request =>
                        request.PublicId == change.ResourceId))) &&
                (change.Resource != "contract_draft_comments" ||
                    (hasRequestsAccess && context.ContractVersions.Any(version =>
                        version.PublicId == change.ResourceId))) &&
                (change.Resource != "airline_contracts" ||
                    (hasAirlinePortalRole &&
                     (context.Contracts.Any(contract =>
                        contract.PublicId == change.ResourceId &&
                        context.Airlines.Any(airline => airline.Id == contract.AirlineId &&
                            context.Organizations.Any(organization =>
                                organization.Id == airline.OrganizationId &&
                                airlineOrganizationIds.Contains(organization.PublicId)))) ||
                      context.ServiceRequests.Any(request =>
                        request.PublicId == change.ResourceId &&
                        request.ProvisionedAccountId == accountInternalId &&
                        context.Airlines.Any(airline => airline.Id == request.AirlineId &&
                            context.Organizations.Any(organization =>
                                organization.Id == airline.OrganizationId &&
                                airlineOrganizationIds.Contains(organization.PublicId))))))))
            .OrderBy(change => change.Id)
            .Take(limit + 1)
            .Select(change => new AccountChangeData(
                change.PublicId, change.Id, change.Resource,
                change.ResourceId, change.OccurredAt))
            .ToArrayAsync(cancellationToken);
        return new AccountChangePage(rows.Take(limit).ToArray(), rows.Length > limit);
    }
}
