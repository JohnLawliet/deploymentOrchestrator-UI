import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchEventSource, type EventSourceMessage } from '@microsoft/fetch-event-source';
import { Activity, ChevronDown, ChevronUp, Download, Loader2, Pause, Play, Power, Terminal, X } from 'lucide-react';
import RollbackButton from '@/components/RollbackButton';
import { usePortal } from '@/context/PortalContext';
import {
  downloadTerminal,
  getOperation,
  saveBlob,
  resolvedTerminalEventUrl,
  stopProfile,
  subscribeProfileLogs,
  techDriveHeaders,
  unsubscribeProfileLogs,
} from '@/lib/contractApi';
import { deploymentIdOf } from '@/lib/deploymentIdentity';
import { QC_WAR_TIMELINE, qcWarPhase, qcWarPhaseLabel } from '@/lib/qcWarProgress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DeploymentRecord, TerminalOutputEvent } from '@/types/api-contracts';
import { errorMessage } from '@/types/frontend';

const terminalStates = new Set(['RESOURCE_ACTIVE', 'RESOURCE_FAILED', 'RESOURCE_INACTIVE', 'ACTIVE', 'FAILED', 'INACTIVE']);

const lifecycleStatuses = {
  DEPLOYMENT_FAILED: 'FAILED',
  DEPLOYMENT_SUCCEEDED: 'COMPLETED',
  RESOURCE_FAILED: 'FAILED',
  RESOURCE_ACTIVE: 'ACTIVE',
  RESOURCE_INACTIVE: 'INACTIVE',
};

const missingJarLogMessage = 'No jarDeployment.log was produced because the application launcher did not start.';
const isNotFound = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'status' in error && error.status === 404;
const errorStatus = (error: unknown): number | null =>
  typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : null;
const isTerminalOutputEvent = (message: EventSourceMessage): TerminalOutputEvent | null => {
  if (message.event !== 'TERMINAL_OUTPUT' || !message.data.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(message.data);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as TerminalOutputEvent).deploymentId !== 'string' ||
      typeof (parsed as TerminalOutputEvent).timestamp !== 'string' ||
      typeof (parsed as TerminalOutputEvent).line !== 'string'
    )
      return null;
    return {
      ...(parsed as TerminalOutputEvent),
      replayed: (parsed as TerminalOutputEvent).replayed === true,
    };
  } catch {
    return null;
  }
};
const rollbackDetails = (value: unknown): { rollbackResult?: string; rollbackMessage?: string } | null => {
  if (typeof value !== 'object' || value === null) return null;
  const { rollbackResult, rollbackMessage } = value as Record<string, unknown>;
  if (typeof rollbackResult !== 'string' && typeof rollbackMessage !== 'string') return null;
  return {
    ...(typeof rollbackResult === 'string' ? { rollbackResult } : {}),
    ...(typeof rollbackMessage === 'string' ? { rollbackMessage } : {}),
  };
};

