using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

public static class RampChecklistSubmissionPolicy
{
    public const int MaximumAnswers = 256;
    public const int MaximumNoteLength = 1000;

    public static bool HasValidRequestShape(
        IReadOnlyCollection<RampChecklistAnswerWriteData>? answers)
    {
        if (answers is null || answers.Count is 0 or > MaximumAnswers)
        {
            return false;
        }

        var itemIds = new HashSet<Guid>();
        foreach (var answer in answers)
        {
            if (answer is null ||
                answer.ItemId == Guid.Empty ||
                !Enum.IsDefined(answer.Value) ||
                !itemIds.Add(answer.ItemId) ||
                answer.Note?.Length > MaximumNoteLength)
            {
                return false;
            }
        }

        return true;
    }

    public static bool CanSubmit(
        ChecklistStatus checklistStatus,
        IReadOnlyCollection<RampChecklistItemRule>? itemRules,
        IReadOnlyCollection<RampChecklistAnswerWriteData>? answers)
    {
        if (checklistStatus is not (ChecklistStatus.NotStarted or ChecklistStatus.InProgress) ||
            itemRules is null ||
            itemRules.Count == 0 ||
            !HasValidRequestShape(answers))
        {
            return false;
        }

        var rulesById = new Dictionary<Guid, RampChecklistItemRule>(itemRules.Count);
        foreach (var rule in itemRules)
        {
            if (rule is null || rule.ItemId == Guid.Empty || !rulesById.TryAdd(rule.ItemId, rule))
            {
                return false;
            }
        }

        var answersById = answers!.ToDictionary(answer => answer.ItemId);
        if (answersById.Keys.Any(itemId => !rulesById.ContainsKey(itemId)) ||
            rulesById.Values.Any(rule => rule.IsRequired && !answersById.ContainsKey(rule.ItemId)))
        {
            return false;
        }

        return answersById.Values.All(answer =>
            answer.Value != ChecklistAnswerValue.NotOk ||
            !rulesById[answer.ItemId].RequiresNoteWhenNotOk ||
            !string.IsNullOrWhiteSpace(answer.Note));
    }
}
