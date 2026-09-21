/** Neutral MFE contracts: nothing here imports React, a router, single-spa or Module Federation. */

export { DEV } from './dev.ts'

export {
  createMfeError,
  createMfeErrorFactory,
  describeThrown,
  describeValue,
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
  type IconData,
  type IconNode,
  type JsonSchemaObject,
  type JsonSchemaValue,
  type PublishedWidgetContract,
} from './definition.ts'

export {
  eventNameToHandlerProp,
  isReservedInputName,
  isValidEventName,
  RESERVED_INPUT_NAMES,
  validateAgainstContract,
  validateSerializable,
  type ContractEvents,
  type ContractInputs,
  type ContractValidation,
  type ContractValidationContext,
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
  type StorageKeyOptions,
  type StorageRetention,
  type StorageSnapshot,
} from './storage.ts'

export {
  FRAMEWORK_CONTRACT_MAJOR,
  isSupportedContractMajor,
  type AdapterKind,
  type AdapterSelectionRule,
  type NeutralRegistryEntry,
  type NormalizedRegistry,
  type QuarantinedRegistryEntry,
} from './registry.ts'

export {
  DEFAULT_DEADLINES,
  withDeadline,
  type DeadlineConfig,
  type DeadlineContext,
} from './deadline.ts'

export {
  allow,
  breadcrumbTrailEqual,
  commandEntryEqual,
  deny,
  type BoundaryLocation,
  type BreadcrumbItem,
  type CommandEntry,
  type CommandPlacement,
  type CommandRegistration,
  type Decision,
  type NavigationAction,
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

/** In a module of its own rather than beside either surface, because it belongs to both. */
export { HOST_SCOPE } from './scope.ts'

export {
  coerceInputs,
  defaultInputsFor,
  describeWidgetInputs,
  needsInputPrompt,
  type WidgetInputField,
  type WidgetInputKind,
  type WidgetInputType,
} from './widget-inputs.ts'

export type { BuildProvenance } from './definition.ts'
