import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  FileCheck2,
  Loader2,
  RotateCcw,
  Upload,
  X,
  XCircle,
} from 'lucide-react'
import FileBrowser from '@/components/FileBrowser'
import SearchableProfileSelect from '@/components/SearchableProfileSelect'
import { Notice, Page } from '@/components/PagePrimitives'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FormDescription, FormItem, FormLabel } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { usePortal } from '@/context/PortalContext'
import { createUpload, executeUpload, getUpload, rollbackUploadItem } from '@/lib/contractApi'
import {
  canExecuteWarHotfix,
  displayUploadItemName,
  duplicateUploadItemNames,
  isUploadRunning,
  isUploadTerminal,
  UPLOAD_EVENT_TYPES,
  UPLOAD_MODES,
  UPLOAD_TARGET_KINDS,
  uploadStorageKey,
} from '@/lib/uploadContract'

const list = (value) => Array.isArray(value) ? value : []
const basename = (path) => String(path || '').replace(/\\/g, '/').split('/').pop()
const recoverableOperationError = (error) => [404, 410].includes(error?.status)

export default function UploadPage() {
  const {
    username,
    frontendProfileActivityMap,
    wildflyProfileActivityMap,
    lastSystemEvent,
    systemStatus,
  } = usePortal()
  const [mainMode, setMainMode] = useState('')
  const [hotfixType, setHotfixType] = useState('')
  const [sources, setSources] = useState([])
  const [qcDestination, setQcDestination] = useState([])
  const [frontendQuery, setFrontendQuery] = useState('')
  const [frontendPort, setFrontendPort] = useState('')
  const [wildflyQuery, setWildflyQuery] = useState('')
  const [wildflyProfileId, setWildflyProfileId] = useState('')
  const [operation, setOperation] = useState(null)
  const [selectedTargets, setSelectedTargets] = useState({})
  const [targetSummary, setTargetSummary] = useState('')
  const [pending, setPending] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [rollbackSource, setRollbackSource] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const refreshTimer = useRef(null)
  const previousSystemStatus = useRef(systemStatus)
  const operationRef = useRef(null)

  const frontendProfiles = useMemo(() => Object.values(frontendProfileActivityMap || {}), [frontendProfileActivityMap])
  const wildflyProfiles = useMemo(() => Object.values(wildflyProfileActivityMap || {}), [wildflyProfileActivityMap])
  const selectedFrontend = frontendProfiles.find((profile) => String(profile.port) === frontendPort)
  const selectedWildfly = wildflyProfiles.find((profile) => profile.id === wildflyProfileId)
  const uploadMode = mainMode === 'regular'
    ? UPLOAD_MODES.REGULAR
    : hotfixType === 'frontend'
      ? UPLOAD_MODES.FRONTEND_HOTFIX
      : hotfixType === 'war'
        ? UPLOAD_MODES.WILDFLY_HOTFIX
        : ''
  const operationId = operation?.operationId || ''
  const running = isUploadRunning(operation)
  const terminal = isUploadTerminal(operation)
  const preflight = operation?.status === 'READY' || operation?.status === 'AWAITING_SELECTION'
  const hasFrontendIndex = sources.some((path) => basename(path).toLowerCase() === 'index.html')
  const storageKey = uploadStorageKey(username)

  useEffect(() => { operationRef.current = operation }, [operation])

  const clearStoredOperation = useCallback(() => {
    if (username) sessionStorage.removeItem(storageKey)
  }, [storageKey, username])

  const storeOperation = useCallback((nextOperation) => {
    if (!username || !nextOperation?.operationId || !nextOperation?.mode) return
    sessionStorage.setItem(storageKey, JSON.stringify({
      operationId: nextOperation.operationId,
      mode: nextOperation.mode,
    }))
  }, [storageKey, username])

  const resetWorkflow = useCallback((message = '') => {
    clearStoredOperation()
    operationRef.current = null
    setSources([])
    setQcDestination([])
    setFrontendQuery('')
    setFrontendPort('')
    setWildflyQuery('')
    setWildflyProfileId('')
    setOperation(null)
    setSelectedTargets({})
    setTargetSummary('')
    setPending(false)
    setRefreshing(false)
    setRollbackSource('')
    setError('')
    setNotice(message)
  }, [clearStoredOperation])

  const acceptOperation = useCallback((nextOperation, summary) => {
    if (!nextOperation?.operationId) throw new Error('The backend did not return an upload operation ID.')
    operationRef.current = nextOperation
    if (nextOperation.mode === UPLOAD_MODES.REGULAR) {
      setMainMode('regular')
      setHotfixType('')
    } else if (nextOperation.mode === UPLOAD_MODES.FRONTEND_HOTFIX) {
      setMainMode('hotfix')
      setHotfixType('frontend')
    } else if (nextOperation.mode === UPLOAD_MODES.WILDFLY_HOTFIX) {
      setMainMode('hotfix')
      setHotfixType('war')
    }
    setOperation(nextOperation)
    if (summary) setTargetSummary(summary)
    if (isUploadTerminal(nextOperation)) clearStoredOperation()
    else storeOperation(nextOperation)
  }, [clearStoredOperation, storeOperation])

  const handleExpiredOperation = useCallback((message = 'The saved upload is no longer available. It can be submitted again.') => {
    resetWorkflow(message)
  }, [resetWorkflow])

  const refreshOperation = useCallback(async ({ quiet = false } = {}) => {
    const id = operationRef.current?.operationId
    if (!id) return null
    if (!quiet) setRefreshing(true)
    try {
      const nextOperation = await getUpload(id)
      acceptOperation(nextOperation)
      setError('')
      return nextOperation
    } catch (reason) {
      if (recoverableOperationError(reason)) handleExpiredOperation()
      else setError(reason.message)
      return null
    } finally {
      if (!quiet) setRefreshing(false)
    }
  }, [acceptOperation, handleExpiredOperation])

  useEffect(() => {
    if (!username || operationRef.current) return
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return
    try {
      const restored = JSON.parse(raw)
      if (!restored?.operationId || !Object.values(UPLOAD_MODES).includes(restored.mode)) throw new Error('Invalid saved upload')
      const placeholder = { operationId: restored.operationId, mode: restored.mode, status: 'QUEUED', items: [] }
      if (restored.mode === UPLOAD_MODES.REGULAR) setMainMode('regular')
      else {
        setMainMode('hotfix')
        setHotfixType(restored.mode === UPLOAD_MODES.FRONTEND_HOTFIX ? 'frontend' : 'war')
      }
      operationRef.current = placeholder
      setOperation(placeholder)
      setNotice('Restored the current upload. Retrieving its latest status…')
      setRefreshing(true)
      getUpload(restored.operationId)
        .then((nextOperation) => { acceptOperation(nextOperation); setNotice('') })
        .catch((reason) => {
          if (recoverableOperationError(reason)) handleExpiredOperation()
          else setError(reason.message)
        })
        .finally(() => setRefreshing(false))
    } catch {
      sessionStorage.removeItem(storageKey)
      setNotice('The saved upload reference was invalid and has been cleared.')
    }
  }, [acceptOperation, handleExpiredOperation, storageKey, username])

  useEffect(() => {
    const current = operationRef.current
    const event = lastSystemEvent
    if (!current?.operationId || isUploadTerminal(current) || !UPLOAD_EVENT_TYPES.has(event?.eventType)) return
    if (String(event.deploymentId || '') !== String(current.operationId)) return
    window.clearTimeout(refreshTimer.current)
    refreshTimer.current = window.setTimeout(() => { void refreshOperation({ quiet: true }) }, 200)
    return () => window.clearTimeout(refreshTimer.current)
  }, [lastSystemEvent, refreshOperation])

  useEffect(() => {
    const previous = previousSystemStatus.current
    previousSystemStatus.current = systemStatus
    const current = operationRef.current
    if (systemStatus === 'connected' && previous === 'reconnecting' && current?.operationId && !isUploadTerminal(current)) {
      void refreshOperation({ quiet: true })
    }
  }, [refreshOperation, systemStatus])

  useEffect(() => () => window.clearTimeout(refreshTimer.current), [])

  const confirmAbandonActive = () => !running || window.confirm('This upload is still running. Stop displaying it and change the upload mode? The backend operation will continue.')
  const changeMainMode = (value) => {
    if (pending) return
    if (value === mainMode) return
    if (!confirmAbandonActive()) return
    resetWorkflow()
    setMainMode(value)
    setHotfixType('')
  }
  const changeHotfixType = (value) => {
    if (pending) return
    if (value === hotfixType) return
    if (!confirmAbandonActive()) return
    resetWorkflow()
    setHotfixType(value)
  }

  const requestForCurrentMode = () => {
    if (uploadMode === UPLOAD_MODES.REGULAR) return {
      mode: uploadMode,
      sourcePaths: sources,
      target: { kind: UPLOAD_TARGET_KINDS.QC_PATH, reference: qcDestination[0] },
    }
    if (uploadMode === UPLOAD_MODES.FRONTEND_HOTFIX) return {
      mode: uploadMode,
      sourcePaths: sources,
      target: { kind: UPLOAD_TARGET_KINDS.FRONTEND_PROFILE, reference: frontendPort },
    }
    return {
      mode: uploadMode,
      sourcePaths: sources,
      target: { kind: UPLOAD_TARGET_KINDS.WILDFLY_PROFILE, reference: wildflyProfileId },
    }
  }

  const create = async () => {
    if (!uploadMode || !sources.length || pending) return
    setPending(true)
    setError('')
    setNotice('')
    try {
      const response = await createUpload(requestForCurrentMode())
      const summary = uploadMode === UPLOAD_MODES.REGULAR
        ? `QC directory: ${qcDestination[0]}`
        : uploadMode === UPLOAD_MODES.FRONTEND_HOTFIX
          ? `Frontend: ${selectedFrontend?.profileName || frontendPort} · port ${frontendPort}`
          : `WildFly: ${selectedWildfly?.profileName || wildflyProfileId}`
      acceptOperation(response, summary)
      setSelectedTargets({})
    } catch (reason) {
      setError(reason.message)
    } finally {
      setPending(false)
    }
  }

  const execute = async () => {
    if (!operationId || pending || !canExecuteWarHotfix(operation, selectedTargets)) return
    const missing = list(operation.items).filter((item) => item.status === 'MISSING').length
    const warning = missing
      ? `Deploy this hotfix? ${missing} missing item(s) will be skipped and the operation will finish as failed.`
      : 'Deploy this hotfix using the resolved targets?'
    if (!window.confirm(warning)) return
    setPending(true)
    setError('')
    try {
      const response = await executeUpload(operationId, selectedTargets)
      acceptOperation(response)
    } catch (reason) {
      setError(reason.message)
    } finally {
      setPending(false)
    }
  }

  const rollback = async (item) => {
    if (!operationId || rollbackSource) return
    if (!window.confirm(`Rollback ${item.name || item.sourcePath} at ${item.targetPath}?`)) return
    setRollbackSource(item.sourcePath)
    setError('')
    storeOperation(operation)
    try {
      const response = await rollbackUploadItem(operationId, item.sourcePath)
      acceptOperation(response)
      await refreshOperation({ quiet: true })
    } catch (reason) {
      setError(reason.message)
      if (isUploadTerminal(operation)) clearStoredOperation()
    } finally {
      setRollbackSource('')
    }
  }

  const canCreate = uploadMode === UPLOAD_MODES.REGULAR
    ? sources.length > 0 && qcDestination.length === 1
    : uploadMode === UPLOAD_MODES.FRONTEND_HOTFIX
      ? sources.length > 0 && frontendPort && selectedFrontend?.directoryExists !== false && hasFrontendIndex
      : uploadMode === UPLOAD_MODES.WILDFLY_HOTFIX
        ? sources.length > 0 && wildflyProfileId
        : false

  return <Page title="Upload" description="Move files from your Tech Drive to QC or apply a frontend or exploded-WAR hotfix.">
    <div className="space-y-5">
      {notice && <Notice tone="warning">{notice}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {systemStatus === 'reconnecting' && operationId && !terminal && <p className="text-xs text-amber-700" role="status">System updates are reconnecting. The upload is still running.</p>}

      <div className="grid grid-cols-2 items-start gap-3 md:gap-5" data-testid="upload-mode-row">
        <ModeCard title="Is this a hotfix?" value={mainMode} onChange={changeMainMode} disabled={pending} options={[
          ['regular', 'Regular file upload'],
          ['hotfix', 'This is a hotfix'],
        ]} />
        {mainMode === 'hotfix' && <ModeCard title="Hotfix type" value={hotfixType} onChange={changeHotfixType} disabled={pending} options={[
          ['frontend', 'Frontend XAMPP'],
          ['war', 'WAR profile'],
        ]} />}
      </div>

      {!operation && uploadMode && <Card>
        <CardContent className="space-y-5 pt-6">
          {uploadMode === UPLOAD_MODES.REGULAR && <div className="grid gap-5 xl:grid-cols-2">
            <BrowserPanel title="Files and directories from Tech Drive" description="Select one or more source items.">
              <FileBrowser rootKey="techDrive" showSelectAll selected={sources} onSelectionChange={setSources} disabled={pending} />
            </BrowserPanel>
            <BrowserPanel title="QC destination" description="Select exactly one destination directory.">
              <FileBrowser rootKey="qc" selectableType="directory" selected={qcDestination} onSelectionChange={(items) => setQcDestination(items.slice(-1))} disabled={pending} />
            </BrowserPanel>
          </div>}

          {uploadMode === UPLOAD_MODES.FRONTEND_HOTFIX && <div className="space-y-5">
            <FormItem className="max-w-xl">
              <FormLabel>Frontend XAMPP profile</FormLabel>
              <SearchableProfileSelect
                profiles={frontendProfiles}
                value={frontendQuery}
                onValueChange={(value) => { setFrontendQuery(value); if (!value) setFrontendPort('') }}
                onSelect={(profile) => { setFrontendPort(String(profile.port)); setFrontendQuery(profile.profileName) }}
                getKey={(profile) => String(profile.port)}
                getLabel={(profile) => profile.profileName}
                getDescription={(profile) => [`Port ${profile.port}`, profile.frontendUrl].filter(Boolean).join(' · ')}
                getSearchText={(profile) => `${profile.profileName} ${profile.port} ${profile.frontendUrl || ''}`}
                isDisabled={(profile) => profile.directoryExists === false}
                getDisabledReason={(profile) => profile.directoryExists === false ? 'Document root directory is unavailable.' : ''}
                ariaLabel="Select frontend XAMPP profile"
                inputAriaLabel="Frontend profile name, port, or URL"
                disabled={pending}
              />
              {selectedFrontend?.documentRoot && <FormDescription>Document root: <span className="font-mono text-foreground">{selectedFrontend.documentRoot}</span></FormDescription>}
            </FormItem>
            <Notice tone="warning">Select <strong>index.html</strong> and its sibling files/directories. Do not select their parent build directory, or index.html will be installed one level too deep.</Notice>
            <BrowserPanel title="Production build contents" description="Select index.html and the build content beside it.">
              <FileBrowser rootKey="techDrive" showSelectAll selected={sources} onSelectionChange={setSources} disabled={pending} />
            </BrowserPanel>
            {sources.length > 0 && !hasFrontendIndex && <p className="field-error">Select the production build&apos;s top-level index.html.</p>}
          </div>}

          {uploadMode === UPLOAD_MODES.WILDFLY_HOTFIX && <div className="space-y-5">
            <FormItem className="max-w-xl">
              <FormLabel>WildFly profile</FormLabel>
              <SearchableProfileSelect
                profiles={wildflyProfiles}
                value={wildflyQuery}
                onValueChange={(value) => { setWildflyQuery(value); if (!value) setWildflyProfileId('') }}
                onSelect={(profile) => { setWildflyProfileId(profile.id); setWildflyQuery(profile.profileName || profile.id) }}
                getLabel={(profile) => profile.profileName || profile.id}
                getDescription={(profile) => [profile.application, profile.version, profile.status, profile.health].filter(Boolean).join(' · ')}
                getSearchText={(profile) => `${profile.profileName || ''} ${profile.id} ${profile.application || ''} ${profile.version || ''}`}
                ariaLabel="Select WildFly profile"
                inputAriaLabel="WildFly profile name, application, version, or ID"
                disabled={pending}
              />
            </FormItem>
            <BrowserPanel title="Hotfix files and directories" description="Select one or more items from your Tech Drive.">
              <FileBrowser rootKey="techDrive" showSelectAll selected={sources} onSelectionChange={setSources} disabled={pending} />
            </BrowserPanel>
          </div>}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">Selected source items: {sources.length}</p>
            <Button type="button" className="gap-2" disabled={!canCreate || pending} onClick={create}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploadMode === UPLOAD_MODES.WILDFLY_HOTFIX ? (pending ? 'Inspecting…' : 'Inspect hotfix') : (pending ? 'Submitting…' : 'Upload')}
            </Button>
          </div>
        </CardContent>
      </Card>}

      {operation && <div className="grid gap-5 lg:grid-cols-2" data-testid="upload-results-layout">
        <Card><CardContent className="space-y-4 pt-6">
          <div><h2 className="font-semibold">Selected upload</h2><p className="text-xs text-muted-foreground">Operation {operationId}</p></div>
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Mode</dt><dd>{operation.mode}</dd>
            <dt className="text-muted-foreground">Target</dt><dd className="break-all">{targetSummary || operation.target?.reference || 'Resolved by the backend'}</dd>
          </dl>
          <div><p className="mb-2 text-sm font-medium">Sources</p><ul className="space-y-1">{(sources.length ? sources : list(operation.items).map((item) => item.sourcePath)).map((path) => <li key={path} className="break-all rounded border border-border px-2 py-1.5 font-mono text-xs">{path}</li>)}</ul></div>
        </CardContent></Card>

        <Card><CardContent className="space-y-4 pt-6">
          <div className="flex items-start justify-between gap-3"><h2 className="font-semibold">Operation progress<span className="sr-only">: {operation.status}</span></h2>{(pending || refreshing) && <Loader2 aria-label="Refreshing upload" className="h-4 w-4 animate-spin text-primary" />}</div>
          {operation.status === 'FAILED' && operation.message && <Notice tone="error">{operation.message}</Notice>}
          {operation.mode === UPLOAD_MODES.FRONTEND_HOTFIX && operation.status === 'COMPLETED' && selectedFrontend?.documentRoot && <Notice>
            <span className="block text-xs text-muted-foreground">Frontend document directory</span>
            <span className="mt-0.5 block break-all font-mono text-sm text-foreground">{selectedFrontend.documentRoot}</span>
          </Notice>}
          <RestartStatus operation={operation} />
          <OperationItems
            operation={operation}
            selectedTargets={selectedTargets}
            setSelectedTargets={setSelectedTargets}
            onRollback={rollback}
            rollbackSource={rollbackSource}
            selectionDisabled={pending || running}
          />
          {preflight && <div className="space-y-3">
            {list(operation.items).some((item) => item.status === 'MISSING') && <Notice tone="warning">Missing items will be skipped. Executing this hotfix will cause the overall operation to finish as failed.</Notice>}
            <div className="flex justify-end"><Button type="button" className="gap-2" disabled={pending || !canExecuteWarHotfix(operation, selectedTargets)} onClick={execute}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}Deploy hotfix</Button></div>
          </div>}
          {terminal && <div className="flex justify-end"><Button type="button" variant="outline" onClick={() => resetWorkflow()}>Start another upload</Button></div>}
        </CardContent></Card>
      </div>}
    </div>
  </Page>
}

