using System.Data;
using Elevant.Infrastructure.Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Seed;

/// <summary>Explicit, Development-only credential recovery for the synthetic HR actor.</summary>
public sealed class DevelopmentHumanResourcesCredentialRotator(ElevantDbContext context)
{
    private const string NormalizedEmail = "GESTION.HUMANA@DEV.ELEVANT.TEST";
    private static readonly Guid AccountPublicId = Guid.Parse("40000000-0000-7000-8000-000000000004");

    public async Task RotateAsync(string newPassword, CancellationToken cancellationToken = default)
    {
        DevelopmentAccountPasswords.ValidateSingle(newPassword);
        await DatabaseInstanceVerifier.RequireEnvironmentAsync(context, "Development", cancellationToken);

        var account = await context.Users.AsNoTracking()
            .SingleOrDefaultAsync(item => item.NormalizedEmail == NormalizedEmail, cancellationToken);
        if (account is null || account.PublicId != AccountPublicId)
        {
            throw new InvalidOperationException("The synthetic Development HR account is missing or has identity drift.");
        }

        var hash = new PasswordHasher<ApplicationUser>().HashPassword(account, newPassword);
        var parameters = new[]
        {
            new SqlParameter("@normalized_email", SqlDbType.NVarChar, 256) { Value = NormalizedEmail },
            new SqlParameter("@public_id", SqlDbType.UniqueIdentifier) { Value = AccountPublicId },
            new SqlParameter("@password_hash", SqlDbType.NVarChar, -1) { Value = hash },
            new SqlParameter("@security_stamp", SqlDbType.NVarChar, -1) { Value = Guid.NewGuid().ToString("D") },
        };
        await using var transaction = await context.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);
        await context.Database.ExecuteSqlRawAsync(
            "EXEC [iam].[set_development_account_credential] @normalized_email, @public_id, @password_hash, @security_stamp;",
            parameters,
            cancellationToken);
        await context.Database.ExecuteSqlRawAsync(
            "EXEC [iam].[require_development_hr_password_change];",
            cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }
}
