using System.Data;
using System.Security.Cryptography;
using System.Text;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

internal sealed class EfCommercialIntakeStore(ElevantDbContext context) : ICommercialIntakeStore
{
    public async Task<CommercialSubmissionResult> SubmitAsync(
        SubmitCommercialRequestCommand command, CancellationToken cancellationToken = default)
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

                    var request = new ServiceRequest
                    {
                        PublicId = command.RequestId,
                        RequestCode = reference,
                        AirlineProfileId = airline.Id,
                        AirlineId = airline.CanonicalAirlineId,
                        RequestedAirlineName = airline.DisplayName,
                        AirlineLegalNameSnapshot = airline.LegalName,
                        SubmissionHash = hash,
                        Type = CommercialRequestType.Affiliation,
                        Status = CommercialRequestStatus.Pending,
                        ContactName = command.RepresentativeName.Trim(),
                        ContactTitle = command.RepresentativeTitle.Trim(),
                        ContactEmail = command.RepresentativeEmail.Trim(),
                        ContactPhone = command.RepresentativePhone.Trim(),
                        AuthorityDeclared = command.AuthorityDeclared,
                        SubmittedAt = DateTimeOffset.UtcNow,
                    };
                    context.ServiceRequests.Add(request);
                    foreach (var serviceId in command.ServiceIds)
                    {
                        var service = services.Single(item => item.PublicId == serviceId);
                        context.Set<ServiceRequestItem>().Add(new ServiceRequestItem
                        {
                            ServiceRequest = request,
                            ServiceDefinitionId = service.Id,
                            RequestedServiceName = service.Name,
                            RequestedUnit = service.DefaultBillingUnit,
                        });
                    }

                    var recipients = await CommercialNotificationRecipients.WithPermissionAsync(context,
                        "commercial.requests.read", cancellationToken);
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
            command.RepresentativePhone.Trim(), command.AuthorityDeclared.ToString());
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
    }
}
