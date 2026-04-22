import type { AgentManifest } from '@operator-os/contracts';
import pino from 'pino';
import { beforeEach, describe, expect, it } from 'vitest';

import { ManifestLoader } from '../manifest-loader.js';

const silentLogger = pino({ level: 'silent' });

const makeManifest = (providerId: string): AgentManifest => ({
  manifestVersion: '1',
  providerId,
  providerVersion: '0.0.0-test',
  displayName: providerId,
  description: `${providerId} manifest`,
  author: 'test',
  license: 'MIT',
  capabilities: [],
  requirements: {}
});

describe('ManifestLoader', () => {
  let sources: Map<string, AgentManifest>;

  beforeEach(() => {
    sources = new Map<string, AgentManifest>([
      ['claude-code', makeManifest('anthropic.claude-code')],
      ['codex', makeManifest('openai.codex')]
    ]);
  });

  describe('load', () => {
    it('returns the manifest registered for a known short-name', () => {
      const loader = new ManifestLoader(sources, silentLogger);
      const manifest = loader.load('claude-code');
      expect(manifest.providerId).toBe('anthropic.claude-code');
    });

    it('returns distinct manifests for distinct short-names', () => {
      const loader = new ManifestLoader(sources, silentLogger);
      expect(loader.load('claude-code').providerId).toBe(
        'anthropic.claude-code'
      );
      expect(loader.load('codex').providerId).toBe('openai.codex');
    });

    it('throws a descriptive error for an unknown short-name', () => {
      const loader = new ManifestLoader(sources, silentLogger);
      expect(() => loader.load('ghost')).toThrow(
        /no manifest registered for 'ghost'/
      );
    });

    it('error message lists known providers so the caller can diagnose typos', () => {
      const loader = new ManifestLoader(sources, silentLogger);
      expect(() => loader.load('gemini')).toThrow(/claude-code/);
      expect(() => loader.load('gemini')).toThrow(/codex/);
    });
  });

  describe('availableProviders', () => {
    it('returns the set of short-names registered at construction time', () => {
      const loader = new ManifestLoader(sources, silentLogger);
      expect([...loader.availableProviders()].sort()).toEqual([
        'claude-code',
        'codex'
      ]);
    });

    it('returns an empty list when no sources were registered', () => {
      const loader = new ManifestLoader(new Map(), silentLogger);
      expect(loader.availableProviders()).toEqual([]);
    });

    it('is isolated from post-construction mutation of the input map', () => {
      const loader = new ManifestLoader(sources, silentLogger);
      sources.set('gemini', makeManifest('google.gemini'));
      expect([...loader.availableProviders()].sort()).toEqual([
        'claude-code',
        'codex'
      ]);
    });
  });
});
