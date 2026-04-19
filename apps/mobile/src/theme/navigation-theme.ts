import { DefaultTheme, type Theme } from '@react-navigation/native';

import { colors } from './tokens';

export const navigationTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.copper,
    background: colors.canvas,
    card: colors.card,
    text: colors.ink,
    border: colors.line,
    notification: colors.danger
  }
};
