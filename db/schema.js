const { seedEchoCave, seedCardTemplates } = require('./default-data');
const migrateBigCourses = require('./course-migration');

function initializeSchema(db) {
  // Create tables
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    avatar_url TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    owner_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id) REFERENCES courses(id),
    FOREIGN KEY (author_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id),
    FOREIGN KEY (author_id) REFERENCES users(id)
  )`);

  // --- Migration: add new columns (safe if already exist) ---
  const migrateTable = (table, col, type) => {
    const info = db.all(`PRAGMA table_info(${table})`);
    if (!info.some(c => c.name === col)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
      console.log(`  ✓ 迁移: ${table}.${col} (${type})`);
    }
  };

  migrateTable('users', 'password_hash', "TEXT DEFAULT ''");
  migrateTable('users', 'nickname', "TEXT DEFAULT ''");
  migrateTable('users', 'major', "TEXT DEFAULT ''");
  migrateTable('users', 'grade', "TEXT DEFAULT ''");
  migrateTable('users', 'email', "TEXT DEFAULT ''");
  migrateTable('users', 'email_verified', "INTEGER DEFAULT 0");
  migrateTable('users', 'verification_code', "TEXT DEFAULT ''");
  migrateTable('users', 'verification_code_expires', "TEXT DEFAULT ''");
  migrateTable('users', 'qq', "TEXT DEFAULT ''");
  migrateTable('users', 'privacy_show_profile', "INTEGER DEFAULT 1");
  migrateTable('users', 'privacy_allow_match', "INTEGER DEFAULT 1");
  migrateTable('users', 'wechat', "TEXT DEFAULT ''");
  migrateTable('users', 'douyin', "TEXT DEFAULT ''");
  migrateTable('users', 'avatar_desc', "TEXT DEFAULT ''");
  migrateTable('users', 'mbti', "TEXT DEFAULT ''");
  migrateTable('users', 'checkin_streak', "INTEGER DEFAULT 0");
  migrateTable('users', 'last_checkin_date', "TEXT DEFAULT ''");
  migrateTable('users', 'grace_days', "INTEGER DEFAULT 0");
  migrateTable('users', 'gender', "TEXT DEFAULT ''");
  migrateTable('users', 'privacy_show_following', "INTEGER DEFAULT 1");
  migrateTable('users', 'privacy_show_followers', "INTEGER DEFAULT 1");
  migrateTable('courses', 'semester', "TEXT DEFAULT ''");
  migrateTable('courses', 'teacher', "TEXT DEFAULT ''");
  migrateTable('courses', 'big_course_id', 'INTEGER');
  migrateTable('comments', 'parent_id', 'INTEGER');
  migrateTable('comments', 'image_url', "TEXT DEFAULT ''");
  migrateTable('comments', 'like_count', "INTEGER DEFAULT 0");
  // square_comments/square_posts migrations moved after table creation

  // New table: user_courses (many-to-many enrollment)
  db.run(`CREATE TABLE IF NOT EXISTS user_courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    course_id INTEGER NOT NULL,
    enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    UNIQUE(user_id, course_id)
  )`);

  migrateTable('user_courses', 'semester_key', "TEXT DEFAULT ''");

  // 批量回填小课的 semester 字段（从 user_courses.semester_key 提取）
  db.run(`
    UPDATE courses SET semester = (
      SELECT uc.semester_key FROM user_courses uc
      WHERE uc.course_id = courses.id AND uc.semester_key != ''
      ORDER BY uc.semester_key DESC LIMIT 1
    )
    WHERE big_course_id IS NOT NULL
      AND (semester = '' OR semester IS NULL)
      AND EXISTS (SELECT 1 FROM user_courses uc2 WHERE uc2.course_id = courses.id AND uc2.semester_key != '')
  `);

  // New table: materials (学习资料)
  db.run(`CREATE TABLE IF NOT EXISTS materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL,
    uploader_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size INTEGER DEFAULT 0,
    chapter TEXT DEFAULT '',
    category TEXT DEFAULT '其他',
    avg_rating REAL DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    download_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (uploader_id) REFERENCES users(id)
  )`);

  // New table: material_ratings (资料评分)
  db.run(`CREATE TABLE IF NOT EXISTS material_ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(material_id, user_id)
  )`);

  // New table: study_invites (自习邀约)
  db.run(`CREATE TABLE IF NOT EXISTS study_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL,
    course_id INTEGER,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    study_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    location TEXT DEFAULT '',
    max_participants INTEGER DEFAULT 4,
    status TEXT DEFAULT 'open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES users(id),
    FOREIGN KEY (course_id) REFERENCES courses(id)
  )`);
  migrateTable('study_invites', 'approval_required', "INTEGER DEFAULT 0");

  // New table: study_invite_responses (邀约响应)
  db.run(`CREATE TABLE IF NOT EXISTS study_invite_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    status TEXT DEFAULT 'accepted',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invite_id) REFERENCES study_invites(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(invite_id, user_id)
  )`);

  // New table: notifications (消息提醒)
  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    related_type TEXT,
    related_id INTEGER,
    related_comment_id INTEGER,
    course_id INTEGER,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // New table: square_posts (交友广场帖子)
  migrateTable('notifications', 'related_comment_id', 'INTEGER');

  db.run(`CREATE TABLE IF NOT EXISTS square_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT DEFAULT '',
    max_people INTEGER DEFAULT 1,
    current_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'open',
    expires_at TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES users(id)
  )`);

  // Migrations for square_posts (must be after table creation)
  migrateTable('square_posts', 'course_id', 'INTEGER');
  db.run('CREATE INDEX IF NOT EXISTS idx_square_posts_course_id ON square_posts(course_id)');

  // New table: square_interests (感兴趣记录)
  db.run(`CREATE TABLE IF NOT EXISTS square_interests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES square_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(post_id, user_id)
  )`);

  // New table: square_comments (广场评论)
  db.run(`CREATE TABLE IF NOT EXISTS square_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES square_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id)
  )`);

  // Migrations for square_comments (must be after table creation)
  migrateTable('square_comments', 'parent_id', 'INTEGER');
  migrateTable('square_comments', 'image_url', "TEXT DEFAULT ''");
  migrateTable('square_comments', 'like_count', "INTEGER DEFAULT 0");

  // New table: follows (关注关系)
  db.run(`CREATE TABLE IF NOT EXISTS follows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    follower_id INTEGER NOT NULL,
    following_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(follower_id, following_id)
  )`);

  // New table: feedback (问题反馈)
  db.run(`CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    contact TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // New table: echo_cave_quotes (回声洞语录)
  db.run(`CREATE TABLE IF NOT EXISTS echo_cave_quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    author_id INTEGER,
    source TEXT DEFAULT 'system',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
  )`);

  seedEchoCave(db);

  db.run(`CREATE TABLE IF NOT EXISTS favorite_courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    course_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    UNIQUE(user_id, course_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS favorite_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    post_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    UNIQUE(user_id, post_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS post_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
  )`);

  // New table: contact_exchange_requests (交换联系方式请求)
  db.run(`CREATE TABLE IF NOT EXISTS contact_exchange_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL,
    to_user_id INTEGER NOT NULL,
    message TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // New table: email_verifications (邮箱验证码临时表)
  db.run(`CREATE TABLE IF NOT EXISTS email_verifications (
    email TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    attempts INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL
  )`);

  // ========== 探索模块：组件化卡片系统 ==========

  // New table: explore_cards (卡片 — components 存 JSON，后端不解析)
  db.run(`CREATE TABLE IF NOT EXISTS explore_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    template_id TEXT,
    components TEXT NOT NULL DEFAULT '[]',
    max_participants INTEGER DEFAULT 0,
    current_count INTEGER DEFAULT 0,
    approval_required INTEGER DEFAULT 0,
    status TEXT DEFAULT 'open',
    course_id INTEGER,
    expires_at TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES users(id),
    FOREIGN KEY (course_id) REFERENCES courses(id)
  )`);

  // New table: explore_posts (帖子 — 卡片的容器)
  db.run(`CREATE TABLE IF NOT EXISTS explore_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    content TEXT DEFAULT '',
    status TEXT DEFAULT 'published',
    course_id INTEGER,
    expires_at TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES users(id),
    FOREIGN KEY (course_id) REFERENCES courses(id)
  )`);

  // New table: explore_post_cards (帖子-卡片关联)
  db.run(`CREATE TABLE IF NOT EXISTS explore_post_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    card_id INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (post_id) REFERENCES explore_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (card_id) REFERENCES explore_cards(id) ON DELETE CASCADE,
    UNIQUE(post_id, card_id)
  )`);

  // New table: card_participants (参与者/报名)
  db.run(`CREATE TABLE IF NOT EXISTS card_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    status TEXT DEFAULT 'accepted',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (card_id) REFERENCES explore_cards(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(card_id, user_id)
  )`);

  // New table: card_vote_records (投票去重)
  db.run(`CREATE TABLE IF NOT EXISTS card_vote_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL,
    module_index INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    option_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (card_id) REFERENCES explore_cards(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(card_id, module_index, user_id, option_id)
  )`);

  // New table: explore_comments (帖子评论)
  db.run(`CREATE TABLE IF NOT EXISTS explore_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    parent_id INTEGER,
    image_url TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES explore_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id)
  )`);
  migrateTable('explore_comments', 'like_count', "INTEGER DEFAULT 0");

  // New table: comment_likes (统一评论点赞记录，支持多表)
  // 迁移旧表（如有）
  try {
    const oldTable = db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='comment_likes'");
    if (oldTable.length > 0) {
      const info = db.all("PRAGMA table_info(comment_likes)");
      const hasTypeCol = info.some(r => r.name === 'comment_type');
      if (!hasTypeCol) {
        // 重命名旧表，创建新表，迁移数据
        db.run('ALTER TABLE comment_likes RENAME TO comment_likes_old');
        db.run(`CREATE TABLE comment_likes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          comment_type TEXT NOT NULL DEFAULT 'explore',
          comment_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(comment_type, comment_id, user_id)
        )`);
        // 迁移旧数据
        try {
          db.run(`INSERT OR IGNORE INTO comment_likes (id, comment_type, comment_id, user_id, created_at)
            SELECT id, 'explore', comment_id, user_id, created_at FROM comment_likes_old`);
        } catch (e) {
          console.log('  ⚠ 旧数据迁移跳过:', e.message);
        }
        db.run('DROP TABLE comment_likes_old');
        console.log('  ✓ 重构 comment_likes 表（多类型支持）');
      }
    } else {
      db.run(`CREATE TABLE IF NOT EXISTS comment_likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        comment_type TEXT NOT NULL DEFAULT 'explore',
        comment_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(comment_type, comment_id, user_id)
      )`);
    }
  } catch (e) {
    console.log('  ⚠ comment_likes 迁移:', e.message);
  }

  // 索引在评论表建好、旧点赞数据迁移完成后创建。
  try { db.run('CREATE INDEX IF NOT EXISTS idx_explore_comments_post ON explore_comments(post_id, parent_id)'); } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_comment_likes_type_cid ON comment_likes(comment_type, comment_id)'); } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_comment_likes_type_user ON comment_likes(comment_type, user_id, comment_id)'); } catch {}

  // New table: card_templates (卡片模板)
  db.run(`CREATE TABLE IF NOT EXISTS card_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    category TEXT DEFAULT 'general',
    components_schema TEXT NOT NULL,
    is_official INTEGER DEFAULT 1,
    creator_id INTEGER,
    usage_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES users(id)
  )`);

  // Migration: add styles column (UGC card customization)
  try {
    db.run(`ALTER TABLE card_templates ADD COLUMN styles TEXT DEFAULT '{}'`);
  } catch (e) {
    // column already exists — ignore
  }

  seedCardTemplates(db);
  console.log('  ✓ 探索模块表 + 模板数据初始化完成');

  migrateBigCourses(db);
}

module.exports = initializeSchema;
