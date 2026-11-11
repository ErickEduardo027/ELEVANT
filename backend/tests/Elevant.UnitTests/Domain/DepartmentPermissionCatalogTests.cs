using Elevant.Domain.Enumerations;
using Elevant.Domain.Governance;

namespace Elevant.UnitTests.Domain;

public sealed class DepartmentPermissionCatalogTests
{
    [Fact]
    public void CoversTheFourDepartmentsWithUniqueWellFormedCodes()
    {
        Assert.Equal(
            [Department.HumanResources, Department.Contracts, Department.Operations, Department.Finance],
            DepartmentPermissionCatalog.Departments);

        var codes = DepartmentPermissionCatalog.Departments.SelectMany(DepartmentPermissionCatalog.CodesOf).ToArray();
        Assert.Equal(codes.Length, codes.Distinct(StringComparer.Ordinal).Count());
        Assert.All(codes, code =>
        {
            Assert.Matches("^[a-z_]+\\.[a-z_]+\\.[a-z]+$", code);
            Assert.True(code.Length <= 120);
        });
    }

    [Fact]
    public void EveryModuleOffersRead()
    {
        foreach (var department in DepartmentPermissionCatalog.Departments)
            Assert.All(DepartmentPermissionCatalog.ModulesOf(department),
                module => Assert.Contains(module.Actions, action => action.Action == "read"));
    }

    [Theory]
    [InlineData("contracts.requests.read", Department.Contracts)]
    [InlineData("contracts.requests.cancel", Department.Contracts)]
    [InlineData("contracts.drafts.delete", Department.Contracts)]
    [InlineData("finance.packages.delete", Department.Finance)]
    [InlineData("finance.packages.retire", Department.Finance)]
    [InlineData("operations.review.decide", Department.Operations)]
    [InlineData("operations.planning.update", Department.Operations)]
    [InlineData("operations.review.reopen", Department.Operations)]
    [InlineData("operations.incidents.update", Department.Operations)]
    [InlineData("human_resources.access_requests.validate", Department.HumanResources)]
    [InlineData("finance.invoicing.issue", Department.Finance)]
    [InlineData("finance.receipts.apply", Department.Finance)]
    public void KnowsWhichDepartmentOwnsACode(string code, Department department)
    {
        Assert.Equal(department, DepartmentPermissionCatalog.DepartmentOf(code));
        Assert.True(DepartmentPermissionCatalog.Belongs(code, department));
        Assert.False(DepartmentPermissionCatalog.Belongs(code,
            department == Department.Finance ? Department.Contracts : Department.Finance));
    }

    [Fact]
    public void HumanResourcesCannotProgramShiftsBecauseOperationsOwnsThem()
    {
        Assert.True(DepartmentPermissionCatalog.IsKnown("human_resources.schedules.read"));
        Assert.False(DepartmentPermissionCatalog.IsKnown("human_resources.schedules.manage"));
        Assert.DoesNotContain("human_resources.schedules.manage",
            DepartmentPermissionCatalog.Normalize(["human_resources.schedules.manage"]));
    }

    [Fact]
    public void EveryMenuOptionHasASectionAndActionsInAMatrixColumn()
    {
        string[] kinds = [PermissionKinds.Read, PermissionKinds.Create, PermissionKinds.Update, PermissionKinds.Delete, PermissionKinds.Other];
        foreach (var department in DepartmentPermissionCatalog.Departments)
        {
            var modules = DepartmentPermissionCatalog.ModulesOf(department);
            Assert.All(modules, module =>
            {
                Assert.False(string.IsNullOrWhiteSpace(module.Section));
                Assert.All(module.Actions, action => Assert.Contains(action.Kind, kinds));
                Assert.Equal(1, module.Actions.Count(action => action.Kind == PermissionKinds.Read));
                Assert.True(module.Parent is null || modules.Any(other => other.Key == module.Parent && other.Parent is null),
                    $"{module.Key} must live inside a top-level option");
            });
        }
    }

