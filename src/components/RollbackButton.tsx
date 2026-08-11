import { useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { isLockConflict, rollbackWar } from '@/lib/contractApi';
import { isOperationTerminal } from '@/lib/operationProgress';
import { usePortal } from '@/context/PortalContext';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/types/frontend';

const rollbackOperationType = 'WAR_ROLLBACK';

export default function RollbackButton({
  profileId,
  backupSnapshotId,
  profileName,
  disabled = false,
  className = '',
  buttonClassName = '',
}: {
  profileId: string;
  backupSnapshotId: number | null | undefined;
  profileName?: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
}) {
  const { registerOperation, operations } = usePortal();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const rollbackBusy = Object.values(operations).some(
    (operation) =>
      operation.operationType === rollbackOperationType &&
      operation.resourceKey === `WILDFLY_PROFILE:${profileId}` &&
      !isOperationTerminal(operation),
  );

  const startRollback = async () => {
    if (typeof backupSnapshotId !== 'number') return;
    if (!window.confirm(`Rollback ${profileName || profileId} to its current eligible backup?`)) return;
    setSubmitting(true);
    setError('');
    try {
      const operation = await rollbackWar(backupSnapshotId);
      registerOperation(
        { ...operation, operationType: rollbackOperationType },
        `WILDFLY_PROFILE:${profileId}`,
        `Rollback WAR · ${profileName || profileId}`,
      );
    } catch (reason: unknown) {
      setError(isLockConflict(reason) ? `Profile conflict: ${errorMessage(reason)}` : errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={className}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={`gap-2 ${buttonClassName}`}
        disabled={disabled || typeof backupSnapshotId !== 'number' || rollbackBusy || submitting}
        onClick={startRollback}
      >
        {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
        {submitting || rollbackBusy ? 'Rollback running…' : 'Rollback to previous version'}
      </Button>
      {error && (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
