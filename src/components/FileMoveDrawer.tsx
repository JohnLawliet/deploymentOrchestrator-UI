import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, FolderInput, Loader2, X } from 'lucide-react';
import FileBrowser from '@/components/FileBrowser';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/PagePrimitives';
import { useOptionalPortal } from '@/context/PortalContext';
import { type ApiRequestError, getFileRoots, getProfiles, isLockConflict, moveFiles, preflightFileMove } from '@/lib/contractApi';
import {
  archiveFormatForRequest,
  archiveFormatLabel,
  archiveFormatOptions,
  defaultArchiveFormat,
  isCrossRootArchiveRequired,
  previewArchiveFileName,
  sharedProfileBasePath,
  type FileMoveArchiveChoice,
} from '@/lib/qcProfilePaths';
import { fileMoveDisplayPercentage, fileMovePhase, fileMovePhaseLabel, fileMoveTimeline } from '@/lib/fileMoveProgress';
import { isFileMoveProgress } from '@/lib/operationProgress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { errorMessage } from '@/types/frontend';
import type {
  FileMoveConflict,
  FileMoveItemOutcome,
  FileMovePreflightResponse,
  FileMoveProgressDto,
  FileMoveResult,
  MoveRequest,
  RootKey,
  SystemEvent,
} from '@/types/api-contracts';

