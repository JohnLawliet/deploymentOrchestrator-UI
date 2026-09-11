/**
 * Frontend hand-off: Deployment Orchestrator API contract.
 *
 * Generated from the Spring controller/DTO source on 2026-08-09. This is a
 * declaration-only file: it has no runtime dependency and can be copied into
 * the frontend (or used as the input for an API client). ISO date-time values
 * are represented by `IsoDateTime` strings in JSON.
 */

export type IsoDateTime = string;
export type DeploymentStatus =
  'QUEUED' | 'VALIDATING' | 'LOCKING' | 'PREPARING' | 'DEPLOYING' | 'RESTARTING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type ResourceState = 'INACTIVE' | 'STARTING' | 'ACTIVE' | 'STOPPING' | 'DEPLOYING' | 'FAILED';
export type ProfileHealth = 'FUNCTIONAL' | 'MISSING' | 'NOT_FUNCTIONAL';
export type RuntimeReadiness = 'NOT_VERIFIED' | 'PORT_VERIFIED' | 'HTTP_VERIFIED';
export type RootKey = 'qc' | 'techDrive' | 'jenkinsBuild';
export type AdmissionStatus = 'QUEUED' | 'ADMITTED';

/** Required for every REST and SSE request except where noted otherwise. */
export interface ApiHeaders {
  'X-TechDrive-Username': string;
  'X-Portal-Tab-Id': string;
}

export interface ApiError {
  timestamp: IsoDateTime;
  status: number;
  error: string;
  code: string;
  message: string;
  deploymentId: string | null;
  paths: string[];
  users: string[];
}

export interface UserValidationResponse {
  valid: boolean;
  normalizedUsername: string;
  isAdmin: boolean;
  admissionStatus: AdmissionStatus;
  maxOnlineUsers: number;
  onlineCount: number;
  queuePosition: number | null;
  onlineUsers: UserPresence[];
  notices: string[];
}
export interface PortalSessionResponse {
  username: string;
  isAdmin: boolean;
  admissionStatus: AdmissionStatus;
  maxOnlineUsers: number;
  onlineCount: number;
  queuePosition: number | null;
  onlineUsers?: UserPresence[];
}
export interface PortalQueueResponse {
  admissionStatus: AdmissionStatus;
  maxOnlineUsers: number;
  onlineCount: number;
  queuePosition: number | null;
  onlineUsers: UserPresence[];
}
export interface FileRoot {
  key: RootKey;
  path: string;
}
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  lastModified: IsoDateTime;
  locked: boolean;
  lockMode: string | null;
}
export interface DownloadRequest {
  rootKey: RootKey;
  paths: string[];
}
export type DeleteRequest = DownloadRequest;
export interface RenameRequest {
  rootKey: RootKey;
  path: string;
  newName: string;
}
export interface ExtractRequest {
  rootKey: RootKey;
  path: string;
}
export interface ExtractResponse {
  rootKey: RootKey;
  sourcePath: string;
  destinationPath: string;
}
export interface MoveSource {
  rootKey: RootKey;
  paths: string[];
}
export interface MoveDestination {
  rootKey: RootKey;
  path: string;
}
export interface MoveRequest {
  source: MoveSource;
  destination: MoveDestination;
  overwriteConfirmed?: boolean;
  /** Omit for same-root plain move. Never send NONE for qc→techDrive. */
  archiveFormat?: 'NONE' | 'ZIP' | 'WAR' | 'JAR';
}
export interface FileMovePlanEntry {
  sourceRootKey: RootKey;
  sourcePath: string;
  destinationRootKey: RootKey;
  destinationPath: string;
  overwrite: boolean;
}
export interface FileMoveConflict {
  sourceRootKey: RootKey;
  sourcePath: string;
  destinationRootKey: RootKey;
  destinationPath: string;
  name: string;
}
export interface FileMovePreflightResponse {
  totalCount: number;
  moves: FileMovePlanEntry[];
  conflicts: FileMoveConflict[];
  adminRequired: boolean;
}
export interface FileMoveItemOutcome {
  sourceRootKey: RootKey;
  sourcePath: string;
  destinationRootKey: RootKey;
  destinationPath: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | string;
  message: string | null;
}
export interface FileMoveResult {
  operationId: string;
  totalCount: number;
  completed: FileMoveItemOutcome[];
  failed: FileMoveItemOutcome[];
}
export type FileMovePhaseCode =
  | 'FILE_MOVE_STARTED'
  | 'FILE_MOVE_CREATING_TEMP'
  | 'FILE_MOVE_ZIPPING'
  | 'FILE_MOVE_TRANSFERRING'
  | 'FILE_MOVE_DELETING_TEMP'
  | 'FILE_MOVE_ITEM_COMPLETED'
  | 'FILE_MOVE_ITEM_FAILED'
  | string;
