import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  type AppStateStatus,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';

import { ScreenShell } from '../components/screen-shell';
import { SectionCard } from '../components/section-card';
import { StatusPill } from '../components/status-pill';
import { tokenStorage } from '../auth/token-storage.js';
import type { TasksStackParamList } from '../navigation/types';
import { connectSse, type SseConnection } from '../services/sse-client.js';
import { createAuthClient } from '../services/auth-client.js';
import { useAuthStore } from '../state/auth-store.js';
import { useTaskStore } from '../state/task-store.js';
import { colors, spacing, typography } from '../theme/tokens';

import { processStreamMessage } from './task-stream-helpers.js';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';

/**
 * Strict navigator-supplied props. The screen reads
 * `route.params.taskId` and calls `navigation.goBack()`.
 */
export type TaskStreamScreenProps = NativeStackScreenProps<
  TasksStackParamList,
  'TaskStream'
>;

const STATUS_TONE: Record<
  string,
  'live' | 'info' | 'warning' | 'critical'
> = {
  pending: 'warning',
  queued: 'warning',
  assigned: 'info',
  executing: 'live',
  streaming: 'live',
  completed: 'live',
  failed: 'critical',
  cancelled: 'critical'
};

/**
 * Cloud Run hard-caps an SSE connection at ~60 minutes. Reconnect
 * a touch sooner so we don't lose deltas to the proxy hangup. The
 * server-side cleanup handles its own lifecycle.
 */
const RECONNECT_BEFORE_MS = 55 * 60 * 1_000;

const defaultGatewayBaseUrl =
  process.env.EXPO_PUBLIC_AUTH_GATEWAY_BASE_URL ?? 'http://localhost:8081';
const screenAuthClient = createAuthClient({
  gatewayBaseUrl: defaultGatewayBaseUrl
});

