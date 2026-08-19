// The soft-glass material's three behaviours are pure functions, which is the
// point of keeping them out of the component: "does the wash pick up the room"
// and "does it thicken over busy content" are claims that can be asserted
// rather than eyeballed in a screenshot.

import { makeTheme } from '../tokens';
import {
  glassSpec,
  mix,
  readabilityAlpha,
  resolveTier,
  touchLightColor,
  washColor,
} from '../glass';

const light = makeTheme('default', false);
const dark = makeTheme('default', true);

/** `rgba(r, g, b, a)` → its parts. */
function rgba(s: string) {
  const m = s.match(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/);
  if (!m) throw new Error(`not an rgba string: ${s}`);
  return { r: +m[1], g: +m[2], b: +m[3], a: +m[4] };
}

describe('mix', () => {
  it('returns the first colour at 0 and the second at 1', () => {
    expect(mix('#000000', '#FFFFFF', 0)).toEqual([0, 0, 0]);
    expect(mix('#000000', '#FFFFFF', 1)).toEqual([255, 255, 255]);
  });

  it('interpolates in between', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toEqual([128, 128, 128]);
  });

  it('clamps out-of-range amounts rather than overshooting', () => {
    expect(mix('#000000', '#FFFFFF', -1)).toEqual([0, 0, 0]);
    expect(mix('#000000', '#FFFFFF', 2)).toEqual([255, 255, 255]);
  });

  it('expands three-digit hex', () => {
    expect(mix('#F00', '#F00', 0)).toEqual([255, 0, 0]);
  });

  it('survives a malformed colour instead of emitting NaN into a style', () => {
    expect(mix('nonsense', '#FFFFFF', 0)).toEqual([0, 0, 0]);
  });
});

describe('感知环境颜色 — washColor', () => {
  it('pulls the wash toward whatever the surface sits over', () => {
    const overPaper = rgba(washColor(light, 'chrome', light.paper));
    const overAccent = rgba(washColor(light, 'chrome', light.hibiscus));

    // The surface colour is white, so "picks up the accent" cannot mean a
    // higher red channel — red is already at the ceiling. It means a colour
    // cast: green and blue fall away from red.
    expect(overAccent.g).toBeLessThan(overPaper.g);
    expect(overAccent.b).toBeLessThan(overPaper.b);
    expect(overAccent.r - overAccent.g).toBeGreaterThan(overPaper.r - overPaper.g);
    expect(overAccent.r - overAccent.b).toBeGreaterThan(overPaper.r - overPaper.b);
  });

  it('leans cool over a cool backdrop and warm over a warm one', () => {
    const cool = rgba(washColor(light, 'chrome', '#3A6EA5'));
    const warm = rgba(washColor(light, 'chrome', '#D98A40'));
    expect(cool.b).toBeGreaterThan(cool.r);
    expect(warm.r).toBeGreaterThan(warm.b);
  });

  it('stays closer to the surface colour than to the room', () => {
    // past roughly a third it stops reading as its own object
    const card = rgba(washColor(light, 'chrome', '#000000'));
    expect(card.r).toBeGreaterThan(128);
  });

  it('defaults to the page paper when no backdrop is named', () => {
    expect(washColor(light, 'chrome')).toBe(washColor(light, 'chrome', light.paper));
  });

  it('carries the level wash alpha unless one is passed', () => {
    expect(rgba(washColor(light, 'chrome')).a).toBe(glassSpec(light, 'chrome').washAlpha);
    expect(rgba(washColor(light, 'chrome', undefined, 0.5)).a).toBe(0.5);
  });

  it('follows the flower theme, not a fixed grey', () => {
    const ocean = makeTheme('ocean', false);
    const sunset = makeTheme('sunset', false);
    const a = rgba(washColor(ocean, 'chrome', ocean.paper));
    const b = rgba(washColor(sunset, 'chrome', sunset.paper));
    expect(a).not.toEqual(b);
  });
});

describe('自动调整通透度 — readabilityAlpha', () => {
  it('rises with how busy the content behind is', () => {
    const empty = readabilityAlpha(light, 'chrome', 0, 'full');
    const mid = readabilityAlpha(light, 'chrome', 0.5, 'full');
    const busy = readabilityAlpha(light, 'chrome', 1, 'full');
    expect(mid).toBeGreaterThan(empty);
    expect(busy).toBeGreaterThan(mid);
  });

  it('never drops below the level resting value', () => {
    expect(readabilityAlpha(light, 'chrome', 0, 'full')).toBe(glassSpec(light, 'chrome').washAlpha);
  });

  it('never exceeds fully opaque', () => {
    for (const level of ['chrome', 'sheet', 'card'] as const) {
      expect(readabilityAlpha(light, level, 1, 'wash')).toBeLessThanOrEqual(1);
      expect(readabilityAlpha(dark, level, 1, 'wash')).toBeLessThanOrEqual(1);
    }
  });

  it('starts thicker when the tier cannot blur', () => {
    expect(readabilityAlpha(light, 'chrome', 0, 'wash'))
      .toBeGreaterThan(readabilityAlpha(light, 'chrome', 0, 'full'));
  });

  it('clamps a density outside 0–1', () => {
    expect(readabilityAlpha(light, 'chrome', -5, 'full')).toBe(readabilityAlpha(light, 'chrome', 0, 'full'));
    expect(readabilityAlpha(light, 'chrome', 5, 'full')).toBe(readabilityAlpha(light, 'chrome', 1, 'full'));
  });
});

describe('material levels', () => {
  it('gets less transparent and less blurred as it settles into the page', () => {
    const chrome = glassSpec(light, 'chrome');
    const sheet = glassSpec(light, 'sheet');
    const card = glassSpec(light, 'card');
    expect(chrome.intensity).toBeGreaterThan(sheet.intensity);
    expect(sheet.intensity).toBeGreaterThan(card.intensity);
    expect(chrome.washAlpha).toBeLessThan(sheet.washAlpha);
    expect(sheet.washAlpha).toBeLessThan(card.washAlpha);
  });

  it('dims the specular highlight in dark mode', () => {
    for (const level of ['chrome', 'sheet', 'card'] as const) {
      expect(glassSpec(dark, level).sheen).toBeLessThan(glassSpec(light, level).sheen);
    }
  });

  it('gives the highlight a band to fall through, not a hairline', () => {
    expect(glassSpec(light, 'chrome').sheenHeight).toBeGreaterThan(8);
  });
});

describe('graceful degradation — resolveTier', () => {
  it('drops to a solid surface when transparency is turned down', () => {
    expect(resolveTier({ reduceTransparency: true })).toBe('solid');
  });

  it('picks a real tier by default', () => {
    expect(['full', 'wash']).toContain(resolveTier());
  });
});

describe('感知交互行为 — touchLightColor', () => {
  it('is warm in light mode and plain in dark', () => {
    expect(touchLightColor(light)).toContain('255,252,247');
    expect(touchLightColor(dark)).toContain('255,255,255');
  });

  it('is subtler in dark mode, where a bright bloom would blow out', () => {
    const a = Number(touchLightColor(light).match(/([\d.]+)\)$/)![1]);
    const b = Number(touchLightColor(dark).match(/([\d.]+)\)$/)![1]);
    expect(b).toBeLessThan(a);
  });
});
