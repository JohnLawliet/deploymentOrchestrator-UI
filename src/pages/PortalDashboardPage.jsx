import { useEffect, useId, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Eye,
  Loader2,
  Power,
  RefreshCw,
  RotateCcw,
  Server,
  X,
} from "lucide-react";
import {
  getJars,
  getProfiles,
  isLockConflict,
  restartJar,
  startProfile,
  stopProfile,
} from "@/lib/contractApi";
import {
  normalizeDashboardProfile,
  overlayRuntimeActivity,
} from "@/lib/runtimeActivity";
import { usePortal } from "@/context/PortalContext";
import RollbackButton from "@/components/RollbackButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Notice, Page } from "@/components/PagePrimitives";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const busyStates = new Set(["STARTING", "STOPPING", "DEPLOYING"]);

export default function PortalDashboardPage() {
  const {
    wildflyProfileActivityMap,
    jarProfileActivityMap,
    replaceProfileActivities,
    reconcileResourceActivity,
    registerOperation,
    setViewingOperation,
    operations,
  } = usePortal();
  const [jars, setJars] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [version, setVersion] = useState("");
  const [profileQuery, setProfileQuery] = useState("");
  const [debouncedProfileQuery, setDebouncedProfileQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState("");
  const [refresh, setRefresh] = useState(0);
  const versions = useMemo(
    () => [...new Set(profiles.map((p) => p.version).filter(Boolean))],
    [profiles],
  );
  const versionProfiles = useMemo(
    () => profiles.filter((profile) => profile.version === version),
    [profiles, version],
  );
  const filteredProfiles = useMemo(() => {
    const query = debouncedProfileQuery.trim().toLocaleLowerCase();
    if (!query) return versionProfiles;
    return versionProfiles.filter((profile) =>
      [profile.name, profile.id].some((value) =>
        String(value || "")
          .toLocaleLowerCase()
          .includes(query),
      ),
    );
  }, [debouncedProfileQuery, versionProfiles]);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedProfileQuery(profileQuery),
      400,
    );
    return () => window.clearTimeout(timer);
  }, [profileQuery]);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError("");
    Promise.all([getJars(), getProfiles()])
      .then(([jarItems, profileItems]) => {
        if (disposed) return;
        const nextJars = Array.isArray(jarItems) ? jarItems : [];
        const nextProfiles = Array.isArray(profileItems) ? profileItems : [];
        setJars(nextJars);
        setProfiles(nextProfiles);
        replaceProfileActivities(nextProfiles);
        setVersion(
          (current) =>
            current || nextProfiles.find((p) => p.version)?.version || "",
        );
        setLoading(false);
        const reconciliations = [
          ...nextJars
            .filter((jar) => jar.id)
            .map((jar) => reconcileResourceActivity(`JAR:${jar.id}`)),
        ];
        void Promise.allSettled(reconciliations);
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [refresh, reconcileResourceActivity, replaceProfileActivities]);

  const runRestart = async (key, action, label, warning) => {
    if (!window.confirm(warning)) return;
    setSubmitting(key);
    setError("");
    try {
      registerOperation(await action(), key, label);
    } catch (e) {
      setError(
        isLockConflict(e) ? `Resource conflict: ${e.message}` : e.message,
      );
    } finally {
      setSubmitting("");
    }
  };

  const viewOutput = (activity, label, resourceType) => {
    const resolvedResourceType = resourceType
      || ("applicationName" in activity ? "JAR" : "WILDFLY_PROFILE");
    const deploymentId = activity?.currentDeploymentId;
    if (resolvedResourceType === "JAR" && !deploymentId) return;
    if (resolvedResourceType === "WILDFLY_PROFILE" && !activity?.serverLogAvailable) return;
    const resourceKey = `${resolvedResourceType}:${activity.id}`;
    setViewingOperation(
      {
        ...(operations[deploymentId] || {}),
        ...(deploymentId ? { deploymentId } : {}),
        resourceKey,
        resourceType: resolvedResourceType,
        ...(resolvedResourceType === "WILDFLY_PROFILE"
          ? { profileId: activity.id, outputRequested: true }
          : {}),
        status: activity.status,
        label,
      },
    );
  };

  const runProfilePower = async (profile, activity) => {
    const key = `WILDFLY_PROFILE:${profile.id}`;
    const active = activity.status === "ACTIVE";
    const verb = active ? "Stop" : "Start";
    if (!window.confirm(`${verb} ${profile.name}?`)) return;
    setSubmitting(key);
    setError("");
    try {
      if (active) await stopProfile(profile.id);
      else await startProfile(profile.id);
      await reconcileResourceActivity(key);
    } catch (reason) {
      setError(isLockConflict(reason) ? `Resource conflict: ${reason.message}` : reason.message);
    } finally {
      setSubmitting("");
    }
  };

  const changeVersion = (nextVersion) => {
    setVersion(nextVersion);
    setProfileQuery("");
    setDebouncedProfileQuery("");
  };

  const changeProfileQuery = (nextQuery) => {
    setProfileQuery(nextQuery);
    if (!nextQuery) setDebouncedProfileQuery("");
  };

  const selectProfile = (profile) => {
    setProfileQuery(profile.name);
    setDebouncedProfileQuery(profile.name);
  };

  return (
    <Page
      title="Dashboard"
      description="Live QC resource inventory and restart controls."
    >
      <div className="flex justify-end mb-4">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setRefresh((v) => v + 1)}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh activity
        </Button>
      </div>
      {loading && (
        <div className="py-16 text-center text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
          Loading inventory…
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {!loading && (
        <div className="space-y-8">
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-semibold">WildFly profiles</h2>
                <p className="text-sm text-muted-foreground">
                  Runtime state and health are reported independently by the
                  backend.
                </p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <select
                  aria-label="WildFly version"
                  className="form-control w-full sm:w-auto sm:min-w-52"
                  value={version}
                  onChange={(event) => changeVersion(event.target.value)}
                >
                  {versions.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <ProfileAutocomplete
                  profiles={versionProfiles}
                  value={profileQuery}
                  onValueChange={changeProfileQuery}
                  onSelect={selectProfile}
                />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {filteredProfiles.map((profile) => {
                  const initialActivity = normalizeDashboardProfile(profile);
                  const activity = overlayRuntimeActivity(
                    initialActivity,
                    wildflyProfileActivityMap[profile.id],
                  );
                  const key = `WILDFLY_PROFILE:${profile.id}`;
                  return (
                    <ActivityCard
                      key={profile.id}
                      activity={activity}
                      title={activity.profileName || profile.name}
                      subtitle={activity.version || profile.version}
                      lastDeployedUser={profile.lastDeployedUser}
                      wildfly
                    >
                      <div className="flex w-full flex-wrap gap-2" data-testid={`profile-actions-primary-${profile.id}`}>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          disabled={!activity.serverLogAvailable}
                          onClick={() =>
                            viewOutput(activity, `Profile · ${profile.name}`)
                          }
                        >
                          <Eye className="w-3.5 h-3.5" />
                          View output
                        </Button>
                        <Button
                          size="sm"
                          className="gap-2"
                          disabled={submitting === key || busyStates.has(activity.status)}
                          onClick={() => runProfilePower(profile, activity)}
                        >
                          {submitting === key
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Power className="w-3.5 h-3.5" />}
                          {activity.status === "STARTING"
                            ? "Starting…"
                            : activity.status === "STOPPING"
                              ? "Stopping…"
                              : activity.status === "ACTIVE"
                                ? "Stop"
                                : "Start"}
                        </Button>
                      </div>
                      <div className="w-full" data-testid={`profile-actions-secondary-${profile.id}`}>
                        <RollbackButton
                          profileId={profile.id}
                          profileName={profile.name}
                          disabled={submitting === key || busyStates.has(activity.status)}
                        />
                      </div>
                    </ActivityCard>
                  );
                })}
            </div>
            {!profiles.length ? (
              <p className="empty-state">
                No valid WildFly launchers were discovered.
              </p>
            ) : debouncedProfileQuery.trim() && !filteredProfiles.length ? (
              <p className="empty-state">
                No profiles match &ldquo;{debouncedProfileQuery.trim()}&rdquo;
                for {version}.
              </p>
            ) : (
              !versionProfiles.length && (
                <p className="empty-state">
                  No profiles found for this version.
                </p>
              )
            )}
          </section>
          <section>
            <h2 className="text-lg font-semibold mb-1">
              Backend JAR applications
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              Configured applications discovered in the backend-JAR catalogue.
            </p>
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {jars.map((jar) => {
                const activity = jarProfileActivityMap[jar.id] ||
                  Object.values(jarProfileActivityMap).find(
                    (item) =>
                      item.applicationName ===
                      (jar.applicationName || jar.name),
                  ) || {
                    id: jar.id,
                    applicationName: jar.applicationName || jar.name,
                    status: "UNKNOWN",
                    health: "UNKNOWN",
                  };
                const key = `JAR:${activity.id || jar.id}`;
                return (
                  <ActivityCard
                    key={jar.id || jar.name}
                    activity={activity}
                    title={activity.applicationName || jar.name}
                    subtitle={activity.jarName || jar.jarName}
                    lastDeployedUser={jar.lastDeployedUser}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={!activity.currentDeploymentId}
                      onClick={() =>
                        viewOutput(activity, `JAR · ${jar.name}`)
                      }
                    >
                      <Eye className="w-3.5 h-3.5" />
                      View output
                    </Button>
                    <Button
                      size="sm"
                      className="gap-2"
                      disabled={
                        submitting === key || busyStates.has(activity.status)
                      }
                      onClick={() =>
                        runRestart(
                          key,
                          () =>
                            restartJar(jar.applicationName || jar.name),
                          `Restart JAR · ${jar.name}`,
                          `Restart ${jar.name}? The running process will be stopped and started again.`,
                        )
                      }
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Restart
                    </Button>
                  </ActivityCard>
                );
              })}
            </div>
            {!jars.length && (
              <p className="empty-state">
                No deployable JAR applications were found.
              </p>
            )}
          </section>
        </div>
      )}
    </Page>
  );
}

function ProfileAutocomplete({
  profiles,
  value,
  onValueChange,
  onSelect,
}) {
  const [open, setOpen] = useState(false);
  const normalizedQuery = value.trim().toLocaleLowerCase();
  const suggestions = useMemo(() => {
    if (!normalizedQuery) return profiles;
    return profiles.filter((profile) =>
      [profile.name, profile.id].some((candidate) =>
        String(candidate || "")
          .toLocaleLowerCase()
          .includes(normalizedQuery),
      ),
    );
  }, [normalizedQuery, profiles]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Search WildFly profiles"
          className="w-full justify-between font-normal sm:w-72"
        >
          <span className={value ? "truncate" : "truncate text-muted-foreground"}>
            {value || "Search profiles..."}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            aria-label="Profile name or ID"
            placeholder="Type a profile name or ID..."
            value={value}
            onValueChange={onValueChange}
          />
          <CommandList>
            <CommandEmpty>No matching profiles.</CommandEmpty>
            {value && (
              <>
                <CommandGroup>
                  <CommandItem
                    value="clear-profile-search"
                    onSelect={() => {
                      onValueChange("");
                      setOpen(false);
                    }}
                  >
                    <X className="mr-2 h-4 w-4" />
                    Show all profiles
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            <CommandGroup heading="Profiles">
              {suggestions.map((profile) => (
                <CommandItem
                  key={profile.id}
                  value={`${profile.name} ${profile.id}`}
                  onSelect={() => {
                    onSelect(profile);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={`mr-2 h-4 w-4 ${
                      value === profile.name ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{profile.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {profile.id}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ActivityCard({
  activity,
  title,
  subtitle,
  lastDeployedUser,
  wildfly = false,
  children,
}) {
  const active = activity.status === "ACTIVE";
  const healthWarning = ["MISSING", "NOT_FUNCTIONAL"].includes(activity.health);
  const [expandedOverride, setExpandedOverride] = useState(null);
  const expanded = wildfly ? (expandedOverride ?? active) : true;
  const detailsId = useId();

  return (
    <Card
      className={`${active ? "border-green-500/35 bg-green-500/5" : ""} ${activity.health === "MISSING" ? "ring-1 ring-red-500/70" : ""}`}
    >
      <CardHeader className={wildfly ? "p-4 pb-2" : "p-5 pb-3"}>
        <div className="flex justify-between gap-3">
          <div className={`flex min-w-0 ${wildfly ? "gap-2.5" : "gap-3"}`}>
            <div
              className={`${wildfly ? "h-8 w-8" : "h-9 w-9"} grid shrink-0 place-items-center rounded-md ${active ? "bg-green-500/15 text-green-700" : "bg-muted text-muted-foreground"}`}
            >
              <Server className={wildfly ? "h-3.5 w-3.5" : "h-4 w-4"} />
            </div>
            <div className="min-w-0">
              <CardTitle
                className={`${wildfly ? "text-sm" : "text-base"} truncate`}
              >
                {title}
              </CardTitle>
              <CardDescription
                className={`${wildfly ? "text-xs" : ""} mt-1 truncate`}
              >
                {subtitle || "No artifact reported"}
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge
              variant={
                active
                  ? "success"
                  : activity.status === "FAILED"
                    ? "destructive"
                    : "muted"
              }
            >
              {activity.status}
            </Badge>
            <Badge
              variant={
                healthWarning
                  ? "destructive"
                  : activity.health === "FUNCTIONAL"
                    ? "success"
                    : "muted"
              }
            >
              {activity.health}
            </Badge>
            {wildfly && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-expanded={expanded}
                aria-controls={detailsId}
                title={
                  expanded
                    ? "Collapse profile details"
                    : "Expand profile details"
                }
                onClick={() => setExpandedOverride(!expanded)}
              >
                {expanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
                <span className="sr-only">
                  {expanded
                    ? "Collapse profile details"
                    : "Expand profile details"}
                </span>
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent
        className={`${wildfly ? "p-4 pt-0" : "p-5 pt-0"} space-y-3`}
      >
        {healthWarning && (
          <Notice tone={activity.health === "MISSING" ? "error" : "warning"}>
            <strong>{activity.health}</strong>
            {activity.health === "NOT_FUNCTIONAL" &&
              ` · ${activity.consecutiveFailures || 0} consecutive failures`}
          </Notice>
        )}
        {lastDeployedUser && (
          <p className="text-xs text-muted-foreground">
            Last deployed by{" "}
            <span className="font-medium text-foreground">
              {lastDeployedUser}
            </span>
          </p>
        )}
        <div id={detailsId} hidden={!expanded}>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">PID</dt>
            <dd>{activity.pid ?? "Unavailable"}</dd>
            {wildfly && (
              <>
                <dt className="text-muted-foreground">Application</dt>
                <dd>{activity.application ?? "No WAR history"}</dd>
                <dt className="text-muted-foreground">Port offset</dt>
                <dd>{activity.offset ?? "—"}</dd>
                <dt className="text-muted-foreground">Application port</dt>
                <dd>{activity.applicationPort ?? "—"}</dd>
                <dt className="text-muted-foreground">Management port</dt>
                <dd>{activity.managementPort ?? "—"}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Deployments</dt>
            <dd>{activity.deployCount ?? 0}</dd>
            <dt className="text-muted-foreground">Failed deployments</dt>
            <dd>{activity.failedDeployCount ?? 0}</dd>
            <dt className="text-muted-foreground">Consecutive failures</dt>
            <dd>{activity.consecutiveFailures ?? 0}</dd>
            {activity.currentDeploymentId && (
              <>
                <dt className="text-muted-foreground">Current deployment</dt>
                <dd className="truncate" title={activity.currentDeploymentId}>
                  {activity.currentDeploymentId}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Last deployment</dt>
            <dd>
              {activity.lastDeploymentOn
                ? new Date(activity.lastDeploymentOn).toLocaleString()
                : "—"}
            </dd>
            <dt className="text-muted-foreground">Last successful deployment</dt>
            <dd>
              {activity.lastSuccessfulDeploymentOn
                ? new Date(activity.lastSuccessfulDeploymentOn).toLocaleString()
                : "—"}
            </dd>
            <dt className="text-muted-foreground">Last update</dt>
            <dd>
              {activity.lastUpdatedOn
                ? new Date(activity.lastUpdatedOn).toLocaleString()
                : "—"}
            </dd>
            <dt className="text-muted-foreground">Latest result</dt>
            <dd
              className={
                activity.lastResult === "FAILED"
                  ? "font-medium text-red-700"
                  : ""
              }
            >
              {activity.lastResult || "—"}
            </dd>
          </dl>
        </div>
        <div className="flex flex-wrap gap-2">{children}</div>
      </CardContent>
    </Card>
  );
}
