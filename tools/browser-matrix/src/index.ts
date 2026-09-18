export { loadSupportData, versionKey } from './caniuse.ts'
export type { FeatureSupport, SupportData, SupportString } from './caniuse.ts'
export { computeMatrix, isFullySupported, COVERAGE_TARGET_PERCENT } from './matrix.ts'
export type {
  BrowserFloor,
  BrowserMatrix,
  ComputeMatrixOptions,
  ExcludedBrowser,
  MissingFeature,
} from './matrix.ts'
export {
  CONSIDERED_FEATURES,
  REQUIRED_FEATURES,
  REQUIRED_FEATURE_IDS,
} from './required-features.ts'
export type { ConsideredFeature, RequiredFeature } from './required-features.ts'
export {
  ARTIFACT_FILENAME,
  BROWSERSLISTRC_FILENAME,
  buildArtifact,
  main,
  renderBrowserslistrc,
  renderReport,
  runReport,
} from './report.ts'
export type {
  BrowserMatrixArtifact,
  ReportMeta,
  RunReportOptions,
  RunReportResult,
} from './report.ts'
