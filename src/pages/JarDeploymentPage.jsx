import { useEffect, useRef, useState } from 'react'
import { Loader2, Package, Rocket } from 'lucide-react'
import FileBrowser from '@/components/FileBrowser'
import { deployJar, getJars, isLockConflict } from '@/lib/contractApi'
import { deploymentIdOf } from '@/lib/deploymentIdentity'
import { usePortal } from '@/context/PortalContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Choice, Field, Notice, Page } from '@/components/PagePrimitives'

export const DEFAULT_LAUNCHER_SCRIPT = 'java -jar abc.jar --spring.profiles.active=qc --server.port=x'

export function generatedLauncherScript(jarName, port) {
  return DEFAULT_LAUNCHER_SCRIPT
    .replace('abc.jar', jarName || 'abc.jar')
    .replace('--server.port=x', `--server.port=${port || 'x'}`)
}

export function launcherPortError(scriptLine, port) {
  const matches = [...String(scriptLine || '').matchAll(/(?:--server\.port|-Dserver\.port)\s*=\s*(\d+)/gi)]
  if (!matches.length) return 'Launcher script must include --server.port=<port> or -Dserver.port=<port>.'
  if (matches.some((match) => Number(match[1]) !== port)) {
    return `Every launcher port must match Port ${port}.`
  }
  return ''
}

