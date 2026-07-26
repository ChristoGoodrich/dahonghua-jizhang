// Cross-platform "save/share a file": a browser download on web, the native
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

export async function shareBinaryFile(filename: string, data: ArrayBuffer, mimeType: string): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  // expo-file-system (SDK 54+ File/Paths API) + expo-sharing
  const FS: any = await import('expo-file-system');
  const Sharing: any = await import('expo-sharing');
  const file = new FS.File(FS.Paths.cache, filename);
  try { file.create({ overwrite: true }); } catch {}
  // Write binary data as base64-encoded string
  const bytes = new Uint8Array(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = globalThis.btoa(binary);
  file.write(base64, { encoding: 'base64' });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType });
  }
}
