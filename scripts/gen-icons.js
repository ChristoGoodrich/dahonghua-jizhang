// Generates the app icon / splash / favicon PNGs from the 大红花 flower SVG.
// Run with: node scripts/gen-icons.js   (requires `npm i --no-save sharp`)
const sharp = require('sharp');
const path = require('path');

const PAPER = '#FBF7F0';
const HIBISCUS = '#D94E5C';
const STAMEN = '#E8A838';
const OUT = path.join(__dirname, '..', 'assets', 'images');

// 5 rotated petals + a stamen dot, in a 0..100 viewBox (matches the in-app flower)
function flower(petal, stamen) {
  return `
    <g fill="${petal}">
      <ellipse cx="50" cy="26" rx="18" ry="20"/>
      <ellipse cx="73" cy="42" rx="18" ry="20" transform="rotate(72 73 42)"/>
      <ellipse cx="64" cy="70" rx="18" ry="20" transform="rotate(144 64 70)"/>
      <ellipse cx="36" cy="70" rx="18" ry="20" transform="rotate(216 36 70)"/>
      <ellipse cx="27" cy="42" rx="18" ry="20" transform="rotate(288 27 42)"/>
    </g>
    <circle cx="50" cy="50" r="13" fill="${stamen}"/>`;
}

// canvas of `size`, flower scaled to `flowerSize` and centered; optional bg fill
function canvas(size, flowerSize, { bg, petal = HIBISCUS, stamen = STAMEN } = {}) {
  const s = flowerSize / 100;
  const offset = (size - flowerSize) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : ''}
    <g transform="translate(${offset},${offset}) scale(${s})">${flower(petal, stamen)}</g>
  </svg>`;
}

const targets = [
  { file: 'icon.png', svg: canvas(1024, 600, { bg: PAPER }) }, // iOS + base
  { file: 'android-icon-foreground.png', svg: canvas(1024, 520, {}) }, // adaptive fg (transparent, safe zone)
  { file: 'android-icon-monochrome.png', svg: canvas(1024, 520, { petal: '#000000', stamen: '#000000' }) },
  { file: 'splash-icon.png', svg: canvas(1024, 760, {}) }, // transparent flower on splash bg
  { file: 'favicon.png', svg: canvas(196, 140, { bg: PAPER }) },
];

(async () => {
  for (const { file, svg } of targets) {
    await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, file));
    console.log('wrote', file);
  }
})();
