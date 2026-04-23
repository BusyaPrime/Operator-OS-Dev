import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AuthLoadingScreen } from '../screens/auth/auth-loading-screen';
import { SignInScreen } from '../screens/auth/sign-in-screen';
import { useAuthStore } from '../state/auth-store';

import { RootTabs } from './root-tabs';

/**
 * Top-level navigator that flips between the Auth stack (used
 * before the user has a valid session) and the existing 5-tab
 * main shell (RootTabs). Driven by the auth-store's `status`:
 *
 *   unknown        → AuthLoading  (session restore in flight)
 *   authenticating → AuthLoading  (sign-in / refresh in flight)
 *   error          → SignIn       (show the banner; user retries)
 *   unauthenticated → SignIn
 *   authenticated  → RootTabs     (main app)
 *
 * React Navigation v7 re-mounts the active stack when the set
 * of registered screens changes — exactly what we want: on
 * sign-in, the auth stack unmounts and the main stack mounts
 * fresh. No manual navigation.reset() calls.
 *
 * Header is hidden everywhere — RootTabs already owns its own
 * chrome, and the auth screens render their full-bleed layout.
 */
const Stack = createNativeStackNavigator();

export function RootNavigator() {
  const status = useAuthStore((s) => s.status);

  const showLoading = status === 'unknown' || status === 'authenticating';
  const showMain = status === 'authenticated';

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {showLoading ? (
        <Stack.Screen
          component={AuthLoadingScreen}
          name="AuthLoading"
          options={{ animation: 'fade' }}
        />
      ) : showMain ? (
        <Stack.Screen component={RootTabs} name="Main" />
      ) : (
        <Stack.Screen
          component={SignInScreen}
          name="SignIn"
          options={{ animation: 'fade' }}
        />
      )}
    </Stack.Navigator>
  );
}