    [Theory]
    [InlineData("finance.tariffs.manage", new[] { "finance.billing_units.create", "finance.billing_units.read", "finance.billing_units.update",
        "finance.tariffs.create", "finance.tariffs.delete", "finance.tariffs.publish", "finance.tariffs.read", "finance.tariffs.update" })]
    [InlineData("human_resources.employees.manage", new[] { "human_resources.employees.create", "human_resources.employees.read",
        "human_resources.employees.update" })]
    [InlineData("contracts.catalog.retire", new[] { "contracts.catalog.delete", "contracts.catalog.read" })]
    [InlineData("contracts.agreements.read", new[] { "contracts.agreed_services.read", "contracts.agreements.read", "contracts.permits.read" })]
    // 4-A: «Cobros» is a tab of «Facturas», so reading receipts also reads the invoices that contain them.
    [InlineData("finance.receipts.read", new[] { "finance.receipts.read", "finance.reconciliation.read", "finance.statements.read" })]
    [InlineData("finance.packages.manage", new[] { "finance.packages.create", "finance.packages.delete", "finance.packages.publish",
        "finance.packages.read", "finance.packages.retire", "finance.packages.update" })]
    // 4-A: viewing approved services or preinvoices was reading «Por facturar»; issuing a preinvoice was issuing.
    [InlineData("finance.approved_services.read", new[] { "finance.invoicing.read" })]
    [InlineData("finance.preinvoices.read", new[] { "finance.invoicing.read" })]
    [InlineData("finance.preinvoices.issue", new[] { "finance.invoicing.issue", "finance.invoicing.read" })]
    [InlineData("finance.preinvoices.manage", new[] { "finance.invoicing.issue", "finance.invoicing.read" })]
    public void LegacyGrantsKeepTheirAccessAsCrudActions(string legacy, string[] expected)
    {
        Assert.False(DepartmentPermissionCatalog.IsKnown(legacy) && legacy.EndsWith(".manage", StringComparison.Ordinal));
        Assert.Equal(expected, DepartmentPermissionCatalog.Normalize([legacy]));
        Assert.True(DepartmentPermissionCatalog.Belongs(legacy, DepartmentPermissionCatalog.DepartmentOf(expected[0])!.Value));
    }

    [Fact]
    public void NoOptionStillOffersTheCombinedManageAction()
    {
        var codes = DepartmentPermissionCatalog.Departments.SelectMany(DepartmentPermissionCatalog.CodesOf).ToArray();
        Assert.DoesNotContain(codes, code => code.EndsWith(".manage", StringComparison.Ordinal) ||
            code.EndsWith(".edit", StringComparison.Ordinal));
        // «Retirar» of the catalog became its delete action; retiring a published package is a workflow of its own (1-N27).
        Assert.DoesNotContain("contracts.catalog.retire", codes);
        Assert.Equal(["finance.packages.retire"], codes.Where(code => code.EndsWith(".retire", StringComparison.Ordinal)));
    }

    /// <summary>3-A: rescheduling, cancelling and diverting a flight is its own planning action.</summary>
    [Fact]
    public void PlanningOffersTheRescheduleActionWithItsLabel()
    {
        var planning = Assert.Single(DepartmentPermissionCatalog.ModulesOf(Department.Operations),
            module => module.Key == "planning");
        var update = Assert.Single(planning.Actions, action => action.Action == "update");
        Assert.Equal(("Reprogramar, cancelar o desviar escalas", PermissionKinds.Update), (update.Label, update.Kind));
        Assert.Contains("operations.planning.update", DepartmentPermissionCatalog.CodesOf(Department.Operations));
        Assert.Equal(["operations.planning.read", "operations.planning.update"],
            DepartmentPermissionCatalog.Normalize(["operations.planning.update"]));
    }

    /// <summary>
    /// 3-H: reopening an approval is its own review action; 3-G: the incidents are a sub-window of Revisión that OCC
    /// reads and manages (report, review, resolve and close).
    /// </summary>
    [Fact]
    public void ReviewOffersTheReopenActionAndTheIncidentsSubWindow()
    {
        var modules = DepartmentPermissionCatalog.ModulesOf(Department.Operations);
        var review = Assert.Single(modules, module => module.Key == "review");
        var reopen = Assert.Single(review.Actions, action => action.Action == "reopen");
        Assert.Equal(("Reabrir operaciones aprobadas sin facturar", PermissionKinds.Other), (reopen.Label, reopen.Kind));
        var incidents = Assert.Single(modules, module => module.Key == "incidents");
        Assert.Equal(("Incidencias", "review"), (incidents.Label, incidents.Parent));
        Assert.Equal(["read", "update"], incidents.Actions.Select(action => action.Action).ToArray());
        Assert.Equal("Reportar y gestionar incidencias", incidents.Actions.Single(action => action.Action == "update").Label);
        var codes = DepartmentPermissionCatalog.CodesOf(Department.Operations);
        foreach (var code in new[] { "operations.review.reopen", "operations.incidents.read", "operations.incidents.update" })
            Assert.Contains(code, codes);
        Assert.Equal(["operations.review.read", "operations.review.reopen"],
            DepartmentPermissionCatalog.Normalize(["operations.review.reopen"]));
    }

