const REDACTED = '[REDACTED]';

const SECRET_KEYS = new Set([
  'accesstoken',
  'apikey',
  'accountkey',
  'authheader',
  'authheaders',
  'authorization',
  'authorizationheader',
  'authorizationheaders',
  'auth',
  'clientsecret',
  'config',
  'configuration',
  'credential',
  'credentials',
  'dbpassword',
  'headers',
  'httpheaders',
  'password',
  'privatekey',
  'refreshtoken',
  'requestheaders',
  'secret',
  'secretkey',
  'awssecretaccesskey',
  'token',
]);

export function normalizeMetadataKey(key: string): string {
  return key
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]/g, '');
}

export function isSecretKey(key: string): boolean {
  const normalized = normalizeMetadataKey(key);
  if (normalized === 'credentialref' || normalized.endsWith('credentialref')) return false;
  return (
    SECRET_KEYS.has(normalized) ||
    normalized.endsWith('password') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('secretkey') ||
    normalized.endsWith('accesstoken') ||
    normalized.endsWith('refreshtoken') ||
    normalized.startsWith('authorization')
  );
}

export function isSecretValue(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return redactSecretText(value) !== value;
}

export function redactSecretText(value: string): string {
  return value
    .replace(
      /-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----[\s\S]*?-----END (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----/g,
      REDACTED,
    )
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, REDACTED)
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, REDACTED)
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, REDACTED)
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, REDACTED)
    .replace(/\b(?:sk|pk|rk|api)[-_][A-Za-z0-9_-]{8,}\b/gi, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g, REDACTED)
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, REDACTED)
    .replace(
      /\b(password|passwd|secret|token|api[_-]?key|authorization|account[_-]?key|aws[_-]?secret[_-]?access[_-]?key|client[_-]?secret|private[_-]?key)\s*[:=]\s*(?:"[\s\S]*?"|'[\s\S]*?'|[^\s,;]+)/gi,
      '$1=[REDACTED]',
    )
    .replace(/\b(?:https?|postgres(?:ql)?):\/\/[^@\s]+@/gi, (match) => {
      const protocol = match.slice(0, match.indexOf('://') + 3);
      return `${protocol}[REDACTED]@`;
    });
}

export function redactSecrets<T>(value: T): T {
  if (isSecretValue(value)) return REDACTED as T;
  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry)) as T;
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isSecretKey(key) || isSecretValue(entry) ? REDACTED : redactSecrets(entry),
    ]),
  ) as T;
}
