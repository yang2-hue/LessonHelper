import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/js/pages/search.js', import.meta.url), 'utf8');

test('search page exposes a square posts tab', () => {
  assert.match(source, /key: 'squarePosts',\s*icon: 'forum',\s*label: '广场'/);
  assert.match(source, /data-tab="\$\{t\.key\}"/);
});

test('search results render square posts and link to the existing detail page', () => {
  assert.match(source, /const \{ courses = \[\], materials = \[\], posts = \[\], squarePosts = \[\] \} = data;/);
  assert.match(source, /if \(squarePosts\.length > 0\)/);
  assert.match(source, /navigateTo\('square-post', \$\{p\.id\}\)/);
  assert.match(source, /remainingDays/);
});
