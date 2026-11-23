import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const indexSource = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../public/js/main.js', import.meta.url), 'utf8');
const routerSource = await readFile(new URL('../public/js/core/router.js', import.meta.url), 'utf8');
const homeSource = await readFile(new URL('../public/js/pages/home.js', import.meta.url), 'utf8').catch(() => '');
const styleSource = await readFile(new URL('../public/css/style.css', import.meta.url), 'utf8');

test('home page is the default app entry and sidebar destination', () => {
  assert.match(indexSource, /data-page="home"/);
  assert.match(mainSource, /import '\.\/pages\/home\.js'/);
  assert.match(mainSource, /initRouter\(\(\) => navigateTo\('home'\)\)/);
  assert.match(routerSource, /page: 'home'/);
  assert.match(homeSource, /registerPage\('home'/);
});

test('home page renders the campus hero, personal stats, and navigation cards', () => {
  assert.match(homeSource, /选一门课/);
  assert.match(homeSource, /home-hero-campus\.png/);
  assert.match(homeSource, /今日课程/);
  assert.match(homeSource, /连续签到/);
  assert.match(homeSource, /新消息/);
  assert.match(homeSource, /page:\s*'allcourse',\s*name:\s*'课程广场'/);
  assert.match(homeSource, /page:\s*'treasurebox',\s*name:\s*'百宝箱'/);
  assert.match(homeSource, /page:\s*'favorites',\s*name:\s*'我的收藏'/);
  assert.match(styleSource, /\.home-hero/);
  assert.match(styleSource, /\.home-stats/);
  assert.match(styleSource, /\.home-nav-grid/);
});
