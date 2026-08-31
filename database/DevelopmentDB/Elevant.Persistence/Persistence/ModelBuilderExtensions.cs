using System.Text;
using Elevant.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace Elevant.Infrastructure.Persistence;

internal static class ModelBuilderExtensions
{
    public static void ConfigureElevantConventions(this ModelBuilder modelBuilder)
    {
        ConfigureAuditableEntities(modelBuilder);

        foreach (var entityType in modelBuilder.Model.GetEntityTypes())
        {
            var tableName = entityType.GetTableName();
            if (tableName is not null)
            {
                entityType.SetTableName(ToSnakeCase(tableName));
            }

            var table = StoreObjectIdentifier.Table(
                entityType.GetTableName()!,
                entityType.GetSchema());

            foreach (var property in entityType.GetProperties())
            {
                var columnName = property.GetColumnName(table);
                if (columnName is not null)
                {
                    property.SetColumnName(ToSnakeCase(columnName));
                }
            }
        }
    }

    private static void ConfigureAuditableEntities(ModelBuilder modelBuilder)
    {
        var auditableTypes = modelBuilder.Model.GetEntityTypes()
            .Where(entityType => typeof(AuditableEntity).IsAssignableFrom(entityType.ClrType))
            .Select(entityType => entityType.ClrType)
            .ToArray();

        foreach (var auditableType in auditableTypes)
        {
            var builder = modelBuilder.Entity(auditableType);
            builder.Property(nameof(AuditableEntity.PublicId))
                .HasDefaultValueSql("NEWSEQUENTIALID()");
            builder.Property(nameof(AuditableEntity.CreatedAt))
                .HasPrecision(3)
                .HasDefaultValueSql("SYSUTCDATETIME()");
            builder.Property(nameof(AuditableEntity.UpdatedAt))
                .HasPrecision(3)
                .HasDefaultValueSql("SYSUTCDATETIME()");
            builder.Property(nameof(AuditableEntity.RowVersion)).IsRowVersion();
            builder.HasIndex(nameof(AuditableEntity.PublicId)).IsUnique();
        }
    }

    private static string ToSnakeCase(string value)
    {
        var result = new StringBuilder(value.Length + 8);

        for (var index = 0; index < value.Length; index++)
        {
            var character = value[index];
            if (char.IsUpper(character) && index > 0 && value[index - 1] != '_')
            {
                result.Append('_');
            }

            result.Append(char.ToLowerInvariant(character));
        }

        return result.ToString();
    }
}
