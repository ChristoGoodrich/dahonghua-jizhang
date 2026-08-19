// The Glass primitive, with the tier fallback under the microscope.
//
// The fallback is the part most likely to rot: it only shows on web and on
// devices that cannot blur, neither of which anyone looks at while designing.
// HyperOS gates the material on flagship silicon, so "what this looks like
// without blur" is a state real users get, not a theoretical one.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Animated, View } from 'react-native';
import { Glass } from '@/components/ui/Glass';
import { makeTheme } from '@/theme/tokens';
import { glassSpec } from '@/theme/glass';

const theme = makeTheme('default', false);

jest.mock('@/theme/ThemeContext', () => ({
  useTheme: () => jest.requireActual('@/theme/tokens').makeTheme('default', false),
}));

jest.mock('expo-blur', () => {
  const { View: V } = jest.requireActual('react-native');
  const Mock = (props: Record<string, unknown>) => <V {...props} testID="blur-view" />;
  return { BlurView: Mock };
});

function render(node: React.ReactElement) {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => { r = TestRenderer.create(node); });
  return r;
}

// the mock renders a composite *and* its host View, so filter to the composite
// or every count comes back doubled
const blurs = (r: TestRenderer.ReactTestRenderer) =>
  r.root.findAll((n) => n.props?.testID === 'blur-view' && typeof n.type === 'function');

/** Flatten a style prop (array, nested, Animated) into plain objects. */
function styleObjects(style: unknown): Record<string, unknown>[] {
  return [style].flat(6).filter((s): s is Record<string, unknown> => !!s && typeof s === 'object');
}

/** Every backgroundColor painted anywhere in the tree. */
function fills(r: TestRenderer.ReactTestRenderer): string[] {
  const out: string[] = [];
  r.root.findAll(() => true, { deep: true }).forEach((n) => {
    for (const s of styleObjects(n.props?.style)) {
      if (typeof s.backgroundColor === 'string') out.push(s.backgroundColor);
    }
  });
  return out;
}

describe('tiers', () => {
  it('uses a real blur at the full tier', () => {
    const r = render(<Glass tier="full" />);
    expect(blurs(r)).toHaveLength(1);
    expect(blurs(r)[0].props.intensity).toBe(glassSpec(theme, 'chrome').intensity);
  });

  it('drops the blur, and thickens the wash to compensate, at the wash tier', () => {
    const full = render(<Glass tier="full" density={0} />);
    const wash = render(<Glass tier="wash" density={0} />);
    expect(blurs(wash)).toHaveLength(0);

    const alpha = (r: TestRenderer.ReactTestRenderer) =>
      Number(fills(r).find((c) => c.startsWith('rgba'))!.match(/([\d.]+)\)$/)![1]);
    expect(alpha(wash)).toBeGreaterThan(alpha(full));
  });

  it('renders an opaque surface at the solid tier', () => {
    const r = render(<Glass tier="solid" density={1} />);
    expect(blurs(r)).toHaveLength(0);
    const rgbaFill = fills(r).find((c) => c.startsWith('rgba'))!;
    expect(Number(rgbaFill.match(/([\d.]+)\)$/)![1])).toBe(1);
  });
});

describe('the material', () => {
  it('paints an edge whose width comes from the level, not the caller', () => {
    const chrome = render(<Glass level="chrome" tier="wash" />);
    const card = render(<Glass level="card" tier="wash" />);
    const width = (r: TestRenderer.ReactTestRenderer) =>
      r.root
        .findAll(() => true, { deep: true })
        .flatMap((n) => styleObjects(n.props?.style))
        .map((s) => s.borderWidth)
        .find((w): w is number => typeof w === 'number')!;
    expect(width(chrome)).toBeGreaterThan(width(card));
  });

  it('can have its edge and sheen turned off', () => {
    const r = render(<Glass tier="wash" edge={false} sheen={false} />);
    const anyBorder = r.root
      .findAll(() => true, { deep: true })
      .flatMap((n) => styleObjects(n.props?.style))
      .some((s) => typeof s.borderWidth === 'number');
    expect(anyBorder).toBe(false);
  });

  it('blends toward the backdrop it is told about', () => {
    const overPaper = fills(render(<Glass tier="wash" under={theme.paper} />));
    const overAccent = fills(render(<Glass tier="wash" under={theme.hibiscus} />));
    expect(overPaper.find((c) => c.startsWith('rgba')))
      .not.toBe(overAccent.find((c) => c.startsWith('rgba')));
  });

  it('honours a surface colour override', () => {
    const card = fills(render(<Glass tier="wash" />)).find((c) => c.startsWith('rgba'))!;
    const ink = fills(render(<Glass tier="wash" surface={theme.ink} />)).find((c) => c.startsWith('rgba'))!;
    const channel = (s: string) => Number(s.match(/rgba\((\d+)/)![1]);
    expect(channel(ink)).toBeLessThan(channel(card));
  });

  it('renders its children', () => {
    const r = render(<Glass tier="wash"><View testID="inside" /></Glass>);
    expect(r.root.findAll((n) => n.props?.testID === 'inside').length).toBeGreaterThan(0);
  });

  it('paints a touch bloom only when one is driven', () => {
    const idle = render(<Glass tier="wash" />);
    const pressed = render(<Glass tier="wash" touch={new Animated.Value(1)} />);
    expect(fills(pressed).length).toBeGreaterThan(fills(idle).length);
  });
});
