import { useMemo, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { getWarSnapshots, isLockConflict, rollbackWar } from '@/lib/contractApi'
import { isOperationTerminal } from '@/lib/operationProgress'
import { usePortal } from '@/context/PortalContext'
import { Button } from '@/components/ui/button'

const rollbackOperationType = 'WAR_ROLLBACK'

function snapshotTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown date'
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export default function RollbackButton({
  profileId,
  profileName,
  disabled = false,
  className = '',
  buttonClassName = '',
}) {
  const { username, registerOperation, operations } = usePortal()
  const [open, setOpen] = useState(false)
  const [snapshots, setSnapshots] = useState([])
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const sortedSnapshots = useMemo(
    () => [...snapshots].sort((left, right) => Date.parse(right.createdAt || '') - Date.parse(left.createdAt || '')),
    [snapshots],
  )
  const rollbackBusy = Object.values(operations).some(
    (operation) =>
      operation.operationType === rollbackOperationType
      && operation.resourceKey === `WILDFLY_PROFILE:${profileId}`
      && !isOperationTerminal(operation),
  )

  const toggle = async () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    setState('loading')
    setError('')
    try {
      const result = await getWarSnapshots(profileId)
      setSnapshots(Array.isArray(result) ? result : [])
      setState('ready')
    } catch (reason) {
      setSnapshots([])
      setError(reason.message)
      setState('error')
    }
  }

  const selectSnapshot = async (snapshot) => {
    if (!window.confirm(`Rollback ${profileName || profileId} to snapshot ${snapshot.snapshotId}?`)) return
    setSelectedId(snapshot.snapshotId)
    setError('')
    try {
      const operation = await rollbackWar(snapshot.snapshotId, username)
      registerOperation(
        { ...operation, operationType: rollbackOperationType },
        `WILDFLY_PROFILE:${profileId}`,
        `Rollback WAR · ${profileName || profileId}`,
      )
      setOpen(false)
    } catch (reason) {
      setError(isLockConflict(reason) ? `Profile conflict: ${reason.message}` : reason.message)
    } finally {
      setSelectedId('')
    }
  }

  return (
    <div className={`relative ${className}`}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={`gap-2 ${buttonClassName}`}
        disabled={disabled || rollbackBusy || state === 'loading' || !!selectedId}
        aria-expanded={open}
        onClick={toggle}
      >
        {state === 'loading' || selectedId
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <RotateCcw className="h-3.5 w-3.5" />}
        {selectedId || rollbackBusy ? 'Rollback running…' : 'Rollback to previous version'}
      </Button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 w-[min(34rem,calc(100vw-3rem))] rounded-md border border-border bg-background p-2 shadow-lg">
          {state === 'loading' && (
            <p className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading snapshots…
            </p>
          )}
          {state === 'error' && <p className="p-2 text-sm text-red-700" role="alert">{error}</p>}
          {state === 'ready' && !sortedSnapshots.length && (
            <p className="p-2 text-sm text-muted-foreground">No snapshots found</p>
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
          {error && state !== 'error' && <p className="p-2 text-sm text-red-700" role="alert">{error}</p>}
        </div>
      )}
    </div>
  )
}
