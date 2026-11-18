import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'guide-data.js'), 'utf8'), context);
const guide = context.window.GUIDE_DATA;
assert.equal(guide.lessonCount, guide.lessons.length);
assert.equal(guide.lessons.filter(item => item.kind === 'overview').length, 14);
assert.equal(new Set(guide.lessons.map(item => item.id)).size, guide.lessonCount);
let imageReferences = 0;
for (const lesson of guide.lessons) {
  assert.ok(lesson.markdown.trim(), `Empty lesson: ${lesson.id}`);
  assert.ok(lesson.pdfPage >= 1 && lesson.pdfEndPage >= lesson.pdfPage && lesson.pdfEndPage <= guide.sourcePages);
  for (const match of lesson.markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    assert.ok(match[1].startsWith('guide-assets/'));
    assert.ok(fs.existsSync(path.join(root, match[1])), `Missing image: ${match[1]}`);
    assert.ok(guide.imageSizes[match[1]]?.every(size => size > 0));
    imageReferences++;
  }
  assert.ok(!lesson.markdown.includes('/Users/'));
  assert.ok(!lesson.markdown.includes('/private/'));
}
assert.ok(fs.existsSync(path.join(root, 'book.pdf')));
console.log(`Verified ${guide.lessonCount} sections, 14 chapters, and ${imageReferences} image references.`);
