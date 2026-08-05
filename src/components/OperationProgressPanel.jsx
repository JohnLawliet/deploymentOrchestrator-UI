import { useEffect, useRef, useState } from 'react';
import { Activity, ChevronDown, ChevronUp, Download, Loader2, Pause, Play, Power, Terminal, X } from 'lucide-react';
import RollbackButton from '@/components/RollbackButton';
import { usePortal } from '@/context/PortalContext';
import {
  downloadTerminal,
  getOperation,
  saveBlob,
  stopProfile,
  subscribeProfileLogs,
  unsubscribeProfileLogs,
} from '@/lib/contractApi';
import { deploymentIdOf } from '@/lib/deploymentIdentity';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const terminalStates = new Set(['RESOURCE_ACTIVE', 'RESOURCE_FAILED', 'RESOURCE_INACTIVE', 'ACTIVE', 'FAILED', 'INACTIVE']);

const lifecycleStatuses = {
  DEPLOYMENT_FAILED: 'FAILED',
  DEPLOYMENT_SUCCEEDED: 'COMPLETED',
  RESOURCE_FAILED: 'FAILED',
  RESOURCE_ACTIVE: 'ACTIVE',
  RESOURCE_INACTIVE: 'INACTIVE',
};

const missingJarLogMessage = 'No jarDeployment.log was produced because the application launcher did not start.';

export default function OperationProgressPanel() {
  const { viewingOperation, setViewingOperation, operations, reconcileResourceActivity, profileLogLines, clearProfileLogs } =
    usePortal();
  const [record, setRecord] = useState(null);
  const [actionState, setActionState] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [connection, setConnection] = useState('disconnected');
  const [connectionError, setConnectionError] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const outputRef = useRef(null);
  const releasedProfileRef = useRef('');
  const operationId = deploymentIdOf(viewingOperation);
  const live = operationId ? operations[operationId] : null;
  const operationProgress = live?.progress;
  const lifecycleStatus = lifecycleStatuses[live?.statusEvent];
  const status =
    lifecycleStatus ||
    operationProgress?.status ||
    live?.statusEvent ||
    live?.state ||
    record?.status ||
    viewingOperation?.status ||
    'STARTING';
  const statusTerminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(status);
  const phaseCode = statusTerminal ? undefined : operationProgress?.phaseCode || record?.phaseCode;
  const suppliedProgress = Number.isFinite(operationProgress?.progressPercentage)
    ? operationProgress.progressPercentage
    : Number.isFinite(record?.progressPercentage)
      ? record.progressPercentage
      : undefined;
  const completed = status === 'COMPLETED';
  const failed = status.includes('FAILED');
  const cancelled = status === 'CANCELLED';
  const complete = completed || terminalStates.has(status);
  const progress = completed
    ? 100
    : failed || cancelled
      ? undefined
      : (suppliedProgress ?? (terminalStates.has(status) ? 100 : undefined));
  const progressWidth = Math.min(100, Math.max(0, progress ?? 32));
  const message =
    (lifecycleStatus ? live?.message : operationProgress?.message) ||
    live?.message ||
    operationProgress?.message ||
    record?.message ||
    (complete ? 'Operation reached a terminal resource state.' : 'The backend is processing this operation.');
  const badgeVariant = failed ? 'destructive' : completed ? 'success' : cancelled ? 'muted' : complete ? 'success' : 'warning';
  const resourceKey = live?.resourceKey || viewingOperation?.resourceKey || '';
  const resourceType = viewingOperation?.resourceType || (String(resourceKey).startsWith('JAR:') ? 'JAR' : 'WILDFLY_PROFILE');
  const profileId = viewingOperation?.profileId || String(resourceKey).replace(/^WILDFLY_PROFILE:/, '');
  const profileOutput = resourceType === 'WILDFLY_PROFILE' && viewingOperation?.outputRequested && !!profileId;
  const outputLines = profileLogLines?.[profileId] || [];
  const operationType = live?.operationType || viewingOperation?.operationType || record?.type;
  const warDeployment = operationType === 'WAR_DEPLOY' || operationType === 'QC_WAR';
  const showFailedWarLog = false;
  const showJarLog = resourceType === 'JAR' && live?.logAvailable === true;
  const showSuccessfulWarActions =
    completed && warDeployment && String(resourceKey).startsWith('WILDFLY_PROFILE:') && !!profileId;

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
      .catch((error) => {
        if (disposed) return;
        setConnection('disconnected');
        setConnectionError(error.message);
      });
    return () => {
      disposed = true;
      if (releasedProfileRef.current !== profileId) {
        void unsubscribeProfileLogs(profileId).catch(() => {});
      }
    };
  }, [profileOutput, profileId, clearProfileLogs]);

  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [autoScroll, profileLogLines, profileId, profileOutput]);

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
    } catch (error) {
      setActionError(error.status === 404 ? missingJarLogMessage : error.message);
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
      } catch (error) {
        setActionError(error.message);
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
    } catch (error) {
      setActionError(error.message);
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
    <Card className="fixed bottom-4 left-[calc(var(--sidebar-width)+1.25rem)] right-5 z-50 flex max-h-[calc(100vh-2rem)] flex-col overflow-visible border-primary/25 shadow-glow">
      <CardHeader className="min-h-0 overflow-visible p-4">
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
              Phase: <strong className="font-mono text-foreground">{phaseCode}</strong>
            </span>
          )}
          {progress !== undefined && (
            <span>
              Progress: <strong className="text-foreground">{Math.round(progress)}%</strong>
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{message}</p>
        {operationProgress?.steps?.length > 0 && (
          <div
            className="max-h-40 overflow-auto rounded-md border border-border bg-muted/15 p-2"
            aria-label="Operation progress history"
          >
            <ol className="space-y-1.5">
              {operationProgress.steps.map((step, index) => (
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
        {(live?.resources?.rollbackResult || live?.resources?.rollbackMessage) && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-sm">
            <strong>Rollback: {live.resources.rollbackResult || 'reported'}</strong>
            {live.resources.rollbackMessage && <div>{live.resources.rollbackMessage}</div>}
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
                <RollbackButton profileId={profileId} profileName={record?.profile || profileId} disabled={!!actionState} />
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
      {profileOutput && (
        <CardContent className="flex min-h-32 shrink-0 flex-col p-4 pt-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs font-medium">
              <Terminal className="h-3.5 w-3.5" />
              Profile output
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
            className="h-56 min-h-24 overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-xs leading-5 text-foreground"
            aria-live="polite"
          >
            {outputLines.length ? (
              outputLines.map((item, index) => (
                <div className={item.replayed ? 'text-muted-foreground' : ''} key={`${item.timestamp || 'line'}-${index}`}>
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
