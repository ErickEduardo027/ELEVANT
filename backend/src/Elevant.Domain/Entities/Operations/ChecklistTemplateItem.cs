namespace Elevant.Domain.Entities.Operations;

public sealed class ChecklistTemplateItem : AuditableEntity
{
    public long ChecklistTemplateVersionId { get; set; }

    public string ItemCode { get; set; } = string.Empty;

    public string SectionName { get; set; } = string.Empty;

    public string Label { get; set; } = string.Empty;

    public int SortOrder { get; set; }

    public bool RequiresNoteWhenNotOk { get; set; }

    public bool IsRequired { get; set; }
}
