using System.Data;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>Reads one applicable checklist within the live ramp-agent scope.</summary>
internal sealed class EfRampOperationChecklistReadStore(
    ElevantDbContext context,
    TimeProvider timeProvider) : IRampOperationChecklistReadStore
{
    private const string TurnaroundChecklistCode = "TURNAROUND-BASE";

    public async Task<RampOperationChecklistReadResult> GetChecklistAsync(
        RampOperationChecklistReadRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var strategy = context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(
                IsolationLevel.Serializable,
                cancellationToken);
            context.ChangeTracker.Clear();
            var result = await GetInsideTransactionAsync(request, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return result;
        });
    }

    private async Task<RampOperationChecklistReadResult> GetInsideTransactionAsync(
        RampOperationChecklistReadRequest request,
        CancellationToken cancellationToken)
    {
        var authorization = new EfRampExecutionAuthorization(context, timeProvider);
        var actorResult = await authorization.ResolveActorAsync(
            request.ActorAccountId,
            request.AllowedStationIds,
            installationId: null,
            cancellationToken);
        if (!actorResult.IsSuccess)
        {
            return actorResult.Failure == RampExecutionAuthorizationFailure.Forbidden
                ? RampOperationChecklistReadResult.Failed(
                    RampOperationChecklistReadFailure.AgentProfileUnavailable)
                : RampOperationChecklistReadResult.Failed(
                    RampOperationChecklistReadFailure.NotFound);
        }

        var scope = await authorization.ResolveOperationAsync(
            actorResult.Access!,
            request.OperationId,
            lockForUpdate: false,
            cancellationToken);
        if (scope is null)
        {
            return RampOperationChecklistReadResult.Failed(
                RampOperationChecklistReadFailure.NotFound);
        }

        var checklist = await (
                from operationChecklist in context.OperationChecklists.AsNoTracking()
                join version in context.Set<ChecklistTemplateVersion>().AsNoTracking()
                    on operationChecklist.ChecklistTemplateVersionId equals version.Id
                join template in context.Set<ChecklistTemplate>().AsNoTracking()
                    on version.ChecklistTemplateId equals template.Id
                where operationChecklist.GroundOperationId == scope.Operation.Id &&
                      template.Code == TurnaroundChecklistCode
                orderby version.VersionNumber descending, operationChecklist.PublicId
                select new ChecklistProjection(
                    operationChecklist.Id,
                    operationChecklist.PublicId,
                    operationChecklist.Status,
                    operationChecklist.StartedAt,
                    operationChecklist.SubmittedAt,
                    version.Id,
                    version.VersionNumber,
                    template.Code,
                    template.Name))
            .FirstOrDefaultAsync(cancellationToken);
        if (checklist is null)
        {
            return RampOperationChecklistReadResult.Failed(
                RampOperationChecklistReadFailure.NotFound);
        }

        var items = await (
                from item in context.Set<ChecklistTemplateItem>().AsNoTracking()
                where item.ChecklistTemplateVersionId == checklist.TemplateVersionInternalId
                join answerCandidate in context.Set<ChecklistAnswer>().AsNoTracking()
                        .Where(answer => answer.OperationChecklistId == checklist.InternalId)
                    on item.Id equals answerCandidate.ChecklistTemplateItemId into answers
                from answer in answers.DefaultIfEmpty()
                orderby item.SortOrder, item.PublicId
                select new ItemProjection(
                    item.PublicId,
                    item.ItemCode,
                    item.SectionName,
                    item.Label,
                    item.SortOrder,
                    item.IsRequired,
                    item.RequiresNoteWhenNotOk,
                    answer == null
                        ? null
                        : new RampChecklistAnswerData(
                            answer.Value.ToString(),
                            answer.Note,
                            answer.AnsweredAt)))
            .ToArrayAsync(cancellationToken);
        if (items.Length == 0 ||
            items.Select(item => item.SortOrder).Distinct().Count() != items.Length)
        {
            return RampOperationChecklistReadResult.Failed(
                RampOperationChecklistReadFailure.Conflict);
        }

        var sections = items
            .GroupBy(item => item.SectionName)
            .Select(group => new RampChecklistSectionData(
                group.Key,
                group.Select(item => new RampChecklistItemData(
                    item.Id,
                    item.Code,
                    item.Label,
                    item.SortOrder,
                    item.IsRequired,
                    item.RequiresNoteWhenNotOk,
                    item.Answer)).ToArray()))
            .ToArray();

        return RampOperationChecklistReadResult.Success(new RampOperationChecklistData(
            scope.Operation.PublicId,
            checklist.PublicId,
            checklist.Status.ToString(),
            checklist.StartedAt,
            checklist.SubmittedAt,
            new RampChecklistTemplateData(
                checklist.TemplateCode,
                checklist.TemplateName,
                checklist.TemplateVersion),
            sections));
    }

    private sealed record ChecklistProjection(
        long InternalId,
        Guid PublicId,
        ChecklistStatus Status,
        DateTimeOffset? StartedAt,
        DateTimeOffset? SubmittedAt,
        long TemplateVersionInternalId,
        int TemplateVersion,
        string TemplateCode,
        string TemplateName);

    private sealed record ItemProjection(
        Guid Id,
        string Code,
        string SectionName,
        string Label,
        int SortOrder,
        bool IsRequired,
        bool RequiresNoteWhenNotOk,
        RampChecklistAnswerData? Answer);
}
