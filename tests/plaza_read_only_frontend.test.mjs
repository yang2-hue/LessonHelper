import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const detailSource = await readFile(new URL('../public/js/pages/courses/detail.js', import.meta.url), 'utf8');

test('course detail enforces read-only mode for non-enrolled users', () => {
  assert.match(detailSource, /const enrolled = await checkEnrollment\(courseId\)/);
  assert.match(detailSource, /只读模式/);
  assert.match(detailSource, /const squareTab = enrolled\s*\?/);
  assert.match(detailSource, /if \(enrolled\) await renderCourseSquareTab/);
});

test('course detail only renders the composer and material upload for enrolled users', () => {
  assert.match(detailSource, /const composeBar = enrolled\s*\?/);
  assert.match(detailSource, /const uploadBtn = enrolled\s*\?/);
});
