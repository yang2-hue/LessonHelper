import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const searchSource = await readFile(new URL('../public/js/pages/search.js', import.meta.url), 'utf8');
const plazaSource = await readFile(new URL('../public/js/pages/courses/plaza.js', import.meta.url), 'utf8');

test('search results use course-aware navigation for courses, materials, and posts', () => {
  assert.match(searchSource, /navigateToCourseResult\(\$\{c\.id\}\)/);
  assert.match(searchSource, /navigateToCourseResult\(\$\{m\.course_id\}\)/);
  assert.match(searchSource, /navigateToCourseResult\(\$\{p\.course_id\},\s*\$\{p\.id\}\)/);
  assert.match(searchSource, /navigateTo\('course-detail', Number\(courseId\)\)/);
});

test('plaza navigation resolves a course id to its aggregate course index', () => {
  assert.match(plazaSource, /export async function navigateToPlazaCourseById/);
  assert.match(plazaSource, /item\.courseIds\.includes\(Number\(courseId\)\)/);
  assert.match(plazaSource, /navigateTo\('plaza-course', Number\(courseId\)\)/);
});
