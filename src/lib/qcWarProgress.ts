import type { OperationProgress } from '@/types/api-contracts';

export type QcWarTimelineStep = {
  id: string;
  label: string;
  description: string;
  phaseCodes: readonly string[];
};

type QcWarPhase = {
  label: string;
  percentage?: number;
  timelineId?: string;
};

export const QC_WAR_PHASES: Readonly<Record<string, QcWarPhase>> = {
  WAR_EXTRACTING: { label: 'Extracting inbound WAR', percentage: 20, timelineId: 'extract' },
  QC_MERGING: { label: 'Applying QC configuration', percentage: 30, timelineId: 'configure' },
  QC_STAGING_READY: { label: 'QC staging completed', percentage: 45, timelineId: 'configure' },
  PROFILE_STOPPING: { label: 'Stopping WildFly', percentage: 55, timelineId: 'stop' },
  SNAPSHOT_RELOCATING: { label: 'Moving current deployment to backup', percentage: 65, timelineId: 'backup' },
  SNAPSHOT_READY: { label: 'Backup secured', timelineId: 'backup' },
  DATASOURCE_UPDATING: { label: 'Updating datasource', percentage: 70, timelineId: 'datasource' },
  ARCHIVE_INSTALLING: { label: 'Installing exploded WAR', percentage: 75, timelineId: 'install' },
  ARCHIVE_INSTALLED: { label: 'Exploded WAR installed', timelineId: 'install' },
  PROFILE_STARTING: { label: 'Starting WildFly', percentage: 80, timelineId: 'start' },
  DEPLOYMENT_MARKER_WAIT: { label: 'Waiting for WildFly deployment result', percentage: 90, timelineId: 'wait' },
  HEALTH_VERIFYING: { label: 'Verifying application health', percentage: 95, timelineId: 'health' },
  ROLLBACK_STARTED: { label: 'Restoring previous deployment' },
  ROLLBACK_COMPLETED: { label: 'Rollback completed' },
  COMPLETED: { label: 'Deployment completed', percentage: 100 },
  FAILED: { label: 'Deployment failed' },
  FAILURE_DETECTED: { label: 'Deployment failure detected' },
};

export const QC_WAR_TIMELINE: readonly QcWarTimelineStep[] = [
  {
    id: 'extract',
    label: 'Extract WAR',
    description: 'Unpacks the selected Tech Drive WAR into a staging directory.',
    phaseCodes: ['WAR_EXTRACTING'],
  },
  {
    id: 'configure',
    label: 'Apply QC configuration',
    description: 'Merges QC configuration into the staged WAR and finishes staging.',
    phaseCodes: ['QC_MERGING', 'QC_STAGING_READY'],
  },
  {
    id: 'stop',
    label: 'Stop profile',
    description: 'Stops the target WildFly profile so the deployment can be replaced safely.',
    phaseCodes: ['PROFILE_STOPPING'],
  },
  {
    id: 'backup',
    label: 'Secure backup',
    description: 'Moves the current deployment aside as a rollback snapshot.',
    phaseCodes: ['SNAPSHOT_RELOCATING', 'SNAPSHOT_READY'],
  },
  {
    id: 'datasource',
    label: 'Update datasource, if requested',
    description: 'Updates the profile datasource when the deploy requested a change; otherwise this step is skipped.',
    phaseCodes: ['DATASOURCE_UPDATING'],
  },
  {
    id: 'install',
    label: 'Install deployment',
    description: 'Installs the prepared exploded WAR into the profile deployment location.',
    phaseCodes: ['ARCHIVE_INSTALLING', 'ARCHIVE_INSTALLED'],
  },
  {
    id: 'start',
    label: 'Start profile',
    description: 'Starts WildFly for the profile with the new deployment.',
    phaseCodes: ['PROFILE_STARTING'],
  },
  {
    id: 'wait',
    label: 'Wait for WildFly',
    description: 'Waits for WildFly to report the deployment marker / result.',
    phaseCodes: ['DEPLOYMENT_MARKER_WAIT'],
  },
  {
    id: 'health',
    label: 'Verify health',
    description: 'Checks that the application is healthy after startup.',
    phaseCodes: ['HEALTH_VERIFYING'],
  },
];

export const qcWarPhase = (phaseCode: string | null | undefined): QcWarPhase | null =>
  (phaseCode && QC_WAR_PHASES[phaseCode]) || null;

export const qcWarPhaseLabel = (phaseCode: string | null | undefined): string | null => qcWarPhase(phaseCode)?.label || null;

export const isRollbackPhase = (phaseCode: string | null | undefined): boolean =>
  phaseCode === 'ROLLBACK_STARTED' || phaseCode === 'ROLLBACK_COMPLETED';

export const isFailureProgress = (progress: Pick<OperationProgress, 'phaseCode' | 'status'>): boolean =>
  progress.phaseCode === 'FAILED' || progress.phaseCode === 'FAILURE_DETECTED' || progress.status === 'FAILED';