function FileMoveTimelineStepItem({
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

type DrawerPhase = 'pickDest' | 'confirmOverwrite' | 'blockedAdmin' | 'moving' | 'done';

type FileMoveDrawerProps = {
  open: boolean;
  sourceRootKey: RootKey;
  sourcePaths: string[];
  onClose: () => void;
  onFinished: (result: FileMoveResult | null) => void;
};

const rootLabel = (key: RootKey): string => {
  if (key === 'qc') return 'QC';
  if (key === 'techDrive') return 'Tech Drive';
  return key;
};

function allowedDestinationRoots(sourceRootKey: RootKey, isAdmin: boolean): RootKey[] {
  if (sourceRootKey === 'techDrive') return ['techDrive'];
  if (sourceRootKey === 'qc') return isAdmin ? ['qc', 'techDrive'] : ['qc'];
  return [sourceRootKey];
}

function isSelfOrNestedDestination(sourcePaths: string[], destinationPath: string): boolean {
  const dest = destinationPath === '.' ? '' : destinationPath.replace(/\/$/, '');
  return sourcePaths.some((source) => {
    const src = source.replace(/\/$/, '');
    if (!dest) return src === '.' || src === '';
    return src === dest || dest.startsWith(`${src}/`);
  });
}

function moveErrorMessage(reason: unknown): string {
  const error = reason as Partial<ApiRequestError>;
  if (error.code === 'ADMIN_REQUIRED' || error.status === 403)
    return error.message || 'This move requires an administrator (qc → Tech Drive, or leaving a WildFly profile directory).';
  if (error.code === 'TARGET_EXISTS' || error.status === 409)
    return error.message || 'One or more destinations already exist. Confirm overwrite to replace them.';
  if (error.code === 'INVALID_MOVE_REQUEST' || error.status === 400) return error.message || 'This move is not allowed.';
  if (error.code === 'RESOURCE_LOCKED' || error.status === 423)
    return error.message || 'The selected paths are locked by another user.';
  if (error.code === 'SOURCE_NOT_FOUND' || error.status === 404)
    return error.message || 'One or more source items were not found.';
  if (error.code === 'ROOT_READ_ONLY' || error.code === 'SOURCE_NOT_READABLE')
    return error.message || 'The source cannot be moved.';
  return errorMessage(reason, 'Unable to move the selected items.');
}

function ItemList({ title, items, empty }: { title: string; items: FileMoveItemOutcome[]; empty: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-muted-foreground">
        {title} ({items.length})
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="max-h-28 space-y-1 overflow-y-auto font-mono text-xs">
          {items.map((item) => (
            <li key={`${item.sourceRootKey}:${item.sourcePath}`}>
              {item.sourcePath}
              {item.destinationPath ? <span className="text-muted-foreground"> → {item.destinationPath}</span> : null}
              {item.message ? <span className="text-red-700"> — {item.message}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function FileMoveDrawer({ open, sourceRootKey, sourcePaths, onClose, onFinished }: FileMoveDrawerProps) {
  const portal = useOptionalPortal();
  const isAdmin = portal?.isAdmin === true;
  const lastSystemEvent = portal?.lastSystemEvent;

  const destinationOptions = useMemo(() => allowedDestinationRoots(sourceRootKey, isAdmin), [sourceRootKey, isAdmin]);
  const [expanded, setExpanded] = useState(true);
  const [phase, setPhase] = useState<DrawerPhase>('pickDest');
  const [destinationRootKey, setDestinationRootKey] = useState<RootKey>(destinationOptions[0] || sourceRootKey);
  const [destinationPath, setDestinationPath] = useState('.');
  const [confineBase, setConfineBase] = useState('.');
  const [archiveChoice, setArchiveChoice] = useState<FileMoveArchiveChoice>(() =>
    defaultArchiveFormat(sourceRootKey, destinationOptions[0] || sourceRootKey),
  );
  const [destRefreshToken, setDestRefreshToken] = useState(0);
  const [preflight, setPreflight] = useState<FileMovePreflightResponse | null>(null);
  const [conflicts, setConflicts] = useState<FileMoveConflict[]>([]);
  const [conflictPaths, setConflictPaths] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [lockUsers, setLockUsers] = useState<string[]>([]);
  const [lockPaths, setLockPaths] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [progress, setProgress] = useState<FileMoveProgressDto | null>(null);
  const [result, setResult] = useState<FileMoveResult | null>(null);
  const destinationPathRef = useRef(destinationPath);
  destinationPathRef.current = destinationPath;

  const formatOptions = useMemo(
    () => archiveFormatOptions(sourceRootKey, destinationRootKey),
    [sourceRootKey, destinationRootKey],
  );
  const crossRootArchive = isCrossRootArchiveRequired(sourceRootKey, destinationRootKey);
  const isArchiving = archiveChoice !== 'NONE';

  const resetPreflightGates = useCallback(() => {
    setPhase((current) => (current === 'blockedAdmin' || current === 'confirmOverwrite' ? 'pickDest' : current));
    setPreflight(null);
    setConflicts([]);
    setConflictPaths([]);
    setError('');
  }, []);

  const handleDestinationPathChange = useCallback(
    (path: string) => {
      if (destinationPathRef.current !== path) resetPreflightGates();
      setDestinationPath(path);
    },
    [resetPreflightGates],
  );

  const buildMovePayload = useCallback(
    (overwriteConfirmed = false): MoveRequest => {
      const archiveFormat = archiveFormatForRequest(archiveChoice, sourceRootKey, destinationRootKey);
      return {
        source: { rootKey: sourceRootKey, paths: sourcePaths },
        destination: { rootKey: destinationRootKey, path: destinationPath },
        overwriteConfirmed,
        archiveFormat,
      };
    },
    [archiveChoice, destinationPath, destinationRootKey, sourcePaths, sourceRootKey],
  );

  useEffect(() => {
    if (!open) return;
    const initialRoot = destinationOptions[0] || sourceRootKey;
    setExpanded(true);
    setPhase('pickDest');
    setDestinationRootKey(initialRoot);
    setDestinationPath('.');
    setConfineBase('.');
    setArchiveChoice(defaultArchiveFormat(sourceRootKey, initialRoot));
    setDestRefreshToken((value) => value + 1);
    setPreflight(null);
    setConflicts([]);
    setConflictPaths([]);
    setError('');
    setLockUsers([]);
    setLockPaths([]);
    setBusy(false);
    setOperationId(null);
    setProgress(null);
    setResult(null);
  }, [open, destinationOptions, sourceRootKey]);

  useEffect(() => {
    if (!open || sourceRootKey !== 'qc' || isAdmin) return;
    const controller = new AbortController();
    Promise.all([getProfiles(), getFileRoots()])
      .then(([profiles, roots]) => {
        if (controller.signal.aborted) return;
        const qcRoot = roots.find((root) => root.key === 'qc')?.path;
        if (!qcRoot) {
          setConfineBase('.');
          setDestinationPath('.');
          return;
        }
        const base =
          sharedProfileBasePath(
            sourcePaths,
            profiles.map((profile) => profile.profileDir),
            qcRoot,
          ) ?? '.';
        setConfineBase(base);
        setDestinationPath(base);
        setDestRefreshToken((value) => value + 1);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setConfineBase('.');
        setDestinationPath('.');
      });
    return () => controller.abort();
  }, [open, sourceRootKey, isAdmin, sourcePaths]);

  useEffect(() => {
    if (!open || !lastSystemEvent || !('eventType' in lastSystemEvent)) return;
    const event = lastSystemEvent as SystemEvent;
    if (event.eventType === 'OPERATION_PROGRESS' && event.resourceType === 'FILE' && isFileMoveProgress(event.resources)) {
      const payload = event.resources;
      if (operationId) {
        if (payload.operationId !== operationId && event.deploymentId !== operationId) return;
      } else if (phase !== 'moving') {
        return;
      } else {
        setOperationId(payload.operationId);
      }
      setProgress(payload);
      return;
    }
    if (event.eventType === 'OPERATION_FINISHED') {
      const finishedId = event.resources.operationId || event.deploymentId;
      if (finishedId && finishedId === operationId) {
        setDestRefreshToken((value) => value + 1);
        setProgress((current) =>
          current && current.operationId === finishedId
            ? {
                ...current,
                pendingCount: 0,
                pending: [],
                progressPercentage: 100,
                phaseCode: current.failedCount > 0 ? 'FILE_MOVE_ITEM_FAILED' : 'FILE_MOVE_ITEM_COMPLETED',
              }
            : current,
        );
      }
    }
  }, [lastSystemEvent, open, operationId, phase]);

  if (!open) return null;

  const invalidDestination = isSelfOrNestedDestination(sourcePaths, destinationPath);
  const moveDone = phase === 'done' || !!result;
  const progressPercent = fileMoveDisplayPercentage(progress, { done: moveDone });
  const completed = phase === 'done' && result ? result.completed : (progress?.completed ?? result?.completed ?? []);
  const failed = phase === 'done' && result ? result.failed : (progress?.failed ?? result?.failed ?? []);
  const pending = progress?.pending ?? [];
  const browserBasePath = sourceRootKey === 'qc' && !isAdmin && destinationRootKey === 'qc' ? confineBase : '.';
  const phaseLabel = fileMovePhaseLabel(progress?.phaseCode) || progress?.phaseCode || null;
  const timelineSteps = fileMoveTimeline(isArchiving);
  const currentTimelineId = moveDone ? 'complete' : fileMovePhase(progress?.phaseCode)?.timelineId;
  const plannedArchiveDestination = isArchiving ? (preflight?.moves[0]?.destinationPath ?? null) : null;
  const archivePreview =
    plannedArchiveDestination ??
    (isArchiving && sourcePaths.length === 1
      ? `${destinationPath === '.' ? '' : `${destinationPath}/`}${previewArchiveFileName(
          sourcePaths[0],
          archiveChoice as 'ZIP' | 'WAR' | 'JAR',
        )}`
      : isArchiving
        ? 'Generated archive name assigned during preflight'
        : null);

  const runPreflight = async () => {
    if (!sourcePaths.length || busy || invalidDestination) return;
    setBusy(true);
    setError('');
    setLockUsers([]);
    setLockPaths([]);
    setConflictPaths([]);
    try {
      const response = await preflightFileMove(buildMovePayload());
      setPreflight(response);
      if (response.adminRequired && !isAdmin) {
        setPhase('blockedAdmin');
        return;
      }
      if (response.conflicts.length > 0) {
        setConflicts(response.conflicts);
        setPhase('confirmOverwrite');
        return;
      }
      await executeMove(false, false);
    } catch (reason: unknown) {
      applyMoveFailure(reason);
    } finally {
      setBusy(false);
    }
  };

  const executeMove = async (overwriteConfirmed: boolean, manageBusy = true) => {
    if (manageBusy) setBusy(true);
    setError('');
    setLockUsers([]);
    setLockPaths([]);
    setPhase('moving');
    try {
      const response = await moveFiles(buildMovePayload(overwriteConfirmed));
      setOperationId(response.operationId);
      setResult(response);
      setProgress({
        operationId: response.operationId,
        totalCount: response.totalCount,
        completedCount: response.completed.length,
        failedCount: response.failed.length,
        pendingCount: 0,
        progressPercentage: 100,
        currentSourcePath: null,
        currentDestinationPath: null,
        phaseCode: response.failed.length > 0 ? 'FILE_MOVE_ITEM_FAILED' : 'FILE_MOVE_ITEM_COMPLETED',
        completed: response.completed,
        failed: response.failed,
        pending: [],
      });
      setPhase('done');
      setDestRefreshToken((value) => value + 1);
      onFinished(response);
    } catch (reason: unknown) {
      applyMoveFailure(reason);
    } finally {
      if (manageBusy) setBusy(false);
    }
  };

  const applyMoveFailure = (reason: unknown) => {
    const requestError = reason as Partial<ApiRequestError>;
    if (isLockConflict(reason)) {
      setLockUsers(requestError.users || []);
      setLockPaths(requestError.paths || []);
      setError(moveErrorMessage(reason));
      setPhase('pickDest');
      return;
    }
    if (requestError.code === 'ADMIN_REQUIRED' || (requestError.status === 403 && requestError.code !== 'ROOT_READ_ONLY')) {
      setPhase('blockedAdmin');
      setError(moveErrorMessage(reason));
      return;
    }
    if (requestError.code === 'TARGET_EXISTS' || requestError.status === 409) {
      setConflictPaths(requestError.paths || []);
      setConflicts(
        (requestError.paths || []).map((path) => ({
          sourceRootKey,
          sourcePath: '',
          destinationRootKey,
          destinationPath: path,
          name: path.split('/').pop() || path,
        })),
      );
      setPhase('confirmOverwrite');
      setError(moveErrorMessage(reason));
      return;
    }
    setError(moveErrorMessage(reason));
    setPhase('pickDest');
  };

  const closeDrawer = () => {
    if (busy && phase === 'moving') return;
    onClose();
  };

  const headerStatus =
    phase === 'moving'
      ? phaseLabel || 'Moving…'
      : phase === 'done'
        ? failed.length
          ? 'Finished with errors'
          : 'Completed'
        : 'Choose destination';

  return (
    <Card
      className={`fixed bottom-4 left-[calc(var(--sidebar-width)+1.25rem)] right-5 z-50 border-primary/25 shadow-glow ${
        expanded ? 'top-4 flex flex-col overflow-hidden' : ''
      }`}
      data-testid="file-move-drawer"
    >
      {!expanded ? (
        <div className="flex min-w-0 items-center gap-3 p-3">
          <FolderInput className="h-4 w-4 shrink-0 text-primary" />
          <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setExpanded(true)}>
            <span className="truncate text-sm font-semibold">Move {sourcePaths.length} selected item(s)</span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{headerStatus}</span>
          </button>
          <Button variant="ghost" size="icon" aria-label="Expand move drawer" onClick={() => setExpanded(true)}>
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close move drawer"
            disabled={busy && phase === 'moving'}
            onClick={closeDrawer}
          >
            <X className="h-4 w-4" />
          </Button>
          {(phase === 'moving' || phase === 'done') && (
            <div className="absolute bottom-0 left-0 right-0 h-1 overflow-hidden bg-muted">
              <div
                role="progressbar"
                aria-valuenow={Math.round(progressPercent)}
                aria-valuemin={0}
                aria-valuemax={100}
                className={`h-full ${failed.length ? 'bg-red-500' : 'bg-primary'} transition-all`}
                style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
              />
            </div>
          )}
        </div>
      ) : (
        <>
          <CardHeader className="shrink-0 space-y-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FolderInput className="h-4 w-4 text-primary" />
                Move {sourcePaths.length} selected item(s)
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" aria-label="Collapse move drawer" onClick={() => setExpanded(false)}>
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close move drawer"
                  disabled={busy && phase === 'moving'}
                  onClick={closeDrawer}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              From <strong className="text-foreground">{rootLabel(sourceRootKey)}</strong> · {headerStatus}
              {operationId ? (
                <>
                  {' '}
                  · <span className="font-mono">{operationId}</span>
                </>
              ) : null}
            </p>
            {(phase === 'moving' || phase === 'done') && (
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  role="progressbar"
                  aria-valuenow={Math.round(progressPercent)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className={`h-full ${failed.length ? 'bg-red-500' : 'bg-primary'} transition-all`}
                  style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
                />
              </div>
            )}
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 pt-0">
            {error && (
              <Notice tone="error">
                <div>{error}</div>
                {lockUsers.length > 0 && <div className="mt-1">Users: {lockUsers.join(', ')}</div>}
                {lockPaths.length > 0 && <div className="mt-1 font-mono text-xs">{lockPaths.join(', ')}</div>}
              </Notice>
            )}

            {phase === 'blockedAdmin' && (
              <Notice tone="warning">
                This move requires an administrator (qc → Tech Drive, or moving out of a registered WildFly profile directory).
                Choose a destination inside the profile to continue.
              </Notice>
            )}

            {(phase === 'pickDest' || phase === 'blockedAdmin') && (
              <>
                <div className="space-y-2">
                  {destinationOptions.length === 1 ? (
                    <p className="text-sm">
                      <span className="font-medium">Destination root:</span> {rootLabel(destinationOptions[0])}
                    </p>
                  ) : (
                    <>
                      <label className="text-sm font-medium" htmlFor="file-move-destination-root">
                        Destination root
                      </label>
                      <select
                        id="file-move-destination-root"
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                        value={destinationRootKey}
                        disabled={busy}
                        onChange={(event) => {
                          const nextRoot = event.target.value as RootKey;
                          setDestinationRootKey(nextRoot);
                          setDestinationPath('.');
                          setArchiveChoice(defaultArchiveFormat(sourceRootKey, nextRoot));
                          setDestRefreshToken((value) => value + 1);
                          resetPreflightGates();
                        }}
                      >
                        {destinationOptions.map((key) => (
                          <option key={key} value={key}>
                            {rootLabel(key)}
                          </option>
                        ))}
                      </select>
                      {sourceRootKey === 'qc' && destinationOptions.includes('techDrive') && (
                        <p className="text-xs text-muted-foreground">Moving to Tech Drive requires an administrator.</p>
                      )}
                    </>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="file-move-archive-format">
                    Transfer mode
                  </label>
                  <select
                    id="file-move-archive-format"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                    value={archiveChoice}
                    disabled={busy}
                    onChange={(event) => {
                      setArchiveChoice(event.target.value as FileMoveArchiveChoice);
                      resetPreflightGates();
                    }}
                  >
                    {formatOptions.map((option) => (
                      <option key={option} value={option}>
                        {option === 'NONE' ? 'Move as-is' : `Archive as ${archiveFormatLabel(option)}`}
                      </option>
                    ))}
                  </select>
                  {crossRootArchive ? (
                    <p className="text-xs text-muted-foreground">
                      Selections are archived as a single file before transfer to Tech Drive. To explode an archive later, use
                      Extract (can be slow for large WARs).
                    </p>
                  ) : isArchiving ? (
                    <p className="text-xs text-muted-foreground">
                      Selections are packed into one archive. To explode it later, use Extract (can be slow for large WARs on Tech
                      Drive).
                    </p>
                  ) : null}
                  {archivePreview ? (
                    <p className="text-xs text-muted-foreground">
                      Preview: <span className="font-mono text-foreground">{archivePreview}</span>
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    Destination folder:{' '}
                    <span className="font-mono text-muted-foreground">
                      {destinationPath === '.' ? '(root)' : destinationPath}
                    </span>
                  </p>
                  <FileBrowser
                    rootKey={destinationRootKey}
                    selectableType="directory"
                    enableMove={false}
                    enableDelete={false}
                    refreshToken={destRefreshToken}
                    disabled={busy}
                    basePath={browserBasePath}
                    onPathChange={handleDestinationPathChange}
                  />
                </div>
                {invalidDestination && (
                  <Notice tone="warning">Choose a destination that is not one of the selected items or inside them.</Notice>
                )}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="outline" disabled={busy} onClick={closeDrawer}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || invalidDestination || phase === 'blockedAdmin'}
                    onClick={() => void runPreflight()}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {busy ? 'Checking…' : 'Move here'}
                  </Button>
                </div>
              </>
            )}

            {phase === 'confirmOverwrite' && (
              <div className="space-y-3">
                <Notice tone="warning">These destinations already exist and will be overwritten if you continue.</Notice>
                <ul className="max-h-40 space-y-1 overflow-y-auto font-mono text-xs">
                  {(conflicts.length ? conflicts : conflictPaths.map((path) => ({ name: path, destinationPath: path }))).map(
                    (item) => (
                      <li key={item.destinationPath}>
                        {item.name}
                        {item.destinationPath !== item.name ? ` → ${item.destinationPath}` : ''}
                      </li>
                    ),
                  )}
                </ul>
                <p className="text-xs text-muted-foreground">
                  {preflight?.totalCount ?? sourcePaths.length} planned item(s) will be moved to{' '}
                  <span className="font-mono">
                    {rootLabel(destinationRootKey)}/
                    {plannedArchiveDestination ?? (destinationPath === '.' ? '' : destinationPath)}
                  </span>
                  {isArchiving ? ' as an archive' : ''}
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setPhase('pickDest');
                      setError('');
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="button" disabled={busy} onClick={() => void executeMove(true)}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Overwrite and move
                  </Button>
                </div>
              </div>
            )}

            {(phase === 'moving' || phase === 'done') && (
              <div className="space-y-4">
                {phase === 'moving' && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {progress?.phaseCode ? (
                        <span>
                          Phase: <strong className="text-foreground">{phaseLabel}</strong>{' '}
                          <span className="font-mono">({progress.phaseCode})</span>
                        </span>
                      ) : (
                        <span className="text-sm font-medium text-foreground">{phaseLabel || 'Moving…'}</span>
                      )}
                      <span>
                        Progress: <strong className="text-foreground">{Math.round(progressPercent)}%</strong>
                      </span>
                    </div>
                    {progress?.currentSourcePath ? (
                      <p className="text-xs text-muted-foreground">
                        Current: <span className="font-mono text-foreground">{progress.currentSourcePath}</span>
                        {progress.currentDestinationPath ? (
                          <>
                            {' '}
                            → <span className="font-mono text-foreground">{progress.currentDestinationPath}</span>
                          </>
                        ) : null}
                      </p>
                    ) : null}
                    {!progress?.currentDestinationPath && plannedArchiveDestination ? (
                      <p className="text-xs text-muted-foreground">
                        Archive: <span className="font-mono text-foreground">{plannedArchiveDestination}</span>
                      </p>
                    ) : null}
                    <TooltipProvider delayDuration={200}>
                      <ol
                        className="grid gap-1 rounded-md border border-border bg-muted/15 p-2 text-xs sm:grid-cols-3"
                        aria-label={isArchiving ? 'File move archive timeline' : 'File move timeline'}
                      >
                        {timelineSteps.map((step, index) => (
                          <FileMoveTimelineStepItem
                            key={step.id}
                            index={index + 1}
                            label={step.label}
                            description={step.description}
                            current={currentTimelineId === step.id}
                          />
                        ))}
                      </ol>
                    </TooltipProvider>
                  </div>
                )}
                {phase === 'done' && (
                  <>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        Phase:{' '}
                        <strong className="text-foreground">
                          {failed.length
                            ? fileMovePhaseLabel('FILE_MOVE_ITEM_FAILED')
                            : fileMovePhaseLabel('FILE_MOVE_ITEM_COMPLETED')}
                        </strong>
                      </span>
                      <span>
                        Progress: <strong className="text-foreground">100%</strong>
                      </span>
                    </div>
                    <TooltipProvider delayDuration={200}>
                      <ol
                        className="grid gap-1 rounded-md border border-border bg-muted/15 p-2 text-xs sm:grid-cols-3"
                        aria-label={isArchiving ? 'File move archive timeline' : 'File move timeline'}
                      >
                        {timelineSteps.map((step, index) => (
                          <FileMoveTimelineStepItem
                            key={step.id}
                            index={index + 1}
                            label={step.label}
                            description={step.description}
                            current={step.id === 'complete'}
                          />
                        ))}
                      </ol>
                    </TooltipProvider>
                    {completed.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-muted-foreground">Destination path(s)</p>
                        <ul className="max-h-28 space-y-1 overflow-y-auto font-mono text-xs">
                          {completed.map((item) => (
                            <li key={`${item.sourceRootKey}:${item.sourcePath}:${item.destinationPath}`}>
                              {item.destinationPath || item.sourcePath}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {failed.length > 0 ? <ItemList title="Failed" items={failed} empty="No failures." /> : null}
                    {!isArchiving && completed.length > 1 ? (
                      <ItemList title="Completed" items={completed} empty="No completed items." />
                    ) : null}
                    <div className="flex justify-end">
                      <Button type="button" onClick={closeDrawer}>
                        Close
                      </Button>
                    </div>
                  </>
                )}
                {phase === 'moving' && failed.length > 0 ? <ItemList title="Failed" items={failed} empty="No failures." /> : null}
                {phase === 'moving' && !isArchiving && pending.length > 0 ? (
                  <ItemList title="Pending" items={pending} empty="No pending items." />
                ) : null}
              </div>
            )}
          </CardContent>
        </>
      )}
    </Card>
  );
}
