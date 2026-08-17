using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Reference;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.IntegrationTests.Persistence;

public sealed class DatabaseModelTests
{
    private static ElevantDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ElevantDbContext>()
            .UseSqlServer("Server=localhost;Initial Catalog=ElevantDevelopmentDb;Integrated Security=true;")
            .Options;

        return new ElevantDbContext(options);
    }

    [Theory]
    [InlineData(typeof(ApplicationUser), "iam", "accounts")]
    [InlineData(typeof(Organization), "iam", "organizations")]
    [InlineData(typeof(Airline), "ref", "airlines")]
    [InlineData(typeof(Station), "ref", "stations")]
    [InlineData(typeof(ServiceDefinition), "ref", "service_definitions")]
    public void CanonicalEntitiesUseExpectedSchemaAndTable(Type entityType, string schema, string table)
    {
        using var context = CreateContext();
        var metadata = context.Model.FindEntityType(entityType);

        Assert.NotNull(metadata);
        Assert.Equal(schema, metadata.GetSchema());
        Assert.Equal(table, metadata.GetTableName());
    }

    [Fact]
    public void BusinessForeignKeysNeverCascadeDeleteHistory()
    {
        using var context = CreateContext();
        var cascadingForeignKeys = context.Model.GetEntityTypes()
            .SelectMany(entity => entity.GetForeignKeys())
            .Where(foreignKey => foreignKey.DeleteBehavior is DeleteBehavior.Cascade or DeleteBehavior.ClientCascade)
            .Select(foreignKey => $"{foreignKey.DeclaringEntityType.DisplayName()}->{foreignKey.PrincipalEntityType.DisplayName()}")
            .ToArray();

        Assert.Empty(cascadingForeignKeys);
    }

    [Fact]
    public void AccountIsOneToOneWithPerson()
    {
        using var context = CreateContext();
        var account = context.Model.FindEntityType(typeof(ApplicationUser));

        Assert.NotNull(account);
        Assert.Contains(
            account.GetIndexes(),
            index => index.IsUnique && index.Properties.Select(property => property.Name).SequenceEqual([nameof(ApplicationUser.PersonId)]));
    }
}
