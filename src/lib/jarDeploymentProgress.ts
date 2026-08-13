type JarDeploymentTimelineStep = {
  id: string;
  label: string;
  description: string;
  phaseCodes: readonly string[];
  frontendOnly?: boolean;
};

type JarDeploymentPhase = {
  label: string;
  timelineId?: string;
};

export const JAR_DEPLOYMENT_PHASES: Readonly<Record<string, JarDeploymentPhase>> = {
  METADATA_RESOLVED: { label: 'Resolving deployment metadata', timelineId: 'initialize' },
  RECORD_CREATED: { label: 'Creating deployment record', timelineId: 'initialize' },
  TERMINAL_REGISTERING: { label: 'Registering terminal output', timelineId: 'initialize' },
  TERMINAL_REGISTERED: { label: 'Terminal output registered', timelineId: 'initialize' },
  RUNTIME_REPOSITORY_UPDATING: { label: 'Updating runtime repository', timelineId: 'initialize' },
  RUNTIME_CACHE_UPDATING: { label: 'Updating runtime cache', timelineId: 'initialize' },
  RUNTIME_STATE_PUBLISHING: { label: 'Publishing runtime state', timelineId: 'initialize' },
  TASK_SUBMITTING: { label: 'Submitting deployment task', timelineId: 'initialize' },
  TASK_QUEUED: { label: 'Deployment task queued', timelineId: 'initialize' },
  VALIDATING: { label: 'Validating deployment', timelineId: 'lock' },
  LOCK_SECURED: { label: 'Deployment lock secured', timelineId: 'lock' },
  LOCKS_VERIFIED: { label: 'Deployment locks verified', timelineId: 'lock' },
  FRONTEND_STAGING: { label: 'Staging frontend files', timelineId: 'frontend-stage' },
  SNAPSHOT_CREATING: { label: 'Creating JAR snapshot', timelineId: 'snapshot' },
  SNAPSHOT_READY: { label: 'JAR snapshot ready', timelineId: 'snapshot' },
  APPLICATION_STOPPING: { label: 'Stopping application', timelineId: 'stop' },
  ARTIFACT_COPYING: { label: 'Copying JAR artifact', timelineId: 'deploy' },
  APPLICATION_STARTING: { label: 'Starting application', timelineId: 'start' },
  HEALTH_VERIFYING: { label: 'Verifying application health', timelineId: 'health' },
  FRONTEND_PUBLISHING: { label: 'Publishing frontend files', timelineId: 'frontend-publish' },
  COMPLETED: { label: 'Deployment completed', timelineId: 'finalize' },
  ROLLBACK_STARTED: { label: 'Restoring previous JAR deployment' },
  ROLLBACK_COMPLETED: { label: 'JAR rollback completed' },
  FAILED: { label: 'Deployment failed' },
  CLEANUP: { label: 'Cleaning up deployment resources', timelineId: 'finalize' },
};

const BASE_JAR_DEPLOYMENT_TIMELINE: readonly JarDeploymentTimelineStep[] = [
  {
    id: 'initialize',
    label: 'Initialize deployment',
    description:
      'Resolves metadata, creates the deployment record, registers terminal/runtime state, and queues the deploy task.',
    phaseCodes: [
      'METADATA_RESOLVED',
      'RECORD_CREATED',
      'TERMINAL_REGISTERING',
      'TERMINAL_REGISTERED',
      'RUNTIME_REPOSITORY_UPDATING',
      'RUNTIME_CACHE_UPDATING',
      'RUNTIME_STATE_PUBLISHING',
      'TASK_SUBMITTING',
      'TASK_QUEUED',
    ],
  },
  {
    id: 'lock',
    label: 'Validate and secure locks',
    description: 'Validates the request and acquires/verifies exclusive locks for this deployment.',
    phaseCodes: ['VALIDATING', 'LOCK_SECURED', 'LOCKS_VERIFIED'],
  },
  {
    id: 'frontend-stage',
    label: 'Stage frontend files',
    description: 'Stages associated frontend files when a frontend deploy was requested.',
    phaseCodes: ['FRONTEND_STAGING'],
    frontendOnly: true,
  },
  {
    id: 'snapshot',
    label: 'Create snapshot, if replacing',
    description: 'Creates a JAR snapshot before replace so rollback is possible; skipped on a fresh install.',
    phaseCodes: ['SNAPSHOT_CREATING', 'SNAPSHOT_READY'],
  },
  {
    id: 'stop',
    label: 'Stop application',
    description: 'Stops the running application process.',
    phaseCodes: ['APPLICATION_STOPPING'],
  },
  {
    id: 'deploy',
    label: 'Deploy JAR artifact',
    description: 'Copies the new JAR into the runtime location.',
    phaseCodes: ['ARTIFACT_COPYING'],
  },
  {
    id: 'start',
    label: 'Start application',
    description: 'Starts the application using the new artifact.',
    phaseCodes: ['APPLICATION_STARTING'],
  },
  {
    id: 'health',
    label: 'Verify application health',
    description: 'Confirms the application started and is healthy.',
    phaseCodes: ['HEALTH_VERIFYING'],
  },
  {
    id: 'frontend-publish',
    label: 'Publish frontend files',
    description: 'Publishes staged frontend files to the live location when a frontend deploy was requested.',
    phaseCodes: ['FRONTEND_PUBLISHING'],
    frontendOnly: true,
  },
  {
    id: 'finalize',
    label: 'Complete and clean up',
    description: 'Marks the operation complete and cleans up temporary deployment resources.',
    phaseCodes: ['COMPLETED', 'CLEANUP'],
  },
];

export const jarDeploymentTimeline = (frontendDeploymentRequested: boolean): readonly JarDeploymentTimelineStep[] =>
  BASE_JAR_DEPLOYMENT_TIMELINE.filter((step) => frontendDeploymentRequested || !step.frontendOnly);

export const jarDeploymentPhase = (phaseCode: string | null | undefined): JarDeploymentPhase | null =>
  (phaseCode && JAR_DEPLOYMENT_PHASES[phaseCode]) || null;

export const jarDeploymentPhaseLabel = (phaseCode: string | null | undefined): string | null =>
  jarDeploymentPhase(phaseCode)?.label || null;

export const isJarDeploymentPhase = (phaseCode: string | null | undefined): boolean => !!jarDeploymentPhase(phaseCode);
