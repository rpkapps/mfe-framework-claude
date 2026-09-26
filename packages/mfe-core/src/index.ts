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
  type Tracer,
} from './telemetry.ts'

export {
  DEFAULT_SCHEMA_VERSION,
  isStorageEnvelope,
  physicalStorageKey,
  storagePrefix,
  type MfeStorage,
  type MfeStorageKey,
  type StorageArea,
  type StorageEnvelope,
  type StorageKeyOptions,
  type StorageSnapshot,
} from './storage.ts'

export {
  FRAMEWORK_CONTRACT_MAJOR,
  isSupportedContractMajor,
  type MfeAdapter,
  type Registry,
  type RegistryEntry,
  type RejectedRegistryEntry,
} from './registry.ts'

export { type DeadlineConfig } from './deadline.ts'

export { defaultExposePath, PAGE_SHARE_SCOPE, SCOPE_ATTRIBUTE } from './container-contract.ts'

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
