// The soft-glass material's three behaviours are pure functions, which is the
// point of keeping them out of the component: "does the wash pick up the room"
// and "does it thicken over busy content" are claims that can be asserted
// rather than eyeballed in a screenshot.

import { makeTheme } from '../tokens';
import {
  ambientPull,
  glassSpec,
  luminance,
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

  it('takes a surface colour, so dark chrome stays dark', () => {
    // the toast pill passes t.ink; a light wash there would drop white text
    // onto a light panel
    const onCard = rgba(washColor(light, 'chrome', light.paper));
    const onInk = rgba(washColor(light, 'chrome', light.paper, undefined, light.ink));
    expect(onInk.r).toBeLessThan(onCard.r);
    expect(onInk.g).toBeLessThan(onCard.g);
    expect(onInk.b).toBeLessThan(onCard.b);
    // still lifted off pure ink by the ambient pull toward the paper
    expect(onInk.r).toBeGreaterThan(rgba(`rgba(0, 0, 0, 1)`).r);
  });

  it('follows the flower theme, not a fixed grey', () => {
    const ocean = makeTheme('ocean', false);
    const sunset = makeTheme('sunset', false);
    const a = rgba(washColor(ocean, 'chrome', ocean.paper));
    const b = rgba(washColor(sunset, 'chrome', sunset.paper));
    expect(a).not.toEqual(b);
  });
});

describe('contrast — the reason the pull is damped', () => {
  /** Composite a wash over a backdrop and return the WCAG ratio against text. */
  function contrastOverPaper(wash: string, textHex: string, t: ReturnType<typeof makeTheme>) {
    const { r, g, b, a } = rgba(wash);
    const [pr, pg, pb] = mix(t.paper, t.paper, 0); // the paper itself
    const over = (f: number, back: number) => f * a + back * (1 - a);
    const composited =
      '#' +
      [over(r, pr), over(g, pg), over(b, pb)]
        .map((c) => Math.round(c).toString(16).padStart(2, '0'))
        .join('');
    const l1 = luminance(composited);
    const l2 = luminance(textHex);
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
  }

  it('keeps the dark toast pill readable — its text is near-white', () => {
    // An undamped 28% pull toward near-white paper took this from 14:1 to
    // 4.9:1. WCAG AA for normal text is 4.5:1; a toast that can appear over
    // anything should not be sitting on the line.
    const wash = washColor(light, 'chrome', light.paper, readabilityAlpha(light, 'chrome', 0.7, 'wash'), light.ink);
    expect(contrastOverPaper(wash, light.paper, light)).toBeGreaterThan(7);
  });

  it('damps the pull only when the surface and the room are far apart', () => {
    const near = ambientPull(light.card, light.paper); // white over paper
    const far = ambientPull(light.ink, light.paper); // ink over paper
    expect(near).toBeGreaterThan(0.26); // effectively the full pull
    expect(far).toBeLessThan(0.12);
    expect(far).toBeGreaterThan(0); // still picks the room up a little
  });

  it('leaves the light surfaces exactly where they were', () => {
    // the nav bar and sheets were verified in the browser at these values;
    // damping must not have moved them
    expect(rgba(washColor(light, 'chrome', light.paper, 0.91))).toEqual({ r: 254, g: 253, b: 251, a: 0.91 });
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