export default function OperationProgressPanel() {
  const {
    viewingOperation,
    setViewingOperation,
    operations,
    reconcileResourceActivity,
    wildflyProfileActivityMap = {},
    profileLogLines,
    clearProfileLogs,
  } = usePortal();
  const [record, setRecord] = useState<DeploymentRecord | null>(null);
  const [actionState, setActionState] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [connection, setConnection] = useState('disconnected');
  const [connectionError, setConnectionError] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [jarOutputLines, setJarOutputLines] = useState<TerminalOutputEvent[]>([]);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const releasedProfileRef = useRef('');
  const operationId = deploymentIdOf(viewingOperation);
  const live = operationId ? operations[operationId] : null;
  const operationProgress = live?.progress;
  const operationType = live?.operationType || viewingOperation?.operationType || record?.type;
  const warDeployment = operationType === 'WAR_DEPLOY' || operationType === 'QC_WAR';
  const manualWarRollback = operationType === 'WAR_ROLLBACK';
  const automaticRollback = warDeployment && !manualWarRollback && !!operationProgress?.rollbackState;
  const rollbackOperation = automaticRollback || manualWarRollback;
  const rollbackRestoring = rollbackOperation && operationProgress?.rollbackState === 'RESTORING';
  const rollbackRestored = rollbackOperation && operationProgress?.rollbackState === 'RESTORED';
  const rollbackFailed = rollbackOperation && operationProgress?.rollbackState === 'FAILED';
  const deploymentFailed = operationProgress?.deploymentOutcome === 'FAILED';
  const lifecycleStatus = live?.statusEvent ? lifecycleStatuses[live.statusEvent as keyof typeof lifecycleStatuses] : undefined;
  const rawStatus =
    lifecycleStatus ||
    operationProgress?.status ||
    live?.statusEvent ||
    live?.state ||
    record?.status ||
    viewingOperation?.status ||
    'STARTING';
  const status = rollbackRestoring ? 'RESTORING' : rollbackRestored ? 'RESTORED' : rollbackFailed ? 'FAILED' : rawStatus;
  const statusTerminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(rawStatus);
  const phaseCode = statusTerminal && !rollbackRestoring && !rollbackRestored ? undefined : operationProgress?.phaseCode;
  const progressValue = operationProgress?.progressPercentage;
  const recordProgress = record?.progressPercentage;
  const suppliedProgress = Number.isFinite(progressValue)
    ? progressValue
    : Number.isFinite(recordProgress)
      ? recordProgress
      : undefined;
  const completed = rawStatus === 'COMPLETED' || (manualWarRollback && operationProgress?.deploymentOutcome === 'SUCCEEDED');
  const failed = deploymentFailed || rollbackFailed || rawStatus.includes('FAILED');
  const cancelled = status === 'CANCELLED';
  const complete = completed || terminalStates.has(status);
  const progress = completed
    ? 100
    : (failed && !rollbackRestoring && !rollbackRestored) || cancelled
      ? undefined
      : (suppliedProgress ?? (terminalStates.has(status) ? 100 : undefined));
  const progressWidth = Math.min(100, Math.max(0, progress ?? 32));
  const restoredState = live?.restoredResourceState;
  const message = rollbackRestoring
    ? automaticRollback
      ? 'Deployment failed — restoring previous version.'
      : 'Restoring previous deployment.'
    : rollbackFailed
      ? automaticRollback
        ? 'Deployment failed and rollback failed. Manual recovery is required.'
        : 'Rollback failed. Manual recovery is required.'
      : rollbackRestored && deploymentFailed
        ? `Deployment failed. The previous deployment was restored${restoredState ? ` and the profile is ${restoredState.toLowerCase()}` : ''}.`
        : manualWarRollback && completed
          ? 'Previous deployment restored successfully.'
          : (lifecycleStatus ? live?.message : operationProgress?.message) ||
            live?.message ||
            operationProgress?.message ||
            record?.errorMessage ||
            (complete ? 'Operation reached a terminal resource state.' : 'The backend is processing this operation.');
  const badgeVariant = failed ? 'destructive' : completed ? 'success' : cancelled ? 'muted' : complete ? 'success' : 'warning';
  const resourceKey = live?.resourceKey || viewingOperation?.resourceKey || '';
  const resourceType = viewingOperation?.resourceType || (String(resourceKey).startsWith('JAR:') ? 'JAR' : 'WILDFLY_PROFILE');
  const profileId = viewingOperation?.profileId || String(resourceKey).replace(/^WILDFLY_PROFILE:/, '');
  const profileOutput = resourceType === 'WILDFLY_PROFILE' && viewingOperation?.outputRequested && !!profileId;
  const jarOutput = resourceType === 'JAR' && viewingOperation?.outputRequested && !!operationId;
  const outputLines = useMemo(
    () => (jarOutput ? jarOutputLines : profileLogLines?.[profileId] || []),
    [jarOutput, jarOutputLines, profileLogLines, profileId],
  );
  const profileSnapshotId = wildflyProfileActivityMap[profileId]?.backupSnapshotId;
  const backupSnapshotId =
    typeof profileSnapshotId === 'number'
      ? profileSnapshotId
      : typeof live?.backupSnapshotId === 'number'
        ? live.backupSnapshotId
        : typeof viewingOperation?.backupSnapshotId === 'number'
          ? viewingOperation.backupSnapshotId
          : null;
  const showFailedWarLog = warDeployment && deploymentFailed && live?.logAvailable === true;
  const showJarLog = resourceType === 'JAR' && (jarOutput || live?.logAvailable === true);
  const showSuccessfulWarActions =
    completed && warDeployment && String(resourceKey).startsWith('WILDFLY_PROFILE:') && !!profileId;
  const rollback = rollbackDetails(live?.resources);
  const progressSteps = operationProgress?.steps ?? [];
  const currentPhase = qcWarPhase(operationProgress?.phaseCode);

  useEffect(() => {
    if (operationId) setExpanded(true);
  }, [operationId]);

  useEffect(() => {
    if (!profileOutput) return undefined;
    let disposed = false;
    releasedProfileRef.current = '';
    clearProfileLogs(profileId);
    setConnection('connecting');
    setConnectionError('');
    subscribeProfileLogs(profileId)
      .then(() => {
        if (!disposed) setConnection('connected');
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setConnection('disconnected');
        setConnectionError(errorMessage(error));
      });
    return () => {
      disposed = true;
      if (releasedProfileRef.current !== profileId) {
        void unsubscribeProfileLogs(profileId).catch(() => {});
      }
    };
  }, [profileOutput, profileId, clearProfileLogs]);

  useEffect(() => {
    if (!jarOutput) return undefined;
    const controller = new AbortController();
    let disposed = false;
    setJarOutputLines([]);
    setConnection('connecting');
    setConnectionError('');
    void fetchEventSource(resolvedTerminalEventUrl(live?.terminalEventsUrl || viewingOperation?.terminalEventsUrl, operationId), {
      method: 'GET',
      headers: techDriveHeaders(),
      signal: controller.signal,
      openWhenHidden: true,
      onopen: async (response) => {
        if (!response.ok) throw new Error(`JAR log stream returned ${response.status}`);
        if (!disposed) setConnection('connected');
      },
      onmessage: (message) => {
        const event = isTerminalOutputEvent(message);
        if (!event || event.deploymentId !== operationId) return;
        setJarOutputLines((current) => [...current, event].slice(-1000));
      },
      onclose: () => {
        if (!disposed) setConnection('disconnected');
      },
      onerror: (error) => {
        if (!disposed) {
          setConnection('reconnecting');
          setConnectionError(errorMessage(error, 'Unable to stream JAR output.'));
        }
        return 3000;
      },
    }).catch((error: unknown) => {
      if (!disposed && !controller.signal.aborted) {
        setConnection('disconnected');
        setConnectionError(errorMessage(error, 'Unable to stream JAR output.'));
      }
    });
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [jarOutput, live?.terminalEventsUrl, operationId, viewingOperation?.terminalEventsUrl]);

  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [autoScroll, outputLines]);

  useEffect(() => {
    if (!operationId) return undefined;
    let disposed = false;
    setRecord(null);
    setActionError('');
    setActionMessage('');
    getOperation(operationId)
      .then((result) => {
        if (!disposed) setRecord(result);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [operationId]);

  if (!viewingOperation) return null;

  const downloadLog = async () => {
    setActionState('downloading');
    setActionError('');
    setActionMessage('');
    try {
      saveBlob(await downloadTerminal(operationId));
    } catch (error: unknown) {
      const status = errorStatus(error);
      setActionError(
        showFailedWarLog
          ? status === 403
            ? 'You are not authorized to download this failed deployment log.'
            : status === 404
              ? 'No retained failure log is available for this deployment.'
              : status === 409
                ? 'The failure log is not ready yet. Try again shortly.'
                : errorMessage(error)
          : isNotFound(error)
            ? missingJarLogMessage
            : errorMessage(error),
      );
    } finally {
      setActionState('');
    }
  };

  const closeDrawer = async () => {
    setActionError('');
    if (profileOutput) {
      setActionState('closing');
      try {
        await unsubscribeProfileLogs(profileId);
        releasedProfileRef.current = profileId;
        setViewingOperation(null);
      } catch (error: unknown) {
        setActionError(errorMessage(error));
      } finally {
        setActionState('');
      }
      return;
    }
    if (resourceType === 'JAR' && operationId) {
      setViewingOperation(null);
      return;
    }
    setViewingOperation(null);
  };

  const stopSelectedProfile = async () => {
    if (!window.confirm(`Stop profile ${record?.profile || profileId}?`)) return;
    setActionState('stopping');
    setActionError('');
    setActionMessage('');
    try {
      await stopProfile(profileId);
      await reconcileResourceActivity(`WILDFLY_PROFILE:${profileId}`);
      setActionMessage('Profile stopped successfully.');
    } catch (error: unknown) {
      setActionError(errorMessage(error));
    } finally {
      setActionState('');
    }
  };

  if (!expanded) {
    return (
      <Card className="fixed bottom-4 left-[calc(var(--sidebar-width)+1.25rem)] right-5 z-50 border-primary/25 shadow-glow">
        <div className="flex min-w-0 items-center gap-3 p-3">
          <Activity className="h-4 w-4 shrink-0 text-primary" />
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            aria-expanded="false"
            onClick={() => setExpanded(true)}
          >
            <span className="truncate text-sm font-semibold">{viewingOperation.label || 'Operation progress'}</span>
            {phaseCode && <span className="hidden truncate font-mono text-xs text-muted-foreground sm:inline">{phaseCode}</span>}
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {failed ? 'Failed' : cancelled ? 'Cancelled' : progress !== undefined ? `${Math.round(progress)}%` : 'In progress'}
            </span>
          </button>
          <Badge variant={badgeVariant}>{status.replace('RESOURCE_', '')}</Badge>
          <Button variant="ghost" size="icon" aria-label="Expand operation progress" onClick={() => setExpanded(true)}>
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Hide operation progress"
            disabled={actionState === 'closing'}
            onClick={closeDrawer}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="h-1 overflow-hidden bg-muted">
          <div
            className={`h-full ${failed ? 'bg-red-500' : cancelled ? 'bg-slate-500' : 'bg-primary'} transition-all`}
            style={{ width: `${progressWidth}%` }}
          />
        </div>
      </Card>
    );
  }

  return (
    <Card className="fixed bottom-4 left-[calc(var(--sidebar-width)+1.25rem)] right-5 top-4 z-50 flex flex-col overflow-hidden border-primary/25 shadow-glow">
      <CardHeader className="max-h-[60%] shrink-0 overflow-y-auto p-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-primary" />
            {viewingOperation.label || 'Operation progress'}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={badgeVariant}>{status.replace('RESOURCE_', '')}</Badge>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Collapse operation progress"
              aria-expanded="true"
              onClick={() => setExpanded(false)}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Hide operation progress"
              disabled={actionState === 'closing'}
              onClick={closeDrawer}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <span className="truncate font-mono text-xs text-muted-foreground">{operationId}</span>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full ${failed ? 'bg-red-500' : cancelled ? 'bg-slate-500' : 'bg-primary'} transition-all`}
            style={{ width: `${progressWidth}%` }}
          />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {phaseCode && (
            <span>
              Phase:{' '}
              <strong className="text-foreground">{qcWarPhaseLabel(phaseCode) || phaseCode}</strong>{' '}
              <span className="font-mono">({phaseCode})</span>
            </span>
          )}
          {progress !== undefined && (
            <span>
              Progress: <strong className="text-foreground">{Math.round(progress)}%</strong>
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{message}</p>
        {deploymentFailed && operationProgress?.failureMessage && operationProgress.failureMessage !== message && (
          <p className="text-sm text-red-700">{operationProgress.failureMessage}</p>
        )}
        {rollbackFailed && operationProgress?.rollbackFailureMessage && (
          <p className="text-sm text-red-700">{operationProgress.rollbackFailureMessage}</p>
        )}
        {warDeployment && (
          <ol className="grid gap-1 rounded-md border border-border bg-muted/15 p-2 text-xs sm:grid-cols-3" aria-label="QC WAR deployment timeline">
            {QC_WAR_TIMELINE.map((step, index) => {
              const current = currentPhase?.timelineId === step.id;
              return (
                <li className={current ? 'font-semibold text-primary' : 'text-muted-foreground'} key={step.id}>
                  <span className="mr-1 font-mono">{index + 1}.</span>
                  {step.label}
                </li>
              );
            })}
          </ol>
        )}
        {progressSteps.length > 0 && (
          <div
            className="max-h-40 overflow-auto rounded-md border border-border bg-muted/15 p-2"
            aria-label="Operation progress history"
          >
            <ol className="space-y-1.5">
              {progressSteps.map((step, index) => (
                <li className="grid grid-cols-[auto_1fr] gap-x-2 text-xs" key={`${step.timestamp}-${step.phaseCode}-${index}`}>
                  <span className="font-mono text-primary">{step.phaseCode}</span>
                  <span className="text-muted-foreground">{step.message}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {live?.frontendWarning && (
          <p className="text-sm text-amber-700">{live.frontendWarning} The backend deployment result is unchanged.</p>
        )}
        {rollback && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-sm">
            <strong>Rollback: {rollback.rollbackResult || 'reported'}</strong>
            {rollback.rollbackMessage && <div>{rollback.rollbackMessage}</div>}
          </div>
        )}
        {(showFailedWarLog || showJarLog || showSuccessfulWarActions) && (
          <div className="flex flex-wrap items-start gap-2 border-t border-border pt-3">
            {showJarLog && (
              <Button variant="outline" size="sm" className="gap-2" disabled={!!actionState} onClick={downloadLog}>
                {actionState === 'downloading' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {actionState === 'downloading' ? 'Downloading…' : 'Download full log'}
              </Button>
            )}
            {showFailedWarLog && (
              <Button variant="outline" size="sm" className="gap-2" disabled={!!actionState} onClick={downloadLog}>
                {actionState === 'downloading' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {actionState === 'downloading' ? 'Downloading…' : 'Download Logs'}
              </Button>
            )}
            {showSuccessfulWarActions && (
              <>
                <Button variant="outline" size="sm" className="gap-2" disabled={!!actionState} onClick={stopSelectedProfile}>
                  {actionState === 'stopping' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Power className="h-3.5 w-3.5" />
                  )}
                  {actionState === 'stopping' ? 'Stopping…' : 'Stop profile'}
                </Button>
                <RollbackButton
                  profileId={profileId}
                  profileName={record?.profile || profileId}
                  backupSnapshotId={backupSnapshotId}
                  disabled={!!actionState || backupSnapshotId === null}
                />
              </>
            )}
          </div>
        )}
        {connectionError && (
          <p className="text-sm text-red-700" role="alert">
            {connectionError}
          </p>
        )}
        {actionError && (
          <p className="text-sm text-red-700" role="alert">
            {actionError}
          </p>
        )}
        {actionMessage && (
          <p className="text-sm text-green-700" role="status">
            {actionMessage}
          </p>
        )}
        {viewingOperation.profileLogUnavailable && (
          <p className="text-sm text-amber-700" role="status">
            Profile log output is no longer available.
          </p>
        )}
      </CardHeader>
      {(profileOutput || jarOutput) && (
        <CardContent className="flex min-h-0 flex-1 flex-col p-4 pt-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs font-medium">
              <Terminal className="h-3.5 w-3.5" />
              {jarOutput ? 'JAR output' : 'Profile output'}
              <span className="font-normal text-muted-foreground">({connection})</span>
            </span>
            <div className="flex flex-wrap gap-1">
              <Button variant="ghost" size="sm" className="gap-2" onClick={() => setAutoScroll((value) => !value)}>
                {autoScroll ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {autoScroll ? 'Pause scroll' : 'Resume scroll'}
              </Button>
            </div>
          </div>
          <div
            ref={outputRef}
            className="min-h-24 flex-1 overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-xs leading-5 text-foreground"
            aria-live="polite"
          >
            {outputLines.length ? (
              outputLines.map((item, index) => (
                <div
                  className={('replayed' in item ? item.replayed : item.replay) === true ? 'text-muted-foreground' : ''}
                  key={`${item.timestamp || 'line'}-${index}`}
                >
                  {item.line}
                </div>
              ))
            ) : (
              <span className="text-muted-foreground">Waiting for output…</span>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
