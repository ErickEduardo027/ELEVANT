using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// The API account only reaches named objects of the <c>infra</c> schema. It queues and sends
    /// portal emails (ADR-0022): read, insert and update; bodies are cleared, rows never deleted.
    /// </summary>
    public partial class GrantEmailOutboxToApplication : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                IF DATABASE_PRINCIPAL_ID(N'elevant_app_role') IS NOT NULL
                    GRANT SELECT, INSERT, UPDATE ON OBJECT::[infra].[email_outbox] TO [elevant_app_role];
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                IF DATABASE_PRINCIPAL_ID(N'elevant_app_role') IS NOT NULL
                    REVOKE SELECT, INSERT, UPDATE ON OBJECT::[infra].[email_outbox] FROM [elevant_app_role];
                """);
        }
    }
}
