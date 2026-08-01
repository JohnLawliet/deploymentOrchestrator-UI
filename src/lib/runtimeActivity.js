import { currentDeploymentIdOf } from './deploymentIdentity'

const resourceId = (resource) => String(resource?.profileUuid || resource?.id || resource?.resourceKey || '')
  .replace(/^(WILDFLY_PROFILE|JAR):/, '')

const definedFields = (fields) => Object.fromEntries(
  Object.entries(fields).filter(([, value]) => value !== undefined),
)

export function normalizeDashboardProfile(profile) {
  if (!profile?.id) return null
  const failedDeployCount = Number(profile.failedDeployCount)
  return definedFields({
    id: profile.id,
    profileName: profile.profileName ?? profile.name,
    application: profile.application,
    version: profile.version,
    status: profile.status,
    health: profile.health,
    pid: profile.pid,
    currentDeploymentId: currentDeploymentIdOf(profile),
    offset: profile.offset ?? profile.portOffset,
    applicationPort: profile.applicationPort,
    managementPort: profile.managementPort,
    deployCount: profile.deployCount,
    failedDeployCount: Number.isFinite(failedDeployCount) ? failedDeployCount : 0,
    consecutiveFailures: profile.consecutiveFailures,
    lastDeploymentOn: profile.lastDeploymentOn,
    lastSuccessfulDeploymentOn: profile.lastSuccessfulDeploymentOn,
    lastUpdatedOn: profile.lastUpdatedOn,
    lastResult: profile.lastResult,
    hasBackup: profile.hasBackup,
    backupSnapshotId: Object.prototype.hasOwnProperty.call(profile, 'backupSnapshotId')
      ? profile.backupSnapshotId
      : undefined,
    serverLogAvailable: profile.serverLogAvailable,
  })
}

export function overlayRuntimeActivity(initialActivity, liveActivity) {
  if (!liveActivity) return initialActivity
  return {
    ...initialActivity,
    ...definedFields(liveActivity),
  }
}

export function normalizeRuntimeActivity(resource) {
  if (!resource || !resourceId(resource)) return null
  const jar = resource.resourceType === 'JAR' || 'applicationName' in resource
  return definedFields({
    id: resourceId(resource),
    ...(jar
      ? {
          applicationName: resource.applicationName || resource.application || resource.displayName,
          jarName: resource.jarName || resource.displayName,
          frontendUrl: resource.frontendUrl,
          frontendContextPath: resource.frontendContextPath,
        }
      : {
          profileName: resource.profileName || resource.displayName,
          version: resource.version,
          offset: resource.portOffset,
          applicationPort: resource.applicationPort,
          managementPort: resource.managementPort,
          serverLogAvailable: resource.serverLogAvailable,
        }),
    status: resource.state ?? resource.status,
    health: resource.profileHealth ?? resource.health,
    pid: resource.pid,
    deployCount: resource.deployCount,
    failedDeployCount: Number.isFinite(Number(resource.failedDeployCount))
      ? Number(resource.failedDeployCount)
      : 0,
    consecutiveFailures: resource.consecutiveFailures,
    lastDeploymentOn: resource.lastDeploymentOn,
    lastSuccessfulDeploymentOn: resource.lastSuccessfulDeploymentOn,
    lastUpdatedOn: resource.lastCheckedAt ?? resource.lastUpdatedOn,
    lastResult: resource.lastResult,
    currentDeploymentId: currentDeploymentIdOf(resource),
    ...(jar ? {} : {
      hasBackup: resource.hasBackup,
      backupSnapshotId: Object.prototype.hasOwnProperty.call(resource, 'backupSnapshotId')
        ? resource.backupSnapshotId
        : undefined,
    }),
  })
}

export function normalizeSystemSnapshot(resources) {
  const wildflyProfiles = (Array.isArray(resources?.wildflyProfiles) ? resources.wildflyProfiles : [])
    .map(normalizeDashboardProfile)
    .filter(Boolean)
  const jarProfiles = (Array.isArray(resources?.jarProfiles) ? resources.jarProfiles : [])
    .map(normalizeRuntimeActivity)
    .filter(Boolean)
  return { wildflyProfiles, jarProfiles }
}