function ModeCard({ title, value, onChange, options, disabled }) {
  return <Card className="min-w-0"><CardContent className="pt-6"><fieldset disabled={disabled}><legend className="mb-3 text-sm font-semibold">{title}</legend><div className="grid grid-cols-1 gap-2 lg:grid-cols-2">{options.map(([option, label]) => <label key={option} className={`choice min-w-0 ${value === option ? 'choice-active' : ''}`}><input type="radio" name={title} checked={value === option} onChange={() => onChange(option)} />{label}</label>)}</div></fieldset></CardContent></Card>
}

function BrowserPanel({ title, description, children }) {
  return <div className="space-y-2"><div><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground">{description}</p></div>{children}</div>
}

function RestartStatus({ operation }) {
  if (!operation.restartRequired || operation.restartStatus === 'NOT_REQUIRED') return null
  const status = operation.restartStatus
  const running = status === 'RUNNING'
  const failed = status === 'FAILED'
  const completed = status === 'COMPLETED'
  return <div className={`flex items-start gap-2 rounded-md border p-3 text-sm ${failed ? 'border-red-500/40 text-red-700' : completed ? 'border-green-500/40 text-green-700' : 'border-amber-500/40 text-amber-700'}`} role="status">
    {running ? <Loader2 className="mt-0.5 h-4 w-4 animate-spin" /> : failed ? <XCircle className="mt-0.5 h-4 w-4" /> : completed ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <AlertTriangle className="mt-0.5 h-4 w-4" />}
    <span>{status === 'PENDING' ? 'A profile restart will be required after replacement.' : running ? 'Restarting profile' : completed ? 'Profile restart completed.' : `Profile restart failed${operation.message ? `: ${operation.message}` : '.'}`}</span>
  </div>
}

