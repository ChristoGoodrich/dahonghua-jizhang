// Loads GBK_INDEX out of the TypeScript table for the Rust generator.
//
// The table file is one `export const` holding a string literal, so it is read
// and evaluated rather than imported — `require`ing a .ts from plain node would
// need a loader, and a loader is a lot of machinery for one string.

const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'domain', 'gbkTable.ts'),
  'utf8',
);

const start = src.indexOf('"');
const end = src.lastIndexOf('"');
if (start < 0 || end <= start) {
  throw new Error('gbkTable.ts does not hold one quoted string literal');
}
// JSON.parse rather than eval: the literal is JSON-shaped, and the escapes in
// it (\uXXXX) mean the same thing in both.
exports.GBK_INDEX = JSON.parse(src.slice(start, end + 1));
