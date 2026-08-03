import { useMemo, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { getJarSnapshots, isLockConflict, rollbackJar } from '@/lib/contractApi'
import { isOperationTerminal } from '@/lib/operationProgress'
import { usePortal } from '@/context/PortalContext'
import { Button } from '@/components/ui/button'

const rollbackOperationType = 'JAR_ROLLBACK'

function snapshotTime(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString()
}

function yesNo(value) {
  return value === true ? 'Yes' : value === false ? 'No' : 'Unknown'
}

export default function JarRollbackButton({ resourceId, applicationName, disabled = false }) {
  const { registerOperation, operations } = usePortal()
  const [open, setOpen] = useState(false)
  const [snapshots, setSnapshots] = useState([])
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const resourceKey = `JAR:${resourceId}`
  const sortedSnapshots = useMemo(
    () => [...snapshots].sort((left, right) => Date.parse(right.createdAt || '') - Date.parse(left.createdAt || '')),
    [snapshots],
  )
  const rollbackBusy = Object.values(operations).some((operation) => (
    operation.operationType === rollbackOperationType
    && operation.resourceKey === resourceKey
    && !isOperationTerminal(operation)
  ))

  const toggle = async () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    setState('loading')
    setError('')
    try {
      const result = await getJarSnapshots(applicationName)
      setSnapshots(Array.isArray(result) ? result : [])
      setState('ready')
    } catch (reason) {
      setSnapshots([])
      setError(reason.message)
      setState('error')
    }
  }

  const selectSnapshot = async (snapshot) => {
    if (!window.confirm(`Rollback ${applicationName} to snapshot ${snapshot.snapshotId}?`)) return
    setSelectedId(String(snapshot.snapshotId))
    setError('')
    try {
      const operation = await rollbackJar(snapshot.snapshotId)
      registerOperation(
        { ...operation, operationType: rollbackOperationType, resourceType: 'JAR', applicationName },
        resourceKey,
        `Rollback JAR · ${applicationName}`,
      )
      setOpen(false)
    } catch (reason) {
      setError(isLockConflict(reason) ? `Application conflict: ${reason.message}` : reason.message)
    } finally {
      setSelectedId('')
    }
  }

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2"
        disabled={disabled || rollbackBusy || state === 'loading' || !!selectedId}
        aria-expanded={open}
        onClick={toggle}
      >
        {state === 'loading' || selectedId
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <RotateCcw className="h-3.5 w-3.5" />}
        {selectedId || rollbackBusy ? 'Rollback running…' : 'Rollback JAR'}
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-[min(42rem,calc(100vw-3rem))] rounded-md border border-border bg-background p-2 shadow-lg">
          {state === 'loading' && <p className="flex items-center gap-2 p-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading snapshots…</p>}
          {state === 'error' && <p className="p-2 text-sm text-red-700" role="alert">{error}</p>}
          {state === 'ready' && !sortedSnapshots.length && <p className="p-2 text-sm text-muted-foreground">No snapshots found</p>}
          {state === 'ready' && sortedSnapshots.length > 0 && (
            <div className="max-h-72 overflow-auto">
              <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_auto] gap-3 border-b px-2 py-1 text-xs font-medium text-muted-foreground">
                <span>Snapshot / application</span><span>Created</span><span>Launcher</span><span>Was active</span>
              </div>
              {sortedSnapshots.map((snapshot) => (
                <button
                  type="button"
                  key={snapshot.snapshotId}
                  className="grid w-full grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_auto] gap-3 rounded px-2 py-2 text-left text-xs hover:bg-muted disabled:opacity-50"
                  disabled={!!selectedId}
                  onClick={() => selectSnapshot(snapshot)}
                >
                  <span className="min-w-0"><span className="block truncate font-mono">{snapshot.snapshotId}</span><span className="block truncate text-muted-foreground">{snapshot.applicationName}</span></span>
                  <span className="text-muted-foreground">{snapshotTime(snapshot.createdAt)}</span>
                  <span>{yesNo(snapshot.includesLauncher)}</span>
                  <span>{yesNo(snapshot.preDeploymentActive)}</span>
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
