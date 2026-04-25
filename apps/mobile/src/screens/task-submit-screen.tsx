import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';

import { ScreenShell } from '../components/screen-shell';
import { SectionCard } from '../components/section-card';
import type { TasksStackParamList } from '../navigation/types';
import { useTaskStore } from '../state/task-store';
import { colors, spacing, typography } from '../theme/tokens';

import {
  generateIdempotencyKey,
  performTaskSubmit
} from './task-submit-helpers.js';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';

/**
 * Capability chips offered to the user. Subset of
 * `agentCapabilityEnum` from contracts; the full enum is overkill
 * for the MVP picker. Server-side router still honours the full
 * enum — this is purely UI surface area.
 */
const CAPABILITY_OPTIONS: readonly string[] = [
  'code-generation',
  'code-review',
  'planning',
  'tool-use',
  'shell-execution',
  'file-read',
  'file-write'
];

const PROMPT_MAX_CHARS = 50_000;

/**
 * Strict navigator-supplied props. The screen only ever calls
 * `navigation.navigate('TaskStream', { taskId })` — but we accept
 * the full props shape so React Navigation's type-checker is
 * satisfied at the navigator wire-up.
 */
export type TaskSubmitScreenProps = NativeStackScreenProps<
  TasksStackParamList,
  'TaskSubmit'
>;

export function TaskSubmitScreen({ navigation }: TaskSubmitScreenProps) {
  const submitTask = useTaskStore((s) => s.submitTask);
  const submissionStatus = useTaskStore((s) => s.submissionStatus);
  const submissionError = useTaskStore((s) => s.submissionError);
  const clearSubmissionError = useTaskStore((s) => s.clearSubmissionError);

  const [prompt, setPrompt] = useState('');
  const [selectedCapabilities, setSelectedCapabilities] = useState<
    ReadonlySet<string>
  >(() => new Set(['code-generation']));

  // One stable idempotency key per screen mount. Re-mounting (user
  // navigates back + comes again) generates a fresh key — that is
  // the desired behaviour: a different user-intent.
  const idempotencyKey = useMemo(() => generateIdempotencyKey(), []);

  useEffect(() => {
    return () => {
      // Clear any stale submit error when leaving the screen so
      // the next mount starts clean.
      if (submissionError) clearSubmissionError();
    };
  }, [submissionError, clearSubmissionError]);

  const promptLength = prompt.length;
  const trimmedPrompt = prompt.trim();
  const hasPrompt = trimmedPrompt.length > 0;
  const hasCapability = selectedCapabilities.size > 0;
  const canSubmit =
    hasPrompt && hasCapability && submissionStatus !== 'submitting';

  const toggleCapability = (cap: string) => {
    setSelectedCapabilities((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) next.delete(cap);
      else next.add(cap);
      return next;
    });
  };

  const onSubmit = async () => {
    if (!canSubmit) return;
    await performTaskSubmit({
      prompt: trimmedPrompt,
      capabilities: selectedCapabilities,
      idempotencyKey,
      submitTask,
      navigation
    });
    // On error the store has already set submissionError; UI
    // re-renders and shows the error block.
  };

  return (
    <ScreenShell
      eyebrow="New task"
      subtitle="Send a prompt to a connected agent and watch the output stream live."
      title="Submit a task"
    >
      <SectionCard eyebrow="Prompt" title="What should the agent do?">
        <TextInput
          accessibilityLabel="task-prompt"
          multiline
          numberOfLines={6}
          onChangeText={setPrompt}
          placeholder="Describe the task in plain language…"
          placeholderTextColor={colors.inkMuted}
          style={styles.promptInput}
          value={prompt}
        />
        <Text style={styles.charCount}>
          {promptLength} / {PROMPT_MAX_CHARS}
        </Text>
      </SectionCard>

      <SectionCard
        eyebrow="Capabilities"
        title="What does the agent need to be able to do?"
      >
        <View style={styles.chipsRow}>
          {CAPABILITY_OPTIONS.map((cap) => {
            const selected = selectedCapabilities.has(cap);
            return (
              <Pressable
                accessibilityLabel={`capability-${cap}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                key={cap}
                onPress={() => toggleCapability(cap)}
                style={[styles.chip, selected ? styles.chipSelected : null]}
              >
                <Text
                  style={[
                    styles.chipLabel,
                    selected ? styles.chipLabelSelected : null
                  ]}
                >
                  {cap}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </SectionCard>

      {submissionError !== undefined ? (
        <View accessibilityLabel="submission-error" style={styles.errorBlock}>
          <Text style={styles.errorTitle}>
            Submission failed ({submissionError.code})
          </Text>
          <Text style={styles.errorBody}>{submissionError.message}</Text>
        </View>
      ) : null}

      <Pressable
        accessibilityLabel="submit-task"
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit }}
        disabled={!canSubmit}
        onPress={onSubmit}
        style={[
          styles.submitButton,
          !canSubmit ? styles.submitButtonDisabled : null
        ]}
      >
        <Text style={styles.submitLabel}>
          {submissionStatus === 'submitting' ? 'Submitting…' : 'Submit task'}
        </Text>
      </Pressable>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  charCount: {
    color: colors.inkMuted,
    fontSize: typography.caption,
    marginTop: spacing.xs,
    textAlign: 'right'
  },
  chip: {
    backgroundColor: colors.card,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs
  },
  chipLabel: {
    color: colors.inkMuted,
    fontSize: typography.caption
  },
  chipLabelSelected: {
    color: colors.ink,
    fontWeight: '600'
  },
  chipSelected: {
    backgroundColor: colors.cardStrong
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs
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
  errorTitle: {
    color: '#FF7B7B',
    fontSize: typography.caption,
    fontWeight: '700',
    marginBottom: spacing.xs,
    textTransform: 'uppercase'
  },
  promptInput: {
    backgroundColor: colors.card,
    borderRadius: 12,
    color: colors.ink,
    fontSize: typography.body,
    minHeight: 120,
    padding: spacing.md,
    textAlignVertical: 'top'
  },
  submitButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: 12,
    paddingVertical: spacing.md
  },
  submitButtonDisabled: {
    opacity: 0.4
  },
  submitLabel: {
    color: colors.cardStrong,
    fontSize: typography.body,
    fontWeight: '700'
  }
});