export interface FileMoveProgressDto {
  operationId: string;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  pendingCount: number;
  progressPercentage: number;
  currentSourcePath: string | null;
  currentDestinationPath: string | null;
  phaseCode: FileMovePhaseCode;
  completed: FileMoveItemOutcome[];
  failed: FileMoveItemOutcome[];
  pending: FileMoveItemOutcome[];
}

export interface LockInfo {
  resourceKey: string;
  deploymentId: string;
  owner: string;
  acquiredAt: IsoDateTime;
  expiresAt: IsoDateTime | null;
  reason: string;
  section: string;
  profile: string;
  mode: 'READ' | 'WRITE';
  revision: number;
}
export interface UserPresence {
  username: string;
  status: 'ACTIVE' | 'IDLE' | 'OFFLINE';
  lastLoginAt: IsoDateTime;
  lastSeenAt: IsoDateTime;
  lastActivity: string | null;
  lastActivityTime: IsoDateTime | null;
  lastActivityStatus: string | null;
  revision: number;
}

export type JarLauncherMode = 'REUSE_EXISTING' | 'GENERATE_AND_SAVE';
export interface JarLauncher {
  mode: JarLauncherMode;
  port?: number | null;
  javaExecutablePath?: string | null;
}
export interface JarBatFetchResponse {
  content: string;
}
export interface JarFrontendDeployment {
  mode?: 'NONE' | 'REUSE_ASSOCIATION' | 'DEPLOY';
  catalogueJarId?: string | null;
  profileUuid?: string | null;
  sourceRootKey?: 'techDrive' | null;
  sourcePaths?: string[] | null;
  confirmReassociation?: boolean | null;
}
/** `deployerName` is server-derived and must never be sent. */
export interface JarDeploymentRequest {
  applicationName: string;
  sourcePath: string;
  launcher: JarLauncher;
  healthUrl?: string | null;
  catalogueJarId?: string | null;
  frontend?: JarFrontendDeployment | null;
}
export interface DeploymentStartResponse {
  deploymentId: string;
  status: 'ACCEPTED' | 'STARTING';
  terminalEventsUrl: string | null;
  resourceType: string | null;
  applicationName: string | null;
}
export interface JarPreflightCheckResponse {
  status: boolean | null;
  errors: string[];
}
export interface JarSnapshotSummary {
  snapshotId: number;
  applicationName: string;
  createdAt: IsoDateTime;
  includesLauncher: boolean;
  preDeploymentActive: boolean;
}
export interface SnapshotRollbackRequest {
  snapshotId: number;
}

export interface WildFlyDatasource {
  name: string;
  jndiName: string;
  connectionUrl: string;
  username: string;
  password: string;
}
/** `deployerName` is server-derived and must never be sent. */
export interface WarDeploymentRequest {
  application: string;
  profileId: string;
  sourceRootKey: RootKey;
  /** Tech Drive source archive path; UI accepts .war or .zip with WAR-layout contents. */
  sourcePath: string;
  datasourceOverride?: WildFlyDatasource | null;
  additionalConfigRequired: boolean;
  duplicateSelections?: Record<string, string> | null;
}
export interface WarPreflightResponse {
  ready: boolean;
  decisionRequired: boolean;
  missingFiles: string[];
  duplicateFiles: Record<string, string[]>;
  automaticallyResolved: Record<string, string>;
  warnings: string[];
  lockExpiresAt: IsoDateTime | null;
  activity: WildflyProfileActivity | null;
}
export interface WarDeploymentStartResponse {
  deploymentId: string;
  status: 'STARTING';
  terminalEventsUrl: string | null;
  profileId: string;
}
export interface WarSnapshotSummary {
  snapshotId: number;
  application: string;
  applicationVersion: number | null;
  createdAt: IsoDateTime;
}

