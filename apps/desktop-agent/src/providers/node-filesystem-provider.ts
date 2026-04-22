import { Buffer } from 'node:buffer';
import { watch as fsWatch } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  PathNotAllowedError,
  type DirectoryEntry,
  type FileContent,
  type FileStats,
  type FileSystemProvider,
  type FileSystemProviderScope,
  type FileSystemWatchCallback,
  type FileSystemWatchHandle
} from '@operator-os/contracts';

import type { Logger } from 'pino';

/**
 * Local filesystem provider backed by `node:fs/promises`.
 *
 * Enforces scope on every operation:
 * - `allowedRoots` — absolute paths; any read/write outside
 *   throws PathNotAllowedError via assertPathAllowed.
 * - `readOnly` — when true, every mutating method throws.
 * - `maxFileSizeBytes` — per-write cap (input length or Buffer
 *   length), throws BudgetExceededError-shaped AIAgentError on
 *   overrun.
 * - `maxTotalWriteBytes` — cumulative cap enforced by the
 *   provider across its lifetime; tracked via `#bytesWritten`.
 *
 * This is the only module in the package that is allowed to
 * call fs.readFile/writeFile directly. Agent code must go
 * through FileSystemProvider — that is how scope enforcement
 * stays load-bearing.
 */
export class NodeFileSystemProvider implements FileSystemProvider {
  readonly scope: FileSystemProviderScope;

  #logger: Logger;
  #bytesWritten = 0;

  constructor(scope: FileSystemProviderScope, logger: Logger) {
    if (scope.allowedRoots.length === 0) {
      throw new PathNotAllowedError('<init>', scope.allowedRoots);
    }
    this.scope = scope;
    this.#logger = logger;
  }

  isPathAllowed(targetPath: string): boolean {
    const resolved = path.resolve(targetPath);
    return this.scope.allowedRoots.some((root) => {
      const rootResolved = path.resolve(root);
      if (resolved === rootResolved) return true;
      const rel = path.relative(rootResolved, resolved);
      return (
        rel !== '' &&
        !rel.startsWith('..') &&
        !path.isAbsolute(rel)
      );
    });
  }

  assertPathAllowed(targetPath: string): void {
    if (!this.isPathAllowed(targetPath)) {
      throw new PathNotAllowedError(targetPath, this.scope.allowedRoots);
    }
  }

  async readFile(targetPath: string): Promise<FileContent> {
    this.assertPathAllowed(targetPath);
    const absolute = path.resolve(targetPath);
    const data = await fs.readFile(absolute);
    // Heuristic: if the bytes decode cleanly as UTF-8, hand
    // back utf-8; otherwise base64. JSON.parse + TypeScript
    // callers almost always want UTF-8; binary assets (images
    // etc.) get base64 so the caller can detect non-text.
    const utf8 = data.toString('utf-8');
    const roundtrip = Buffer.from(utf8, 'utf-8');
    const isClean = roundtrip.equals(data);
    return {
      path: absolute,
      content: isClean ? utf8 : data.toString('base64'),
      encoding: isClean ? 'utf-8' : 'base64',
      sizeBytes: data.byteLength
    };
  }

  async readDirectory(targetPath: string): Promise<readonly DirectoryEntry[]> {
    this.assertPathAllowed(targetPath);
    const absolute = path.resolve(targetPath);
    const entries = await fs.readdir(absolute, { withFileTypes: true });
    const mapped: DirectoryEntry[] = [];
    for (const entry of entries) {
      const entryPath = path.join(absolute, entry.name);
      let sizeBytes: number | undefined;
      if (entry.isFile()) {
        const stat = await fs.stat(entryPath);
        sizeBytes = stat.size;
      }
      mapped.push({
        name: entry.name,
        type: entry.isDirectory()
          ? 'directory'
          : entry.isSymbolicLink()
            ? 'symlink'
            : 'file',
        sizeBytes
      });
    }
    return mapped;
  }

