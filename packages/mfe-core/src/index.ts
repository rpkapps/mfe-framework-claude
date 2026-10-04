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

export { type Listener, type Subscribable, type Unsubscribe } from './observable.ts'

export { type AttemptToken, type MountHandle, type MountState } from './lifecycle.ts'

export type {
  RuntimeDefinitionSnapshot,
  RuntimeMountSnapshot,
  RuntimeRejectedEntrySnapshot,
  RuntimeSnapshot,
} from './runtime-snapshot.ts'

export {
  assertDefinitionId,
  CAPABILITY_NAMES,
  DEFINITION_ID_RULE,
  ICON_ELEMENT_TAGS,
  isCapabilityName,
  isValidDefinitionId,
  type CapabilityDeclaration,
  type CapabilityDescriptor,
  type PublishedRoute,
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
  type PublishedContract,
} from './definition.ts'

export {
  DEFINITION_BRAND,
  isBrandedDefinition,
  type BrandedDefinition,
} from './definition-brand.ts'

export {
  findOutputNameProblem,
  isReservedInputName,
  outputNameToHandlerProp,
  outputPayloadSchema,
  outputSchemaError,
  RESERVED_INPUT_NAMES,
  validateAgainstContract,
  findNonSerializableValue,
  validateSerializable,
  type ContractEmitPayloads,
  type ContractInputs,
  type ContractOutputs,
  type ContractParsedInputs,
  type ContractValidation,
  type ContractValidationContext,
  type OutputSchema,
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
  type TelemetrySpanContext,
  type Tracer,
} from './telemetry.ts'

export {
  createStorageError,
  DEFAULT_SCHEMA_VERSION,
  isStorageEnvelope,
  isStoredKey,
  physicalStorageKey,
  storedKey,
  type AnyStoredKey,
  type BrowserStorageArea,
  type MfeStorage,
  type ReadonlyStoredKey,
  type StorageArea,
  type StorageEnvelope,
  type StorageError,
  type StorageErrorCode,
  type StorageSnapshot,
  type StoredKey,
  type StoredKeyOptions,
  type StoredRow,
  type StoredSnapshot,
  type StoredStatus,
  type StoredUpdate,
  type StoredValue,
  type UserStorageAdapter,
  type UserStorageHandle,
  type UserStorageState,
} from './storage.ts'

export {
  type MfeAdapter,
  type Registry,
  type RegistryEntry,
  type RejectedRegistryEntry,
} from './registry.ts'

export { type DeadlineConfig } from './deadline.ts'

export { defaultExposePath, PAGE_SHARE_SCOPE, SCOPE_ATTRIBUTE } from './container-contract.ts'

export {
  assertRuntimeCompatibility,
  isRuntimeRequirement,
  RUNTIME_API_REQUIREMENT,
  RUNTIME_API_VERSION,
  satisfiesRuntimeRequirement,
} from './runtime-compatibility.ts'

export {
  ACTION_EFFECTS,
  actionEntryEqual,
  allow,
  arrayEqual,
  breadcrumbTrailEqual,
  DEFAULT_ACTION_PLACEMENTS,
  deny,
  isRecord,
  isWithinBoundary,
  shallowEqual,
  withoutUndefined,
  type BoundaryLocation,
  type BreadcrumbItem,
  type ActionEffect,
  type ActionEntry,
  type ActionExecutionContext,
  type AgentContextEntry,
  type AgentContextRegistration,
  type AgentPrompt,
  type AgentSuggestion,
  type AgentSuggestionEntry,
  type ActionInputSchema,
  type ActionPlacement,
  type ActionRegistration,
  type Decision,
  type NavigationAction,
  type NavigationBridge,
  type NavigationIntent,
  type ShellState,
  type ShellTheme,
  type ShellTransition,
  type ShellUser,
} from './records.ts'

export { type Diagnostic, type DiagnosticSeverity, type DiagnosticsSink } from './diagnostics.ts'

/** In a module of its own rather than beside either surface, because it belongs to both. */
export { HOST_SCOPE } from './scope.ts'

export {
  coerceInputs,
  defaultInputsFor,
  describeOutputs,
  describeInputs,
  needsInputPrompt,
  type WidgetOutput,
  type WidgetInputField,
  type WidgetInputKind,
  type WidgetInputType,
} from './widget-inputs.ts'

export type { BuildProvenance } from './definition.ts'
