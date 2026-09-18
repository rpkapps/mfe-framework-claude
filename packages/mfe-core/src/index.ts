/**
 * `@company/mfe-core` — neutral MFE contracts.
 *
 * Nothing here imports React, a router, single-spa or Module Federation
 * (§12.2). Zod appears in type positions only: schemas arrive from the author's
 * own Zod instance and are validated through their `safeParse`.
 */

export {
  createMfeError,
  describeValue,
  formatPath,
  isMfeError,
  toMfeError,
  type MfeError,
  type MfeErrorCode,
  type MfeErrorDetails,
  type MfeErrorDirection,
} from './errors.ts'

export {
  arrayEqual,
  KeyedListeners,
  ListenerSet,
  shallowEqual,
  SnapshotSource,
  type Listener,
  type Subscribable,
  type Unsubscribe,
} from './observable.ts'

export {
  MountLifecycle,
  type AttemptToken,
  type MountHandle,
  type MountLifecycleOptions,
  type MountState,
  type MountStatus,
} from './lifecycle.ts'

export {
  CAPABILITY_NAMES,
  DEFINITION_ID_RULE,
  isCapabilityName,
  isValidDefinitionId,
  type CapabilityDescriptor,
  type CapabilityIconRef,
  type CapabilityName,
  type ContainerDescriptor,
  type DefinitionIdentity,
  type DefinitionKind,
  type ExportedDefinitionDescriptor,
} from './definition.ts'

export {
  eventNameToHandlerProp,
  findNonSerializableValue,
  isReservedInputName,
  isValidEventName,
  RESERVED_INPUT_NAMES,
  validateAgainstContract,
  validateSerializable,
  type ContractEvents,
  type ContractInputs,
  type ContractIssue,
  type ContractParseError,
  type ContractParseResult,
  type ContractSchema,
  type ContractValidation,
  type ContractValidationContext,
  type InferContract,
  type WidgetContract,
} from './contract.ts'

export {
  boundAttributes,
  boundName,
  EMPTY_ATTRIBUTES,
  normalizeError,
  SpanKind,
  SpanStatusCode,
  TELEMETRY_LIMITS,
  type MeasurementUnit,
  type MfeTelemetry,
  type Span,
  type SpanOptions,
  type SpanRecord,
  type SpanStatus,
  type TelemetryAttributes,
  type TelemetryAttribution,
  type TelemetryEventRecord,
  type TelemetryFrameworkRecord,
  type TelemetryLevel,
  type TelemetryLogRecord,
  type TelemetryMeasurementRecord,
  type TelemetryProvider,
  type TelemetryRecord,
  type TelemetryRecordKind,
  type Tracer,
} from './telemetry.ts'

export {
  DEFAULT_RETENTION,
  DEFAULT_SCHEMA_VERSION,
  isStorageEnvelope,
  physicalStorageKey,
  storagePrefix,
  type MfeStorage,
  type MfeStorageKey,
  type StorageArea,
  type StorageEnvelope,
  type StorageKeyDeclaration,
  type StorageKeyOptions,
  type StorageRetention,
  type StorageSnapshot,
} from './storage.ts'

export {
  FRAMEWORK_CONTRACT_MAJOR,
  isSupportedContractMajor,
  type AdapterKind,
  type AdapterSelectionRule,
  type AdvertisedContract,
  type NeutralRegistryEntry,
  type NormalizedRegistry,
  type QuarantinedRegistryEntry,
} from './registry.ts'

export {
  createTimeoutError,
  DEFAULT_DEADLINES,
  withDeadline,
  type DeadlineConfig,
  type DeadlineContext,
} from './deadline.ts'

export {
  allow,
  breadcrumbItemEqual,
  breadcrumbTrailEqual,
  commandEntryEqual,
  deny,
  type BoundaryLocation,
  type BreadcrumbContribution,
  type BreadcrumbItem,
  type CommandEntry,
  type CommandPlacement,
  type CommandRegistration,
  type Decision,
  type NavigationBridge,
  type NavigationIntent,
  type ShellState,
  type ShellTheme,
  type ShellTransition,
  type ShellUser,
} from './records.ts'

export {
  DiagnosticsHub,
  type Diagnostic,
  type DiagnosticSeverity,
  type DiagnosticsSink,
} from './diagnostics.ts'
