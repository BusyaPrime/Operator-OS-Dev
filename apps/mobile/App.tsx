import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';

import { RootTabs } from './src/navigation/root-tabs';
import { navigationTheme } from './src/theme/navigation-theme';

export default function App() {
  return (
    <NavigationContainer theme={navigationTheme}>
      <StatusBar style="light" />
      <RootTabs />
    </NavigationContainer>
  );
}
