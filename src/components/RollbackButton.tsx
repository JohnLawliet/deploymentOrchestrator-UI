import { useMemo, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { getWarSnapshots, isLockConflict, rollbackWar } from '@/lib/contractApi';
import { isOperationTerminal } from '@/lib/operationProgress';
import { usePortal } from '@/context/PortalContext';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { errorMessage, type AsyncState } from '@/types/frontend';
import type { WarSnapshotSummary } from '@/types/api-contracts';

const rollbackOperationType = 'WAR_ROLLBACK';

function snapshotTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function RollbackButton({
  profileId,
  profileName,
  disabled = false,
  className = '',
  buttonClassName = '',
}: {
  profileId: string;
  profileName?: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
}) {
  const { registerOperation, operations } = usePortal();
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<WarSnapshotSummary[]>([]);
  const [state, setState] = useState<AsyncState>('idle');
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const sortedSnapshots = useMemo(
    () => [...snapshots].sort((left, right) => Date.parse(right.createdAt || '') - Date.parse(left.createdAt || '')),
    [snapshots],
  );
  const rollbackBusy = Object.values(operations).some(
    (operation) =>
      operation.operationType === rollbackOperationType &&
      operation.resourceKey === `WILDFLY_PROFILE:${profileId}` &&
      !isOperationTerminal(operation),
  );

  const loadSnapshots = async () => {
    setState('loading');
    setError('');
    try {
      const result = await getWarSnapshots(profileId);
      setSnapshots(Array.isArray(result) ? result : []);
      setState('ready');
    } catch (reason: unknown) {
      setSnapshots([]);
      setError(errorMessage(reason));
      setState('error');
    }
  };

  const changeOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) void loadSnapshots();
  };

  const selectSnapshot = async (snapshot: WarSnapshotSummary) => {
    if (!window.confirm(`Rollback ${profileName || profileId} to snapshot ${snapshot.snapshotId}?`)) return;
    setSelectedId(String(snapshot.snapshotId));
    setError('');
    try {
      const operation = await rollbackWar(snapshot.snapshotId);
      registerOperation(
        { ...operation, operationType: rollbackOperationType },
        `WILDFLY_PROFILE:${profileId}`,
        `Rollback WAR · ${profileName || profileId}`,
      );
      setOpen(false);
    } catch (reason: unknown) {
      setError(isLockConflict(reason) ? `Profile conflict: ${errorMessage(reason)}` : errorMessage(reason));
    } finally {
      setSelectedId('');
    }
  };

  return (
    <div className={className}>
      <Popover open={open} onOpenChange={changeOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={`gap-2 ${buttonClassName}`}
            disabled={disabled || rollbackBusy || state === 'loading' || !!selectedId}
            aria-expanded={open}
          >
            {state === 'loading' || selectedId ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            {selectedId || rollbackBusy ? 'Rollback running…' : 'Rollback to previous version'}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={16}
          className="w-[min(34rem,calc(100vw-2rem))] max-h-[var(--radix-popover-content-available-height)] overflow-auto p-2"
        >
          {state === 'loading' && (
            <p className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading snapshots…
            </p>
          )}
          {state === 'error' && (
            <p className="p-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}
          {state === 'ready' && !sortedSnapshots.length && (
            <p className="p-2 text-sm text-muted-foreground">Profile doesn't have rollback snapshots.</p>
          )}
          {state === 'ready' && sortedSnapshots.length > 0 && (
            <div className="max-h-64 overflow-auto">
              {sortedSnapshots.map((snapshot) => (
                <button
                  type="button"
                  key={snapshot.snapshotId}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-4 rounded px-2 py-2 text-left text-xs hover:bg-muted disabled:opacity-50"
                  disabled={!!selectedId}
                  onClick={() => selectSnapshot(snapshot)}
                >
                  <span className="truncate font-mono">{snapshot.snapshotId}</span>
                  <span className="text-right text-muted-foreground">{snapshotTime(snapshot.createdAt)}</span>
                </button>
              ))}
            </div>
          )}
          {error && state !== 'error' && (
            <p className="p-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
