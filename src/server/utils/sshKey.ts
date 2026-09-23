import { createHash } from 'node:crypto';
import { normalizePublicKey, SSH_KEY_TYPES } from '../../shared/schemas/account.ts';

export interface ParsedSshKey {
  type: string;
  /** Linha normalizada "tipo base64 [comentário]", pronta para o authorized_keys / sshkeys do cloud-init. */
  line: string;
  /** Fingerprint no mesmo formato do `ssh-keygen -lf`: SHA256:<base64 sem padding>. */
  fingerprint: string;
}

/** Lê uma string SSH (uint32 big-endian com o tamanho + bytes) a partir de `offset`. */
function readString(buf: Buffer, offset: number): { value: Buffer; next: number } | null {
  if (offset + 4 > buf.length) return null;
  const len = buf.readUInt32BE(offset);
  if (offset + 4 + len > buf.length) return null;
  return { value: buf.subarray(offset + 4, offset + 4 + len), next: offset + 4 + len };
}

/**
 * Valida uma chave pública OpenSSH de verdade (não só o formato): o blob base64 precisa começar com o mesmo tipo
 * declarado no texto. Chaves RSA menores que 2048 bits são recusadas. Devolve null se for inválida.
 */
export function parseSshPublicKey(raw: string): ParsedSshKey | null {
  const line = normalizePublicKey(raw);
  const [type, b64, ...comment] = line.split(' ');
  if (!type || !b64 || !(SSH_KEY_TYPES as readonly string[]).includes(type)) return null;
  const blob = Buffer.from(b64, 'base64');
  if (blob.length < 20 || blob.toString('base64').replace(/=+$/, '') !== b64.replace(/=+$/, '')) return null;

  const embedded = readString(blob, 0);
  if (!embedded || embedded.value.toString('utf8') !== type) return null;

  // Estrutura completa de cada tipo (RFC 4253, 5656 e 8709); o blob precisa terminar exatamente no último campo.
  let end: number;
  if (type === 'ssh-ed25519') {
    const key = readString(blob, embedded.next);
    if (key?.value.length !== 32) return null;
    end = key.next;
  } else if (type.startsWith('ecdsa-sha2-')) {
    const curve = readString(blob, embedded.next);
    const point = curve && readString(blob, curve.next);
    const expected = { nistp256: 65, nistp384: 97, nistp521: 133 }[type.slice('ecdsa-sha2-'.length)];
    if (!curve || !point || curve.value.toString('utf8') !== type.slice('ecdsa-sha2-'.length)) return null;
    if (point.value.length !== expected || point.value[0] !== 0x04) return null; // ponto não comprimido
    end = point.next;
  } else {
    const exponent = readString(blob, embedded.next);
    const modulus = exponent && readString(blob, exponent.next);
    if (!modulus) return null;
    const bits = (modulus.value.length - (modulus.value[0] === 0 ? 1 : 0)) * 8;
    if (bits < 2048) return null;
    end = modulus.next;
  }
  if (end !== blob.length) return null;

  const fingerprint = `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;
  return { type, line: [type, b64, ...comment].join(' '), fingerprint };
}