export function TaskStreamScreen({
  navigation,
  route
}: TaskStreamScreenProps) {
  const { taskId } = route.params;
  const task = useTaskStore((s) => s.tasks[taskId]);
  const appendDelta = useTaskStore((s) => s.appendDelta);
  const setStatus = useTaskStore((s) => s.setStatus);
  const completeTask = useTaskStore((s) => s.completeTask);
  const failTask = useTaskStore((s) => s.failTask);

  const storeSurface = useMemo(
    () => ({ appendDelta, setStatus, completeTask, failTask }),
    [appendDelta, setStatus, completeTask, failTask]
  );

  // 'connecting' | 'connected' | 'reconnecting' | 'closed-ok' | 'closed-error'
  const [connectionState, setConnectionState] = useState<
    'connecting' | 'connected' | 'reconnecting' | 'closed-ok' | 'closed-error'
  >('connecting');
  const [streamError, setStreamError] = useState<string | undefined>();

  // Connection handle so AppState transitions + cleanup can abort.
  const connectionRef = useRef<SseConnection | undefined>(undefined);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  useEffect(() => {
    if (task === undefined) return;

    let mounted = true;

    const buildAuthHeader = async (): Promise<string | undefined> => {
      const accessToken = useAuthStore.getState().accessToken;
      return accessToken === undefined ? undefined : `Bearer ${accessToken}`;
    };

    const tryRefresh = async (): Promise<boolean> => {
      const refreshToken = await tokenStorage.readRefreshToken();
      if (refreshToken === undefined) return false;
      try {
        const response = await screenAuthClient.refresh(refreshToken);
        await tokenStorage.writeRefreshToken(response.refreshToken);
        useAuthStore
          .getState()
          .applyRefreshedTokens(
            response.accessToken,
            response.accessTokenExpiresAt
          );
        return true;
      } catch {
        await useAuthStore.getState().forceSignOut();
        return false;
      }
    };

    const open = (): void => {
      if (!mounted) return;
      setConnectionState((prev) =>
        prev === 'connecting' ? prev : 'reconnecting'
      );
      // Pull the latest seq the store has acked so the server skips
      // the replay on reconnect (NOTE 4 — no delta loss).
      const latestSeq = useTaskStore.getState().tasks[taskId]?.lastEventId;
      const conn = connectSse({
        url: task.streamUrl,
        authHeader: buildAuthHeader,
        onUnauthorized: tryRefresh,
        lastEventId:
          latestSeq !== undefined ? String(latestSeq) : undefined,
        onMessage: (message) => {
          if (!mounted) return;
          setConnectionState('connected');
          const outcome = processStreamMessage(
            taskId,
            message.data,
            storeSurface
          );
          if (outcome.terminal) {
            setConnectionState('closed-ok');
          }
        },
        onError: (err) => {
          if (!mounted) return;
          setStreamError(
            err instanceof Error ? err.message : 'stream error'
          );
        },
        onClose: (reason) => {
          if (!mounted) return;
          if (reason === 'server-end') {
            // Terminal status frame already updated the store; we
            // just acknowledge the clean close.
            setConnectionState((prev) =>
              prev === 'closed-ok' ? prev : 'closed-ok'
            );
            return;
          }
          if (reason === 'aborted') return;
          if (reason === 'reauth-needed') {
            // Tokens were just rotated — reconnect immediately with
            // the new bearer + same lastEventId.
            connectionRef.current = undefined;
            open();
            return;
          }
          // Fatal — try one auto-reconnect, then surface the error.
          setConnectionState('reconnecting');
          reconnectTimerRef.current = setTimeout(() => {
            if (!mounted) return;
            open();
          }, 2_000);
        }
      });
      connectionRef.current = conn;

      // Pre-emptive Cloud Run hangup.
      reconnectTimerRef.current = setTimeout(() => {
        if (!mounted) return;
        conn.close();
        open();
      }, RECONNECT_BEFORE_MS);
    };

    open();

    const subscription = AppState.addEventListener(
      'change',
      (status: AppStateStatus) => {
        if (!mounted) return;
        if (status === 'active') {
          // Returning to foreground — ensure we have a live stream.
          if (connectionRef.current === undefined) open();
        }
      }
    );

    return () => {
      mounted = false;
      subscription.remove();
      if (reconnectTimerRef.current !== undefined) {
        clearTimeout(reconnectTimerRef.current);
      }
      connectionRef.current?.close();
      connectionRef.current = undefined;
    };
    // We intentionally re-run only when the taskId / streamUrl
    // change. Store setters from zustand are stable references.
  }, [taskId, task?.streamUrl, storeSurface]);

  if (task === undefined) {
    return (
      <ScreenShell
        eyebrow="Task stream"
        subtitle="The task you opened isn't in the local view-model — submit a new one."
        title="Task not found"
      >
        <Pressable
          accessibilityLabel="back-to-submit"
          accessibilityRole="button"
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Text style={styles.backLabel}>Go back</Text>
        </Pressable>
      </ScreenShell>
    );
  }

  const tone = STATUS_TONE[task.status] ?? 'info';
  const connectionTone =
    connectionState === 'connected'
      ? 'live'
      : connectionState === 'closed-ok'
        ? 'info'
        : connectionState === 'closed-error'
          ? 'critical'
          : 'warning';

  return (
    <ScreenShell
      eyebrow={`Task ${task.taskId.slice(0, 8)}`}
      subtitle="Live output streamed from the agent. Reconnects automatically if the connection drops."
      title="Streaming output"
    >
      <SectionCard eyebrow="Status" title="Where the task stands">
        <View style={styles.pillRow}>
          <StatusPill label={task.status} tone={tone} />
          <StatusPill label={connectionState} tone={connectionTone} />
        </View>
        {streamError !== undefined ? (
          <Text style={styles.errorCopy}>{streamError}</Text>
        ) : null}
      </SectionCard>

      <SectionCard eyebrow="Prompt" title="What you asked">
        <Text style={styles.promptCopy}>{task.prompt}</Text>
      </SectionCard>

      <SectionCard eyebrow="Output" title="Agent response">
        <ScrollView
          accessibilityLabel="task-output"
          style={styles.outputBox}
        >
          <Text style={styles.outputText}>
            {task.output.length > 0 ? task.output : '(waiting for output…)'}
          </Text>
        </ScrollView>
      </SectionCard>

      {task.error !== undefined ? (
        <View accessibilityLabel="task-error" style={styles.errorBlock}>
          <Text style={styles.errorTitle}>
            Task failed ({task.error.code})
          </Text>
          <Text style={styles.errorBody}>{task.error.message}</Text>
        </View>
      ) : null}

      <Pressable
        accessibilityLabel="back-to-submit"
        accessibilityRole="button"
        onPress={() => navigation.goBack()}
        style={styles.backButton}
      >
        <Text style={styles.backLabel}>Submit another task</Text>
      </Pressable>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: 12,
    paddingVertical: spacing.md
  },
  backLabel: {
    color: colors.cardStrong,
    fontSize: typography.body,
    fontWeight: '700'
  },
  errorBlock: {
    backgroundColor: '#3B1F1F',
    borderRadius: 12,
    padding: spacing.md
  },
  errorBody: {
    color: '#F8D7D7',
    fontSize: typography.body,
    lineHeight: 20
  },
  errorCopy: {
    color: colors.danger,
    fontSize: typography.caption,
    marginTop: spacing.xs
  },
  errorTitle: {
    color: '#FF7B7B',
    fontSize: typography.caption,
    fontWeight: '700',
    marginBottom: spacing.xs,
    textTransform: 'uppercase'
  },
  outputBox: {
    backgroundColor: colors.card,
    borderRadius: 12,
    maxHeight: 320,
    padding: spacing.md
  },
  outputText: {
    color: colors.ink,
    fontFamily: 'Courier',
    fontSize: typography.body,
    lineHeight: 22
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs
  },
  promptCopy: {
    color: colors.inkMuted,
    fontSize: typography.body,
    lineHeight: 22
  }
});
