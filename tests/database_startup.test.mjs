import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import openDatabase from '../db/database.js';
import initializeSchema from '../db/schema.js';

test('an empty database starts with the migrated comment schema and indexes', async t => {
  t.mock.method(console, 'log', () => {});
  const directory = await mkdtemp(path.join(tmpdir(), 'lessonhelper-test-'));
  const filename = path.join(directory, 'eduspace.db');
  try {
    const db = await openDatabase(filename);
    initializeSchema(db);
    db.save();

    const reopened = await openDatabase(filename);
    const columns = reopened.all('PRAGMA table_info(explore_comments)');
    assert.ok(columns.some(column => column.name === 'like_count'));
    const indexes = reopened.all('PRAGMA index_list(comment_likes)').map(index => index.name);
    assert.ok(indexes.includes('idx_comment_likes_type_cid'));
    assert.ok(indexes.includes('idx_comment_likes_type_user'));
    assert.equal(reopened.get('SELECT COUNT(*) AS count FROM card_templates').count, 7);
  } finally {
    await rm(filename, { force: true });
    await rmdir(directory);
  }
});
