import axios from 'axios'
import { getStoredPortalUsername } from '@/lib/portalSession'

const contextPath = (import.meta.env.VITE_BASE_PATH || '/deploymentOrchestrator').replace(/\/$/, '')
const backendOrigin = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')
const apiBaseUrl = `${backendOrigin}${contextPath}/api`
const client = axios.create({ baseURL: apiBaseUrl, headers: { 'Content-Type': 'application/json' } })
export const techDriveHeaders = (username = getStoredPortalUsername()) => (
  username ? { 'X-TechDrive-Username': username.trim() } : {}
)

export function isPortalIdentityParameter(parameter) {
  const name = String(parameter?.name || '').toLowerCase()
  return name === 'x-techdrive-username' || name === 'username'
}

client.interceptors.request.use((config) => {
  const existing = typeof config.headers?.get === 'function'
    ? config.headers.get('X-TechDrive-Username')
    : config.headers?.['X-TechDrive-Username']
  if (existing) return config
  const headers = techDriveHeaders()
  if (!headers['X-TechDrive-Username']) return config
  if (typeof config.headers?.set === 'function') {
    config.headers.set('X-TechDrive-Username', headers['X-TechDrive-Username'])
  } else {
    config.headers = { ...config.headers, ...headers }
  }
  return config
})

function normalizedError(error, fallback = 'The request could not be completed') {
  const body = error?.response?.data
  const payload = body instanceof Blob ? null : body
  const result = new Error(payload?.message || (typeof payload === 'string' ? payload : '') || error?.message || fallback)
  result.status = error?.response?.status
  result.code = payload?.code
  result.deploymentId = payload?.deploymentId
  result.operationId = payload?.operationId
  result.paths = payload?.paths || []
  result.users = payload?.users || []
  result.details = payload
  return result
}

async function request(promise, fallback) {
  try { return (await promise).data } catch (error) {
    if (axios.isCancel(error)) throw error
    throw normalizedError(error, fallback)
  }
}

async function blobRequest(promise) {
  try {
    const response = await promise
    const disposition = response.headers['content-disposition'] || ''
    const utfName = disposition.match(/filename\*=UTF-8''([^;]+)/i)
    const plainName = disposition.match(/filename="?([^";]+)"?/i)
    return { blob: response.data, filename: decodeURIComponent(utfName?.[1] || plainName?.[1] || 'download') }
  } catch (error) {
    if (error?.response?.data instanceof Blob) {
      try { error.response.data = JSON.parse(await error.response.data.text()) } catch { /* non-JSON error */ }
    }
    throw normalizedError(error, 'Download failed')
  }
}

export const validateUser = (username) => request(client.get('/users/validate', {
  headers: techDriveHeaders(username),
}), 'Unable to validate this username')
export const getJars = () => request(client.get('/dashboard/jars'), 'Unable to load JAR applications')
export const getWarApplications = () => request(client.get('/dashboard/war-applications'), 'Unable to load WAR applications')
export const getProfiles = () => request(client.get('/dashboard/profiles'), 'Unable to load WildFly profiles')
export const getProfileDatasources = (profileId, signal) => request(client.get(`/wildfly/profiles/${encodeURIComponent(profileId)}/datasources`, { signal }), 'Unable to load datasources for this profile')
export const getRuntimeResource = (resourceKey) => request(client.get(`/resources/${encodeURIComponent(resourceKey)}`), 'Unable to load runtime activity')
export const getOperation = (id) => request(client.get(`/deployments/${encodeURIComponent(id)}`), 'Unable to load operation')
export const restartJar = (app) => request(client.post(`/dashboard/jars/${encodeURIComponent(app)}/restart`, null), 'Unable to restart the application')
export const startProfile = (id) => request(client.post(`/profiles/${encodeURIComponent(id)}/start`), 'Unable to start the profile')
export const stopProfile = (id) => request(client.post(`/profiles/${encodeURIComponent(id)}/stop`), 'Unable to stop the profile')
export const deployJar = (payload) => request(client.post('/deployments/qc/jar', payload), 'JAR deployment was rejected')
export const preflightWar = (payload, signal) => request(client.post('/deployments/qc/war/preflight', payload, { signal }), 'WAR preflight failed')
export const cancelWarPreflight = (profileId) => request(client.delete(`/wildfly/profiles/${encodeURIComponent(profileId)}/preflight`), 'Unable to cancel the profile reservation')
export const deployWar = (payload) => request(client.post('/deployments/qc/war', payload), 'WAR deployment was rejected')
export const getWarSnapshots = (profileId) => request(client.get('/deployments/qc/war/snapshots', { params: { profileId } }), 'Unable to load rollback snapshots')
export const rollbackWar = (snapshotId, deployerName) => request(client.post('/deployments/qc/war/rollback', { snapshotId, deployerName }), 'WAR rollback was rejected')
export const downloadTerminal = (deploymentId) => blobRequest(client.get(`/terminals/${encodeURIComponent(deploymentId)}/download`, { responseType: 'blob' }))
export const deleteTerminal = (deploymentId) => request(client.delete(`/terminals/${encodeURIComponent(deploymentId)}`), 'Unable to close the terminal')
export const subscribeProfileLogs = (profileId) => request(client.put(`/profiles/${encodeURIComponent(profileId)}/log-subscriptions`), 'Unable to subscribe to profile logs')
export const unsubscribeProfileLogs = (profileId) => request(client.delete(`/profiles/${encodeURIComponent(profileId)}/log-subscriptions`), 'Unable to unsubscribe from profile logs')
export const getFileRoots = () => request(client.get('/files/roots'), 'Unable to load file roots')
export const listFiles = (rootKey, path, signal) => request(client.get('/files/list', { params: { rootKey, path }, signal }), 'Unable to load this directory')
export const downloadSingle = (rootKey, path) => blobRequest(client.get('/files/download', { params: { rootKey, path }, responseType: 'blob' }))
export const downloadSelection = (rootKey, paths) => blobRequest(client.post('/files/download', { rootKey, paths }, { responseType: 'blob' }))
export const getDatabaseTables = (signal) => request(client.get('/database/tables', { signal }), 'Unable to load database table metadata')
export const getDatabaseTableRows = (table, page, size, signal) => request(client.get(`/database/tables/${encodeURIComponent(table)}`, { params: { page, size }, signal }), 'Unable to load table data')

