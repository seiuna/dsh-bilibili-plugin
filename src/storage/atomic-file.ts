import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export async function removeIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
}

/** 同目录独占临时文件 + fsync + rename；POSIX 为 0600，Windows 依赖目录 ACL。 */
export async function writePrivateAtomic(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${crypto.randomBytes(12).toString('hex')}.tmp`;
  const handle = await fs.open(tempPath, 'wx', 0o600);
  let closed = false;
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    closed = true;
    await fs.rename(tempPath, filePath);
  } finally {
    try {
      if (!closed) await handle.close();
    } finally {
      await removeIfExists(tempPath);
    }
  }
}
