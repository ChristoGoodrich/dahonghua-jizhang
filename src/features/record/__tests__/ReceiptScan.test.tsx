// ReceiptScan coverage.
//
// Everything here is guard rails around a native picker: the camera needs a
// permission that can be refused, either source can be cancelled, and the whole
// row must go inert while a scan is already running. None of it was exercised
// before — the component reached expo-image-picker through `await import`, which
// throws under Jest, so every path collapsed into the catch clause.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ReceiptScan, ReceiptPreview } from '../ReceiptScan';
import { I18N } from '@/i18n';

const mockPicker = {
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
};

jest.mock('expo-image-picker', () => mockPicker);

jest.mock('@/theme/ThemeContext', () => ({
  useTheme: () => ({
    ink: '#2B2622', inkSoft: '#8A8178', line: '#EADFCF',
    card: '#FFFDF8', hibiscus: '#C4515E', isDark: false,
  }),
}));

jest.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

const s = I18N.zh;
const GRANTED = { granted: true };
const SHOT = { canceled: false, assets: [{ uri: 'file:///shot.jpg' }] };

/** Controls are located by their accessibility label rather than by component
 *  type — Pressable is wrapped in RN 0.85 so findAllByType misses it, and this
 *  way the labels themselves stay under test. */
function byLabel(r: TestRenderer.ReactTestRenderer, label: string) {
  return r.root.findAll((n) => n.props?.accessibilityLabel === label)[0];
}

function countByLabel(r: TestRenderer.ReactTestRenderer, label: string) {
  return r.root.findAll((n) => n.props?.accessibilityLabel === label).length;
}

function render(over: Partial<React.ComponentProps<typeof ReceiptScan>> = {}) {
  const onCapture = jest.fn();
  const props = { lang: 'zh' as const, onCapture, busy: false, ...over };
  let r!: TestRenderer.ReactTestRenderer;
  act(() => { r = TestRenderer.create(<ReceiptScan {...props} />); });
  return { r, onCapture, camera: byLabel(r, s.cameraTake), gallery: byLabel(r, s.cameraGallery) };
}

const text = (r: TestRenderer.ReactTestRenderer) => JSON.stringify(r.toJSON());

beforeEach(() => {
  mockPicker.requestCameraPermissionsAsync.mockReset().mockResolvedValue(GRANTED);
  mockPicker.launchCameraAsync.mockReset().mockResolvedValue(SHOT);
  mockPicker.launchImageLibraryAsync.mockReset().mockResolvedValue(SHOT);
});

describe('camera', () => {
  it('asks for permission, then hands the photo up', async () => {
    const { camera, onCapture } = render();
    await act(async () => { await camera.props.onPress(); });
    expect(mockPicker.requestCameraPermissionsAsync).toHaveBeenCalled();
    expect(onCapture).toHaveBeenCalledWith('file:///shot.jpg');
  });

  it('stops at a refused permission and says so, without opening the camera', async () => {
    mockPicker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false });
    const { r, camera, onCapture } = render();
    await act(async () => { await camera.props.onPress(); });
    expect(mockPicker.launchCameraAsync).not.toHaveBeenCalled();
    expect(onCapture).not.toHaveBeenCalled();
    expect(text(r)).toContain(s.cameraPermission);
  });

  it('stays quiet when the user backs out of the camera', async () => {
    mockPicker.launchCameraAsync.mockResolvedValue({ canceled: true });
    const { r, camera, onCapture } = render();
    await act(async () => { await camera.props.onPress(); });
    expect(onCapture).not.toHaveBeenCalled();
    expect(text(r)).not.toContain(s.cameraPermissionDesc);
  });

  it('reports a picker crash as a permission problem', async () => {
    mockPicker.launchCameraAsync.mockRejectedValue(new Error('no camera'));
    const { r, camera, onCapture } = render();
    await act(async () => { await camera.props.onPress(); });
    expect(onCapture).not.toHaveBeenCalled();
    expect(text(r)).toContain(s.cameraPermissionDesc);
  });
});

describe('gallery', () => {
  it('needs no permission prompt', async () => {
    const { gallery, onCapture } = render();
    await act(async () => { await gallery.props.onPress(); });
    expect(mockPicker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
    expect(onCapture).toHaveBeenCalledWith('file:///shot.jpg');
  });

  it('stays quiet on cancel', async () => {
    mockPicker.launchImageLibraryAsync.mockResolvedValue({ canceled: true });
    const { gallery, onCapture } = render();
    await act(async () => { await gallery.props.onPress(); });
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('ignores a result that carries no asset', async () => {
    mockPicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [] });
    const { gallery, onCapture } = render();
    await act(async () => { await gallery.props.onPress(); });
    expect(onCapture).not.toHaveBeenCalled();
  });
});

describe('busy', () => {
  it('disables both buttons and refuses to launch anything', async () => {
    const { camera, gallery, onCapture } = render({ busy: true });
    expect(camera.props.disabled).toBe(true);
    expect(gallery.props.disabled).toBe(true);

    await act(async () => { await camera.props.onPress(); });
    await act(async () => { await gallery.props.onPress(); });
    expect(mockPicker.launchCameraAsync).not.toHaveBeenCalled();
    expect(mockPicker.launchImageLibraryAsync).not.toHaveBeenCalled();
    expect(onCapture).not.toHaveBeenCalled();
  });
});

describe('error clearing', () => {
  it('drops a stale error on the next attempt', async () => {
    mockPicker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false });
    const { r, camera } = render();
    await act(async () => { await camera.props.onPress(); });
    expect(text(r)).toContain(s.cameraPermission);

    mockPicker.requestCameraPermissionsAsync.mockResolvedValue(GRANTED);
    await act(async () => { await camera.props.onPress(); });
    expect(text(r)).not.toContain(s.cameraPermission);
  });
});

describe('ReceiptPreview', () => {
  it('shows the image and a remove button', () => {
    const onRemove = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<ReceiptPreview uri="file:///x.jpg" busy={false} onRemove={onRemove} />);
    });
    expect(text(r)).toContain('file:///x.jpg');

    const btn = byLabel(r, I18N.zh.a11yRemoveImage);
    act(() => { btn.props.onPress(); });
    expect(onRemove).toHaveBeenCalled();
  });

  it('hides the remove button while a scan is running', () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<ReceiptPreview uri="file:///x.jpg" busy onRemove={jest.fn()} />);
    });
    expect(countByLabel(r, I18N.zh.a11yRemoveImage)).toBe(0);
  });

  it('labels the remove button in the caller language', () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <ReceiptPreview uri="file:///x.jpg" busy={false} onRemove={jest.fn()} lang="en" />,
      );
    });
    expect(countByLabel(r, I18N.en.a11yRemoveImage)).toBeGreaterThan(0);
  });
});
