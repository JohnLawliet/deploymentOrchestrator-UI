import { activeOperationIdOf } from './deploymentIdentity';
import type {
  FrontendProfileActivity,
  JarProfileActivity,
  JarRuntimeResource,
  Profile,
  RuntimeResource,
  SystemSnapshot,
  WildflyProfileActivity,
} from '@/types/api-contracts';
import type { FrontendProfileActivityModel, RuntimeActivityModel } from '@/types/frontend';

type WildflyActivity = RuntimeActivityModel;
type JarActivity = RuntimeActivityModel;
type RuntimeActivityInput = Partial<RuntimeResource & JarRuntimeResource> & {
  id?: string | null;
  profileName?: string | null;
  name?: string | null;
  status?: RuntimeActivityModel['status'];
  health?: RuntimeActivityModel['health'];
  offset?: number | null;
  portOffset?: number | null;
  lastDeploymentOn?: string | null;
  lastSuccessfulDeploymentOn?: string | null;
  lastUpdatedOn?: string | null;
  serverLogAvailable?: boolean;
  applicationName?: string | null;
  jarName?: string | null;
  applicationPort?: number | null;
  servicePort?: number | null;
  readinessStatus?: RuntimeActivityModel['readinessStatus'];
  terminalDeploymentId?: string | null;
};
type DashboardProfileInput = Partial<Profile> & {
  id?: string | null;
  name?: string | null;
  profileName?: string | null;
  status?: RuntimeActivityModel['status'];
  health?: RuntimeActivityModel['health'];
};
type FrontendProfileInput = Partial<FrontendProfileActivity> & {
  profileUuid?: string | null;
  profileName?: string | null;
  port?: number | null;
  associatedJar?: {
    id?: string | null;
    jarProfileUuid?: string | null;
    applicationName?: string | null;
    jarName?: string | null;
    artifactName?: string | null;
  };
  lastDeployment?: { deployedBy?: string | null; deployedAt?: string | null };
};

const resourceId = (resource: RuntimeActivityInput) =>
  String(resource?.profileUuid || resource?.id || resource?.resourceKey || '').replace(/^(WILDFLY_PROFILE|JAR):/, '');
const preferDefined = <T>(value: T | undefined, fallback: T | undefined): T | undefined =>
  value === undefined ? fallback : value;

const definedFields = <T extends object>(fields: T): T => {
  const result = { ...fields };
  Object.entries(result).forEach(([key, value]) => {
    if (value === undefined) Reflect.deleteProperty(result, key);
  });
  return result;
};

export function normalizeFrontendProfile(profile: FrontendProfileInput): FrontendProfileActivityModel | null {
  if (!profile.profileUuid || !profile.profileName || typeof profile.port !== 'number') return null;
  const associatedJar = profile.associatedJar;
  const lastDeployment = profile.lastDeployment;
  return definedFields({
    profileUuid: profile.profileUuid,
    profileName: profile.profileName,
    port: profile.port,
    documentRoot: profile.documentRoot,
    serverName: profile.serverName,
    frontendUrl: profile.frontendUrl,
    jarProfileUuid: preferDefined(profile.jarProfileUuid, associatedJar?.id ?? associatedJar?.jarProfileUuid),
    applicationName: preferDefined(profile.applicationName, associatedJar?.applicationName),
    jarName: preferDefined(profile.jarName, associatedJar?.jarName ?? associatedJar?.artifactName),
    lastDeployedUser: preferDefined(profile.lastDeployedUser, lastDeployment?.deployedBy),
    lastDeploymentOn: preferDefined(profile.lastDeploymentOn, lastDeployment?.deployedAt),
    health: profile.health,
    healthReason: profile.healthReason,
    directoryExists: profile.directoryExists,
    running: profile.running,
  });
}

export function normalizeDashboardProfile(profile: DashboardProfileInput): WildflyActivity | null {
  if (!profile.id) return null;
  const failedDeployCount = Number(profile.failedDeployCount);
  return definedFields({
    id: profile.id,
    profileName: profile.profileName ?? profile.name,
    application: profile.application,
    version: profile.version,
    status: profile.status,
    health: profile.health,
    pid: profile.pid,
    activeOperationId: activeOperationIdOf(profile),
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
    serverLogAvailable: profile.serverLogAvailable,
  });
}

