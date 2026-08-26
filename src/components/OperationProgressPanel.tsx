import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchEventSource, type EventSourceMessage } from '@microsoft/fetch-event-source';
import { Activity, ChevronDown, ChevronUp, Download, Loader2, Pause, Play, Power, Terminal, X } from 'lucide-react';
import RollbackButton from '@/components/RollbackButton';
import { usePortal } from '@/context/PortalContext';
import {
  downloadTerminal,
  saveBlob,
  resolvedTerminalEventUrl,
  stopProfile,
  subscribeProfileLogs,
  techDriveHeaders,
  unsubscribeProfileLogs,
} from '@/lib/contractApi';
import { deploymentIdOf } from '@/lib/deploymentIdentity';
import {
  isJarDeploymentPhase,
  jarDeploymentPhase,
  jarDeploymentPhaseLabel,
  jarDeploymentTimeline,
} from '@/lib/jarDeploymentProgress';
import { QC_WAR_TIMELINE, qcWarPhase, qcWarPhaseLabel } from '@/lib/qcWarProgress';
import {
  isProfilePowerOperation,
  profilePowerPhase,
  profilePowerPhaseLabel,
  profilePowerTimeline,
} from '@/lib/profilePowerProgress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { TerminalOutputEvent } from '@/types/api-contracts';
import { errorMessage } from '@/types/frontend';

type TimelineStep = { id: string; label: string; description: string };
type Timeline = { ariaLabel: string; steps: readonly TimelineStep[]; currentStepId?: string; phaseLabel?: string | null };
type OutputSource = 'none' | 'profile-log' | 'terminal' | 'terminal-pending';

function TimelineStepItem({
  index,
  label,
  description,
  current,
}: {
  index: number;
  label: string;
  description: string;
  current: boolean;
}) {
  return (
    <li className={current ? 'font-semibold text-primary' : 'text-muted-foreground'}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="cursor-help text-left underline decoration-dotted decoration-current/40 underline-offset-2"
          >
            <span className="mr-1 font-mono">{index}.</span>
            {label}
          </button>
        </TooltipTrigger>
        <TooltipContent>{description}</TooltipContent>
      </Tooltip>
    </li>
  );
}

