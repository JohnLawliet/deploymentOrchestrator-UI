export const JAR_APPLICATION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

export function jarApplicationNameFromPath(path: string): string {
  const filename =
    String(path || '')
      .replace(/\\/g, '/')
      .split('/')
      .pop() || '';
  return filename.toLowerCase().endsWith('.jar') ? filename.slice(0, -4) : filename;
}

export function isValidJarApplicationName(value: string): boolean {
  return JAR_APPLICATION_NAME_PATTERN.test(String(value || '').trim());
}

export function generatedJarCommand(
  applicationName: string,
  port: string | number | null | undefined,
  javaPath?: string | null,
): string {
  const name = String(applicationName || '').trim() || 'application';
  const selectedPort = port === '' || port === null || port === undefined ? 'x' : port;
  const executable = String(javaPath || '').trim() || 'java';
  return `${executable} -jar ${name}.jar --spring.profiles.active=qc --server.port=${selectedPort}`;
}