export function overlayRuntimeActivity<T extends object>(
  initialActivity: T,
  liveActivity: Partial<RuntimeActivityModel> | null,
): T & Partial<RuntimeActivityModel> {
  if (!liveActivity) return initialActivity;
  return {
    ...initialActivity,
    ...definedFields(liveActivity),
  };
}

export function normalizeRuntimeActivity(resource: RuntimeActivityInput): WildflyActivity | JarActivity | null {
  if (!resourceId(resource)) return null;
  const jar = resource.resourceType === 'JAR' || resource.applicationName !== undefined;
  const frontendProfile =
    resource.frontendProfile === null
      ? null
      : resource.frontendProfile === undefined
        ? undefined
        : normalizeFrontendProfile(resource.frontendProfile);
  return definedFields({
    id: resourceId(resource),
    ...(jar
      ? {
          applicationName: resource.applicationName ?? resource.application,
          jarName: resource.jarName,
          applicationPort: resource.applicationPort,
          javaExecutablePath: resource.javaExecutablePath,
          servicePort: resource.servicePort,
          readinessStatus: resource.readinessStatus ?? resource.readiness,
          readinessReason: resource.readinessReason,
          frontendProfileUuid: resource.frontendProfileUuid,
          frontendUrl: resource.frontendUrl,
          frontendProfile,
          terminalDeploymentId: resource.terminalDeploymentId,
          terminalAvailable: resource.terminalAvailable,
        }
      : {
          profileName: resource.profileName ?? resource.displayName,
          version: resource.version,
          offset: resource.portOffset,
          applicationPort: resource.applicationPort,
          servicePort: resource.servicePort,
          managementPort: resource.managementPort,
          serverLogAvailable: resource.serverLogAvailable,
        }),
    status: resource.state ?? resource.status,
    health: resource.profileHealth ?? resource.health,
    pid: resource.pid,
    deployCount: resource.deployCount,
    failedDeployCount: Number.isFinite(Number(resource.failedDeployCount)) ? Number(resource.failedDeployCount) : 0,
    consecutiveFailures: resource.consecutiveFailures,
    lastDeploymentOn: resource.lastDeploymentOn,
    lastSuccessfulDeploymentOn: resource.lastSuccessfulDeploymentOn,
    lastUpdatedOn: resource.lastCheckedAt ?? resource.lastUpdatedOn,
    lastResult: resource.lastResult,
    activeOperationId: activeOperationIdOf(resource),
  });
}

function normalizeJarProfileActivity(profile: JarProfileActivity): JarActivity {
  const frontendProfile = profile.frontendProfile ? normalizeFrontendProfile(profile.frontendProfile) : profile.frontendProfile;
  return definedFields({
    id: profile.id,
    applicationName: profile.applicationName,
    jarName: profile.jarName,
    status: profile.status,
    health: profile.health,
    pid: profile.pid,
    activeOperationId: profile.activeOperationId,
    terminalDeploymentId: profile.terminalDeploymentId,
    terminalAvailable: profile.terminalAvailable,
    applicationPort: profile.applicationPort,
    javaExecutablePath: profile.javaExecutablePath,
    healthUrl: profile.healthUrl,
    healthReason: profile.healthReason,
    readinessStatus: profile.readiness,
    readinessReason: profile.readinessReason,
    frontendUrl: profile.frontendUrl,
    frontendProfileUuid: profile.frontendProfileUuid,
    frontendProfile,
    deployCount: profile.deployCount,
    consecutiveFailures: profile.consecutiveFailures,
    failedDeployCount: profile.failedDeployCount,
    lastUpdatedOn: profile.lastUpdatedOn,
    lastResult: profile.lastResult,
  });
}

export function normalizeSystemSnapshot(resources: SystemSnapshot): {
  wildflyProfiles: WildflyActivity[];
  jarProfiles: JarActivity[];
  frontendProfiles: FrontendProfileActivityModel[];
} {
  const wildflyProfiles = resources.wildflyProfiles
    .map(normalizeDashboardProfile)
    .filter((profile): profile is WildflyActivity => profile !== null);
  const jarProfiles = resources.jarProfiles.map(normalizeJarProfileActivity);
  const frontendProfiles = resources.frontendProfiles
    .map(normalizeFrontendProfile)
    .filter((profile): profile is FrontendProfileActivityModel => profile !== null);
  return { wildflyProfiles, jarProfiles, frontendProfiles };
}
