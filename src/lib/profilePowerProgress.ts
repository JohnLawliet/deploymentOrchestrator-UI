export type ProfilePowerOperationType = 'PROFILE_START' | 'PROFILE_STOP';

export type ProfilePowerTimelineStep = {
  id: string;
  label: string;
  description: string;
  phaseCodes: readonly string[];
};

type ProfilePowerPhase = {
  label: string;
  timelineId?: string;
};

export const PROFILE_POWER_PHASES: Readonly<Record<string, ProfilePowerPhase>> = {
  PROFILE_PREPARING: { label: 'Preparing profile runtime', timelineId: 'prepare' },
  PROFILE_STARTING: { label: 'Starting WildFly', timelineId: 'start' },
  DEPLOYMENT_MARKER_WAIT: { label: 'Waiting for WAR deployment', timelineId: 'wait' },
  HEALTH_VERIFYING: { label: 'Verifying application health', timelineId: 'health' },
  PROFILE_STOPPING: { label: 'Stopping WildFly', timelineId: 'stop' },
  COMPLETED: { label: 'Operation completed', timelineId: 'complete' },
  FAILED: { label: 'Operation failed' },
};

const START_TIMELINE: readonly ProfilePowerTimelineStep[] = [
  {
    id: 'prepare',
    label: 'Prepare profile',
    description: 'Clears the profile runtime log, temporary, and data directories.',
    phaseCodes: ['PROFILE_PREPARING'],
  },
  {
    id: 'start',
    label: 'Start WildFly',
    description: 'Executes the profile launcher and waits for the WildFly process to start.',
    phaseCodes: ['PROFILE_STARTING'],
  },
  {
    id: 'wait',
    label: 'Wait for WAR deployment',
    description: 'Waits for WildFly to finish deploying the application.',
    phaseCodes: ['DEPLOYMENT_MARKER_WAIT'],
  },
  {
    id: 'health',
    label: 'Verify health',
    description: 'Confirms the deployed application is healthy before completing the operation.',
    phaseCodes: ['HEALTH_VERIFYING'],
  },
  {
    id: 'complete',
    label: 'Complete',
    description: 'The profile start operation completed successfully.',
    phaseCodes: ['COMPLETED'],
  },
];

const STOP_TIMELINE: readonly ProfilePowerTimelineStep[] = [
  {
    id: 'stop',
    label: 'Stop WildFly',
    description: 'Requests shutdown and waits for the WildFly profile to stop.',
    phaseCodes: ['PROFILE_STOPPING'],
  },
  {
    id: 'complete',
    label: 'Complete',
    description: 'The profile stop operation completed successfully.',
    phaseCodes: ['COMPLETED'],
  },
];

export const isProfilePowerOperation = (value: string | null | undefined): value is ProfilePowerOperationType =>
  value === 'PROFILE_START' || value === 'PROFILE_STOP';

export const profilePowerTimeline = (operationType: string | null | undefined): readonly ProfilePowerTimelineStep[] =>
  operationType === 'PROFILE_START' ? START_TIMELINE : operationType === 'PROFILE_STOP' ? STOP_TIMELINE : [];

export const profilePowerPhase = (phaseCode: string | null | undefined): ProfilePowerPhase | null =>
  (phaseCode && PROFILE_POWER_PHASES[phaseCode]) || null;

export const profilePowerPhaseLabel = (phaseCode: string | null | undefined): string | null =>
  profilePowerPhase(phaseCode)?.label || null;
