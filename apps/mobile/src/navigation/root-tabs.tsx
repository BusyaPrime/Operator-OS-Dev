import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { CostsScreen } from '../screens/costs-screen';
import { DevicesScreen } from '../screens/devices-screen';
import { HomeScreen } from '../screens/home-screen';
import { SessionsScreen } from '../screens/sessions-screen';
import { SettingsScreen } from '../screens/settings-screen';
import { colors } from '../theme/tokens';

import { TasksStack } from './tasks-stack';

const Tab = createBottomTabNavigator();

export function RootTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.copperDeep,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.line,
          height: 64,
          paddingBottom: 8,
          paddingTop: 8
        }
      }}
    >
      <Tab.Screen component={HomeScreen} name="Home" />
      <Tab.Screen component={TasksStack} name="Tasks" />
      <Tab.Screen component={DevicesScreen} name="Devices" />
      <Tab.Screen component={SessionsScreen} name="Sessions" />
      <Tab.Screen component={CostsScreen} name="Costs" />
      <Tab.Screen component={SettingsScreen} name="Settings" />
    </Tab.Navigator>
  );
}
