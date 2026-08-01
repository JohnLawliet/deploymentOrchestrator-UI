import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import {
  eventUrl,
  getOperation,
  getProfiles,
  getRuntimeResource,
  techDriveHeaders,
  validateUser,
} from '@/lib/contractApi'
import { deploymentIdOf, withDeploymentIdentity } from '@/lib/deploymentIdentity'
import { normalizeDashboardProfile, normalizeRuntimeActivity, normalizeSystemSnapshot } from '@/lib/runtimeActivity'
import {
  activeRegisteredOperations,
  reconcileOperationProgress,
  reduceOperationProgress,
  registerOperationInMap,
} from '@/lib/operationProgress'
import { getStoredPortalUsername, PORTAL_USERNAME_SESSION_KEY } from '@/lib/portalSession'

const PortalContext = createContext(null)
const systemEvents = [
  'RESOURCE_STARTING', 'RESOURCE_DEPLOYING', 'RESOURCE_ACTIVE', 'RESOURCE_STOPPING',
  'RESOURCE_INACTIVE', 'RESOURCE_FAILED', 'DEPLOYMENT_SUCCEEDED', 'DEPLOYMENT_FAILED',
  'TERMINAL_AVAILABLE', 'TERMINAL_CLOSED', 'WAR_PREFLIGHT_READY',
  'WAR_PREFLIGHT_CANCELLED', 'DEPLOYMENT_LOG_AVAILABLE', 'FRONTEND_INACTIVE',
  'FRONTEND_CONFIGURATION_INVALID', 'PROFILE_LOG_UNAVAILABLE',
]
const eventStatuses = {
  RESOURCE_STARTING: 'STARTING', RESOURCE_DEPLOYING: 'DEPLOYING',
  RESOURCE_ACTIVE: 'ACTIVE', RESOURCE_STOPPING: 'STOPPING',
  RESOURCE_INACTIVE: 'INACTIVE', RESOURCE_FAILED: 'FAILED',
}
const mapById = (items) => Object.fromEntries((Array.isArray(items) ? items : []).filter((item) => item?.id).map((item) => [item.id, item]))
const eventResourceId = (event) => String(event.profileId || event.resourceKey || event.resources?.id || '').replace(/^(WILDFLY_PROFILE|JAR):/, '')
const eventResourceType = (event) => event.resourceType
  || (String(event.resourceKey || '').startsWith('JAR:') ? 'JAR' : 'WILDFLY_PROFILE')
const eventProfileId = (event) => String(event.profileId || eventResourceId(event) || '')

export function mergeActivityMap(map, event) {
  const id = eventResourceId(event)
  if (!id) return map
  const deploymentId = deploymentIdOf(event)
  if (event.eventType === 'TERMINAL_AVAILABLE') {
    if (eventResourceType(event) === 'WILDFLY_PROFILE') {
      return {
        ...map,
        [id]: {
          id,
          ...map[id],
          serverLogAvailable: true,
        },
      }
    }
    if (!map[id] || !deploymentId) return map
    return {
      ...map,
      [id]: {
        ...map[id],
        currentDeploymentId: deploymentId,
      },
    }
  }
  if (event.eventType === 'PROFILE_LOG_UNAVAILABLE') {
    return {
      ...map,
      [id]: {
        id,
        ...map[id],
        serverLogAvailable: false,
      },
    }
  }
  if (event.eventType === 'TERMINAL_CLOSED') {
    if (eventResourceType(event) !== 'JAR') return map
    if (!map[id] || !deploymentId || map[id].currentDeploymentId !== deploymentId) return map
    return {
      ...map,
      [id]: {
        ...map[id],
        currentDeploymentId: null,
      },
    }
  }
  const payload = event.resources?.activity || (event.resources?.id ? event.resources : {})
  const status = event.state || eventStatuses[event.eventType]
  const hasCurrentDeploymentId = Object.prototype.hasOwnProperty.call(event, 'currentDeploymentId')
  const hasCurrentOperationId = Object.prototype.hasOwnProperty.call(event, 'currentOperationId')
  return {
    ...map,
    [id]: {
      id,
      ...map[id],
      ...payload,
      ...(status ? { status } : {}),
      ...(event.pid !== undefined ? { pid: event.pid } : {}),
      ...(event.deployCount !== undefined ? { deployCount: event.deployCount } : {}),
      ...(event.failedDeployCount !== undefined ? { failedDeployCount: event.failedDeployCount } : {}),
      ...(event.consecutiveFailures !== undefined ? { consecutiveFailures: event.consecutiveFailures } : {}),
      ...(event.lastResult !== undefined ? { lastResult: event.lastResult } : {}),
      ...(event.hasBackup !== undefined ? { hasBackup: event.hasBackup } : {}),
      ...(Object.prototype.hasOwnProperty.call(event, 'backupSnapshotId')
        ? { backupSnapshotId: event.backupSnapshotId }
        : {}),
      ...(event.timestamp ? { lastUpdatedOn: event.timestamp } : {}),
      ...(event.eventType === 'DEPLOYMENT_FAILED'
        ? {}
        : hasCurrentDeploymentId
        ? { currentDeploymentId: event.currentDeploymentId }
        : hasCurrentOperationId
          ? { currentDeploymentId: event.currentOperationId }
          : {}),
    },
  }
}

