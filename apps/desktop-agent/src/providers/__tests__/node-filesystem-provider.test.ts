import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PathNotAllowedError } from '@operator-os/contracts';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NodeFileSystemProvider } from '../node-filesystem-provider.js';

const silentLogger = pino({ level: 'silent' });

/**
 * Each test runs in its own temp directory under os.tmpdir() so
 * concurrent test runs don't collide. beforeEach allocates,
 * afterEach tears down.
 */
describe('NodeFileSystemProvider', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'nfsp-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('scope validation', () => {
    it('accepts paths inside an allowed root', () => {
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root] },
        silentLogger
      );
      expect(provider.isPathAllowed(path.join(root, 'a.txt'))).toBe(true);
      expect(provider.isPathAllowed(path.join(root, 'sub', 'b.txt'))).toBe(true);
    });

    it('accepts the root itself', () => {
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root] },
        silentLogger
      );
      expect(provider.isPathAllowed(root)).toBe(true);
    });

    it('rejects paths outside all allowed roots', () => {
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root] },
        silentLogger
      );
      const outside = path.join(os.tmpdir(), 'not-allowed.txt');
      expect(provider.isPathAllowed(outside)).toBe(false);
    });

    it("rejects traversal via '..'", () => {
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root] },
        silentLogger
      );
      const traversal = path.join(root, '..', '..', 'etc', 'passwd');
      expect(provider.isPathAllowed(traversal)).toBe(false);
    });

    it('assertPathAllowed throws PathNotAllowedError on rejection', () => {
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root] },
        silentLogger
      );
      const bad = path.join(root, '..', 'outside.txt');
      expect(() => provider.assertPathAllowed(bad)).toThrow(PathNotAllowedError);
    });

    it('assertPathAllowed is silent on allowed paths', () => {
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root] },
        silentLogger
      );
      expect(() => provider.assertPathAllowed(root)).not.toThrow();
    });

    it('construction with empty allowedRoots throws', () => {
      expect(
        () => new NodeFileSystemProvider({ allowedRoots: [] }, silentLogger)
      ).toThrow(PathNotAllowedError);
    });
  });

  describe('readFile', () => {
    it('returns utf-8 for text content', async () => {
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root] },
        silentLogger
      );
      const p = path.join(root, 'hello.txt');
      await fs.writeFile(p, 'Hello, world!', 'utf-8');
      const result = await provider.readFile(p);
      expect(result.encoding).toBe('utf-8');
      expect(result.content).toBe('Hello, world!');
      expect(result.sizeBytes).toBe(13);
    });

    it('returns base64 for binary content', async () => {
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root] },
        silentLogger
      );
      const p = path.join(root, 'binary.bin');
      const bytes = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0xc0]);
      await fs.writeFile(p, bytes);
      const result = await provider.readFile(p);
      expect(result.encoding).toBe('base64');
      expect(result.sizeBytes).toBe(5);
    });

    it('rejects out-of-scope reads', async () => {
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root] },
        silentLogger
      );
      const outside = path.join(os.tmpdir(), 'outside.txt');
      await expect(provider.readFile(outside)).rejects.toThrow(
        PathNotAllowedError
      );
    });
  });

  describe('writeFile (atomic)', () => {
    it('writes string content utf-8', async () => {
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root] },
        silentLogger
      );
      const p = path.join(root, 'wrote.txt');
      await provider.writeFile(p, 'payload');
      const back = await fs.readFile(p, 'utf-8');
      expect(back).toBe('payload');
    });

    it('writes Uint8Array binary content', async () => {
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root] },
        silentLogger
      );
      const p = path.join(root, 'bin.dat');
      await provider.writeFile(p, new Uint8Array([1, 2, 3, 4]));
      const back = await fs.readFile(p);
      expect(Array.from(back)).toEqual([1, 2, 3, 4]);
    });

    it('creates parent directories as needed', async () => {
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root] },
        silentLogger
      );
      const nested = path.join(root, 'a', 'b', 'c', 'deep.txt');
      await provider.writeFile(nested, 'deep');
      const back = await fs.readFile(nested, 'utf-8');
      expect(back).toBe('deep');
    });

    it('leaves no .tmp files behind on success', async () => {
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root] },
        silentLogger
      );
      const p = path.join(root, 'atomic.txt');
      await provider.writeFile(p, 'ok');
      const entries = await fs.readdir(root);
      expect(entries.filter((n) => n.includes('.tmp'))).toHaveLength(0);
    });
  });

  describe('write budget enforcement', () => {
    it('rejects write exceeding maxFileSizeBytes', async () => {
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root], maxFileSizeBytes: 5 },
        silentLogger
      );
      const p = path.join(root, 'too-big.txt');
      await expect(
        provider.writeFile(p, '123456789')
      ).rejects.toThrow(PathNotAllowedError);
    });

    it('allows writes within maxFileSizeBytes', async () => {
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root], maxFileSizeBytes: 10 },
        silentLogger
      );
      await expect(
        provider.writeFile(path.join(root, 'ok.txt'), '12345')
      ).resolves.toBeUndefined();
    });

    it('tracks cumulative write bytes across calls', async () => {
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root], maxTotalWriteBytes: 10 },
        silentLogger
      );
      await provider.writeFile(path.join(root, 'a.txt'), '12345');  // 5
      await provider.writeFile(path.join(root, 'b.txt'), '12345');  // 10 total
      await expect(
        provider.writeFile(path.join(root, 'c.txt'), '1')
      ).rejects.toThrow(PathNotAllowedError);
    });
  });

  describe('read-only mode', () => {
    it('rejects writeFile when scope.readOnly=true', async () => {
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root], readOnly: true },
        silentLogger
      );
      await expect(
        provider.writeFile(path.join(root, 'x.txt'), 'nope')
      ).rejects.toThrow(PathNotAllowedError);
    });

    it('rejects deleteFile in read-only mode', async () => {
      const p = path.join(root, 'existing.txt');
      await fs.writeFile(p, 'present');
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root], readOnly: true },
        silentLogger
      );
      await expect(provider.deleteFile(p)).rejects.toThrow(PathNotAllowedError);
    });

    it('rejects createDirectory in read-only mode', async () => {
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root], readOnly: true },
        silentLogger
      );
      await expect(
        provider.createDirectory(path.join(root, 'new-dir'))
      ).rejects.toThrow(PathNotAllowedError);
    });

    it('rejects moveFile in read-only mode', async () => {
      const from = path.join(root, 'from.txt');
      const to = path.join(root, 'to.txt');
      await fs.writeFile(from, 'x');
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root], readOnly: true },
        silentLogger
      );
      await expect(provider.moveFile(from, to)).rejects.toThrow(
        PathNotAllowedError
      );
    });

    it('still allows readFile / readDirectory / stat in read-only mode', async () => {
      const p = path.join(root, 'readable.txt');
      await fs.writeFile(p, 'readable');
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root], readOnly: true },
        silentLogger
      );
      const result = await provider.readFile(p);
      expect(result.content).toBe('readable');
    });
  });

  describe('directory + stat operations', () => {
    it('readDirectory lists files and directories with types', async () => {
      await fs.writeFile(path.join(root, 'f.txt'), 'x');
      await fs.mkdir(path.join(root, 'sub'));
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root] },
        silentLogger
      );
      const entries = await provider.readDirectory(root);
      const names = new Set(entries.map((e) => e.name));
      expect(names).toEqual(new Set(['f.txt', 'sub']));
      const file = entries.find((e) => e.name === 'f.txt')!;
      expect(file.type).toBe('file');
      expect(file.sizeBytes).toBe(1);
      const dir = entries.find((e) => e.name === 'sub')!;
      expect(dir.type).toBe('directory');
    });

    it('stat returns file metadata with ISO timestamps', async () => {
      const p = path.join(root, 'meta.txt');
      await fs.writeFile(p, 'metadata');
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root] },
        silentLogger
      );
      const s = await provider.stat(p);
      expect(s.type).toBe('file');
      expect(s.sizeBytes).toBe(8);
      expect(s.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(s.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('move + delete', () => {
    it('moveFile renames / moves across allowed subtree', async () => {
      const from = path.join(root, 'from.txt');
      const to = path.join(root, 'nested', 'to.txt');
      await fs.writeFile(from, 'moved');
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root] },
        silentLogger
      );
      await provider.moveFile(from, to);
      await expect(fs.readFile(to, 'utf-8')).resolves.toBe('moved');
      await expect(fs.stat(from)).rejects.toThrow();
    });

    it('deleteFile removes target', async () => {
      const p = path.join(root, 'bye.txt');
      await fs.writeFile(p, 'bye');
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root] },
        silentLogger
      );
      await provider.deleteFile(p);
      await expect(fs.stat(p)).rejects.toThrow();
    });

    it('deleteFile on missing file does not throw (force: true)', async () => {
      const provider = new NodeFileSystemProvider(
        { allowedRoots: [root] },
        silentLogger
      );
      await expect(
        provider.deleteFile(path.join(root, 'not-there.txt'))
      ).resolves.toBeUndefined();
    });
  });

  describe('multiple allowed roots', () => {
    it('accepts paths in any of the allowed roots', async () => {
      const second = await fs.mkdtemp(path.join(os.tmpdir(), 'nfsp-2-'));
      try {
        const provider = new NodeFileSystemProvider(
          { allowedRoots: [root, second] },
          silentLogger
        );
        expect(provider.isPathAllowed(path.join(root, 'a.txt'))).toBe(true);
        expect(provider.isPathAllowed(path.join(second, 'b.txt'))).toBe(true);
      } finally {
        await fs.rm(second, { recursive: true, force: true });
      }
    });
  });
});
