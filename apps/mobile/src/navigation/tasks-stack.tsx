import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { TaskStreamScreen } from '../screens/task-stream-screen';
import { TaskSubmitScreen } from '../screens/task-submit-screen';

import type { TasksStackParamList } from './types';

/**
 * Inner stack for the Tasks tab. TaskSubmit is the entry point;
 * after a successful submit it pushes TaskStream with the task
 * id in route params (see TaskSubmitScreen.onSubmit). TaskStream
 * pops back to TaskSubmit via navigation.goBack().
 *
 * Header hidden — both screens use ScreenShell for their own
 * eyebrow + title chrome.
 */
const Stack = createNativeStackNavigator<TasksStackParamList>();

export function TasksStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen component={TaskSubmitScreen} name="TaskSubmit" />
      <Stack.Screen component={TaskStreamScreen} name="TaskStream" />
    </Stack.Navigator>
  );
}
