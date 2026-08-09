import type { RuntimeActivityModel } from '@/types/frontend';

export function hasAuthoritativeFrontendAssociation(activity: RuntimeActivityModel | null | undefined): boolean {
  const profile = activity?.frontendProfile;
  const effectiveUrl = activity?.frontendUrl ?? profile?.frontendUrl;
  return Boolean(profile?.profileUuid && profile.profileName && profile.port != null && effectiveUrl && profile.documentRoot);
}

export default function JarFrontendDetails({ activity }: { activity: RuntimeActivityModel | null | undefined }) {
  const profile = activity?.frontendProfile;
  const effectiveUrl = activity?.frontendUrl ?? profile?.frontendUrl;
  const associated = hasAuthoritativeFrontendAssociation(activity);

  const directoryState =
    profile?.directoryExists === true ? 'Available' : profile?.directoryExists === false ? 'Missing' : 'Unknown';
  const runningState = profile?.running === true ? 'Running' : profile?.running === false ? 'Inactive' : 'Unknown';
  const healthState = profile?.health ?? 'Unknown';

  if (!associated || !profile) {
    return (
      <div className="w-full rounded-md border border-border bg-muted/20 p-3" aria-label="Frontend details">
        <p className="text-sm font-medium text-amber-700">
          JAR wasn't associated with frontend during deployment. Redeploy with frontend setup
        </p>
      </div>
    );
  }

  return (
    <div className="w-full rounded-md border border-border bg-muted/20 p-3" aria-label="Frontend details">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Frontend</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Profile</dt>
        <dd>{profile?.profileName ?? 'Unavailable'}</dd>
        <dt className="text-muted-foreground">URL</dt>
        <dd className="min-w-0 break-all">
          {effectiveUrl ? (
            <a className="text-primary underline-offset-2 hover:underline" href={effectiveUrl} target="_blank" rel="noreferrer">
              {effectiveUrl}
            </a>
          ) : (
            'Unavailable'
          )}
        </dd>
        <dt className="text-muted-foreground">Document root</dt>
        <dd className="break-all">{profile?.documentRoot ?? 'Unavailable'}</dd>
        <dt className="text-muted-foreground">Directory</dt>
        <dd>{directoryState}</dd>
        <dt className="text-muted-foreground">Health</dt>
        <dd>{healthState}</dd>
        {profile?.healthReason && (
          <>
            <dt className="text-muted-foreground">Health reason</dt>
            <dd className="break-all">{profile.healthReason}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Running</dt>
        <dd>{runningState}</dd>
        <dt className="text-muted-foreground">Current JAR</dt>
        <dd>{profile.jarName || profile.applicationName || activity?.jarName || activity?.applicationName || 'Unavailable'}</dd>
        <dt className="text-muted-foreground">Last frontend deployment</dt>
        <dd>
          {profile.lastDeployedUser || profile.lastDeploymentOn
            ? `${profile.lastDeployedUser || 'Unknown user'}${profile.lastDeploymentOn ? ` · ${new Date(profile.lastDeploymentOn).toLocaleString()}` : ''}`
            : 'Unavailable'}
        </dd>
      </dl>
    </div>
  );
}
