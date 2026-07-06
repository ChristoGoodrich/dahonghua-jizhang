import { Platform } from 'react-native';

export function WebOnly({ children }: { children: React.ReactNode }) {
  if (Platform.OS !== 'web') return null;
  return <>{children}</>;
}