export interface WildflyProfileActivity {
  id: string;
  profileName: string;
  version: string;
  application: string | null;
  applicationVersion: number | null;
  lastDeployedUser: string | null;
  status: ResourceState;
  health: ProfileHealth;
  pid: number | null;
  activeOperationId: string | null;
  offset: number;
  applicationPort: number;
  managementPort: number;
  deployCount: number;
  consecutiveFailures: number;
  failedDeployCount: number;
  lastDeploymentOn: IsoDateTime | null;
  lastSuccessfulDeploymentOn: IsoDateTime | null;
  lastUpdatedOn: IsoDateTime | null;
  lastResult: string | null;
}
export interface FrontendProfileActivity {
  profileUuid: string;
  profileName: string;
  port: number;
  documentRoot: string;
  serverName: string;
  frontendUrl: string | null;
  jarProfileUuid: string | null;
  applicationName: string | null;
  jarName: string | null;
  lastDeployedUser: string | null;
  lastDeploymentOn: IsoDateTime | null;
  health: ProfileHealth;
  healthReason: string | null;
  directoryExists: boolean;
  running: boolean;
}
export interface JarApplication {
  name: string;
  directory: string;
  jarName: string;
  running: boolean;
  pid: number | null;
  lastDeployedUser: string | null;
  applicationPort: number | null;
  healthUrl: string | null;
  healthReason: string | null;
  readiness: RuntimeReadiness;
  readinessReason: string | null;
  id: string | null;
  applicationName: string;
  status: ResourceState;
  health: ProfileHealth;
  readinessStatus: RuntimeReadiness;
  deployCount: number;
  consecutiveFailures: number;
  failedDeployCount: number;
  lastResult: string | null;
  terminalAvailable: boolean;
  lastDeploymentOn: IsoDateTime | null;
  frontendUrl: string | null;
  frontendProfileUuid: string | null;
  frontendProfile: FrontendProfileActivity | null;
}
export interface JarCatalogueResponse {
  domain: string;
  jars: JarApplication[];
}
export interface Profile {
  id: string;
  name: string;
  application: string | null;
  applicationVersion: number | null;
  version: string;
  profileDir: string;
  deploymentsDir: string;
  running: boolean;
  portOffset: number | null;
  lastDeployedUser: string | null;
  status: ResourceState;
  health: ProfileHealth;
  pid: number | null;
  activeOperationId: string | null;
  offset: number | null;
  applicationPort: number | null;
  managementPort: number | null;
  deployCount: number;
  consecutiveFailures: number;
  failedDeployCount: number;
  lastDeploymentOn: IsoDateTime | null;
  lastSuccessfulDeploymentOn: IsoDateTime | null;
  lastUpdatedOn: IsoDateTime | null;
  lastResult: string | null;
  serverLogAvailable: boolean;
}
export interface RuntimeResource {
  resourceKey: string;
  resourceType: string;
  application: string | null;
  applicationVersion: number | null;
  profileId: string | null;
  version: string | null;
  absolutePath: string;
  state: ResourceState;
  activeOperationId: string | null;
  pid: number | null;
  healthUrl: string | null;
  healthHost: string | null;
  healthPort: number | null;
  lastDeployedUser: string | null;
  lastDeployedAt: IsoDateTime | null;
  lastResult: string | null;
  lastCheckedAt: IsoDateTime | null;
  profileUuid: string | null;
  displayName: string | null;
  launcherPath: string | null;
  portOffset: number | null;
  servicePort: number | null;
  managementPort: number | null;
  profileHealth: ProfileHealth;
  healthReason: string | null;
  deployCount: number;
  consecutiveFailures: number;
  failedDeployCount: number;
  frontendUrl: string | null;
  readiness: RuntimeReadiness;
  readinessReason: string | null;
  terminalAvailable: boolean;
}
/** JAR resource views flatten RuntimeResource fields with these additions. */
export interface JarRuntimeResource extends RuntimeResource {
  javaExecutablePath: string | null;
  frontendProfileUuid: string | null;
  frontendProfile: FrontendProfileActivity | null;
}
export interface JarProfileActivity {
  id: string;
  applicationName: string;
  status: ResourceState;
  health: ProfileHealth;
  pid: number | null;
  activeOperationId: string | null;
  terminalDeploymentId: string | null;
  jarName: string;
  applicationPort: number | null;
  javaExecutablePath: string | null;
  healthUrl: string | null;
  healthReason: string | null;
  readiness: RuntimeReadiness;
  readinessReason: string | null;
  frontendUrl: string | null;
  frontendProfileUuid: string | null;
  deployCount: number;
  consecutiveFailures: number;
  failedDeployCount: number;
  lastUpdatedOn: IsoDateTime;
  lastResult: string | null;
  frontendProfile: FrontendProfileActivity | null;
  terminalAvailable: boolean;
}
export interface ActivityCheckRequest {
  pid?: number | null;
  offset?: number | null;
  applicationName?: string | null;
}
export interface ProcessResult {
  exitCode: number;
  timedOut: boolean;
  duration: string;
  output: string[];
}
export type ProfilePowerResponse = ProcessResult & Partial<DeploymentStartResponse>;
export interface PortStatus {
  port: number;
  occupied: boolean;
  pid: number | null;
  ownerType: 'NONE' | 'MANAGED_JAR' | 'JAVA_JAR' | 'JAVA' | 'OTHER' | 'UNKNOWN';
  executable: string | null;
  jarName: string | null;
  applicationName: string | null;
  sameApplication: boolean;
  deploymentAllowed: boolean;
  message: string;
}

