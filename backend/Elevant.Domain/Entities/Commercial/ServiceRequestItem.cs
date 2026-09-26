namespace Elevant.Domain.Entities.Commercial;

public sealed class ServiceRequestItem : AuditableEntity
{
    public long ServiceRequestId { get; set; }

    public ServiceRequest ServiceRequest { get; set; } = null!;

    public long? ServiceDefinitionId { get; set; }

    public string RequestedServiceName { get; set; } = string.Empty;

    public decimal? EstimatedQuantity { get; set; }

    public string? RequestedUnit { get; set; }

    public DateOnly? RequestedFrom { get; set; }

    public DateOnly? RequestedTo { get; set; }

    public string? Notes { get; set; }
}