export function PortalProvider({ children }) {
  const [username, setUsername] = useState(getStoredPortalUsername)
  const [validated, setValidated] = useState(false)
  const [validationState, setValidationState] = useState(username ? 'validating' : 'idle')
  const [validationError, setValidationError] = useState('')
  const [activityMaps, setActivityMaps] = useState({ wildflyProfileActivityMap: {}, jarProfileActivityMap: {} })
  const [systemStatus, setSystemStatus] = useState('disconnected')
  const [lastSystemEvent, setLastSystemEvent] = useState(null)
  const [operations, setOperations] = useState({})
  const [viewingOperation, setViewingOperation] = useState(null)
  const [profileLogLines, setProfileLogLines] = useState({})
  const mapsRef = useRef(activityMaps)
  const operationsRef = useRef(operations)
  useEffect(() => { mapsRef.current = activityMaps }, [activityMaps])
  useEffect(() => { operationsRef.current = operations }, [operations])
  const updateOperations = useCallback((updater) => {
    setOperations((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater
      operationsRef.current = next
      return next
    })
  }, [])

  const mergeActivity = useCallback((activity, resourceType) => {
    if (!activity?.id) return
    const jar = resourceType === 'JAR' || 'applicationName' in activity
    const key = jar ? 'jarProfileActivityMap' : 'wildflyProfileActivityMap'
    setActivityMaps((current) => {
      const existing = current[key][activity.id]
      return { ...current, [key]: { ...current[key], [activity.id]: { ...existing, ...activity } } }
    })
  }, [])

  const replaceProfileActivities = useCallback((profiles) => {
    const activities = (Array.isArray(profiles) ? profiles : [])
      .map(normalizeDashboardProfile)
      .filter(Boolean)
    setActivityMaps((current) => ({
      ...current,
      wildflyProfileActivityMap: mapById(activities),
    }))
    return activities
  }, [])

  const reconcileResourceActivity = useCallback(async (resourceKey) => {
    if (!resourceKey) return null
    const resource = await getRuntimeResource(resourceKey)
    const activity = normalizeRuntimeActivity(resource)
    if (activity) mergeActivity(activity, resource.resourceType)
    return activity
  }, [mergeActivity])

  const reconcileProfileActivity = useCallback(async (profileId) => {
    const activities = replaceProfileActivities(await getProfiles())
    return profileId ? activities.find((activity) => activity.id === profileId) || null : activities
  }, [replaceProfileActivities])

  const clearProfileLogs = useCallback((profileId) => {
    if (!profileId) return
    setProfileLogLines((current) => ({ ...current, [profileId]: [] }))
  }, [])

  const acceptUser = useCallback(async (candidate) => {
    const entered = candidate.trim()
    if (!entered) { setValidationError('Enter your username.'); return false }
    setValidationState('validating'); setValidationError('')
    try {
      await validateUser(entered)
      sessionStorage.setItem(PORTAL_USERNAME_SESSION_KEY, entered)
      setUsername(entered); setValidated(true); setValidationState('valid')
      return true
    } catch (error) {
      sessionStorage.removeItem(PORTAL_USERNAME_SESSION_KEY)
      setValidated(false); setValidationState('invalid'); setValidationError(error.message)
      return false
    }
  }, [])

  useEffect(() => { if (username && !validated) acceptUser(username) }, [acceptUser, username, validated])

  useEffect(() => {
    if (!validated || !username) return undefined
    let opened = false
    const controller = new AbortController()
    setSystemStatus('connecting')
    const handleOpen = () => {
      setSystemStatus('connected')
      if (opened) {
        const maps = mapsRef.current
        reconcileProfileActivity().catch(() => {})
        Object.values(maps.jarProfileActivityMap).forEach((item) => reconcileResourceActivity(`JAR:${item.id}`).catch(() => {}))
        activeRegisteredOperations(operationsRef.current)
          .forEach((operation) => {
            const expectedRevision = operation.progress?.revision || 0
            const deploymentId = deploymentIdOf(operation)
            getOperation(deploymentId)
              .then((record) => updateOperations((current) => reconcileOperationProgress(current, deploymentId, record, expectedRevision)))
              .catch(() => {})
          })
      }
      opened = true
    }

    const handleMessage = (message) => {
      try {
        const payload = JSON.parse(message.data)
        const event = {
          ...payload,
          eventType: payload.eventType || message.event || 'message',
        }
        if (event.eventType === 'SYSTEM_SNAPSHOT') {
          const snapshot = normalizeSystemSnapshot(event.resources)
          setActivityMaps({
            wildflyProfileActivityMap: mapById(snapshot.wildflyProfiles),
            jarProfileActivityMap: mapById(snapshot.jarProfiles),
          })
          setLastSystemEvent(event)
          return
        }
        if (event.eventType === 'OPERATION_PROGRESS') {
          updateOperations((current) => reduceOperationProgress(current, event))
          return
        }
        if (event.eventType === 'PROFILE_LOG') {
          const profileId = eventProfileId(event)
          if (!profileId || typeof event.line !== 'string') return
          setProfileLogLines((current) => ({
            ...current,
            [profileId]: [...(current[profileId] || []).slice(-999), event],
          }))
          return
        }
        if (!systemEvents.includes(event.eventType)) return
        const jarEvent = eventResourceType(event) === 'JAR'
        setActivityMaps((current) => ({
          wildflyProfileActivityMap: jarEvent
            ? current.wildflyProfileActivityMap
            : mergeActivityMap(current.wildflyProfileActivityMap, event),
          jarProfileActivityMap: jarEvent
            ? mergeActivityMap(current.jarProfileActivityMap, event)
            : current.jarProfileActivityMap,
        }))
        setLastSystemEvent(event)
        if (event.eventType === 'PROFILE_LOG_UNAVAILABLE') {
          const profileId = eventProfileId(event)
          setViewingOperation((current) => (
            current?.resourceType === 'WILDFLY_PROFILE' && current.profileId === profileId
              ? { ...current, profileLogUnavailable: true }
              : current
          ))
        }
        if (event.eventType === 'TERMINAL_AVAILABLE' && eventResourceType(event) === 'WILDFLY_PROFILE') {
          reconcileProfileActivity(eventProfileId(event)).catch(() => {})
        }
        if (event.resourceKey && ['DEPLOYMENT_SUCCEEDED', 'DEPLOYMENT_FAILED'].includes(event.eventType)) {
          if (event.resourceType === 'JAR' || String(event.resourceKey).startsWith('JAR:')) {
            const resourceKey = event.resourceType
              ? `${event.resourceType}:${eventResourceId(event)}`
              : event.resourceKey
            reconcileResourceActivity(resourceKey).catch(() => {})
          }
        }
        const deploymentId = deploymentIdOf(event)
        if (deploymentId) updateOperations((current) => ({
          ...current,
          [deploymentId]: {
            ...current[deploymentId],
            ...withDeploymentIdentity(event),
            deploymentId,
            statusEvent: ['FRONTEND_INACTIVE', 'FRONTEND_CONFIGURATION_INVALID', 'DEPLOYMENT_LOG_AVAILABLE'].includes(event.eventType) ? current[deploymentId]?.statusEvent : event.eventType,
            logAvailable: event.eventType === 'DEPLOYMENT_LOG_AVAILABLE' || current[deploymentId]?.logAvailable,
            frontendWarning: ['FRONTEND_INACTIVE', 'FRONTEND_CONFIGURATION_INVALID'].includes(event.eventType) ? event.message : current[deploymentId]?.frontendWarning,
          },
        }))
      } catch { setSystemStatus('reconnecting') }
    }

    void fetchEventSource(eventUrl('/system/events'), {
      method: 'GET',
      headers: techDriveHeaders(username),
      signal: controller.signal,
      openWhenHidden: true,
      onopen: async (response) => {
        if (!response.ok) throw new Error(`System event stream returned ${response.status}`)
        handleOpen()
      },
      onmessage: handleMessage,
      onclose: () => {
        if (!controller.signal.aborted) {
          setSystemStatus('reconnecting')
          throw new Error('System event stream closed')
        }
      },
      onerror: () => {
        if (!controller.signal.aborted) setSystemStatus('reconnecting')
        return 3000
      },
    }).catch(() => {
      if (!controller.signal.aborted) setSystemStatus('reconnecting')
    })
    return () => controller.abort()
  }, [username, validated, reconcileProfileActivity, reconcileResourceActivity, updateOperations])

  const changeUser = useCallback(() => {
    sessionStorage.removeItem(PORTAL_USERNAME_SESSION_KEY)
    setValidated(false); setUsername(''); setActivityMaps({ wildflyProfileActivityMap: {}, jarProfileActivityMap: {} }); updateOperations({}); setViewingOperation(null); setProfileLogLines({})
    setValidationState('idle'); setSystemStatus('disconnected')
  }, [updateOperations])

  const registerOperation = useCallback((operation, resourceKey, label) => {
    const record = { ...withDeploymentIdentity(operation), resourceKey, label, registered: true }
    updateOperations((current) => registerOperationInMap(current, operation, resourceKey, label))
    setViewingOperation(record)
    return record
  }, [updateOperations])

  const value = useMemo(() => ({
    username, validated, validationState, validationError, acceptUser, changeUser,
    ...activityMaps, mergeActivity, replaceProfileActivities, reconcileProfileActivity, reconcileResourceActivity, systemStatus,
    lastSystemEvent, operations, registerOperation, viewingOperation, setViewingOperation,
    profileLogLines, clearProfileLogs,
  }), [username, validated, validationState, validationError, acceptUser, changeUser, activityMaps, mergeActivity, replaceProfileActivities, reconcileProfileActivity, reconcileResourceActivity, systemStatus, lastSystemEvent, operations, registerOperation, viewingOperation, profileLogLines, clearProfileLogs])
  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>
}

export function usePortal() {
  const value = useContext(PortalContext)
  if (!value) throw new Error('usePortal must be used within PortalProvider')
  return value
}
