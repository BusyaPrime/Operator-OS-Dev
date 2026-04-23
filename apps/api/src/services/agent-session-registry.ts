import { randomUUID } from 'node:crypto';

import type { WebSocket as WsWebSocket } from 'ws';

/**
 * A live WS session between the api and one desktop-agent
 * instance. One connection per agentId at a time — if the same
 * agentId reconnects, the registry closes the prior session
 * (close code 4004) and replaces it.
 *
 * MVP / Phase 2 scope: in-memory, single Fastify instance. The
 * "Agent WebSocket Sessions Are In-Memory" ADR records the
 * future migration path to a shared store when Cloud Run
 * switches to multi-instance.
 */
export interface AgentSession {
  readonly sessionId: string;
  readonly agentId: string;
  readonly userId: string;
  readonly socket: WsWebSocket;
  /** ISO8601 timestamp when the hello → welcome handshake completed. */
  readonly connectedAt: string;
  /** ISO8601 timestamp of the last ping / pong / message. Mutated via update. */
  lastActivityAt: string;
  /** Arbitrary manifest payload reported by the client at hello. Loose on purpose. */
  readonly manifest: Readonly<Record<string, unknown>>;
}

export interface RegisterParams {
  readonly agentId: string;
  readonly userId: string;
  readonly socket: WsWebSocket;
  readonly manifest: Record<string, unknown>;
}

export interface AgentSessionRegistry {
  /**
   * Accepts a new session. If `agentId` already has a session,
   * closes the prior socket with code 4004 ("duplicate-agent")
   * and replaces it. Returns the freshly-created session.
   */
  register(params: RegisterParams): AgentSession;

  byId(sessionId: string): AgentSession | undefined;
  byAgent(agentId: string): AgentSession | undefined;

  /** Mutates `lastActivityAt` in place; no-op if unknown session. */
  touch(sessionId: string): void;

  /** Removes session by id. Returns true if it was present. */
  removeBySessionId(sessionId: string): boolean;

  size(): number;
  list(): readonly AgentSession[];

  /**
   * Close every session. Invoked from Fastify's onClose hook so
   * shutdown is clean. The `reason` is passed verbatim to the
   * underlying socket close frame.
   */
  closeAll(code: number, reason: string): void;
}

export const createAgentSessionRegistry = (
  idFactory: () => string = () => randomUUID(),
  now: () => string = () => new Date().toISOString()
): AgentSessionRegistry => {
  const sessions = new Map<string, AgentSession>();
  const byAgentId = new Map<string, string>();

  const close = (session: AgentSession, code: number, reason: string): void => {
    try {
      session.socket.close(code, reason);
    } catch {
      // Socket might already be half-closed; terminate as a
      // fallback. Terminate is synchronous + idempotent.
      try {
        session.socket.terminate();
      } catch {
        /* give up silently */
      }
    }
  };

  return {
    register(params: RegisterParams): AgentSession {
      const existingSessionId = byAgentId.get(params.agentId);
      if (existingSessionId !== undefined) {
        const prior = sessions.get(existingSessionId);
        if (prior !== undefined) {
          close(prior, 4004, 'duplicate-agent');
          sessions.delete(existingSessionId);
        }
      }

      const sessionId = idFactory();
      const timestamp = now();
      const session: AgentSession = {
        sessionId,
        agentId: params.agentId,
        userId: params.userId,
        socket: params.socket,
        connectedAt: timestamp,
        lastActivityAt: timestamp,
        manifest: params.manifest
      };
      sessions.set(sessionId, session);
      byAgentId.set(params.agentId, sessionId);
      return session;
    },

    byId(sessionId: string): AgentSession | undefined {
      return sessions.get(sessionId);
    },

    byAgent(agentId: string): AgentSession | undefined {
      const sessionId = byAgentId.get(agentId);
      return sessionId === undefined ? undefined : sessions.get(sessionId);
    },

    touch(sessionId: string): void {
      const session = sessions.get(sessionId);
      if (session === undefined) return;
      session.lastActivityAt = now();
    },

    removeBySessionId(sessionId: string): boolean {
      const session = sessions.get(sessionId);
      if (session === undefined) return false;
      sessions.delete(sessionId);
      const mappedSessionId = byAgentId.get(session.agentId);
      if (mappedSessionId === sessionId) {
        byAgentId.delete(session.agentId);
      }
      return true;
    },

    size(): number {
      return sessions.size;
    },

    list(): readonly AgentSession[] {
      return [...sessions.values()];
    },

    closeAll(code: number, reason: string): void {
      for (const session of sessions.values()) {
        close(session, code, reason);
      }
      sessions.clear();
      byAgentId.clear();
    }
  };
};
