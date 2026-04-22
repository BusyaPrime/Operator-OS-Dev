import { z } from 'zod';

export const nodeEnvSchema = z
  .enum(['development', 'test', 'production'])
  .default('development');

export const booleanFromString = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return defaultValue;
      }

      return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    });

export const integerFromString = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value === undefined ? defaultValue : Number.parseInt(value, 10)
    )
    .pipe(z.number().int().positive());

export const optionalUrlFromString = () =>
  z.preprocess((value) => {
    if (typeof value !== 'string') {
      return value;
    }

    const normalized = value.trim();
    return normalized.length === 0 ? undefined : normalized;
  }, z.string().url().optional());

/**
 * Parse a comma-separated env-var value into a deduplicated,
 * trimmed, non-empty string array. Empty input → default.
 *
 * Example:
 *   "a, b,,c ,b" → ["a", "b", "c"]
 */
export const stringArrayFromCsv = (defaultValue: readonly string[]) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim().length === 0) {
        return [...defaultValue];
      }
      const seen = new Set<string>();
      const out: string[] = [];
      for (const piece of value.split(',')) {
        const normalized = piece.trim();
        if (normalized.length === 0 || seen.has(normalized)) continue;
        seen.add(normalized);
        out.push(normalized);
      }
      return out;
    })
    .pipe(z.array(z.string().min(1)).min(1));