export interface UatPreflightRequest {
  application: string;
  sourceRootKey: 'techDrive';
  /** Tech Drive source archive path; accepts .war or .zip with WAR-layout contents. */
  sourceWarPath: string;
  jenkinsRootKey: 'jenkinsBuild';
  jenkinsExplodedWarPath: string;
  additionalConfigRequired: boolean;
}
export interface UatPreflightResponse {
  lockId: string;
  lockExpiresAt: IsoDateTime;
  lockTtlSeconds: number;
  ready: boolean;
  decisionRequired: boolean;
  missingFromJenkinsFiles: string[];
  missingUatFiles: string[];
  duplicateFiles: Record<string, string[]>;
  automaticallyResolved: Record<string, string>;
  warnings: string[];
}
export interface UatConvertRequest {
  lockId: string;
  duplicateSelections?: Record<string, string> | null;
}
export interface UatOperationResponse {
  operationId: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  message?: string | null;
  outputPath?: string | null;
  warFileName?: string | null;
  sha256?: string | null;
  code?: string | null;
}

export type UploadMode = 'REGULAR' | 'FRONTEND_HOTFIX' | 'WILDFLY_HOTFIX';
export type UploadOperationStatus =
  'QUEUED' | 'READY' | 'AWAITING_SELECTION' | 'RUNNING' | 'ROLLING_BACK' | 'COMPLETED' | 'FAILED';
export type UploadItemStatus =
  | 'MISSING'
  | 'READY'
  | 'AMBIGUOUS'
  | 'AWAITING_SELECTION'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'ROLLING_BACK'
  | 'ROLLED_BACK'
  | 'ROLLBACK_FAILED';
