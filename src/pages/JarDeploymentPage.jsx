import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Package, Rocket } from 'lucide-react'
import FileBrowser from '@/components/FileBrowser'
import { deployJar, getJars, getPortStatus, isLockConflict } from '@/lib/contractApi'
import {
  frontendContextPathError,
  frontendUrl,
  generatedJarCommand,
  isValidJarApplicationName,
  jarApplicationNameFromPath,
  normalizeFrontendContextPath,
} from '@/lib/jarContract'
import { isOperationTerminal } from '@/lib/operationProgress'
import { normalizeRuntimeActivity, overlayRuntimeActivity } from '@/lib/runtimeActivity'
import { usePortal } from '@/context/PortalContext'
import JarFrontendDetails from '@/components/JarFrontendDetails'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Choice, Field, Notice, Page } from '@/components/PagePrimitives'

export default function JarDeploymentPage() {
  const { jarProfileActivityMap, operations, lastSystemEvent, reconcileResourceActivity, registerOperation } = usePortal()
  const [jars, setJars] = useState([])
  const [applicationName, setApplicationName] = useState('')
  const [applicationNameTouched, setApplicationNameTouched] = useState(false)
  const [applicationNameCustomized, setApplicationNameCustomized] = useState(false)
  const [source, setSource] = useState([])
  const [provideScript, setProvideScript] = useState(false)
  const [includeFrontend, setIncludeFrontend] = useState(null)
  const [port, setPort] = useState('')
  const [portTouched, setPortTouched] = useState(false)
  const [healthUrl, setHealthUrl] = useState('')
  const [portStatus, setPortStatus] = useState(null)
  const [portChecking, setPortChecking] = useState(false)
  const [portCheckError, setPortCheckError] = useState('')
  const [portRefresh, setPortRefresh] = useState(0)
  const [script, setScript] = useState({ frontendPort: '', frontendContextPath: '' })
  const [frontendDomain, setFrontendDomain] = useState('')
  const [frontendPortTouched, setFrontendPortTouched] = useState(false)
  const [catalogueLoading, setCatalogueLoading] = useState(true)
  const [catalogueError, setCatalogueError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [structuredDeploymentError, setStructuredDeploymentError] = useState(false)
  const [pendingOperationId, setPendingOperationId] = useState('')
  const submissionGuard = useRef(false)
  const portRequestSequence = useRef(0)

  useEffect(() => {
    let disposed = false
    getJars().then((response) => {
      if (disposed) return
      const items = Array.isArray(response)
        ? response
        : (response?.jars || response?.items || response?.applications || [])
      const domain = Array.isArray(response)
        ? response.find((item) => item?.domain)?.domain
        : response?.domain
      setFrontendDomain(String(domain || '').trim().replace(/\/+$/, ''))
      const next = (Array.isArray(items) ? items : [])
        .map((item) => {
          const normalized = normalizeRuntimeActivity({ ...item, resourceType: 'JAR' })
          return normalized?.id && normalized.applicationName ? { ...item, ...normalized } : null
        })
        .filter(Boolean)
      setJars(next)
    }).catch((reason) => {
      if (!disposed) setCatalogueError(reason.message)
    }).finally(() => {
      if (!disposed) setCatalogueLoading(false)
    })
    return () => { disposed = true }
  }, [])

  const trimmedApplicationName = applicationName.trim()
  const applicationNameValid = isValidJarApplicationName(trimmedApplicationName)
  const selected = useMemo(() => jars.find(
    (item) => item.applicationName.toLocaleLowerCase() === trimmedApplicationName.toLocaleLowerCase(),
  ), [jars, trimmedApplicationName])
  const activity = overlayRuntimeActivity(
    selected || null,
    selected ? jarProfileActivityMap[selected.id] : null,
  )
  const active = activity?.status === 'ACTIVE'
  const profileBusy = ['STARTING', 'STOPPING', 'DEPLOYING'].includes(activity?.status)
  const portNumber = Number(port)
  const portValid = /^\d+$/.test(port) && Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535
  const frontendPortNumber = Number(script.frontendPort)
  const frontendPortValid = includeFrontend !== true || (
    /^\d+$/.test(script.frontendPort)
    && Number.isInteger(frontendPortNumber)
    && frontendPortNumber >= 1
    && frontendPortNumber <= 65535
  )
  const contextPathError = includeFrontend ? frontendContextPathError(script.frontendContextPath) : ''
  const launcherCommand = generatedJarCommand(trimmedApplicationName, port)
  const revealedFrontendUrl = includeFrontend && frontendPortValid && !contextPathError
    ? frontendUrl(frontendDomain, script.frontendPort, script.frontendContextPath)
    : ''

  useEffect(() => {
    const sequence = ++portRequestSequence.current
    setPortStatus(null)
    setPortCheckError('')
    setPortChecking(false)
    if (!portValid || !applicationNameValid) return undefined
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setPortChecking(true)
      getPortStatus(portNumber, trimmedApplicationName, controller.signal)
        .then((status) => {
          if (sequence === portRequestSequence.current && !controller.signal.aborted) setPortStatus(status)
        })
        .catch((reason) => {
          if (sequence === portRequestSequence.current && !controller.signal.aborted) {
            setPortCheckError(reason.message || 'Unable to inspect the port')
          }
        })
        .finally(() => {
          if (sequence === portRequestSequence.current && !controller.signal.aborted) setPortChecking(false)
        })
    }, 800)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [portNumber, portValid, trimmedApplicationName, applicationNameValid, portRefresh, lastSystemEvent])

  useEffect(() => {
    if (selected?.id) reconcileResourceActivity(`JAR:${selected.id}`).catch(() => {})
  }, [selected?.id, reconcileResourceActivity])

  useEffect(() => {
    if (!pendingOperationId) return
    const pending = operations[pendingOperationId]
    if (activity?.currentDeploymentId === pendingOperationId || (pending && isOperationTerminal(pending))) {
      setPendingOperationId('')
    }
  }, [pendingOperationId, activity?.currentDeploymentId, operations])

  const selectSource = (items) => {
    const next = items.slice(-1)
    setSource(next)
    if (!applicationNameCustomized) {
      setApplicationName(next[0] ? jarApplicationNameFromPath(next[0]) : '')
    }
  }

  const normalizeContextInput = () => {
    if (!script.frontendContextPath || contextPathError) return
    setScript((current) => ({
      ...current,
      frontendContextPath: normalizeFrontendContextPath(current.frontendContextPath),
    }))
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!applicationNameValid || !source[0] || !portValid || portChecking || !portStatus?.deploymentAllowed || includeFrontend === null || !frontendPortValid || contextPathError || submitting || pendingOperationId || profileBusy || submissionGuard.current) return
    if (active && !window.confirm(`${trimmedApplicationName} is currently active. Continue with redeployment?`)) return
    submissionGuard.current = true; setSubmitting(true); setError(''); setStructuredDeploymentError(false)
    try {
      const scriptPayload = provideScript || includeFrontend ? {
        ...(provideScript ? { scriptLine: launcherCommand } : {}),
        ...(includeFrontend ? { frontendPort: Number(script.frontendPort) } : {}),
        ...(includeFrontend && script.frontendContextPath.trim()
          ? { frontendContextPath: normalizeFrontendContextPath(script.frontendContextPath) }
          : {}),
      } : undefined
      const operation = await deployJar({
        applicationName: trimmedApplicationName,
        sourcePath: source[0],
        port: portNumber,
        ...(healthUrl.trim() ? { healthUrl: healthUrl.trim() } : {}),
        ...(scriptPayload ? { script: scriptPayload } : {}),
      })
      if (!operation?.deploymentId) throw new Error('The backend did not return a deployment ID.')
      setPendingOperationId(operation.deploymentId)
      registerOperation(
        { ...operation, resourceType: 'JAR', applicationName: trimmedApplicationName },
        undefined,
        `Deploy JAR · ${trimmedApplicationName}`,
      )
    } catch (reason) {
      setStructuredDeploymentError(
        reason.code === 'INVALID_HEALTH_URL'
        || (reason.status === 400 && reason.code === 'JAR_NOT_EXECUTABLE'),
      )
      setError(isLockConflict(reason) ? `Application conflict: ${reason.message}` : reason.message)
      if (reason.code === 'PORT_OCCUPIED' || reason.code === 'PORT_STATE_CHANGED') {
        setPortStatus(null)
        setPortRefresh((current) => current + 1)
      }
    } finally {
      submissionGuard.current = false; setSubmitting(false)
    }
  }

  const formInvalid = !applicationNameValid || !source[0] || !portValid || portChecking
    || !portStatus?.deploymentAllowed
    || includeFrontend === null || !frontendPortValid || !!contextPathError

  return <Page title="Deploy JAR" description="Deploy a backend application from a JAR in your Tech Drive.">
    <Card className="w-full shadow-glow"><CardHeader><CardTitle className="flex items-center gap-2"><Package className="w-5 h-5 text-primary" />JAR deployment</CardTitle><CardDescription>Choose a Tech Drive-relative JAR, application name, and runtime port.</CardDescription></CardHeader>
      <CardContent><form onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Application name (required)">
            <Input required maxLength={255} list="jar-application-suggestions" value={applicationName} onChange={(event) => { setApplicationNameCustomized(true); setApplicationName(event.target.value) }} onBlur={() => setApplicationNameTouched(true)} />
            <datalist id="jar-application-suggestions">{jars.map((jar) => <option key={jar.id} value={jar.applicationName}>{jar.jarName || ''}</option>)}</datalist>
          </Field>
          <Field label="Port number (required)">
            <Input type="number" min="1" max="65535" step="1" required value={port} onChange={(event) => setPort(event.target.value)} onBlur={() => setPortTouched(true)} />
          </Field>
          <div className="md:col-span-2 xl:col-span-1">
            <Field label="Health URL (optional)">
              <Input
                value={healthUrl}
                onChange={(event) => setHealthUrl(event.target.value)}
                placeholder="https://application.example/actuator/health"
              />
            </Field>
          </div>
        </div>
        {applicationNameTouched && !applicationNameValid && <Notice tone="error">{trimmedApplicationName ? 'Application name must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens.' : 'Application name is required.'}</Notice>}
        {portTouched && !portValid && <Notice tone="error">{port === '' ? 'Port is required.' : 'Port must be a whole number from 1 to 65535.'}</Notice>}
        {!catalogueLoading && !jars.length && !catalogueError && <Notice>No existing JAR applications were returned. You can deploy a new application.</Notice>}
        {catalogueError && <Notice tone="warning">Existing applications could not be loaded: {catalogueError}. A new deployment can still be submitted.</Notice>}
        {active && <Notice tone="warning">This application is currently ACTIVE. You will be asked to confirm redeployment.</Notice>}
        {profileBusy && <Notice tone="warning">This application is currently {activity.status.toLowerCase()}. Another deployment cannot start yet.</Notice>}
        {pendingOperationId && <Notice>Deployment request accepted. Waiting for backend activity…</Notice>}
        {activity?.health === 'MISSING' && <Notice tone="error"><strong>MISSING</strong> — the configured runtime resource was not found. Deployment is still available.</Notice>}
        {activity?.health === 'NOT_FUNCTIONAL' && <Notice tone="warning"><strong>NOT_FUNCTIONAL</strong> · {activity.consecutiveFailures || 0} consecutive failures. Deployment is still available.</Notice>}
        {selected && <JarFrontendDetails activity={activity} />}
        <div><p className="text-sm font-medium mb-2">JAR from Tech Drive</p><FileBrowser rootKey="techDrive" selectableExtension=".jar" selected={source} onSelectionChange={selectSource} />{source[0] && <p className="help mt-2">Selected: <span className="font-mono text-foreground">{source[0]}</span></p>}</div>
        {portValid && applicationNameValid && portChecking && <Notice>Checking port {portNumber}...</Notice>}
        {portCheckError && <Notice tone="error">Port check failed: {portCheckError}. Deployment is disabled until the port can be verified.</Notice>}
        {portStatus && !portStatus.occupied && <Notice>Port {portStatus.port} is available.</Notice>}
        {portStatus?.sameApplication && <Notice tone="warning">
          {portStatus.message}. Deployment will stop PID {portStatus.pid}, finish its log capture, and redeploy it.
        </Notice>}
        {portStatus?.occupied && !portStatus.sameApplication && <Notice tone="error">
          {portStatus.message}. {portStatus.pid ? `PID ${portStatus.pid}. ` : ''}
          {portStatus.jarName ? `JAR: ${portStatus.jarName}. ` : ''}Free this port before deploying.
        </Notice>}
        <Choice label="Provide launcher settings?" value={provideScript} onChange={setProvideScript} yes="Yes, include launcher settings" no="No, use backend defaults" />
        {provideScript && <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-4">
          <Field label="Generated launcher command"><textarea className="form-control min-h-20 font-mono text-sm" readOnly value={launcherCommand} /></Field>
        </div>}
        <Choice label="Frontend deployment (required)" value={includeFrontend} onChange={setIncludeFrontend} yes="Include frontend deployment" no="Use existing frontend / this JAR doesn't require frontend" />
        {includeFrontend === null && <p className="help">Select one frontend deployment option before deploying.</p>}
        {includeFrontend && <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-4">
          <h3 className="font-medium">Frontend setup</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Frontend port (required)"><Input required type="number" min="1" max="65535" step="1" value={script.frontendPort} onChange={(event) => setScript((current) => ({ ...current, frontendPort: event.target.value }))} onBlur={() => setFrontendPortTouched(true)} /></Field>
            <Field label="Frontend context path (optional)"><Input value={script.frontendContextPath} onChange={(event) => setScript((current) => ({ ...current, frontendContextPath: event.target.value }))} onBlur={normalizeContextInput} placeholder="/application" /></Field>
          </div>
          {frontendPortTouched && !frontendPortValid && <Notice tone="error">{script.frontendPort === '' ? 'Frontend port is required.' : 'Frontend port must be a whole number from 1 to 65535.'}</Notice>}
          {contextPathError && <Notice tone="error">{contextPathError}</Notice>}
          {revealedFrontendUrl && <Notice>Frontend URL: <span className="font-mono break-all">{revealedFrontendUrl}</span></Notice>}
          {frontendPortValid && script.frontendPort && !frontendDomain && <Notice tone="warning">The backend did not provide the frontend domain, so the frontend URL cannot be previewed.</Notice>}
        </div>}
        {error && <Notice tone="error">{structuredDeploymentError ? <strong>{error}</strong> : error}</Notice>}
        <Button type="submit" disabled={formInvalid || submitting || !!pendingOperationId || profileBusy} className="gap-2">{submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}{submitting ? 'Starting deployment…' : 'Deploy JAR'}</Button>
      </form></CardContent></Card>
  </Page>
}