export default function JarDeploymentPage() {
  const { username, jarProfileActivityMap, reconcileProfileActivity, registerOperation } = usePortal()
  const [jars, setJars] = useState([])
  const [profileId, setProfileId] = useState('')
  const [source, setSource] = useState([])
  const [provideScript, setProvideScript] = useState(false)
  const [deleteBackup, setDeleteBackup] = useState(false)
  const [port, setPort] = useState('')
  const [script, setScript] = useState({ scriptLine: DEFAULT_LAUNCHER_SCRIPT, frontendPort: '', contextName: '' })
  const [scriptCustomized, setScriptCustomized] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [pendingOperationId, setPendingOperationId] = useState('')
  const submissionGuard = useRef(false)

  useEffect(() => {
    getJars().then((items) => {
      const next = Array.isArray(items) ? items : []
      setJars(next); setProfileId((current) => current || next[0]?.id || '')
    }).catch((reason) => setError(reason.message)).finally(() => setLoading(false))
  }, [])

  const selected = jars.find((item) => item.id === profileId)
  const activity = jarProfileActivityMap[profileId]
  const projectName = selected?.applicationName || selected?.name || activity?.applicationName || ''
  const active = activity?.status === 'ACTIVE'
  const profileBusy = ['STARTING', 'STOPPING', 'DEPLOYING'].includes(activity?.status)
  const portNumber = Number(port)
  const portValid = /^\d+$/.test(port) && Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535
  const targetJarName = source[0]
    ? selected?.jarName || source[0].replace(/\\/g, '/').split('/').pop()
    : 'abc.jar'
  const customScriptError = provideScript && portValid
    ? launcherPortError(script.scriptLine, portNumber)
    : ''

  useEffect(() => {
    if (scriptCustomized) return
    setScript((current) => ({
      ...current,
      scriptLine: generatedLauncherScript(targetJarName, port),
    }))
  }, [port, scriptCustomized, targetJarName])

  useEffect(() => {
    if (profileId) reconcileProfileActivity(profileId).catch(() => {})
  }, [profileId, reconcileProfileActivity])

  useEffect(() => {
    if (pendingOperationId && activity?.currentDeploymentId === pendingOperationId) setPendingOperationId('')
  }, [pendingOperationId, activity?.currentDeploymentId])

  const submit = async (event) => {
    event.preventDefault()
    if (!profileId || !source[0] || !portValid || customScriptError || submitting || pendingOperationId || profileBusy || submissionGuard.current) return
    if (active && !window.confirm(`${projectName} is currently active. Continue with redeployment?`)) return
    if (deleteBackup && !window.confirm('Delete the previous artifact instead of retaining a timestamped backup?')) return
    submissionGuard.current = true; setSubmitting(true); setError('')
    try {
      const scriptPayload = provideScript ? {
        ...(script.scriptLine ? { scriptLine: script.scriptLine } : {}),
        ...(script.frontendPort !== '' ? { frontendPort: Number(script.frontendPort) } : {}),
        ...(script.contextName ? { contextName: script.contextName } : {}),
      } : undefined
      const operation = await deployJar({
        projectName, deployerName: username, deleteBackup, requiresScript: provideScript,
        profileId, sourcePath: source[0], port: portNumber, ...(provideScript ? { script: scriptPayload } : {}),
      })
      setPendingOperationId(deploymentIdOf(operation))
      registerOperation(operation, `JAR:${profileId}`, `Deploy JAR · ${projectName}`)
    } catch (reason) {
      setError(isLockConflict(reason) ? `Profile conflict: ${reason.message}` : reason.message)
    } finally {
      submissionGuard.current = false; setSubmitting(false)
    }
  }

  return <Page title="Deploy JAR" description="Deploy a configured backend application from your Tech Drive.">
    <Card className="max-w-4xl shadow-glow"><CardHeader><CardTitle className="flex items-center gap-2"><Package className="w-5 h-5 text-primary" />JAR deployment</CardTitle><CardDescription>Select the UUID-backed application profile and a Tech Drive-relative JAR path.</CardDescription></CardHeader>
      <CardContent><form onSubmit={submit} className="space-y-5">
        <Field label="Project / application"><select className="form-control" value={profileId} onChange={(event) => setProfileId(event.target.value)} disabled={loading || !jars.length}><option value="">{loading ? 'Loading applications…' : 'Select an application'}</option>{jars.map((jar) => <option key={jar.id} value={jar.id}>{jar.applicationName || jar.name} · {jar.jarName || 'JAR profile'}</option>)}</select></Field>
        {!loading && !jars.length && !error && <Notice>No deployable JAR applications were returned by the backend.</Notice>}
        {active && <Notice tone="warning">This application is currently ACTIVE. Runtime state and the latest deployment result remain separate.</Notice>}
        {profileBusy && <Notice tone="warning">This profile is currently {activity.status.toLowerCase()}. Another deployment cannot start yet.</Notice>}
        {pendingOperationId && <Notice>Deployment request accepted. Waiting for the backend activity event…</Notice>}
        {activity?.health === 'MISSING' && <Notice tone="error"><strong>MISSING</strong> — the configured runtime resource was not found. Deployment is still available.</Notice>}
        {activity?.health === 'NOT_FUNCTIONAL' && <Notice tone="warning"><strong>NOT_FUNCTIONAL</strong> · {activity.consecutiveFailures || 0} consecutive failures. Deployment is still available.</Notice>}
        {activity?.frontendUrl === null && activity?.frontendContextPath && <Notice tone="warning">The configured frontend is currently unavailable. This does not prevent a successful backend deployment.</Notice>}
        <div><p className="text-sm font-medium mb-2">JAR from Tech Drive</p><FileBrowser rootKey="techDrive" selectableExtension=".jar" selected={source} onSelectionChange={(items) => setSource(items.slice(-1))} />{source[0] && <p className="help mt-2">Selected: <span className="font-mono text-foreground">{source[0]}</span></p>}</div>
        <Field label="Port number (required)">
          <Input type="number" min="1" max="65535" step="1" required value={port} onChange={(event) => setPort(event.target.value)} />
        </Field>
        {!portValid && <Notice tone="error">{port === '' ? 'Port is required.' : 'Port must be a whole number from 1 to 65535.'}</Notice>}
        <Choice label="Provide or regenerate script data?" value={provideScript} onChange={setProvideScript} yes="Yes, provide script data" no="No, backend-only deployment" />
        {provideScript && <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-4"><Field label="Script line (optional)"><textarea className="form-control min-h-24 font-mono text-sm" value={script.scriptLine} onChange={(event) => { setScriptCustomized(true); setScript((current) => ({ ...current, scriptLine: event.target.value })) }} /></Field>{customScriptError && <Notice tone="error">{customScriptError}</Notice>}<div className="grid sm:grid-cols-2 gap-4"><Field label="Frontend port (optional)"><Input type="number" min="1" max="65535" value={script.frontendPort} onChange={(event) => setScript((current) => ({ ...current, frontendPort: event.target.value }))} /></Field><Field label="Context name (optional)"><Input value={script.contextName} onChange={(event) => setScript((current) => ({ ...current, contextName: event.target.value }))} /></Field></div></div>}
        <Choice label="Delete previous backup?" value={deleteBackup} onChange={setDeleteBackup} yes="Yes, delete it" no="No, retain timestamped backup" />
        {error && <Notice tone="error">{error}</Notice>}
        <fieldset disabled={!portValid || !!customScriptError}>
        <Button disabled={!profileId || !source[0] || submitting || !!pendingOperationId || profileBusy} className="gap-2">{submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}{submitting ? 'Starting deployment…' : 'Deploy JAR'}</Button>
        </fieldset>
      </form></CardContent></Card>
  </Page>
}
