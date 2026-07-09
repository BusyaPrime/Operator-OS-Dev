import readline from 'node:readline/promises';

import { DpapiCredentialStore } from '../auth/credential-store.js';
import { runRegisterCli, type RegisterCliIo } from './register.js';

/**
 * Phase 4.0 Part 4.B — bin entrypoint for `pnpm --filter
 * @operator-os/desktop-agent register`.
 *
 * Wires the production-mode CLI: real readline-driven stdin,
 * real `fetch`, real `DpapiCredentialStore`. The unit tests
 * for `runRegisterCli` cover every branch with injected
 * doubles — this file just composes the production wiring
 * and forwards exit codes.
 */

const buildIo = (
  rl: readline.Interface
): RegisterCliIo => ({
  async readLine(prompt) {
    return rl.question(prompt);
  },
  writeLine(line) {
    process.stdout.write(`${line}\n`);
  },
  writeErrLine(line) {
    process.stderr.write(`${line}\n`);
  }
});

const main = async (): Promise<void> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  try {
    const result = await runRegisterCli({
      io: buildIo(rl),
      fetch: globalThis.fetch,
      credentialStore: new DpapiCredentialStore()
    });
    process.exit(result.exitCode);
  } finally {
    rl.close();
  }
};

void main();
