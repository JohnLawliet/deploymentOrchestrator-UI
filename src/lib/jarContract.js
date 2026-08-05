export const JAR_APPLICATION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

export function jarApplicationNameFromPath(path) {
  const filename =
    String(path || '')
      .replace(/\\/g, '/')
      .split('/')
      .pop() || '';
  return filename.toLowerCase().endsWith('.jar') ? filename.slice(0, -4) : filename;
}

export function isValidJarApplicationName(value) {
  return JAR_APPLICATION_NAME_PATTERN.test(String(value || '').trim());
}

export function generatedJarCommand(applicationName, port) {
  const name = String(applicationName || '').trim() || 'application';
  const selectedPort = port === '' || port === null || port === undefined ? 'x' : port;
  return `java -jar ${name}.jar --spring.profiles.active=qc --server.port=${selectedPort}`;
}
