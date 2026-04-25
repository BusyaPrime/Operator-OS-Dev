/**
 * Pure-logic helpers for TaskSubmitScreen, extracted into a
 * non-tsx module so the test file can import them without
 * pulling react-native (whose Flow-syntax index.js confuses
 * vitest's rolldown parser) into the test bundle.
 *
 * Phase 1.5 SignInScreen test pattern: target the extracted
 * hook / handler, not the rendered tree.
 */

/**
 * Idempotency-key generator. Modern React Native (>=0.74) ships
 * `crypto.randomUUID()` natively; we fall back to a manual v4
 * UUID for older runtimes. Idempotency keys do not need to be
 * cryptographically strong — the server's 24h dedup cache holds
 * them; collision odds at MVP scale are negligible either way.
 */
export const generateIdempotencyKey = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const hex = (len: number): string => {
    let out = '';
    for (let i = 0; i < len; i += 1) {
      out += Math.floor(Math.random() * 16).toString(16);
    }
    return out;
  };
  const variant = '89ab'[Math.floor(Math.random() * 4)];
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
};

export interface TaskSubmitFormState {
  readonly prompt: string;
  readonly capabilities: ReadonlySet<string>;
  readonly idempotencyKey: string;
}

export interface TaskSubmitDeps {
  readonly submitTask: (input: {
    readonly prompt: string;
    readonly capabilities: readonly string[];
    readonly idempotencyKey: string;
  }) => Promise<
    | { readonly taskId: string }
    | { readonly error: { readonly code: string; readonly message: string } }
  >;
  readonly navigation: {
    navigate(name: 'TaskStream', params: { readonly taskId: string }): void;
  };
}

/**
 * Pure-logic task-submit handler. Refuses to call `submitTask`
 * when the prompt is empty / whitespace-only OR no capabilities
 * are selected (validation gate). On success returns
 * `{taskId}` and navigates to TaskStream; on error returns
 * `undefined` (caller renders the error from store state).
 */
export const performTaskSubmit = async (
  args: TaskSubmitFormState & TaskSubmitDeps
): Promise<{ readonly taskId: string } | undefined> => {
  const trimmedPrompt = args.prompt.trim();
  if (trimmedPrompt.length === 0) return undefined;
  if (args.capabilities.size === 0) return undefined;

  const result = await args.submitTask({
    prompt: trimmedPrompt,
    capabilities: [...args.capabilities],
    idempotencyKey: args.idempotencyKey
  });

  if ('taskId' in result) {
    args.navigation.navigate('TaskStream', { taskId: result.taskId });
    return { taskId: result.taskId };
  }
  return undefined;
};