    [Fact]
    public void RejectsUnknownCodesIncludingLegacyCommercialOnes()
    {
        Assert.False(DepartmentPermissionCatalog.IsKnown("commercial.requests.full"));
        Assert.False(DepartmentPermissionCatalog.IsKnown("iam.users.write"));
        Assert.Null(DepartmentPermissionCatalog.DepartmentOf("contracts.requests.delete"));
    }

    [Fact]
    public void NormalizeAddsReadForGrantedActionsAndDropsUnknownCodes()
    {
        var normalized = DepartmentPermissionCatalog.Normalize(
            ["contracts.requests.approve", "contracts.requests.approve", "unknown.module.read"]);

        Assert.Equal(["contracts.requests.approve", "contracts.requests.read"], normalized);
    }

    [Theory]
    [InlineData("contracts.service_closures.decide", "contracts.catalog.read")]
    [InlineData("finance.adjustments.create", "finance.reconciliation.read")]
    [InlineData("operations.attendance.read", "operations.planning.read")]
    [InlineData("operations.incidents.update", "operations.review.read")]
    [InlineData("human_resources.availability.create", "human_resources.schedules.read")]
    // 4-A: «Cobros» and «Estados de cuenta» are tabs of «Facturas».
    [InlineData("finance.receipts.apply", "finance.reconciliation.read")]
    [InlineData("finance.statements.read", "finance.reconciliation.read")]
    public void SubWindowGrantsReadOfTheScreenThatContainsIt(string code, string parentRead)
    {
        var normalized = DepartmentPermissionCatalog.Normalize([code]);

        Assert.Contains(parentRead, normalized);
        Assert.Contains(code[..code.LastIndexOf('.')] + ".read", normalized);
        // The parent grant is read-only: nothing else of the containing screen is added.
        Assert.DoesNotContain(normalized, item => item.StartsWith(parentRead[..parentRead.LastIndexOf('.')], StringComparison.Ordinal) && item != parentRead);
    }

    [Fact]
    public void CatalogReadAloneGrantsNoSubWindow()
    {
        Assert.Equal(["contracts.catalog.read"], DepartmentPermissionCatalog.Normalize(["contracts.catalog.read"]));
    }

    /// <summary>
    /// 4-A, 4-N12, 4-N20: a code of a retired module or action grants nothing, but a template that still stores it keeps
    /// validating in its own department (and only there), so saving it again drops the code instead of failing.
    /// </summary>
    [Theory]
    [InlineData("finance.approved_services.create")]
    [InlineData("finance.approved_services.preinvoice")]
    [InlineData("finance.preinvoices.update")]
    [InlineData("finance.reconciliation.create")]
    [InlineData("finance.reconciliation.record")]
    [InlineData("finance.taxes.read")]
    [InlineData("finance.taxes.create")]
    [InlineData("finance.taxes.manage")]
    [InlineData("finance.fiscal.read")]
    [InlineData("finance.fiscal.simulate")]
    [InlineData("finance.fiscal.manage")]
    // 4-N28: registering and editing an own expense never needed a Finance code.
    [InlineData("finance.expenses.create")]
    [InlineData("finance.expenses.update")]
    [InlineData("finance.expenses.manage")]
    public void RetiredFinanceCodesGrantNothingButStillBelongToFinance(string code)
    {
        Assert.False(DepartmentPermissionCatalog.IsKnown(code));
        Assert.Null(DepartmentPermissionCatalog.DepartmentOf(code));
        Assert.Empty(DepartmentPermissionCatalog.Expand(code));
        Assert.Empty(DepartmentPermissionCatalog.Normalize([code]));
        Assert.True(DepartmentPermissionCatalog.Belongs(code, Department.Finance));
        Assert.False(DepartmentPermissionCatalog.Belongs(code, Department.Contracts));
        Assert.False(DepartmentPermissionCatalog.Belongs(code, Department.Operations));
        // Next to a live code only the live code survives.
        Assert.Equal(["finance.reports.read"], DepartmentPermissionCatalog.Normalize([code, "finance.reports.read"]));
    }

