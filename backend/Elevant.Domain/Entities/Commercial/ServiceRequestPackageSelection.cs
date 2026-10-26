namespace Elevant.Domain.Entities.Commercial;

/// <summary>A package version chosen with a commercial request; its components are expanded into request items.</summary>
public sealed class ServiceRequestPackageSelection
{
    public long ServiceRequestId { get; set; }
    public ServiceRequest ServiceRequest { get; set; } = null!;
    public long PackageVersionId { get; set; }
}
