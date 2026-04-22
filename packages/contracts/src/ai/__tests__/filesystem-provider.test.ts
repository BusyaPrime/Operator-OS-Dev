import { describe, expectTypeOf, it } from 'vitest';

import type {
  DirectoryEntry,
  FileContent,
  FSProviderType,
  FileStats,
  FileSystemProvider,
  FileSystemProviderScope,
  FileSystemWatchCallback,
  FileSystemWatchEvent,
  FileSystemWatchHandle
} from '../filesystem-provider.js';

describe('FileSystemProviderScope', () => {
  it('allowedRoots is readonly string array', () => {
    expectTypeOf<FileSystemProviderScope['allowedRoots']>().toEqualTypeOf<
      readonly string[]
    >();
  });

  it('readOnly + size limits are optional', () => {
    expectTypeOf<FileSystemProviderScope>()
      .toHaveProperty('readOnly')
      .toEqualTypeOf<boolean | undefined>();
    expectTypeOf<FileSystemProviderScope>()
      .toHaveProperty('maxFileSizeBytes')
      .toEqualTypeOf<number | undefined>();
    expectTypeOf<FileSystemProviderScope>()
      .toHaveProperty('maxTotalWriteBytes')
      .toEqualTypeOf<number | undefined>();
  });
});

describe('FSProviderType union', () => {
  it('is the 5-variant narrow union', () => {
    expectTypeOf<FSProviderType>().toEqualTypeOf<
      'local' | 'ssh' | 'cloud' | 'sandbox' | 'other'
    >();
  });
});

describe('FileContent', () => {
  it('encoding is utf-8 | base64', () => {
    expectTypeOf<FileContent['encoding']>().toEqualTypeOf<'utf-8' | 'base64'>();
  });

  it('path, content, sizeBytes required', () => {
    expectTypeOf<FileContent['path']>().toEqualTypeOf<string>();
    expectTypeOf<FileContent['content']>().toEqualTypeOf<string>();
    expectTypeOf<FileContent['sizeBytes']>().toEqualTypeOf<number>();
  });
});

describe('DirectoryEntry + FileStats', () => {
  it('DirectoryEntry.type is 3-variant union', () => {
    expectTypeOf<DirectoryEntry['type']>().toEqualTypeOf<
      'file' | 'directory' | 'symlink'
    >();
  });

  it('FileStats carries modifiedAt and createdAt ISO strings', () => {
    expectTypeOf<FileStats['modifiedAt']>().toEqualTypeOf<string>();
    expectTypeOf<FileStats['createdAt']>().toEqualTypeOf<string>();
  });
});

describe('FileSystemWatchEvent + callback + handle', () => {
  it('event type is 3-variant union', () => {
    expectTypeOf<FileSystemWatchEvent['type']>().toEqualTypeOf<
      'created' | 'modified' | 'deleted'
    >();
  });

  it('callback takes event, returns void', () => {
    expectTypeOf<FileSystemWatchCallback>().toEqualTypeOf<
      (event: FileSystemWatchEvent) => void
    >();
  });

  it('handle exposes async close()', () => {
    type CloseRet = ReturnType<FileSystemWatchHandle['close']>;
    expectTypeOf<CloseRet>().toEqualTypeOf<Promise<void>>();
  });
});

describe('FileSystemProvider interface', () => {
  it('exposes readonly scope', () => {
    expectTypeOf<FileSystemProvider['scope']>().toEqualTypeOf<FileSystemProviderScope>();
  });

  it('readFile returns Promise<FileContent>', () => {
    type Ret = ReturnType<FileSystemProvider['readFile']>;
    expectTypeOf<Ret>().toEqualTypeOf<Promise<FileContent>>();
  });

  it('readDirectory returns readonly DirectoryEntry array promise', () => {
    type Ret = ReturnType<FileSystemProvider['readDirectory']>;
    expectTypeOf<Ret>().toEqualTypeOf<Promise<readonly DirectoryEntry[]>>();
  });

  it('writeFile accepts string | Uint8Array content', () => {
    type Arg = Parameters<FileSystemProvider['writeFile']>[1];
    expectTypeOf<Arg>().toEqualTypeOf<string | Uint8Array>();
  });

  it('isPathAllowed is sync boolean, assertPathAllowed is sync void', () => {
    expectTypeOf<FileSystemProvider['isPathAllowed']>().toEqualTypeOf<
      (path: string) => boolean
    >();
    expectTypeOf<FileSystemProvider['assertPathAllowed']>().toEqualTypeOf<
      (path: string) => void
    >();
  });

  it('watch returns a FileSystemWatchHandle (not a promise)', () => {
    type Ret = ReturnType<FileSystemProvider['watch']>;
    expectTypeOf<Ret>().toEqualTypeOf<FileSystemWatchHandle>();
  });
});