    /// <summary>
    /// 4-N28: «Gastos de empleados» only reviews and reimburses (an own expense needs no Finance code); 4-N03, 4-N04:
    /// voiding an approved supplier invoice and reversing a supplier payment is «finance.payables.reverse».
    /// </summary>
    [Fact]
    public void PayablesOfferTheReversalAndExpensesOnlyReviewAndReimburse()
    {
        var modules = DepartmentPermissionCatalog.ModulesOf(Department.Finance);
        var expenses = Assert.Single(modules, module => module.Key == "expenses");
        Assert.Equal(["read", "approve", "pay"], expenses.Actions.Select(action => action.Action).ToArray());
        var payables = Assert.Single(modules, module => module.Key == "payables");
        Assert.Equal(["read", "create", "update", "approve", "pay", "reverse"], payables.Actions.Select(action => action.Action).ToArray());
        var reverse = Assert.Single(payables.Actions, action => action.Action == "reverse");
        Assert.Equal(("finance.payables.reverse", "Anular facturas y revertir pagos", PermissionKinds.Other),
            (reverse.Code, reverse.Label, reverse.Kind));
        Assert.Equal(Department.Finance, DepartmentPermissionCatalog.DepartmentOf("finance.payables.reverse"));
        Assert.True(DepartmentPermissionCatalog.Belongs("finance.payables.reverse", Department.Finance));
        Assert.False(DepartmentPermissionCatalog.Belongs("finance.payables.reverse", Department.Operations));
        // Administrators hold every code of the department, the reversal included.
        Assert.Contains("finance.payables.reverse", DepartmentPermissionCatalog.CodesOf(Department.Finance));
        Assert.Equal(["finance.payables.read", "finance.payables.reverse"], DepartmentPermissionCatalog.Normalize(["finance.payables.reverse"]));
        // A template that still stores the old expense codes keeps only what they really granted: nothing.
        Assert.Equal(["finance.expenses.approve", "finance.expenses.read"],
            DepartmentPermissionCatalog.Normalize(["finance.expenses.create", "finance.expenses.update", "finance.expenses.approve"]));
    }

    /// <summary>A code nobody ever defined still belongs to no department, even with a known prefix.</summary>
    [Fact]
    public void UnknownCodesWithAKnownPrefixStillBelongNowhere()
    {
        Assert.False(DepartmentPermissionCatalog.Belongs("finance.unknown.read", Department.Finance));
        Assert.False(DepartmentPermissionCatalog.Belongs("finance", Department.Finance));
    }

    /// <summary>
    /// 4-A: the simplified Finance menu (ADR-0035, block 3): Inicio · Facturación · Cuentas por pagar · Reportes ·
    /// Configuración. Preinvoices, approved services, tax treatments and fiscal documents are gone, and «Facturas» is read
    /// only: payments and credit notes are recorded in «Cobros» and the adjustment notes.
    /// </summary>
    [Fact]
    public void FinanceCatalogMatchesTheSimplifiedMenu()
    {
        var modules = DepartmentPermissionCatalog.ModulesOf(Department.Finance);
        Assert.Equal(["Inicio", "Facturación", "Cuentas por pagar", "Reportes", "Configuración"],
            modules.Select(module => module.Section).Distinct().ToArray());
        var codes = DepartmentPermissionCatalog.CodesOf(Department.Finance);
        Assert.DoesNotContain(codes, code => code.StartsWith("finance.preinvoices.", StringComparison.Ordinal) ||
            code.StartsWith("finance.approved_services.", StringComparison.Ordinal) ||
            code.StartsWith("finance.taxes.", StringComparison.Ordinal) ||
            code.StartsWith("finance.fiscal.", StringComparison.Ordinal));
        Assert.DoesNotContain("finance.reconciliation.create", codes);

        PermissionModule Of(string key) => Assert.Single(modules, module => module.Key == key);
        Assert.Equal(("Por facturar", "Facturación"), (Of("invoicing").Label, Of("invoicing").Section));
        Assert.Equal(["read", "issue"], Of("invoicing").Actions.Select(action => action.Action).ToArray());
        Assert.Equal(["read"], Of("reconciliation").Actions.Select(action => action.Action).ToArray());
        string[] subWindows = ["receipts", "statements", "adjustments"];
        Assert.All(subWindows, key => Assert.Equal(("reconciliation", "Facturación"), (Of(key).Parent, Of(key).Section)));
        Assert.Equal(("Charters", "Facturación"), (Of("charters").Label, Of("charters").Section));
        Assert.Equal(["payables", "suppliers", "expenses"],
            modules.Where(module => module.Section == "Cuentas por pagar").Select(module => module.Key).ToArray());
        Assert.Equal("Facturas de proveedores", Of("payables").Label);
        Assert.Equal(["tariffs", "charges", "packages", "close_rules", "contract_approvals", "exchange_rates", "billing_units"],
            modules.Where(module => module.Section == "Configuración").Select(module => module.Key).ToArray());
    }
}
