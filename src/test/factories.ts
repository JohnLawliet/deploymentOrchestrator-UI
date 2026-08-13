import type {
  FrontendProfileActivity,
  JarProfileActivity,
  LockInfo,
  ProfileLogEvent,
  SystemEvent,
  UploadItem,
  UploadResponse,
  UserPresence,
  WildflyProfileActivity,
} from '@/types/api-contracts';
import type { OperationProgressState, OperationRecord } from '@/types/frontend';

const timestamp = '2026-08-09T00:00:00Z';

export const userPresence = (overrides: Partial<UserPresence> = {}): UserPresence => ({
  username: 'test-user',
  status: 'ACTIVE',
  lastLoginAt: timestamp,
  lastSeenAt: timestamp,
  lastActivity: null,
  lastActivityTime: null,
  lastActivityStatus: null,
  revision: 1,
  ...overrides,
});

export const lockInfo = (overrides: Partial<LockInfo> = {}): LockInfo => ({
  resourceKey: 'profile:test',
  deploymentId: 'deployment-test',
  owner: 'test-user',
  acquiredAt: timestamp,
  expiresAt: null,
  reason: 'Test lock',
  section: 'TEST',
  profile: 'test',
  mode: 'WRITE',
  revision: 1,
  ...overrides,
});

export const wildflyProfileActivity = (overrides: Partial<WildflyProfileActivity> = {}): WildflyProfileActivity => ({
  id: 'profile-test',
  profileName: 'Test profile',
  version: '1.0',
  application: null,
  applicationVersion: null,
  lastDeployedUser: null,
  status: 'INACTIVE',
  health: 'FUNCTIONAL',
  pid: null,
  activeOperationId: null,
  offset: 0,
  applicationPort: 8080,
  managementPort: 9990,
  deployCount: 0,
  consecutiveFailures: 0,
  failedDeployCount: 0,
  lastDeploymentOn: null,
  lastSuccessfulDeploymentOn: null,
  lastUpdatedOn: null,
  lastResult: null,
  ...overrides,
});

export const frontendProfileActivity = (overrides: Partial<FrontendProfileActivity> = {}): FrontendProfileActivity => ({
  profileUuid: 'frontend-test',
  profileName: 'Test frontend',
  port: 3000,
  documentRoot: 'C:/frontend',
  serverName: 'localhost',
  frontendUrl: null,
  jarProfileUuid: null,
  applicationName: null,
  jarName: null,
  lastDeployedUser: null,
  lastDeploymentOn: null,
  health: 'FUNCTIONAL',
  healthReason: null,
  directoryExists: true,
  running: false,
  ...overrides,
});

export const jarProfileActivity = (overrides: Partial<JarProfileActivity> = {}): JarProfileActivity => ({
  id: 'jar-test',
  applicationName: 'test-app',
  status: 'INACTIVE',
  health: 'FUNCTIONAL',
  pid: null,
  activeOperationId: null,
  terminalDeploymentId: null,
  jarName: 'test-app.jar',
  applicationPort: 8081,
  javaExecutablePath: null,
  healthUrl: null,
  healthReason: null,
  readiness: 'NOT_VERIFIED',
  readinessReason: null,
  frontendUrl: null,
  frontendProfileUuid: null,
  deployCount: 0,
  consecutiveFailures: 0,
  failedDeployCount: 0,
  lastUpdatedOn: timestamp,
  lastResult: null,
  frontendProfile: null,
  terminalAvailable: false,
  ...overrides,
});

export const uploadItem = (overrides: Partial<UploadItem> = {}): UploadItem => ({
  sourcePath: 'artifact.zip',
  name: 'artifact.zip',
  kind: 'FILE',
  status: 'READY',
  targetPath: null,
  candidates: [],
  message: null,
  rollbackAvailable: false,
  ...overrides,
});

export const uploadResponse = (overrides: Partial<UploadResponse> = {}): UploadResponse => ({
  operationId: 'upload-test',
  mode: 'REGULAR',
  status: 'READY',
  message: null,
  restartRequired: false,
  restartStatus: 'NOT_REQUIRED',
  createdAt: timestamp,
  completedAt: null,
  items: [],
  ...overrides,
});

export const profileLogEvent = (overrides: Partial<ProfileLogEvent> = {}): ProfileLogEvent => ({
  profileId: 'profile-test',
  timestamp,
  line: 'Test output',
  replay: false,
  boundaryReason: null,
  ...overrides,
});

export const operationProgressState = (overrides: Partial<OperationProgressState> = {}): OperationProgressState => ({
  phaseCode: 'PREPARING',
  status: 'PREPARING',
  progressPercentage: null,
  component: null,
  message: null,
  timestamp,
  resourceKey: null,
  resourceType: null,
  username: null,
  firstReceivedAt: 0,
  receivedAt: 0,
  revision: 0,
  eventKeys: [],
  steps: [],
  ...overrides,
});

export const operationRecord = (overrides: Partial<OperationRecord> = {}): OperationRecord => ({
  deploymentId: 'deployment-test',
  ...overrides,
});

export const systemEvent = <T extends SystemEvent>(overrides: Partial<T> & Pick<T, 'eventType' | 'resources'>): T =>
  ({
    timestamp,
    deploymentId: null,
    resourceKey: null,
    resourceType: null,
    state: null,
    pid: null,
    activeOperationId: null,
    deployCount: null,
    consecutiveFailures: null,
    failedDeployCount: null,
    lastResult: null,
    username: null,
    message: null,
    application: null,
    readiness: null,
    readinessReason: null,
    ...overrides,
  }) as T;
