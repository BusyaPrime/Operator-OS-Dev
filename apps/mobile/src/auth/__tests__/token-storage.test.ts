import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn()
}));

import * as SecureStore from 'expo-secure-store';

import { tokenStorage, TOKEN_STORAGE_KEYS } from '../token-storage.js';

describe('tokenStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('readRefreshToken', () => {
    it('returns the stored token when present', async () => {
      vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce('rt-abc');
      await expect(tokenStorage.readRefreshToken()).resolves.toBe('rt-abc');
      expect(SecureStore.getItemAsync).toHaveBeenCalledWith(
        TOKEN_STORAGE_KEYS.refreshToken
      );
    });

    it('returns undefined when the keychain entry is missing', async () => {
      vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(null);
      await expect(tokenStorage.readRefreshToken()).resolves.toBeUndefined();
    });

    it('returns undefined when the platform throws (e.g. web)', async () => {
      vi.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(
        new Error('SecureStore is not available on this platform')
      );
      await expect(tokenStorage.readRefreshToken()).resolves.toBeUndefined();
    });
  });

  describe('writeRefreshToken', () => {
    it('persists the token under the namespaced key', async () => {
      vi.mocked(SecureStore.setItemAsync).mockResolvedValueOnce();
      await tokenStorage.writeRefreshToken('rt-xyz');
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        TOKEN_STORAGE_KEYS.refreshToken,
        'rt-xyz'
      );
    });

    it('rejects empty tokens before touching the keychain', async () => {
      await expect(tokenStorage.writeRefreshToken('')).rejects.toThrow(
        /empty token/
      );
      expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    });

    it('propagates underlying keychain write failures', async () => {
      vi.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(
        new Error('keychain locked')
      );
      await expect(tokenStorage.writeRefreshToken('rt-abc')).rejects.toThrow(
        /keychain locked/
      );
    });
  });

  describe('clearRefreshToken', () => {
    it('deletes the keychain entry', async () => {
      vi.mocked(SecureStore.deleteItemAsync).mockResolvedValueOnce();
      await tokenStorage.clearRefreshToken();
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
        TOKEN_STORAGE_KEYS.refreshToken
      );
    });

    it('swallows platform errors so sign-out can never half-fail', async () => {
      vi.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(
        new Error('SecureStore is not available on this platform')
      );
      await expect(tokenStorage.clearRefreshToken()).resolves.toBeUndefined();
    });
  });

  describe('TOKEN_STORAGE_KEYS', () => {
    it('exposes the stable namespaced key', () => {
      expect(TOKEN_STORAGE_KEYS.refreshToken).toBe(
        'operator-os-auth.refreshToken'
      );
    });
  });
});