function OperationItems({ operation, selectedTargets, setSelectedTargets, onRollback, rollbackSource, selectionDisabled }) {
  const items = list(operation.items)
  const duplicates = duplicateUploadItemNames(items)
  if (!items.length) return <p className="empty-state">Waiting for item status from the backend.</p>
  return <div className="space-y-2">{items.map((item) => <OperationItem
    key={item.sourcePath}
    item={item}
    displayName={displayUploadItemName(item, duplicates)}
    selectedTarget={selectedTargets[item.sourcePath] || ''}
    onTargetChange={(targetPath) => setSelectedTargets((current) => ({ ...current, [item.sourcePath]: targetPath }))}
    canRollback={operation.mode === UPLOAD_MODES.WILDFLY_HOTFIX && item.status === 'SUCCEEDED' && item.rollbackAvailable}
    onRollback={() => onRollback(item)}
    rollingBack={rollbackSource === item.sourcePath}
    selectionDisabled={selectionDisabled}
  />)}</div>
}

function OperationItem({ item, displayName, selectedTarget, onTargetChange, canRollback, onRollback, rollingBack, selectionDisabled }) {
  const processing = ['PROCESSING', 'ROLLING_BACK'].includes(item.status)
  const success = ['SUCCEEDED', 'ROLLED_BACK'].includes(item.status)
  const warning = item.status === 'AMBIGUOUS'
  const failure = ['MISSING', 'FAILED', 'ROLLBACK_FAILED'].includes(item.status)
  const tone = failure ? 'border-red-500/55' : warning ? 'border-orange-500/60' : success ? 'border-green-500/55' : 'border-blue-500/35'
  const iconTone = failure ? 'bg-red-600 text-white' : warning ? 'bg-orange-500 text-white' : success ? 'bg-green-600 text-white' : 'bg-blue-100 text-blue-700'
  const Icon = processing ? Loader2 : success ? Check : warning ? AlertTriangle : failure ? X : FileCheck2
  return <div className={`rounded-md border p-2 ${tone}`} data-status={item.status}>
    <div className="flex items-center gap-2">
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${iconTone}`} title={item.status} data-testid="upload-item-status-icon">
        <Icon className={`h-3 w-3 ${processing ? 'animate-spin' : ''}`} aria-hidden="true" />
        <span className="sr-only">{item.status}</span>
      </span>
      <p className="min-w-0 flex-1 break-all text-sm font-medium leading-tight">{displayName}</p>
      {canRollback && <Button type="button" variant="outline" size="sm" className="gap-1" disabled={rollingBack} onClick={onRollback}>{rollingBack ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}Rollback</Button>}
    </div>
    {warning && <div className="mt-3"><FormLabel htmlFor={`candidate-${item.sourcePath}`}>Select target for {displayName}</FormLabel><Select value={selectedTarget} onValueChange={onTargetChange} disabled={selectionDisabled}><SelectTrigger id={`candidate-${item.sourcePath}`} className="mt-1"><SelectValue placeholder="Choose the exact target path" /></SelectTrigger><SelectContent>{list(item.candidates).map((candidate) => <SelectItem value={candidate} key={candidate}>{candidate}</SelectItem>)}</SelectContent></Select></div>}
    {(failure || warning) && item.message && <p className={`ml-7 mt-1.5 text-xs ${failure ? 'text-red-700' : 'text-orange-700'}`}>{item.message}</p>}
  </div>
}
