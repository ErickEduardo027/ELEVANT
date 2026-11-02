using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Infrastructure;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Entities.Workforce;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence.Configurations;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence;

/// <summary>EF Core boundary for Elevant-owned data.</summary>
public sealed class ElevantDbContext(DbContextOptions<ElevantDbContext> options)
    : IdentityDbContext<ApplicationUser, ApplicationRole, long>(options)
{
    public DbSet<DatabaseInstance> DatabaseInstances => Set<DatabaseInstance>();

    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();

    public DbSet<AccountChange> AccountChanges => Set<AccountChange>();

    public DbSet<Organization> Organizations => Set<Organization>();

    public DbSet<Person> Persons => Set<Person>();

    public DbSet<OrganizationMembership> OrganizationMemberships => Set<OrganizationMembership>();

    public DbSet<PermissionDefinition> Permissions => Set<PermissionDefinition>();

    public DbSet<AccountStationScope> AccountStationScopes => Set<AccountStationScope>();

    public DbSet<AccessProfile> AccessProfiles => Set<AccessProfile>();

    public DbSet<AccessProfileGrant> AccessProfileGrants => Set<AccessProfileGrant>();

    public DbSet<DepartmentAssignment> DepartmentAssignments => Set<DepartmentAssignment>();

    public DbSet<DepartmentNotification> DepartmentNotifications => Set<DepartmentNotification>();

    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();

    public DbSet<AccountEmailToken> AccountEmailTokens => Set<AccountEmailToken>();

    public DbSet<Elevant.Domain.Entities.Infrastructure.EmailOutboxMessage> EmailOutbox => Set<Elevant.Domain.Entities.Infrastructure.EmailOutboxMessage>();

    public DbSet<AccountPermissionGrant> AccountPermissionGrants => Set<AccountPermissionGrant>();

    public DbSet<UserAccessRequest> UserAccessRequests => Set<UserAccessRequest>();

    public DbSet<UserAccessRequestGrant> UserAccessRequestGrants => Set<UserAccessRequestGrant>();

    public DbSet<UserAccessRequestStation> UserAccessRequestStations => Set<UserAccessRequestStation>();

    public DbSet<UserAccessRequestTerminal> UserAccessRequestTerminals => Set<UserAccessRequestTerminal>();

    public DbSet<Airline> Airlines => Set<Airline>();

    public DbSet<Airport> Airports => Set<Airport>();

    public DbSet<Station> Stations => Set<Station>();

    public DbSet<Terminal> Terminals => Set<Terminal>();

    public DbSet<Stand> Stands => Set<Stand>();

    public DbSet<ServiceDefinition> ServiceDefinitions => Set<ServiceDefinition>();

    public DbSet<EquipmentType> EquipmentTypes => Set<EquipmentType>();

    public DbSet<AircraftType> AircraftTypes => Set<AircraftType>();

    public DbSet<OperationalPosition> OperationalPositions => Set<OperationalPosition>();

    public DbSet<EquipmentAsset> EquipmentAssets => Set<EquipmentAsset>();

    public DbSet<RampAgent> RampAgents => Set<RampAgent>();

    public DbSet<JobPosition> JobPositions => Set<JobPosition>();

    public DbSet<Employee> Employees => Set<Employee>();

    public DbSet<EmployeeAssignment> EmployeeAssignments => Set<EmployeeAssignment>();

    public DbSet<EmployeeStation> EmployeeStations => Set<EmployeeStation>();

    public DbSet<PersonnelRequisition> PersonnelRequisitions => Set<PersonnelRequisition>();

    public DbSet<RampMobileAccessRequest> RampMobileAccessRequests => Set<RampMobileAccessRequest>();

    public DbSet<QualificationCycle> QualificationCycles => Set<QualificationCycle>();

    public DbSet<AirportPermitCycle> AirportPermitCycles => Set<AirportPermitCycle>();

    public DbSet<ShiftAssignment> ShiftAssignments => Set<ShiftAssignment>();

    public DbSet<AvailabilityRequest> AvailabilityRequests => Set<AvailabilityRequest>();

    public DbSet<CoverageRequirement> CoverageRequirements => Set<CoverageRequirement>();

    public DbSet<ServiceRequest> ServiceRequests => Set<ServiceRequest>();

    public DbSet<ServiceClosureRequest> ServiceClosureRequests => Set<ServiceClosureRequest>();

    public DbSet<CommercialAirlineProfile> CommercialAirlineProfiles => Set<CommercialAirlineProfile>();

    public DbSet<MediaAsset> MediaAssets => Set<MediaAsset>();

    public DbSet<Contract> Contracts => Set<Contract>();

    public DbSet<ContractVersion> ContractVersions => Set<ContractVersion>();
    public DbSet<ContractDraftComment> ContractDraftComments => Set<ContractDraftComment>();

    public DbSet<ContractServiceRate> ContractServiceRates => Set<ContractServiceRate>();

    public DbSet<ContractSignature> ContractSignatures => Set<ContractSignature>();

    public DbSet<AirlinePermit> AirlinePermits => Set<AirlinePermit>();

    public DbSet<Preinvoice> Preinvoices => Set<Preinvoice>();

    public DbSet<PreinvoiceLine> PreinvoiceLines => Set<PreinvoiceLine>();

    public DbSet<PreinvoiceDispute> PreinvoiceDisputes => Set<PreinvoiceDispute>();

    public DbSet<PreinvoiceDisputeResolution> PreinvoiceDisputeResolutions => Set<PreinvoiceDisputeResolution>();

    public DbSet<PreinvoiceDisputeLine> PreinvoiceDisputeLines => Set<PreinvoiceDisputeLine>();

    public DbSet<NonFiscalInvoice> NonFiscalInvoices => Set<NonFiscalInvoice>();

    public DbSet<NonFiscalInvoiceLine> NonFiscalInvoiceLines => Set<NonFiscalInvoiceLine>();

    public DbSet<NonFiscalPayment> NonFiscalPayments => Set<NonFiscalPayment>();

    public DbSet<BillingUnit> BillingUnits => Set<BillingUnit>();

    public DbSet<ServiceTariffVersion> ServiceTariffVersions => Set<ServiceTariffVersion>();

    public DbSet<ServiceTariffRate> ServiceTariffRates => Set<ServiceTariffRate>();

    public DbSet<ChargeDefinition> ChargeDefinitions => Set<ChargeDefinition>();

    public DbSet<ChargeDefinitionService> ChargeDefinitionServices => Set<ChargeDefinitionService>();

    public DbSet<ChargeTariffVersion> ChargeTariffVersions => Set<ChargeTariffVersion>();

    public DbSet<ChargeRate> ChargeRates => Set<ChargeRate>();

    public DbSet<ContractChargeRate> ContractChargeRates => Set<ContractChargeRate>();

    public DbSet<ExchangeRate> ExchangeRates => Set<ExchangeRate>();

    public DbSet<ContractFinanceReview> ContractFinanceReviews => Set<ContractFinanceReview>();

    public DbSet<AirlineBillingProfile> AirlineBillingProfiles => Set<AirlineBillingProfile>();

    public DbSet<NonFiscalCreditNote> NonFiscalCreditNotes => Set<NonFiscalCreditNote>();

    public DbSet<OperationServiceCharge> OperationServiceCharges => Set<OperationServiceCharge>();

    public DbSet<FinancialDocument> FinancialDocuments => Set<FinancialDocument>();

    public DbSet<Turnaround> Turnarounds => Set<Turnaround>();

    public DbSet<FlightLeg> FlightLegs => Set<FlightLeg>();

    public DbSet<GroundOperation> GroundOperations => Set<GroundOperation>();

    public DbSet<OperationAgentAssignment> OperationAgentAssignments => Set<OperationAgentAssignment>();

    public DbSet<OperationAttendanceContributionRevision> OperationAttendanceContributionRevisions => Set<OperationAttendanceContributionRevision>();

    public DbSet<OperationAttendanceValidation> OperationAttendanceValidations => Set<OperationAttendanceValidation>();

    public DbSet<OperationEquipmentAssignment> OperationEquipmentAssignments => Set<OperationEquipmentAssignment>();

    public DbSet<OperationService> OperationServices => Set<OperationService>();

    public DbSet<OperationChecklist> OperationChecklists => Set<OperationChecklist>();

    public DbSet<Incident> Incidents => Set<Incident>();

    public DbSet<OperationSubmission> OperationSubmissions => Set<OperationSubmission>();

    public DbSet<ReviewDecision> ReviewDecisions => Set<ReviewDecision>();

    public DbSet<OperationMessage> OperationMessages => Set<OperationMessage>();

    public DbSet<OperationalNotification> OperationalNotifications => Set<OperationalNotification>();

    public DbSet<MobileDevice> MobileDevices => Set<MobileDevice>();

    public DbSet<MobileCommandReceipt> MobileCommandReceipts => Set<MobileCommandReceipt>();

    public DbSet<AuditEntry> AuditEntries => Set<AuditEntry>();

    public DbSet<AuditChange> AuditChanges => Set<AuditChange>();

    /// <inheritdoc />
    protected override void OnModelCreating(ModelBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        base.OnModelCreating(builder);
        builder.ConfigurePlatform();
        builder.ConfigureIdentityAndReference();
        builder.ConfigureDepartmentGovernance();
        builder.ConfigureEmployeeGovernance();
        builder.ConfigureWorkforceAndCommercial();
        builder.ConfigurePreinvoices();
        builder.ConfigureNonFiscalInvoices();
        builder.ConfigureNonFiscalPayments();
        builder.ConfigureFinanceTariffs();
        builder.ConfigureFinancePackages();
        builder.ConfigureOperations();
        builder.ConfigureIntegrationAndAudit();
        builder.ApplyConfigurationsFromAssembly(typeof(ElevantDbContext).Assembly);
        builder.ConfigureElevantConventions();
    }
}
