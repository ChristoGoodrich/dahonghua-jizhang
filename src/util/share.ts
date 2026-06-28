// Cross-platform "save/share a text file": a browser download on web, the native
// share sheet (via a temp file) on iOS/Android.
import { Platform } from 'react-native';

export async function shareTextFile(filename: string, content: string, mimeType: string): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  // expo-file-system (SDK 54+ File/Paths API) + expo-sharing, loaded lazily so web never pulls them in
  const FS: any = await import('expo-file-system');
  const Sharing: any = await import('expo-sharing');
  const file = new FS.File(FS.Paths.cache, filename);
  try { file.create({ overwrite: true }); } catch {}
  file.write(content);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType });
  }
}
