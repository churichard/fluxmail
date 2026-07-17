import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export interface FileLockOptions {
  timeoutMs: number;
  staleMs: number;
  description: string;
}

interface LockOwner {
  token: string;
  pid: number;
  hostname: string;
  createdAt: number;
}

const WAIT_ARRAY = new Int32Array(new SharedArrayBuffer(4));

function readOwner(lockPath: string): LockOwner | undefined {
  try {
    const value = JSON.parse(readFileSync(lockPath, 'utf8')) as Partial<LockOwner>;
    if (
      typeof value.token !== 'string' ||
      typeof value.pid !== 'number' ||
      typeof value.hostname !== 'string' ||
      typeof value.createdAt !== 'number'
    ) {
      return undefined;
    }
    return value as LockOwner;
  } catch {
    return undefined;
  }
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function canRemoveAbandonedLock(lockPath: string, staleMs: number): boolean {
  const owner = readOwner(lockPath);
  if (owner?.hostname === hostname()) return !processIsRunning(owner.pid);
  try {
    return Date.now() - statSync(lockPath).mtimeMs > staleMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function releaseOwnedLock(lockPath: string, token: string): void {
  if (readOwner(lockPath)?.token === token) rmSync(lockPath, { force: true });
}

function tryRemoveAbandonedLock(lockPath: string, staleMs: number): boolean {
  const reclaimPath = `${lockPath}.reclaim`;
  const reclaimToken = randomBytes(16).toString('hex');
  const reclaimOwner: LockOwner = {
    token: reclaimToken,
    pid: process.pid,
    hostname: hostname(),
    createdAt: Date.now(),
  };
  let descriptor: number | undefined;

  try {
    descriptor = openSync(reclaimPath, 'wx', 0o600);
    writeFileSync(descriptor, JSON.stringify(reclaimOwner), 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
  } catch (error) {
    if (descriptor !== undefined) {
      closeSync(descriptor);
      rmSync(reclaimPath, { force: true });
    }
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }

  try {
    if (!canRemoveAbandonedLock(lockPath, staleMs)) return false;
    rmSync(lockPath, { recursive: true, force: true });
    return true;
  } finally {
    releaseOwnedLock(reclaimPath, reclaimToken);
  }
}

export function withFileLock<T>(lockPath: string, options: FileLockOptions, callback: () => T): T {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const owner: LockOwner = {
    token: randomBytes(16).toString('hex'),
    pid: process.pid,
    hostname: hostname(),
    createdAt: Date.now(),
  };
  const startedAt = Date.now();

  while (true) {
    let descriptor: number | undefined;
    try {
      descriptor = openSync(lockPath, 'wx', 0o600);
      writeFileSync(descriptor, JSON.stringify(owner), 'utf8');
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      break;
    } catch (error) {
      if (descriptor !== undefined) {
        closeSync(descriptor);
        rmSync(lockPath, { force: true });
      }
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
      if (tryRemoveAbandonedLock(lockPath, options.staleMs)) continue;
      if (Date.now() - startedAt >= options.timeoutMs) {
        throw new Error(`Timed out waiting for ${options.description}`);
      }
      Atomics.wait(WAIT_ARRAY, 0, 0, 25);
    }
  }

  try {
    return callback();
  } finally {
    releaseOwnedLock(lockPath, owner.token);
  }
}