export interface UploadItem {
  sourcePath: string;
  name: string;
  kind: 'FILE' | 'DIRECTORY';
  status: UploadItemStatus;
  targetPath: string | null;
  candidates: string[];
  message: string | null;
  rollbackAvailable: boolean;
}
export interface UploadRequest {
  mode: UploadMode;
  sourcePaths: string[];
  target: { kind: 'QC_PATH' | 'FRONTEND_PROFILE' | 'WILDFLY_PROFILE'; reference: string };
}
export interface UploadResponse {
  operationId: string;
  mode: UploadMode;
  status: UploadOperationStatus;
  message: string | null;
  restartRequired: boolean;
  restartStatus: 'PENDING' | 'NOT_REQUIRED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  createdAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  items: UploadItem[];
}

export interface DatabaseColumn {
  key: string;
  label: string;
  type: 'STRING' | 'INTEGER' | 'LONG' | 'DATETIME' | 'BOOLEAN' | 'STATUS';
  nullable: boolean;
}
export interface DatabaseTable {
  name: string;
  label: string;
  description: string;
  idField: string;
  deletable: boolean;
  permissions: { read: boolean; delete: boolean };
  columns: DatabaseColumn[];
  queries: Array<{
    name: string;
    label: string;
    method: string;
    path: string;
    description: string;
    destructive: boolean;
    allowed: boolean;
    parameters: Array<{
      name: string;
      location: 'HEADER' | 'QUERY' | 'PATH';
      type: DatabaseColumn['type'];
      required: boolean;
      defaultValue: string | null;
      minimum: number | null;
      maximum: number | null;
      description: string;
    }>;
  }>;
}
/** Row keys are described by the corresponding DatabaseTable.columns metadata. */
export type DatabaseValue = string | number | boolean | null;
export type DatabaseRow = Record<string, DatabaseValue>;
export interface DatabasePage<T = DatabaseRow> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

/** Server-side record returned by GET deployment routes. */
export interface DeploymentRecord {
  deploymentId: string;
  type: string;
  username: string;
  application: string | null;
  environment: string | null;
  profile: string | null;
  sourcePath: string | null;
  targetPath: string | null;
  status: DeploymentStatus;
  currentStep: string;
  progressPercentage: number;
  startTime: IsoDateTime;
  endTime: IsoDateTime | null;
  errorMessage: string | null;
  rollbackResult: string | null;
  snapshotId: number | null;
  applicationVersion: number | null;
}

// ---------- SSE -----------------------------------------------------------
// All streams use GET + Accept: text/event-stream + X-TechDrive-Username.
// Native EventSource cannot attach a custom header; use a fetch-based SSE
// client/proxy rather than placing the username in the URL.