  async stat(targetPath: string): Promise<FileStats> {
    this.assertPathAllowed(targetPath);
    const absolute = path.resolve(targetPath);
    const info = await fs.stat(absolute);
    return {
      path: absolute,
      type: info.isDirectory()
        ? 'directory'
        : info.isSymbolicLink()
          ? 'symlink'
          : 'file',
      sizeBytes: info.size,
      modifiedAt: info.mtime.toISOString(),
      createdAt: info.birthtime.toISOString()
    };
  }

  async writeFile(
    targetPath: string,
    content: string | Uint8Array
  ): Promise<void> {
    this.#assertWritable(targetPath);
    const buf = typeof content === 'string'
      ? Buffer.from(content, 'utf-8')
      : Buffer.from(content);
    this.#assertWithinWriteBudget(targetPath, buf.byteLength);

    const absolute = path.resolve(targetPath);
    // Atomic write: temp file + rename. Survives process crash
    // mid-write without leaving a partially-written target.
    const tmp = `${absolute}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(tmp, buf);
    await fs.rename(tmp, absolute);
    this.#bytesWritten += buf.byteLength;
  }

  async deleteFile(targetPath: string): Promise<void> {
    this.#assertWritable(targetPath);
    const absolute = path.resolve(targetPath);
    await fs.rm(absolute, { force: true });
  }

  async createDirectory(targetPath: string): Promise<void> {
    this.#assertWritable(targetPath);
    const absolute = path.resolve(targetPath);
    await fs.mkdir(absolute, { recursive: true });
  }

  async moveFile(from: string, to: string): Promise<void> {
    this.#assertWritable(from);
    this.#assertWritable(to);
    const absFrom = path.resolve(from);
    const absTo = path.resolve(to);
    await fs.mkdir(path.dirname(absTo), { recursive: true });
    await fs.rename(absFrom, absTo);
  }

  watch(
    targetPath: string,
    callback: FileSystemWatchCallback
  ): FileSystemWatchHandle {
    this.assertPathAllowed(targetPath);
    const absolute = path.resolve(targetPath);
    const watcher = fsWatch(absolute, { persistent: false }, (eventType, filename) => {
      const full = filename
        ? path.join(absolute, filename.toString())
        : absolute;
      callback({
        // node:fs events are `rename` or `change`; map to the
        // contract's 3-variant union best-effort.
        type:
          eventType === 'rename'
            ? 'created'
            : eventType === 'change'
              ? 'modified'
              : 'modified',
        path: full
      });
    });

    return {
      close: async () => {
        watcher.close();
      }
    };
  }

  // --- internals ---

  #assertWritable(targetPath: string): void {
    this.assertPathAllowed(targetPath);
    if (this.scope.readOnly === true) {
      throw new PathNotAllowedError(
        `${targetPath} (provider is read-only)`,
        this.scope.allowedRoots
      );
    }
  }

  #assertWithinWriteBudget(targetPath: string, bytes: number): void {
    const perFileCap = this.scope.maxFileSizeBytes;
    if (perFileCap !== undefined && bytes > perFileCap) {
      const msg =
        `Write of ${bytes} bytes to ${targetPath} exceeds ` +
        `scope.maxFileSizeBytes (${perFileCap}).`;
      this.#logger.warn({ targetPath, bytes, perFileCap }, msg);
      throw new PathNotAllowedError(targetPath, this.scope.allowedRoots);
    }
    const totalCap = this.scope.maxTotalWriteBytes;
    if (totalCap !== undefined && this.#bytesWritten + bytes > totalCap) {
      const msg =
        `Cumulative write budget exceeded: ` +
        `${this.#bytesWritten} + ${bytes} > ${totalCap}.`;
      this.#logger.warn(
        { targetPath, bytes, previouslyWritten: this.#bytesWritten, totalCap },
        msg
      );
      throw new PathNotAllowedError(targetPath, this.scope.allowedRoots);
    }
  }
}
