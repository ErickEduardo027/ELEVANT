using System.Globalization;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Common;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

/// <summary>
/// The daily sweep of ramp agents' documents (2-N25): an on-screen alert to Gestión Humana, once per cycle, for each
/// current airport permit, ramp licence or qualification of an active agent that expires within
/// <see cref="HumanResourcesDocumentOptions.NoticeDays"/>; and the OCC alerts of assignments a current document no
/// longer covers (<see cref="AgentDocumentNotices"/>). No email; nothing is released.
/// </summary>
internal sealed class EfHumanResourcesDocumentSweepStore(ElevantDbContext context, TimeProvider clock,
    HumanResourcesDocumentOptions options) : IHumanResourcesDocumentSweepStore
{
    /// <summary>Department alert kind of an airport permit or ramp licence about to expire.</summary>
    public const string PermitKind = "agent_document_expiring";

    /// <summary>Department alert kind of an equipment qualification about to expire.</summary>
    public const string QualificationKind = "agent_qualification_expiring";

    public async Task<HumanResourcesDocumentSweepResult> SweepAsync(CancellationToken cancellationToken = default)
    {
        var now = clock.GetUtcNow();
        var today = BusinessCalendar.Today(now);
        var horizon = today.AddDays(options.NoticeDays);
        var strategy = context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            context.ChangeTracker.Clear();
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            var permits = await (from cycle in context.AirportPermitCycles.AsNoTracking()
                                 join agent in context.RampAgents.AsNoTracking() on cycle.RampAgentId equals agent.Id
                                 join person in context.Persons.AsNoTracking() on agent.PersonId equals person.Id
                                 where cycle.IsCurrent && agent.IsActive && cycle.ExpiresOn >= today &&
                                       cycle.ExpiresOn <= horizon &&
                                       !context.DepartmentNotifications.Any(notification =>
                                           notification.Kind == PermitKind && notification.SourceId == cycle.PublicId)
                                 select new { cycle.PublicId, cycle.DocumentType, cycle.ExpiresOn, person.FirstName,
                                     person.LastName, agent.EmployeeNumber })
                .ToArrayAsync(cancellationToken);
            foreach (var permit in permits)
                await DepartmentNotificationWriter.NotifyAsync(context, Department.HumanResources,
                    "human_resources.permits.read", PermitKind, permit.PublicId,
                    Subject(Label(permit.DocumentType), permit.FirstName, permit.LastName, permit.EmployeeNumber,
                        permit.ExpiresOn), now, cancellationToken);
            var qualifications = await (from cycle in context.QualificationCycles.AsNoTracking()
                                        join type in context.EquipmentTypes.AsNoTracking() on cycle.EquipmentTypeId equals type.Id
                                        join agent in context.RampAgents.AsNoTracking() on cycle.RampAgentId equals agent.Id
                                        join person in context.Persons.AsNoTracking() on agent.PersonId equals person.Id
                                        where cycle.IsCurrent && agent.IsActive && cycle.ExpiresOn >= today &&
                                              cycle.ExpiresOn <= horizon &&
                                              !context.DepartmentNotifications.Any(notification =>
                                                  notification.Kind == QualificationKind &&
                                                  notification.SourceId == cycle.PublicId)
                                        select new { cycle.PublicId, type.Name, cycle.ExpiresOn, person.FirstName,
                                            person.LastName, agent.EmployeeNumber })
                .ToArrayAsync(cancellationToken);
            foreach (var qualification in qualifications)
                await DepartmentNotificationWriter.NotifyAsync(context, Department.HumanResources,
                    "human_resources.qualifications.read", QualificationKind, qualification.PublicId,
                    Subject($"Habilitación {qualification.Name}", qualification.FirstName, qualification.LastName,
                        qualification.EmployeeNumber, qualification.ExpiresOn), now, cancellationToken);
            var assignments = await AgentDocumentNotices.NotifyUncoveredAssignmentsAsync(context, null, now,
                cancellationToken);
            // One alert per document, whatever the number of recipients.
            var announced = context.ChangeTracker.Entries<Elevant.Domain.Entities.Identity.DepartmentNotification>()
                .Where(entry => entry.State == EntityState.Added).Select(entry => entry.Entity.SourceId)
                .Distinct().Count();
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new HumanResourcesDocumentSweepResult(announced, assignments);
        });
    }

    private static string Label(PermitDocumentType type) => type switch
    {
        PermitDocumentType.AirportId => "Carnet aeroportuario",
        PermitDocumentType.RampDriverLicense => "Licencia de conducir en rampa",
        _ => "Documento",
    };

    private static string Subject(string document, string firstName, string lastName, string employeeNumber,
        DateOnly expiresOn) =>
        $"{document} · {firstName} {lastName} ({employeeNumber}) · vence el " +
        expiresOn.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