function parameterLocation(parameter) {
  return String(parameter?.location || 'query').toLowerCase()
}

function databaseQueryPath(template, parameters, values) {
  if (typeof template !== 'string' || !template.trim()) throw new Error('The query endpoint template is missing.')
  let path = template.trim()
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//') || path.includes('\\')) {
    throw new Error('The query endpoint must use a backend API path.')
  }
  for (const parameter of parameters.filter((item) => parameterLocation(item) === 'path')) {
    const token = `{${parameter.name}}`
    if (path.includes(token)) {
      const value = values[parameter.name]
      if (value === '' || value === null || value === undefined) throw new Error(`Path parameter "${parameter.name}" is required.`)
      path = path.split(token).join(encodeURIComponent(value))
    }
  }
  if (/{[^}]+}/.test(path)) throw new Error('The query endpoint has unresolved path parameters.')
  if (!path.startsWith('/')) path = `/${path}`
  if (path === '/api') return '/'
  if (path.startsWith('/api/')) path = path.slice(4)
  if (path.split('/').includes('..')) throw new Error('The query endpoint path is invalid.')
  return path
}

export function executeDatabaseQuery(query, values, signal) {
  if (!query || typeof query !== 'object') return Promise.reject(new Error('The query descriptor is invalid.'))
  const parameters = Array.isArray(query.parameters) ? query.parameters : []
  const params = {}
  const headers = {}
  const data = {}
  for (const parameter of parameters) {
    if (isPortalIdentityParameter(parameter)) continue
    const value = values?.[parameter.name]
    const location = parameterLocation(parameter)
    if (value === '' || value === null || value === undefined || location === 'path') continue
    if (location === 'header') headers[parameter.name] = value
    else if (location === 'body') data[parameter.name] = value
    else params[parameter.name] = value
  }
  const method = String(query.method || 'GET').toUpperCase()
  if (!/^[A-Z]+$/.test(method)) return Promise.reject(new Error('The query HTTP method is invalid.'))
  let url
  try {
    url = databaseQueryPath(query.path, parameters, values || {})
  } catch (error) {
    return Promise.reject(error)
  }
  return request(client.request({
    url,
    method,
    params,
    headers,
    ...(Object.keys(data).length > 0 ? { data } : {}),
    signal,
  }), 'Unable to execute database query')
}

export function eventUrl(path) {
  return `${apiBaseUrl}${path}`
}

export function terminalEventUrl(deploymentId) {
  return `${apiBaseUrl}/terminals/${encodeURIComponent(deploymentId)}/events`
}

export function saveBlob({ blob, filename }) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url)
}

export const isLockConflict = (error) => error?.status === 409
