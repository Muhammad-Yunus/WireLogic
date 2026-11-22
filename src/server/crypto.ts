import crypto from 'node:crypto';

const EPHEMERAL_FALLBACK_KEY = crypto.randomBytes(32);

function getVaultKey(): Buffer {
  const raw = process.env.VAULT_ENCRYPTION_KEY?.trim();
  if (raw) {
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      return Buffer.from(raw, 'hex');
    }
    return crypto.createHash('sha256').update(raw).digest();
  }
  return EPHEMERAL_FALLBACK_KEY;
}

export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

export function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const parts = storedHash.split(':');
    if (parts.length !== 2) return resolve(false);
    const [salt, keyHex] = parts;
    const keyBuf = Buffer.from(keyHex, 'hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      if (derivedKey.length !== keyBuf.length) return resolve(false);
      resolve(crypto.timingSafeEqual(derivedKey, keyBuf));
    });
  });
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function generateOpaqueToken(prefix = 'tks_'): string {
  return `${prefix}${crypto.randomBytes(32).toString('base64url')}`;
}

export function encryptVaultSecret(payload: Record<string, unknown>): string {
  const key = getVaultKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${authTag.toString('base64')}.${encrypted.toString('base64')}`;
}

export function decryptVaultSecret(encoded: string | null | undefined): Record<string, unknown> {
  if (!encoded) return {};
  const parts = encoded.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted credential payload');
  }
  const [ivB64, tagB64, dataB64] = parts;
  const key = getVaultKey();
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8')) as Record<string, unknown>;
}

export function buildSecretHint(secretObj: Record<string, unknown>): string | null {
  const candidate =
    secretObj.apiKey ||
    secretObj.token ||
    secretObj.password ||
    secretObj.secretAccessKey ||
    secretObj.clientSecret ||
    secretObj.webhookUrl;
  if (typeof candidate !== 'string' || !candidate) return null;
  if (candidate.length <= 4) return '••••';
  return `••••${candidate.slice(-4)}`;
}
