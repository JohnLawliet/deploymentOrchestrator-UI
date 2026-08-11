import type {
  DeploymentRecord,
  DeploymentStartResponse,
  DeploymentStatus,
  OperationProgress,
  ProfileHealth,
  ProfileLogEvent,
  ResourceState,
  RuntimeReadiness,
  SystemEvent,
  UatOperationResponse,
  UploadOperationStatus,
  WarDeploymentStartResponse,
} from './api-contracts';

/** UI activity cards combine the server's profile and runtime resource views. */
export interface RuntimeActivityModel {
  id: string;
  profileName?: string | null;
  applicationName?: string | null;
  jarName?: string | null;
  version?: string | null;
  application?: string | null;
  status?: ResourceState | null;
  health?: ProfileHealth | null;
  pid?: number | null;
  activeOperationId?: string | null;
  terminalDeploymentId?: string | null;
  terminalAvailable?: boolean;
  serverLogAvailable?: boolean;
  offset?: number | null;
  applicationPort?: number | null;
  javaExecutablePath?: string | null;
  managementPort?: number | null;
  servicePort?: number | null;
  readiness?: RuntimeReadiness | null;
  readinessStatus?: RuntimeReadiness | null;
  readinessReason?: string | null;
  healthUrl?: string | null;
  healthReason?: string | null;
  frontendUrl?: string | null;
  frontendProfileUuid?: string | null;
  frontendProfile?: FrontendProfileActivityModel | null;
  deployCount?: number | null;
  consecutiveFailures?: number | null;
  failedDeployCount?: number | null;
  lastDeploymentOn?: string | null;
  lastSuccessfulDeploymentOn?: string | null;
  lastUpdatedOn?: string | null;
  lastResult?: string | null;
  hasBackup?: boolean | null;
  backupSnapshotId?: number | null;
}

export interface FrontendProfileActivityModel {
  profileUuid: string;
  profileName: string;
  port: number;
  documentRoot?: string | null;
  serverName?: string | null;
  frontendUrl?: string | null;
  jarProfileUuid?: string | null;
  applicationName?: string | null;
  jarName?: string | null;
  lastDeployedUser?: string | null;
  lastDeploymentOn?: string | null;
  health?: string | null;
  healthReason?: string | null;
  directoryExists?: boolean;
  running?: boolean;
}

export type AsyncState = 'idle' | 'loading' | 'ready' | 'error' | 'expired';
export type OperationStatus =
  | DeploymentStatus
  | ResourceState
  | DeploymentStartResponse['status']
  | WarDeploymentStartResponse['status']
  | UploadOperationStatus
  | UatOperationResponse['status'];

export interface OperationProgressState extends Omit<OperationProgress, 'status'> {
  status: string | null;
  message: string | null;
  timestamp: string;
  resourceKey: string | null;
  resourceType: string | null;
  username: string | null;
  firstReceivedAt: number;
  receivedAt: number;
  revision: number;
  eventKeys: string[];
  steps: Array<Omit<OperationProgress, 'status'> & { status: string | null; timestamp: string; message: string | null }>;
  deploymentOutcome?: 'SUCCEEDED' | 'FAILED' | null;
  failureMessage?: string | null;
  rollbackState?: 'RESTORING' | 'RESTORED' | 'FAILED' | null;
  rollbackMessage?: string | null;
  rollbackFailureMessage?: string | null;
}

export interface OperationRecord {
  deploymentId: string;
  status?: OperationStatus;
  type?: DeploymentRecord['type'];
  username?: string;
  application?: string | null;
  environment?: string | null;
  profile?: string | null;
  sourcePath?: string | null;
  targetPath?: string | null;
  currentStep?: string;
  progressPercentage?: number;
  startTime?: string;
  endTime?: string | null;
  errorMessage?: string | null;
  rollbackResult?: string | null;
  snapshotId?: number | null;
  applicationVersion?: number | null;
  terminalEventsUrl?: string | null;
  hasBackup?: boolean;
  backupSnapshotId?: number | null;
  resourceKey?: string;
  resourceType?: string | null;
  profileId?: string;
  applicationName?: string | null;
  label?: string;
  registered?: boolean;
  operationType?: string;
  statusEvent?: string;
  outputRequested?: boolean;
  terminalAvailabilityConfirmed?: boolean;
  logAvailable?: boolean;
  profileLogUnavailable?: boolean;
  frontendWarning?: string | null;
  message?: string | null;
  state?: string | null;
  rollbackMessage?: string | null;
  restoredResourceState?: 'ACTIVE' | 'INACTIVE' | null;
  progress?: OperationProgressState;
  resources?: SystemEvent['resources'];
}

export type OperationMap = Record<string, OperationRecord>;
export type ProfileLogMap = Record<string, ProfileLogEvent[]>;

export interface OperationToast {
  id: string;
  heading: string;
  username: string;
  targetLabel: string;
  deploymentId: string;
  outcome: string;
}

export const errorMessage = (reason: unknown, fallback = 'The request could not be completed.'): string =>
  reason instanceof Error && reason.message ? reason.message : fallback;
