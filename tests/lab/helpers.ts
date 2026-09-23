import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Helpers dos testes contra o laboratório (@lab). Usam o ssh do sistema (no Windows, o ssh do Git: CLAUDE.md T5/T6).
 * O IP .229 é reservado para testes; cada clone novo usa o MAC derivado dele, então o known_hosts é ignorado.
 */
export const LAB_IP = '192.168.56.229';
const BASE_OPTS = [
  '-o',
  'StrictHostKeyChecking=no',
  '-o',
  'UserKnownHostsFile=/dev/null',
  '-o',
  'LogLevel=ERROR',
  '-o',
  'ConnectTimeout=8',
];

export const myPublicKey = () =>
  readFileSync(join(homedir(), '.ssh', 'id_ed25519.pub'), 'utf8')
    .replace(/\r?\n/g, '')
    .trim();

function run(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const r = spawnSync('ssh', args, { encoding: 'utf8', env, timeout: 60_000 });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

/** SSH com chave (BatchMode: nunca pergunta senha). */
export function sshKey(user: string, command: string, keyFile = join(homedir(), '.ssh', 'id_ed25519')) {
  return run([...BASE_OPTS, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-i', keyFile, `${user}@${LAB_IP}`, command]);
}

/**
 * SSH SÓ com senha (sem chave), usando SSH_ASKPASS (sem sshpass; CLAUDE.md T5). Serve para provar que a política de
 * "login por senha" aplicada pelo guest agent vale de verdade no sshd.
 */
export function sshPassword(user: string, password: string, command = 'true') {
  const dir = mkdtempSync(join(tmpdir(), 'favo-askpass-'));
  const script = join(dir, 'askpass.sh');
  writeFileSync(script, '#!/bin/sh\nprintf "%s\\n" "$FAVO_ASKPASS"\n', { mode: 0o700 });
  try {
    return run(
      [
        ...BASE_OPTS,
        '-o',
        'PreferredAuthentications=password',
        '-o',
        'PubkeyAuthentication=no',
        '-o',
        'NumberOfPasswordPrompts=1',
        `${user}@${LAB_IP}`,
        command,
      ],
      { ...process.env, SSH_ASKPASS: script, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: ':0', FAVO_ASKPASS: password },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Par de chaves ed25519 temporário gerado pelo ssh-keygen (para testar o "adicionar chave" pelo agente). */
export function tempKeyPair() {
  const dir = mkdtempSync(join(tmpdir(), 'favo-key-'));
  const file = join(dir, 'id');
  const r = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'favo-lab', '-f', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ssh-keygen falhou: ${r.stderr}`);
  return {
    privateKeyFile: file,
    publicKey: readFileSync(`${file}.pub`, 'utf8').trim(),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export const randomPassword = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
