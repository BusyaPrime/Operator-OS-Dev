/**
 * Centralised React Navigation param-list types. Lives outside
 * the navigator file so screens can import their typed-prop
 * shape without creating a navigator ↔ screen import cycle.
 */

export interface TasksStackParamList
  extends Record<string, object | undefined> {
  TaskSubmit: undefined;
  TaskStream: { taskId: string };
}
