import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Rocket,
} from "lucide-react";
import FileBrowser from "@/components/FileBrowser";
import {
  cancelWarPreflight,
  deployWar,
  getProfileDatasources,
  getProfiles,
  getWarApplications,
  isLockConflict,
  preflightWar,
} from "@/lib/contractApi";
import { deploymentIdOf } from "@/lib/deploymentIdentity";
import { usePortal } from "@/context/PortalContext";
import { useWarDeployStore } from "@/warDeployStore";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Notice, Page } from "@/components/PagePrimitives";

const datasourceFields = [
  "name",
  "jndiName",
  "connectionUrl",
  "username",
  "password",
  "enabled",
];
const normalizeDatasource = (value) =>
  value
    ? Object.fromEntries(
        datasourceFields.map((field) => [
          field,
          field === "enabled" ? !!value[field] : (value[field] ?? ""),
        ]),
      )
    : null;
const sameDatasource = (left, right) =>
  JSON.stringify(normalizeDatasource(left)) ===
  JSON.stringify(normalizeDatasource(right));
export default function WarDeploymentPage() {
  const {
    username,
    wildflyProfileActivityMap,
    mergeActivity,
    reconcileProfileActivity,
    registerOperation,
  } = usePortal();
  const currentStore = useWarDeployStore();
  const store = useRef(currentStore).current;
  const {
    applications,
    applicationState,
    applicationError,
    profiles,
    profileState,
    profileError,
    version,
    profileId,
    application,
    source,
    datasource,
    originalDatasource,
    additionalConfigRequired,
    datasourceState,
    datasourceError,
    duplicateSelections,
    preflight,
    preflightState,
    preflightChecked,
    error,
    cancellationWarning,
    submitting,
  } = currentStore;
  const [now, setNow] = useState(Date.now());
  const [pendingOperationId, setPendingOperationId] = useState("");
  const submissionGuard = useRef(false);
  const reservedProfile = useRef("");

  const versions = useMemo(
    () => [...new Set(profiles.map((item) => item.version).filter(Boolean))],
    [profiles],
  );

  const filteredProfiles = useMemo(
    () => profiles.filter((item) => item.version === version),
    [profiles, version],
  );
  const selectedProfile = useMemo(
    () => profiles.find((item) => item.id === profileId),
    [profileId, profiles],
  );
  const requiredValid = !!(application && version && profileId && source[0]);
  const selectedActivity = wildflyProfileActivityMap[profileId];
  const profileBusy = ["STARTING", "STOPPING", "DEPLOYING"].includes(
    selectedActivity?.status,
  );
  const lockTime = preflight?.lockExpiresAt
    ? new Date(preflight.lockExpiresAt).getTime()
    : 0;
  const remainingMs = lockTime ? Math.max(0, lockTime - now) : 0;
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const expired = !!lockTime && remainingMs <= 0;
  const duplicates = Object.entries(preflight?.duplicateFiles || {});
  const allDuplicatesSelected = duplicates.every(([name, candidates]) =>
    candidates.includes(duplicateSelections[name]),
  );
  const canDeploy =
    preflightState === "ready" &&
    requiredValid &&
    lockTime > 0 &&
    !preflight?.missingFiles?.length &&
    allDuplicatesSelected &&
    !expired &&
    !submitting &&
    !pendingOperationId &&
    !profileBusy;

  useEffect(() => {
    store.setApplicationState("loading");
    store.setApplicationError("");
    getWarApplications()
      .then((items) => {
        const next = (Array.isArray(items) ? items : []).filter((item) =>
          item.environments?.includes("qc"),
        );
        store.setApplications(next);
        store.setApplication(
          (current) => current || next[0]?.application || "",
        );
        store.setApplicationState("ready");
      })
      .catch((reason) => {
        store.setApplicationError(reason.message);
        store.setApplicationState("error");
      });
    store.setProfileState("loading");
    store.setProfileError("");
    getProfiles()
      .then((items) => {
        const next = Array.isArray(items) ? items : [];
        store.setProfiles(next);
        store.setVersion(
          (current) =>
            current || next.find((item) => item.version)?.version || "",
        );
        store.setProfileState("ready");
      })
      .catch((reason) => {
        store.setProfileError(reason.message);
        store.setProfileState("error");
      });
  }, [store]);

  useEffect(() => {
    if (!filteredProfiles.length) return;
    store.setProfileId((current) =>
      filteredProfiles.some((item) => item.id === current)
        ? current
        : filteredProfiles[0].id,
    );
  }, [filteredProfiles, store]);

  useEffect(() => {
    store.setDatasource(null);
    store.setOriginalDatasource(null);
    store.setDatasourceError("");
    if (!profileId) {
      store.setDatasourceState("idle");
      return undefined;
    }
    reconcileProfileActivity(profileId).catch(() => {});
    store.setDatasourceState("loading");
    const controller = new AbortController();
    getProfileDatasources(profileId, controller.signal)
      .then((result) => {
        const next = normalizeDatasource(result);
        store.setDatasource(next);
        store.setOriginalDatasource(next ? { ...next } : null);
        store.setDatasourceState("ready");
      })
      .catch((reason) => {
        if (reason.name !== "CanceledError") {
          store.setDatasourceError(reason.message);
          store.setDatasourceState("error");
        }
      });
    return () => controller.abort();
  }, [profileId, store, reconcileProfileActivity]);

  useEffect(() => {
    if (
      pendingOperationId &&
      selectedActivity?.currentDeploymentId === pendingOperationId
    )
      setPendingOperationId("");
  }, [pendingOperationId, selectedActivity?.currentDeploymentId]);

  useEffect(() => {
    if (!lockTime || expired) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [lockTime, expired]);

  useEffect(() => {
    if (!expired || !preflightChecked) return;
    store.setPreflightChecked(false);
    store.setPreflightState("expired");
  }, [expired, preflightChecked, store]);

  const clearLocalPreflight = useCallback(() => {
    store.setPreflight(null);
    store.setDuplicateSelections({});
    store.setPreflightChecked(false);
    store.setPreflightState("idle");
    reservedProfile.current = "";
  }, [store]);

  const cancelReservation = useCallback(
    async (profile = reservedProfile.current) => {
      clearLocalPreflight();
      if (!profile) return;
      try {
        await cancelWarPreflight(profile);
        store.setCancellationWarning("");
      } catch (reason) {
        store.setCancellationWarning(
          `The reservation could not be cancelled: ${reason.message}. It will still expire on the server.`,
        );
      }
    },
    [clearLocalPreflight, store],
  );

  useEffect(
    () => () => {
      const profile = reservedProfile.current;
      reservedProfile.current = "";
      if (profile) cancelWarPreflight(profile).catch(() => {});
    },
    [],
  );

  const invalidateAnd = (setter, value) => {
    if (reservedProfile.current) cancelReservation();
    else clearLocalPreflight();
    setter(value);
    store.setError("");
  };

  const payload = useMemo(
    () => ({
      application,
      deployerName: username,
      profileId,
      sourceRootKey: "techDrive",
      sourcePath: source[0] || "",
      datasourceOverride: sameDatasource(datasource, originalDatasource)
        ? null
        : normalizeDatasource(datasource),
      additionalConfigRequired,
      duplicateSelections,
    }),
    [
      application,
      username,
      profileId,
      source,
      datasource,
      originalDatasource,
      additionalConfigRequired,
      duplicateSelections,
    ],
  );

  const runPreflight = async () => {
    if (
      !requiredValid ||
      preflightState === "loading" ||
      profileBusy ||
      pendingOperationId
    )
      return;
    store.setPreflightChecked(true);
    store.setPreflightState("loading");
    store.setError("");
    store.setCancellationWarning("");
    try {
      const result = await preflightWar(payload);
      store.setPreflight(result);
      store.setPreflightState("ready");
      reservedProfile.current = result.lockExpiresAt ? profileId : "";
      setNow(Date.now());
      if (result.activity) mergeActivity(result.activity, "WILDFLY_PROFILE");
    } catch (reason) {
      store.setPreflightChecked(false);
      store.setPreflightState("error");
      store.setError(reason.message);
      reservedProfile.current = "";
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!canDeploy || submissionGuard.current) return;
    submissionGuard.current = true;
    store.setSubmitting(true);
    store.setError("");
    try {
      const operation = await deployWar(payload);
      if (operation.profileId) {
        store.setProfiles((current) =>
          current.map((profile) =>
            profile.id === operation.profileId
              ? {
                  ...profile,
                  ...(typeof operation.hasBackup === "boolean"
                    ? { hasBackup: operation.hasBackup }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(
                    operation,
                    "backupSnapshotId",
                  )
                    ? { backupSnapshotId: operation.backupSnapshotId }
                    : {}),
                }
              : profile,
          ),
        );
      }
      reservedProfile.current = "";
      clearLocalPreflight();
      setPendingOperationId(deploymentIdOf(operation));
      registerOperation(
        { ...operation, operationType: "WAR_DEPLOY" },
        `WILDFLY_PROFILE:${profileId}`,
        `Deploy WAR · ${application}`,
      );
    } catch (reason) {
      store.setError(
        isLockConflict(reason)
          ? `Profile reservation conflict: ${reason.message}`
          : reason.message,
      );
      if (isLockConflict(reason)) clearLocalPreflight();
    } finally {
      submissionGuard.current = false;
      store.setSubmitting(false);
    }
  };

  return (
    <Page
      title="Deploy WAR"
      description="Reserve a WildFly profile, validate an existing Tech Drive WAR, and deploy it."
    >
      <form
        onSubmit={submit}
        className="grid xl:grid-cols-[1.05fr_.95fr] gap-5 items-start"
      >
        <Card>
          <CardHeader>
            <CardTitle>Source and target</CardTitle>
            <CardDescription>
              Profile identifiers and selected paths are submitted exactly as
              backend UUIDs and Tech Drive-relative paths.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <FormItem>
              <FormLabel>Application</FormLabel>
              <Select
                value={application}
                onValueChange={(value) =>
                  invalidateAnd(store.setApplication, value)
                }
                disabled={applicationState === "loading"}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select application" />
                </SelectTrigger>
                <SelectContent>
                  {applications.map((item) => (
                    <SelectItem key={item.application} value={item.application}>
                      {item.application}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {applicationError && (
                <FormMessage>{applicationError}</FormMessage>
              )}
            </FormItem>
            <div className="grid sm:grid-cols-2 gap-4">
              <FormItem>
                <FormLabel>WildFly version</FormLabel>
                <Select
                  value={version}
                  onValueChange={(value) =>
                    invalidateAnd(store.setVersion, value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select version" />
                  </SelectTrigger>
                  <SelectContent>
                    {versions.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {profileError && <FormMessage>{profileError}</FormMessage>}
              </FormItem>
              <FormItem>
                <FormLabel>Profile</FormLabel>
                <Select
                  value={profileId}
                  onValueChange={(value) =>
                    invalidateAnd(store.setProfileId, value)
                  }
                  disabled={profileState === "loading"}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select profile" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredProfiles.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                        {item.portOffset != null
                          ? ` · offset ${item.portOffset}`
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedProfile?.lastDeployedUser && (
                  <FormDescription>
                    Last deployed by {selectedProfile.lastDeployedUser}
                  </FormDescription>
                )}
              </FormItem>
            </div>
            <DatasourceEditor
              state={datasourceState}
              error={datasourceError}
              value={datasource}
              onChange={(value) => invalidateAnd(store.setDatasource, value)}
            />
            <div>
              <p className="text-sm font-medium mb-2">WAR from Tech Drive</p>
              <FileBrowser
                rootKey="techDrive"
                selectableExtension=".war"
                selected={source}
                onSelectionChange={(items) =>
                  invalidateAnd(store.setSource, items.slice(-1))
                }
              />
              {source[0] ? (
                <FormDescription className="mt-2">
                  Selected:{" "}
                  <span className="font-mono text-foreground">{source[0]}</span>
                </FormDescription>
              ) : (
                <FormMessage className="mt-2">
                  Select one .war file.
                </FormMessage>
              )}
            </div>
            <Label
              className={`flex items-start gap-3 rounded-md border p-3 ${
                additionalConfigRequired
                  ? "border-primary bg-primary/10"
                  : ""
              }`}
            >
              <Checkbox
                className="mt-0.5"
                checked={additionalConfigRequired}
                onCheckedChange={(checked) =>
                  invalidateAnd(
                    store.setAdditionalConfigRequired,
                    checked === true,
                  )
                }
              />
              <span>
                <strong>Apply additional WAR configuration</strong>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Require an additionalConfig.toml beside the selected WAR for
                  properties or web.xml changes. Leave unchecked when no
                  additional changes are needed.
                </span>
              </span>
            </Label>
          </CardContent>
        </Card>
        <Card className="xl:sticky xl:top-5">
          <CardHeader>
            <CardTitle>Preflight and deployment</CardTitle>
            <CardDescription>
              The profile is exclusively reserved until the server-provided
              expiry time.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Label
              className={`flex items-center gap-3 rounded-md border p-3 ${preflightChecked ? "border-primary bg-primary/10" : ""}`}
            >
              <Checkbox
                checked={preflightChecked}
                disabled={
                  !requiredValid ||
                  preflightState === "loading" ||
                  submitting ||
                  !!pendingOperationId ||
                  profileBusy
                }
                onCheckedChange={(checked) =>
                  checked ? runPreflight() : cancelReservation()
                }
              />
              <span>
                <strong>Run preflight and reserve profile</strong>
                <span className="block text-xs text-muted-foreground mt-1">
                  Available after application, profile, and WAR are selected.
                </span>
              </span>
            </Label>
            {preflightState === "loading" && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Running preflight…
              </p>
            )}
            {preflightState === "expired" && (
              <Notice tone="warning">
                The exclusive reservation expired. Run preflight again before
                deploying.
              </Notice>
            )}
            {profileBusy && (
              <Notice tone="warning">
                This profile is currently{" "}
                {selectedActivity.status.toLowerCase()}. Wait for the backend
                state to change before starting another deployment.
              </Notice>
            )}
            {pendingOperationId && (
              <Notice>
                Deployment request accepted. Waiting for the backend activity
                event…
              </Notice>
            )}
            {preflight?.warnings?.length > 0 && (
              <Notice tone="warning">
                <strong>Warnings</strong>
                <ul className="list-disc ml-5 mt-1">
                  {preflight.warnings.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </Notice>
            )}
            {preflight?.missingFiles?.length > 0 && (
              <Notice tone="error">
                <strong>Missing required files</strong>
                <ul className="list-disc ml-5 mt-1">
                  {preflight.missingFiles.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </Notice>
            )}
            {Object.keys(preflight?.automaticallyResolved || {}).length > 0 && (
              <Notice>
                <strong>Automatically resolved</strong>
                {Object.entries(preflight.automaticallyResolved).map(
                  ([file, path]) => (
                    <div className="font-mono text-xs mt-1" key={file}>
                      {file} → {path}
                    </div>
                  ),
                )}
              </Notice>
            )}
            {duplicates.map(([file, candidates]) => (
              <FormItem key={file}>
                <FormLabel>Resolve duplicate: {file}</FormLabel>
                <Select
                  value={duplicateSelections[file] || ""}
                  onValueChange={(value) =>
                    store.setDuplicateSelections((current) => ({
                      ...current,
                      [file]: value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose the exact candidate path" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((path) => (
                      <SelectItem key={path} value={path}>
                        {path}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!duplicateSelections[file] && (
                  <FormMessage>A selection is required.</FormMessage>
                )}
              </FormItem>
            ))}
            {cancellationWarning && (
              <Notice tone="warning">{cancellationWarning}</Notice>
            )}
            {error && <Notice tone="error">{error}</Notice>}
            <Button
              type="submit"
              disabled={!canDeploy}
              className="w-full gap-2"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : canDeploy ? (
                <Rocket className="w-4 h-4" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              {submitting
                ? "Starting deployment…"
                : `Deploy WAR${lockTime > 0 && !expired ? ` (${remainingSeconds})` : ""}`}
            </Button>
            <p className="text-xs text-muted-foreground flex gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {canDeploy
                ? "All checks passed. Deploy before the reservation expires."
                : "Complete preflight and resolve every blocking decision."}
            </p>
          </CardContent>
        </Card>
      </form>
    </Page>
  );
}

function DatasourceEditor({ state, error, value, onChange }) {
  if (state === "idle")
    return <Notice>Select a profile to load its datasource.</Notice>;
  if (state === "loading")
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading datasource…
      </p>
    );
  if (state === "error") return <Notice tone="error">{error}</Notice>;
  if (!value)
    return (
      <Notice tone="warning">
        No datasource was returned for this profile.
      </Notice>
    );
  const update = (field, next) =>
    onChange((current) => ({ ...current, [field]: next }));
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
      <div>
        <p className="text-sm font-medium">Profile datasource</p>
        <p className="text-xs text-muted-foreground">
          Changes are applied only as part of this WAR deployment.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {["name", "jndiName", "connectionUrl", "username", "password"].map(
          (field) => (
            <FormItem
              className={field === "connectionUrl" ? "sm:col-span-2" : ""}
              key={field}
            >
              <FormLabel>
                {field === "jndiName"
                  ? "JNDI name"
                  : field === "connectionUrl"
                    ? "Connection URL"
                    : field[0].toUpperCase() + field.slice(1)}
              </FormLabel>
              <Input
                type={field === "password" ? "password" : "text"}
                autoComplete={field === "password" ? "new-password" : "off"}
                value={value[field]}
                onChange={(event) => update(field, event.target.value)}
              />
            </FormItem>
          ),
        )}
      </div>
      <Label className="flex items-center gap-2">
        <Checkbox
          checked={value.enabled}
          onCheckedChange={(checked) => update("enabled", checked === true)}
        />
        Enabled
      </Label>
    </div>
  );
}
