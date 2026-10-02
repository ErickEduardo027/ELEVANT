namespace Elevant.Domain.Entities.Commercial;

public sealed class ContractDraftComment : AuditableEntity
{
    public long ContractVersionId { get; set; }
    public long AuthorAccountId { get; set; }
    public string Body { get; set; } = string.Empty;
}
