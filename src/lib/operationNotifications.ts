import type { SystemEvent } from '@/types/api-contracts';
import type { OperationToast } from '@/types/frontend';

type CompletionEvent = Extract<SystemEvent, { eventType: 'OPERATION_FINISHED' }>;
type CompletionContext = {
  activityMaps: {
    wildflyProfileActivityMap: Record<string, { profileName?: string | null }>;
    jarProfileActivityMap: Record<string, { applicationName?: string | null }>;
    frontendProfileActivityMap: Record<string, { profileName: string; port: number }>;
  };
  lockLabels: Record<string, string>;
  resolvedResource: { profileName?: string | null; applicationName?: string | null } | null;
};
const resourceId = (event: CompletionEvent): string =>
  event.resources.resourceKey.replace(/^(WILDFLY_PROFILE|JAR|UAT|FILE|UPLOAD):/, '');

const headings = {
  WAR: 'WAR operation',
  JAR: 'JAR operation',
  UAT: 'UAT build',
  HOTFIX: 'Hotfix',
  UPLOAD: 'Upload',
  FILE: 'File operation',
};

const withKind = (value: string | null | undefined, kind: string): string => {
  const label = String(value || '').trim();
  if (!label) return '';
  return new RegExp(`\\b${kind}$`, 'i').test(label) ? label : `${label} ${kind}`;
};

const fileRootLabel = (value: string): string => {
  if (value === 'qc') return 'QC files';
  if (value === 'techDrive') return 'Tech Drive files';
  if (value === 'jenkinsBuild') return 'Jenkins Build files';
  return 'Files';
};

const targetFromMaps = (
  section: string,
  id: string,
  maps: CompletionContext['activityMaps'],
  resolvedResource: CompletionContext['resolvedResource'],
): string | null => {
  if (section === 'JAR') {
    const activity = resolvedResource || maps?.jarProfileActivityMap?.[id];
    return activity?.applicationName ? withKind(activity.applicationName, 'application') : null;
  }
  if (section === 'WAR') {
    const activity = resolvedResource || maps?.wildflyProfileActivityMap?.[id];
    return activity?.profileName ? withKind(activity.profileName, 'profile') : null;
  }
  if (section === 'HOTFIX') {
    const wildfly = resolvedResource || maps?.wildflyProfileActivityMap?.[id];
    if (wildfly?.profileName) return withKind(wildfly.profileName, 'profile');
    const frontend = Object.values(maps?.frontendProfileActivityMap || {}).find(
      (profile) => String(profile.port) === id || profile.profileName === id,
    );
    if (frontend?.profileName) return withKind(frontend.profileName, 'frontend');
  }
  return null;
};

export function formatCompletionNotification(
  event: CompletionEvent,
  { activityMaps, lockLabels, resolvedResource }: CompletionContext,
): OperationToast {
  const details = event.resources;
  const section = String(details.section || 'FILE').toUpperCase();
  const outcome = details.outcome || event.state || 'UNKNOWN';
  const deploymentId = String(details.operationId || event.deploymentId || '');
  const id = resourceId(event);
  const mapped = targetFromMaps(section, id, activityMaps, resolvedResource);
  const remembered = lockLabels?.[deploymentId];
  let targetLabel = mapped;
  if (!targetLabel && section === 'UAT') targetLabel = id ? withKind(id, 'application') : 'UAT application';
  if (!targetLabel && section === 'FILE') targetLabel = fileRootLabel(id);
  if (!targetLabel && remembered && remembered !== id) targetLabel = withKind(remembered, 'target');
  if (!targetLabel) {
    targetLabel =
      section === 'WAR'
        ? 'WildFly profile'
        : section === 'JAR'
          ? 'JAR application'
          : section === 'HOTFIX'
            ? 'Hotfix target'
            : section === 'UPLOAD'
              ? 'Upload target'
              : 'Operation target';
  }
  return {
    id: `${deploymentId}:${outcome}`,
    deploymentId,
    outcome,
    heading: `${headings[section as keyof typeof headings] || 'Operation'} ${String(outcome).toLowerCase()}`,
    username: details.username || event.username || 'Unknown user',
    targetLabel,
  };
}