export interface TerminalOutputEvent {
  deploymentId: string;
  timestamp: IsoDateTime;
  line: string;
  replayed: boolean;
}
export interface ProfileLogEvent {
  profileId: string;
  timestamp: IsoDateTime;
  line: string;
  replay: boolean;
  boundaryReason: string | null;
}
export interface OperationProgress {
  phaseCode: string;
  status: string;
  progressPercentage: number | null;
  component: string | null;
}
export interface SystemSnapshot {
  wildflyProfiles: WildflyProfileActivity[];
  jarProfiles: JarProfileActivity[];
  frontendProfiles: FrontendProfileActivity[];
  onlineUsers: UserPresence[];
  locks: LockInfo[];
}
export interface FrontendAssociationUpdated {
  deploymentId: string;
  jarProfileUuid: string;
  frontendProfileUuid: string;
  frontendProfile: FrontendProfileActivity;
  jarProfile: JarProfileActivity;
}
export interface OperationFinished {
  operationId: string;
  username: string;
  section: string;
  resourceKey: string;
  resourceType: string;
  outcome: string;
  completedAt: IsoDateTime;
  summary: string;
}
export interface SystemEventFields {
  scope: 'SYSTEM' | 'RESOURCE' | 'USER' | 'OPERATION';
  timestamp: IsoDateTime;
  deploymentId: string | null;
  resourceKey: string | null;
  resourceType: string | null;
  state: string | null;
  pid: number | null;
  activeOperationId: string | null;
  deployCount: number | null;
  consecutiveFailures: number | null;
  failedDeployCount: number | null;
  lastResult: string | null;
  username: string | null;
  message: string | null;
  application: string | null;
  readiness: RuntimeReadiness | null;
  readinessReason: string | null;
}
export type SystemEvent =
  | (SystemEventFields & { scope: 'SYSTEM'; eventType: 'SYSTEM_SNAPSHOT'; resources: SystemSnapshot })
  | (SystemEventFields & { scope: 'SYSTEM'; eventType: 'FRONTEND_ASSOCIATION_UPDATED'; resources: FrontendAssociationUpdated })
  | (SystemEventFields & { scope: 'SYSTEM'; eventType: 'RUNTIME_RECONCILIATION_ISSUES'; resources: unknown[] })
  | (SystemEventFields & { scope: 'SYSTEM'; eventType: 'RUNTIME_RECONCILIATION_RECOVERED'; resources: null })
  | (SystemEventFields & { eventType: 'OPERATION_PROGRESS'; resources: OperationProgress | FileMoveProgressDto })
  | (SystemEventFields & { eventType: 'USER_PRESENCE_CHANGED'; resources: UserPresence })
  | (SystemEventFields & {
      eventType: 'LOCK_CHANGED';
      resources: { action: 'ACQUIRED' | 'CLAIMED' | 'RELEASED' | 'EXPIRED'; lock: LockInfo };
    })
  | (SystemEventFields & { eventType: 'OPERATION_FINISHED'; resources: OperationFinished })
  | (SystemEventFields & { eventType: 'TERMINAL_AVAILABLE'; resources: null })
  | (SystemEventFields & { eventType: 'TERMINAL_CLOSED'; resources: null })
  | (SystemEventFields & { eventType: 'DEPLOYMENT_LOG_AVAILABLE'; resources: null })
  | (SystemEventFields & { eventType: 'PROFILE_LOG_UNAVAILABLE'; resources: null })
  | (SystemEventFields & {
      eventType:
        | 'RESOURCE_STARTING'
        | 'RESOURCE_DEPLOYING'
        | 'RESOURCE_ACTIVE'
        | 'RESOURCE_STOPPING'
        | 'RESOURCE_INACTIVE'
        | 'RESOURCE_FAILED'
        | 'DEPLOYMENT_SUCCEEDED'
        | 'DEPLOYMENT_FAILED'
        | 'OPERATION_FAILED';
      resources: null;
    })
  | (SystemEventFields & {
      eventType: 'FRONTEND_PROFILE_UNRESOLVED' | 'FRONTEND_INACTIVE' | 'FRONTEND_CONFIGURATION_INVALID';
      resources: string;
    })
  | (SystemEventFields & { eventType: 'WAR_PREFLIGHT_READY'; resources: WarPreflightResponse })
  | (SystemEventFields & { eventType: 'WAR_PREFLIGHT_CANCELLED'; resources: null })
  | (SystemEventFields & {
      eventType:
        | 'UPLOAD_OPERATION_UPDATED'
        | 'UPLOAD_OPERATION_FAILED'
        | 'UPLOAD_OPERATION_COMPLETED'
        | 'UPLOAD_RESTART_STARTED'
        | 'UPLOAD_RESTART_COMPLETED';
      resources: UploadResponse;
    })
  | (SystemEventFields & {
      eventType:
        | 'UPLOAD_ITEM_PROCESSING'
        | 'UPLOAD_ITEM_SUCCEEDED'
        | 'UPLOAD_ITEM_FAILED'
        | 'UPLOAD_ITEM_ROLLED_BACK'
        | 'UPLOAD_ITEM_ROLLBACK_FAILED';
      resources: UploadItem;
    });

export type UatSseEventName = 'UAT_BUILD_RUNNING' | 'UAT_BUILD_COMPLETED' | 'UAT_BUILD_FAILED';