const lifecycleFailureEvents = new Set(['DEPLOYMENT_FAILED', 'RESOURCE_FAILED', 'OPERATION_FAILED']);

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
    profileLogLines,
    clearProfileLogs,
    mergeActivity,
    handleSessionRevoked,
  } = usePortal();
  const [actionState, setActionState] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [connection, setConnection] = useState('disconnected');
  const [connectionError, setConnectionError] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [terminalOutputLines, setTerminalOutputLines] = useState<TerminalOutputEvent[]>([]);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const releasedProfileRef = useRef('');
  const terminalLineKeysRef = useRef(new Set<string>());
  const terminalSubscriptionRef = useRef<{ key: string; controller: AbortController } | null>(null);
  const operationId = deploymentIdOf(viewingOperation);
  const live = operationId ? operations[operationId] : null;
  const operationProgress = live?.progress;
  const operationType = live?.operationType || viewingOperation?.operationType || viewingOperation?.type;
  const warDeployment = operationType === 'WAR_DEPLOY' || operationType === 'QC_WAR';
  const manualWarRollback = operationType === 'WAR_ROLLBACK';
  const wildFlyWarOperation = warDeployment || manualWarRollback;
  const automaticRollback = warDeployment && !manualWarRollback && !!operationProgress?.rollbackState;
  const rollbackOperation = automaticRollback || manualWarRollback;
  const rollbackRestoring = rollbackOperation && operationProgress?.rollbackState === 'RESTORING';
  const rollbackRestored = rollbackOperation && operationProgress?.rollbackState === 'RESTORED';
  const rollbackFailed = rollbackOperation && operationProgress?.rollbackState === 'FAILED';
  const deploymentFailed = operationProgress?.deploymentOutcome === 'FAILED';
  const profilePowerOperation = isProfilePowerOperation(operationType);
  const progressValue =
    typeof operationProgress?.progressPercentage === 'number' && Number.isFinite(operationProgress.progressPercentage)
      ? operationProgress.progressPercentage
      : null;
  const lifecycleFailed = lifecycleFailureEvents.has(live?.statusEvent || '');
  const rawStatus = lifecycleFailed ? 'FAILED' : operationProgress?.status || 'STARTING';
  const status = rollbackRestoring ? 'RESTORING' : rollbackRestored ? 'RESTORED' : rollbackFailed ? 'FAILED' : rawStatus;
  const statusTerminal = ['FAILED', 'CANCELLED'].includes(rawStatus);
  const suppliedProgress = (() => {
    const available = [progressValue].filter((value): value is number => value !== null);
    return available.length ? Math.max(...available) : undefined;
  })();
  const completed =
    operationProgress?.phaseCode === 'COMPLETED' ||
    operationProgress?.status === 'COMPLETED' ||
    operationProgress?.deploymentOutcome === 'SUCCEEDED';
  const failed = deploymentFailed || rollbackFailed || rawStatus.includes('FAILED');
  const cancelled = status === 'CANCELLED';
  const complete = completed || failed || cancelled;
  const phaseCode =
    (statusTerminal || completed) && !rollbackRestoring && !rollbackRestored ? undefined : operationProgress?.phaseCode;
  const progress = completed
    ? 100
    : (failed && !rollbackRestoring && !rollbackRestored) || cancelled
      ? undefined
      : suppliedProgress;
  const progressWidth = Math.min(100, Math.max(0, progress ?? 0));
  const restoredState = live?.restoredResourceState;
  const message = rollbackRestoring
    ? automaticRollback
      ? 'Deployment failed — restoring previous version.'
      : operationProgress?.message || 'Restoring previous deployment.'
    : rollbackFailed
      ? automaticRollback
        ? 'Deployment failed and rollback failed. Manual recovery is required.'
        : 'Rollback failed. Manual recovery is required.'
      : rollbackRestored && deploymentFailed
        ? `Deployment failed. The previous deployment was restored${restoredState ? ` and the profile is ${restoredState.toLowerCase()}` : ''}.`
        : manualWarRollback && completed
          ? 'Previous deployment restored successfully.'
          : (failed ? live?.message : undefined) ||
            operationProgress?.message ||
            live?.message ||
            viewingOperation?.errorMessage ||
            (complete ? 'Operation reached a terminal resource state.' : 'The backend is processing this operation.');
  const badgeVariant = failed ? 'destructive' : completed ? 'success' : cancelled ? 'muted' : complete ? 'success' : 'warning';
  const resourceKey = live?.resourceKey || viewingOperation?.resourceKey || '';
  const resourceType = viewingOperation?.resourceType || (String(resourceKey).startsWith('JAR:') ? 'JAR' : 'WILDFLY_PROFILE');
  const jarDeployment =
    resourceType === 'JAR' &&
    operationType !== 'JAR_ROLLBACK' &&
    (operationType === 'JAR_DEPLOY' || isJarDeploymentPhase(operationProgress?.phaseCode));
  const profileId = viewingOperation?.profileId || String(resourceKey).replace(/^WILDFLY_PROFILE:/, '');
  const outputSource: OutputSource = !viewingOperation?.outputRequested
    ? 'none'
    : resourceType === 'WILDFLY_PROFILE'
      ? !profilePowerOperation && profileId
        ? 'profile-log'
        : 'none'
      : resourceType === 'JAR' && operationId
        ? live?.terminalAvailabilityConfirmed === true || viewingOperation?.terminalAvailabilityConfirmed === true
          ? 'terminal'
          : 'terminal-pending'
        : 'none';
  const profileLogOutput = outputSource === 'profile-log';
  const terminalOutput = outputSource === 'terminal';
  const hasOutput = outputSource !== 'none';
  const outputLines = useMemo(
    () => (terminalOutput ? terminalOutputLines : profileLogLines?.[profileId] || []),
    [terminalOutput, terminalOutputLines, profileLogLines, profileId],
  );
  const showFailedWarLog = wildFlyWarOperation && deploymentFailed && live?.logAvailable === true;
  const showJarLog = resourceType === 'JAR' && !viewingOperation?.outputRequested && live?.logAvailable === true;
  const showSuccessfulWarActions =
    completed && warDeployment && String(resourceKey).startsWith('WILDFLY_PROFILE:') && !!profileId;
  const rollback = rollbackDetails(live?.resources);
  const progressSteps = operationProgress?.steps ?? [];
  const timeline: Timeline | null = wildFlyWarOperation
    ? {
        ariaLabel: manualWarRollback ? 'WildFly WAR rollback timeline' : 'QC WAR deployment timeline',
        steps: QC_WAR_TIMELINE,
        currentStepId: qcWarPhase(operationProgress?.phaseCode)?.timelineId,
        phaseLabel: qcWarPhaseLabel(operationProgress?.phaseCode),
      }
    : profilePowerOperation
      ? {
          ariaLabel: 'WildFly profile operation timeline',
          steps: profilePowerTimeline(operationType),
          currentStepId: profilePowerPhase(operationProgress?.phaseCode)?.timelineId,
          phaseLabel: profilePowerPhaseLabel(operationProgress?.phaseCode),
        }
      : jarDeployment
        ? {
            ariaLabel: 'JAR deployment timeline',
            steps: jarDeploymentTimeline(
              live?.frontendDeploymentRequested ?? viewingOperation?.frontendDeploymentRequested === true,
            ),
            currentStepId: jarDeploymentPhase(operationProgress?.phaseCode)?.timelineId,
            phaseLabel: jarDeploymentPhaseLabel(operationProgress?.phaseCode),
          }
        : null;

  useEffect(() => {
    if (operationId) setExpanded(true);
  }, [operationId]);

  useEffect(() => {
    if (!profileLogOutput) return undefined;
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
        if (errorStatus(error) === 400) {
          mergeActivity({ id: profileId, serverLogAvailable: false }, 'WILDFLY_PROFILE');
          setViewingOperation((current) =>
            current?.resourceType === 'WILDFLY_PROFILE' && current.profileId === profileId
              ? { ...current, profileLogUnavailable: true }
              : current,
          );
        }
        setConnection('disconnected');
        setConnectionError(errorMessage(error));
      });
    return () => {
      disposed = true;
      if (releasedProfileRef.current !== profileId) {
        void unsubscribeProfileLogs(profileId).catch(() => {});
      }
    };
  }, [profileLogOutput, profileId, clearProfileLogs, mergeActivity, setViewingOperation]);

  useEffect(() => {
    if (!terminalOutput) return undefined;
    const terminalUrl = resolvedTerminalEventUrl(live?.terminalEventsUrl || viewingOperation?.terminalEventsUrl, operationId);
    const subscriptionKey = `${operationId}:${terminalUrl}`;
    if (terminalSubscriptionRef.current?.key === subscriptionKey) return undefined;
    const controller = new AbortController();
    let disposed = false;
    terminalSubscriptionRef.current = { key: subscriptionKey, controller };
    terminalLineKeysRef.current.clear();
    setTerminalOutputLines([]);
    setConnection('connecting');
    setConnectionError('');
    void fetchEventSource(terminalUrl, {
      method: 'GET',
      headers: techDriveHeaders(),
      credentials: 'include',
      signal: controller.signal,
      openWhenHidden: true,
      onopen: async (response) => {
        if (response.status === 401) {
          handleSessionRevoked();
          throw new Error('Portal session ended');
        }
        if (!response.ok) throw new Error(`Terminal output stream returned ${response.status}`);
        if (!disposed) setConnection('connected');
      },
      onmessage: (message) => {
        const event = isTerminalOutputEvent(message);
        if (!event || event.deploymentId !== operationId) return;
        const lineKey = message.id || `${event.timestamp}\u0000${event.replayed ? 'replayed' : 'live'}\u0000${event.line}`;
        if (terminalLineKeysRef.current.has(lineKey)) return;
        terminalLineKeysRef.current.add(lineKey);
        if (terminalLineKeysRef.current.size > 2000) {
          const oldest = terminalLineKeysRef.current.values().next().value;
          if (oldest) terminalLineKeysRef.current.delete(oldest);
        }
        setTerminalOutputLines((current) => [...current, event].slice(-1000));
      },
      onclose: () => {
        if (terminalSubscriptionRef.current?.controller === controller) terminalSubscriptionRef.current = null;
        if (!disposed) setConnection('disconnected');
      },
      onerror: (error) => {
        if (!disposed) {
          setConnection('reconnecting');
          setConnectionError(errorMessage(error, 'Unable to stream terminal output.'));
        }
        return 3000;
      },
    }).catch((error: unknown) => {
      if (!disposed && !controller.signal.aborted) {
        setConnection('disconnected');
        setConnectionError(errorMessage(error, 'Unable to stream terminal output.'));
      }
    });
    return () => {
      disposed = true;
      controller.abort();
      if (terminalSubscriptionRef.current?.controller === controller) terminalSubscriptionRef.current = null;
    };
  }, [handleSessionRevoked, terminalOutput, live?.terminalEventsUrl, operationId, viewingOperation?.terminalEventsUrl]);

  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [autoScroll, outputLines]);

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
    if (profileLogOutput) {
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
    if (terminalOutput && operationId) {
      setViewingOperation(null);
      return;
    }
    setViewingOperation(null);
  };

  const stopSelectedProfile = async () => {
    if (!window.confirm(`Stop profile ${viewingOperation.profile || profileId}?`)) return;
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
      <CardHeader className={hasOutput ? 'max-h-[60%] shrink-0 overflow-y-auto p-4' : 'flex min-h-0 flex-1 overflow-y-auto p-4'}>
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
        {operationId && <span className="truncate font-mono text-xs text-muted-foreground">{operationId}</span>}
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full ${failed ? 'bg-red-500' : cancelled ? 'bg-slate-500' : 'bg-primary'} transition-all`}
            style={{ width: `${progressWidth}%` }}
          />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {phaseCode && (
            <span>
              Phase: <strong className="text-foreground">{timeline?.phaseLabel || phaseCode}</strong>{' '}
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
        {rollbackFailed &&
          operationProgress?.rollbackFailureMessage &&
          operationProgress.rollbackFailureMessage !== operationProgress.failureMessage && (
            <p className="text-sm text-red-700">{operationProgress.rollbackFailureMessage}</p>
          )}
        {timeline && timeline.steps.length > 0 && (
          <TooltipProvider delayDuration={200}>
            <ol
              className="grid gap-1 rounded-md border border-border bg-muted/15 p-2 text-xs sm:grid-cols-3"
              aria-label={timeline.ariaLabel}
            >
              {timeline.steps.map((step, index) => (
                <TimelineStepItem
                  key={step.id}
                  index={index + 1}
                  label={step.label}
                  description={step.description}
                  current={timeline.currentStepId === step.id}
                />
              ))}
            </ol>
          </TooltipProvider>
        )}
        {progressSteps.length > 0 && (
          <div
            className={
              hasOutput
                ? 'max-h-40 overflow-auto rounded-md border border-border bg-muted/15 p-2'
                : 'flex min-h-0 flex-1 overflow-auto rounded-md border border-border bg-muted/15 p-2'
            }
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
                  profileName={viewingOperation.profile || profileId}
                  disabled={!!actionState}
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
      {hasOutput && (
        <CardContent className="flex min-h-0 flex-1 flex-col p-4 pt-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs font-medium">
              <Terminal className="h-3.5 w-3.5" />
              {resourceType === 'JAR' ? 'JAR output' : 'Profile output'}
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
            {outputSource === 'terminal-pending' ? (
              <span className="text-muted-foreground">Waiting for terminal output to become available…</span>
            ) : outputLines.length ? (
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
