export default function JarFrontendDetails({ activity }) {
  const profile = activity?.frontendProfile
  const effectiveUrl = activity?.frontendUrl ?? profile?.frontendUrl
  const associated = Boolean(profile)

  const directoryState = !associated
    ? 'Unknown'
    : profile.directoryExists === true
      ? 'Available'
      : profile.directoryExists === false
        ? 'Missing'
        : 'Unknown'
  const runningState = !associated
    ? 'Unknown'
    : profile.running === true
      ? 'Running'
      : profile.running === false
        ? 'Inactive'
        : 'Unknown'

  return (
    <div className="w-full rounded-md border border-border bg-muted/20 p-3" aria-label="Frontend details">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Frontend
      </p>
      {!associated && (
        <p className="mb-2 text-sm font-medium text-amber-700">
          Frontend profile unresolved
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Profile</dt>
        <dd>{profile?.profileName ?? 'Unavailable'}</dd>
        <dt className="text-muted-foreground">URL</dt>
        <dd className="min-w-0 break-all">
          {effectiveUrl
            ? <a className="text-primary underline-offset-2 hover:underline" href={effectiveUrl} target="_blank" rel="noreferrer">{effectiveUrl}</a>
            : 'Unavailable'}
        </dd>
        <dt className="text-muted-foreground">Context path</dt>
        <dd className="break-all">{activity?.frontendContextPath ?? 'Unavailable'}</dd>
        <dt className="text-muted-foreground">Document root</dt>
        <dd className="break-all">{profile?.documentRoot ?? 'Unavailable'}</dd>
        <dt className="text-muted-foreground">Directory</dt>
        <dd>{directoryState}</dd>
        <dt className="text-muted-foreground">State</dt>
        <dd>{runningState}</dd>
      </dl>
    </div>
  )
}
