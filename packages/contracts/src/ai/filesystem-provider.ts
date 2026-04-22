/** Transport type for a filesystem-provider implementation. */
export type FSProviderType =
  | 'local'
  | 'ssh'
  | 'cloud'
  | 'sandbox'
  | 'other';

/**
 * Scope limits declared by a FileSystemProvider. The provider
 * enforces these on every read/write — paths outside
 * allowedRoots are rejected, writes exceeding size limits are
 * rejected, and read-only providers refuse all mutating calls.
 */
export interface FileSystemProviderScope {
  /** Absolute paths. Provider rejects access outside these. */
  readonly allowedRoots: readonly string[];
  /** If true, all mutating methods throw PathNotAllowedError. */
  readonly readOnly?: boolean;
  /** Reject individual writes larger than this. */
  readonly maxFileSizeBytes?: number;
  /** Reject further writes once this cumulative budget is hit. */
  readonly maxTotalWriteBytes?: number;
}

/** File contents returned by FileSystemProvider.readFile. */
export interface FileContent {
  readonly path: string;
  /** Decoded string if encoding='utf-8', base64 otherwise. */
  readonly content: string;
  readonly encoding: 'utf-8' | 'base64';
  readonly sizeBytes: number;
}

/** Single directory entry from FileSystemProvider.readDirectory. */
export interface DirectoryEntry {
  readonly name: string;
  readonly type: 'file' | 'directory' | 'symlink';
  readonly sizeBytes?: number;
}

/** Filesystem-entry metadata from FileSystemProvider.stat. */
export interface FileStats {
  readonly path: string;
  readonly type: 'file' | 'directory' | 'symlink';
  readonly sizeBytes: number;
  /** ISO8601 timestamp of last content modification. */
  readonly modifiedAt: string;
  /** ISO8601 timestamp of entry creation. */
  readonly createdAt: string;
}

/** Watch event emitted by FileSystemProvider.watch. */
export interface FileSystemWatchEvent {
  readonly type: 'created' | 'modified' | 'deleted';
  readonly path: string;
}

/** Callback shape for FileSystemProvider.watch subscribers. */
export type FileSystemWatchCallback = (event: FileSystemWatchEvent) => void;

/** Handle returned by FileSystemProvider.watch; close to unsubscribe. */
export interface FileSystemWatchHandle {
  close(): Promise<void>;
}

/**
 * Provider-agnostic filesystem surface. Agents call this rather
 * than `fs/promises` directly so that scope enforcement,
 * sandboxing, and alternate backends (SSH, cloud, containerised
 * sandbox) can be swapped without changing agent code.
 *
 * Every concrete agent receives a FileSystemProvider
 * (AIAgent.fs). Different agents may carry different scopes —
 * e.g. Cursor CLI may ship with a scoped sandbox provider that
 * restricts writes to the current project dir, while Claude
 * Code uses a local provider with workspace-wide roots.
 */
export interface FileSystemProvider {
  readonly scope: FileSystemProviderScope;

  readFile(path: string): Promise<FileContent>;
  readDirectory(path: string): Promise<readonly DirectoryEntry[]>;
  stat(path: string): Promise<FileStats>;

  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  deleteFile(path: string): Promise<void>;
  createDirectory(path: string): Promise<void>;
  moveFile(from: string, to: string): Promise<void>;

  /** Best-effort. Implementations may throw NotImplementedError. */
  watch(path: string, callback: FileSystemWatchCallback): FileSystemWatchHandle;

  /** True if `path` is inside scope.allowedRoots (not read-only check). */
  isPathAllowed(path: string): boolean;
  /** Throws PathNotAllowedError if isPathAllowed would return false. */
  assertPathAllowed(path: string): void;
}
