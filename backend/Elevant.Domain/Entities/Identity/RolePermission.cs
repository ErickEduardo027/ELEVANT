namespace Elevant.Domain.Entities.Identity;

public sealed class RolePermissionGrant
{
    public long RoleId { get; set; }

    public long PermissionId { get; set; }
}