/** Exact routes, input, successful output, and special response status. */
export interface ApiRoutes {
  'GET /api/test': { headers: { Authorization: string }; response: string };
  'GET /api/users/validate': { response: UserValidationResponse };
  'GET /api/users/me': { response: PortalSessionResponse };
  'GET /api/users/queue': { response: PortalQueueResponse };
  'POST /api/users/activity': { response: void; status: 204 };
  'POST /api/users/logout': { response: void; status: 204 };
  'POST /api/users/{username}/force-logout': { path: { username: string }; response: void; status: 204 };
  'GET /api/files/roots': { response: FileRoot[] };
  'GET /api/files/list': { query: { rootKey: RootKey; path?: string }; response: FileNode[] };
  'GET /api/files/download': { query: { rootKey: RootKey; path: string }; response: Blob };
  'GET /api/files/sample/additionalConfig': { response: Blob };
  'POST /api/files/download': { body: DownloadRequest; response: Blob };
  'DELETE /api/files': { body: DeleteRequest; response: void; status: 204 };
  'POST /api/files/rename': { body: RenameRequest; response: void };
  'POST /api/files/extract': { body: ExtractRequest; response: ExtractResponse };
  'POST /api/files/move/preflight': { body: MoveRequest; response: FileMovePreflightResponse };
  'POST /api/files/move': { body: MoveRequest; response: FileMoveResult };
  'GET /api/logs': { query: { applicationName: string; date?: string }; response: Blob };
  'GET /api/dashboard/war-applications': {
    response: Array<{ application: string; warFileName: string; environments: string[] }>;
  };
  'GET /api/dashboard/jars': { response: JarCatalogueResponse };
  'GET /api/dashboard/profiles': { response: Profile[] };
  'POST /api/dashboard/jars/{application}/restart': { path: { application: string }; response: DeploymentStartResponse };
  'POST /api/dashboard/jars/{application}/stop': { path: { application: string }; response: DeploymentStartResponse };
  'POST /api/dashboard/profiles/{profileId}/restart': { path: { profileId: string }; response: DeploymentStartResponse };
  'POST /api/deployments/qc/jar': { body: JarDeploymentRequest; response: DeploymentStartResponse };
  'GET /api/deployments/qc/jar/fetch-bat': { query: { applicationName: string }; response: JarBatFetchResponse };
  'GET /api/deployments/qc/jar/file-check': { query: { applicationName: string }; response: JarPreflightCheckResponse };
  'GET /api/deployments/qc/jar/snapshots': { query: { applicationName: string }; response: JarSnapshotSummary[] };
  'POST /api/deployments/qc/jar/rollback': { body: SnapshotRollbackRequest; response: DeploymentStartResponse };
  'POST /api/deployments/qc/war': { body: WarDeploymentRequest; response: WarDeploymentStartResponse };
  'POST /api/deployments/qc/war/preflight': { body: WarDeploymentRequest; response: WarPreflightResponse };
  'POST /api/deployments/qc/war/rollback': { body: SnapshotRollbackRequest; response: DeploymentStartResponse };
  'GET /api/deployments/qc/war/snapshots': { query: { profileId: string }; response: WarSnapshotSummary[] };
  'GET /api/deployments/{deploymentId}': { path: { deploymentId: string }; response: DeploymentRecord };
  'GET /api/deployments/history': { response: DeploymentRecord[] };
  'GET /api/terminals/{deploymentId}/events': { path: { deploymentId: string }; response: EventSource };
  'DELETE /api/terminals/{deploymentId}': { path: { deploymentId: string }; response: void; status: 200 };
  'GET /api/terminals/{deploymentId}/download': { path: { deploymentId: string }; response: Blob; status: 200 | 403 | 404 | 409 };
  'GET /api/profiles': { response: Profile[] };
  'GET /api/profiles/running': { response: Profile[] };
  'GET /api/profiles/{profileId}': { path: { profileId: string }; response: Profile };
  'POST /api/profiles/{profileId}/start': { path: { profileId: string }; response: ProfilePowerResponse };
  'POST /api/profiles/{profileId}/stop': { path: { profileId: string }; response: ProfilePowerResponse };
  'PUT /api/profiles/{profileId}/log-subscriptions': { path: { profileId: string }; response: void; status: 200 };
  'DELETE /api/profiles/{profileId}/log-subscriptions': { path: { profileId: string }; response: void; status: 200 };
  'GET /api/wildfly/profiles/{profileId}/datasources': { path: { profileId: string }; response: WildFlyDatasource };
  'DELETE /api/wildfly/profiles/{profileId}/preflight': { path: { profileId: string }; response: void; status: 200 };
  'GET /api/resources': { query: { state?: ResourceState }; response: RuntimeResource[] };
  'GET /api/resources/{resourceKey}': { path: { resourceKey: string }; response: RuntimeResource | JarRuntimeResource };
  'POST /api/resources/{profileUuid}/activity': {
    path: { profileUuid: string };
    body?: ActivityCheckRequest;
    response: WildflyProfileActivity | JarProfileActivity;
  };
  'GET /api/system/ports/{port}': { path: { port: number }; query: { applicationName?: string }; response: PortStatus };
  'GET /api/locks': { response: LockInfo[] };
  'GET /api/locks/status': { query: { resourceKey: string }; response: LockInfo | null };
  'POST /api/uat-builds/preflight': { body: UatPreflightRequest; response: UatPreflightResponse };
  'DELETE /api/uat-builds/locks/{lockId}': { path: { lockId: string }; response: void; status: 204 };
  'POST /api/uat-builds/convert': { body: UatConvertRequest; response: UatOperationResponse; status: 202 };
  'POST /api/uploads': { body: UploadRequest; response: UploadResponse; status: 200 | 202 };
  'GET /api/uploads/{operationId}': { path: { operationId: string }; response: UploadResponse };
  'POST /api/uploads/{operationId}/execute': {
    path: { operationId: string };
    body: { selectedTargets?: Record<string, string> | null };
    response: UploadResponse;
    status: 202;
  };
  'POST /api/uploads/{operationId}/rollback': {
    path: { operationId: string };
    body: { sourcePath: string };
    response: UploadResponse;
    status: 202;
  };
  'GET /api/database/tables': { response: DatabaseTable[] };
  'GET /api/database/tables/{table}': {
    path: { table: string };
    query: { page?: number; size?: number };
    response: DatabasePage;
  };
  'GET /api/database/tables/{table}/{id}': { path: { table: string; id: string }; response: DatabaseRow };
  'DELETE /api/database/tables/deployment-records/{deploymentId}': {
    path: { deploymentId: string };
    response: void;
    status: 204;
  };
  'DELETE /api/database/tables/deployment-records/truncate': { response: void; status: 204 };
  'DELETE /api/database/tables/latest-profile-deployments/truncate': { response: void; status: 204 };
  'DELETE /api/database/tables/runtime-resources/truncate': { response: void; status: 204 };
  'DELETE /api/database/tables/deployment-snapshots/truncate': { response: void; status: 204 };
}

export interface SseRoutes {
  'GET /api/users/queue/events': {
    event: 'PORTAL_QUEUE_STATUS';
    data: PortalSessionResponse;
  };
  'GET /api/system/events': {
    event: SystemEvent['eventType'] | 'PROFILE_LOG';
    data: SystemEvent | ProfileLogEvent;
  };
  'GET /api/terminals/{deploymentId}/events': {
    path: { deploymentId: string };
    event: 'TERMINAL_OUTPUT';
    data: TerminalOutputEvent;
  };
  'GET /api/uat-builds/operations/{operationId}': {
    path: { operationId: string };
    event: UatSseEventName;
    data: UatOperationResponse;
  };
}

/* Error responses: every non-stream API route can return ApiError. Common
 * statuses are 400 INVALID_REQUEST, 409 conflict, 423 RESOURCE_LOCKED, and
 * 500 INTERNAL_ERROR. Jar validation can return JAR_NOT_EXECUTABLE or
 * INVALID_HEALTH_URL. Treat nullable fields as potentially absent only for
 * UatOperationResponse, where Jackson omits null values. */
