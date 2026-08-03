export const JAR_APPLICATION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/

export function jarApplicationNameFromPath(path) {
  const filename = String(path || '').replace(/\\/g, '/').split('/').pop() || ''
  return filename.toLowerCase().endsWith('.jar') ? filename.slice(0, -4) : filename
}

export function isValidJarApplicationName(value) {
  return JAR_APPLICATION_NAME_PATTERN.test(String(value || '').trim())
}

export function generatedJarCommand(applicationName, port) {
  const name = String(applicationName || '').trim() || 'application'
  const selectedPort = port === '' || port === null || port === undefined ? 'x' : port
  return `java -jar ${name}.jar --spring.profiles.active=qc --server.port=${selectedPort}`
}

function unsafeContextPath(value) {
  const containsControlCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
  return containsControlCharacter
    || /[\\?#]/.test(value)
    || /^[a-z][a-z\d+.-]*:/i.test(value)
    || value.startsWith('//')
}

export function frontendContextPathError(value) {
  const entered = String(value || '').trim()
  if (!entered) return ''
  if (unsafeContextPath(entered)) {
    return 'Context path must be a path only, without a URL, host, query, fragment, or backslash.'
  }

  let decoded
  try {
    decoded = decodeURIComponent(entered)
  } catch {
    return 'Context path contains invalid percent encoding.'
  }
  if (unsafeContextPath(decoded)) {
    return 'Context path must be a path only, without a URL, host, query, fragment, or backslash.'
  }
  if (decoded.split('/').some((segment) => segment === '.' || segment === '..')) {
    return 'Context path cannot contain traversal segments.'
  }
  return ''
}

export function normalizeFrontendContextPath(value) {
  const entered = String(value || '').trim()
  if (!entered) return ''
  const error = frontendContextPathError(entered)
  if (error) throw new Error(error)
  const withLeadingSlash = entered.startsWith('/') ? entered : `/${entered}`
  const collapsed = withLeadingSlash.replace(/\/{2,}/g, '/')
  return collapsed === '/' ? '/' : collapsed.replace(/\/+$/, '')
}

export function frontendUrl(domain, port, contextPath) {
  const base = String(domain || '').trim().replace(/\/+$/, '')
  const selectedPort = String(port || '').trim()
  if (!base || !selectedPort) return ''
  const normalizedContext = normalizeFrontendContextPath(contextPath) || '/'
  return `${base}:${selectedPort}${normalizedContext}`
}
