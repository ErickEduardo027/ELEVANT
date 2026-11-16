namespace Elevant.Domain.Enumerations;

public enum FiscalMode { Off, LocalSimulation, ProviderSandbox }
public enum FiscalState { AwaitingArchive, Archiving, ArchiveBlocked, Dispatching, Accepted, Rejected, Conditional, Pending, Unknown }
public enum FiscalSimulationOutcome { Accepted, Rejected, Conditional, Pending, Timeout, Unknown }
public enum FiscalArtifactKind { CanonicalJson, SimulationXml, Manifest, ProviderResponse, Callback }
public enum FiscalArtifactCompletion { Pending, Complete, Failed }
public enum FiscalIntentStatus { AwaitingArchive, Archiving, ArchiveBlocked, Dispatching, Completed }
