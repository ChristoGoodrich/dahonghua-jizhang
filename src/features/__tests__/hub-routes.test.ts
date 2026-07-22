import fs from 'fs';
import path from 'path';

// The 资产 / 我的 hubs are pure link lists — a typo in a path only shows up as a
// dead tap at runtime, so pin every route they point at to a real route file.
const SRC = path.join(__dirname, '..', '..');
const HUBS = [
  path.join(SRC, 'features', 'assets', 'AssetsView.tsx'),
  path.join(SRC, 'features', 'me', 'MeView.tsx'),
  path.join(SRC, 'features', 'LedgerScreen.tsx'),
];

function routesIn(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  const out = new Set<string>();
  for (const m of src.matchAll(/router\.push\(\s*[`'"]\/([a-z-]+)/g)) out.add(m[1]);
  return [...out];
}

describe('hub navigation targets', () => {
  it.each(HUBS)('%s links only to existing routes', (hub) => {
    const routes = routesIn(hub);
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      expect(fs.existsSync(path.join(SRC, 'app', `${r}.tsx`))).toBe(true);
    }
  });

  it('keeps the garden reachable now that it lost its tab', () => {
    expect(fs.existsSync(path.join(SRC, 'app', 'garden.tsx'))).toBe(true);
    expect(routesIn(HUBS[1])).toContain('garden');
  });
});
