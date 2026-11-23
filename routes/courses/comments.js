const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 评论图片上传配置（单图，JPG/PNG/WebP，≤ 5MB）
const COMMENT_IMAGE_DIR = path.join(__dirname, '..', '..', 'uploads', 'comment-images');
const COMMENT_IMAGE_MAX = 5 * 1024 * 1024; // 5MB
const COMMENT_IMAGE_LIMIT = 1;
const COMMENT_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const COMMENT_CHAR_LIMIT = 200;
const COMMENT_COOLDOWN = 30; // seconds

const commentImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(COMMENT_IMAGE_DIR, { recursive: true });
      cb(null, COMMENT_IMAGE_DIR);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `ec_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: COMMENT_IMAGE_MAX, files: COMMENT_IMAGE_LIMIT },
  fileFilter: (req, file, cb) => {
    try { file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8'); } catch {}
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, COMMENT_IMAGE_EXT.has(ext));
  },
});

function parseCommentImage(req, res, next) {
  if (!req.is('multipart/form-data')) return next();
  commentImageUpload.single('image')(req, res, (error) => {
    if (!error) return next();
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? '图片不能超过 5MB'
      : error.code === 'LIMIT_FILE_COUNT'
        ? '只能上传一张图片'
        : '仅支持 JPG、PNG、WebP 格式';
    res.status(400).json({ error: message });
  });
}

function deleteCommentImages(imageUrl) {
  if (!imageUrl) return;
  imageUrl.split(';').filter(Boolean).forEach(url => {
    const p = path.join(__dirname, '..', '..', url);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
}

const COMMENT_TABLES = { course: 'comments', square: 'square_comments' };
const REPLY_PREVIEW_LIMIT = 3;

function createCommentHandlers(db, type) {
  const table = COMMENT_TABLES[type];
  const selectWithAuthor = `SELECT c.*, u.nickname AS author_name, u.username AS author_username,
    u.avatar_url AS author_avatar, u.grade AS author_grade, u.major AS author_major
    FROM ${table} c LEFT JOIN users u ON u.id = c.author_id`;

  function count(postId) {
    return db.get(`SELECT COUNT(*) AS cnt FROM ${table} WHERE post_id = ?`, [postId])?.cnt || 0;
  }

  function setLikeState(comments, userId) {
    let likedIds = new Set();
    if (userId && comments.length > 0) {
      const ids = comments.map(comment => comment.id);
      const placeholders = ids.map(() => '?').join(',');
      const likes = db.all(
        `SELECT comment_id FROM comment_likes WHERE comment_type = ? AND comment_id IN (${placeholders}) AND user_id = ?`,
        [type, ...ids, userId]
      );
      likedIds = new Set(likes.map(like => like.comment_id));
    }
    for (const comment of comments) {
      comment.is_liked = likedIds.has(comment.id);
      comment.like_count = comment.like_count || 0;
    }
  }

  function list(req, res) {
    const postId = Number(req.params.postId);
    const lastCommentId = parseInt(req.query.lastCommentId);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const cursorClause = lastCommentId ? 'AND c.id > ?' : '';
    const params = lastCommentId ? [postId, lastCommentId, limit] : [postId, limit];
    const items = db.all(
      `${selectWithAuthor} WHERE c.post_id = ? AND c.parent_id IS NULL ${cursorClause}
       ORDER BY c.id ASC LIMIT ?`,
      params
    );

    if (items.length > 0) {
      const parentIds = items.map(comment => comment.id);
      const placeholders = parentIds.map(() => '?').join(',');
      const children = db.all(
        `${selectWithAuthor} WHERE c.parent_id IN (${placeholders}) ORDER BY c.created_at ASC`,
        parentIds
      );
      const threads = new Map(items.map(comment => {
        comment.replies = [];
        comment.reply_count = 0;
        return [comment.id, comment];
      }));
      for (const child of children) {
        const parent = threads.get(child.parent_id);
        parent.reply_count += 1;
        if (parent.replies.length < REPLY_PREVIEW_LIMIT) parent.replies.push(child);
      }

      for (const comment of items) {
        const remaining = comment.reply_count - comment.replies.length;
        comment.has_more_replies = remaining > 0;
        comment.more_reply_count = remaining;
      }
      setLikeState(items.flatMap(comment => [comment, ...comment.replies]), req.user?.userId);
    }
    res.json({ items, hasMore: items.length === limit, commentCount: count(postId) });
  }

  function replies(req, res) {
    const commentId = Number(req.params.commentId);
    const items = db.all(`${selectWithAuthor} WHERE c.parent_id = ? ORDER BY c.created_at ASC`, [commentId]);
    setLikeState(items, req.user?.userId);
    res.json(items);
  }

  function remove(req, res) {
    const commentId = Number(req.params.commentId);
    const postId = Number(req.params.postId);
    const comment = db.get(`SELECT * FROM ${table} WHERE id = ? AND post_id = ?`, [commentId, postId]);
    if (!comment) return res.status(404).json({ error: '评论不存在' });
    if (comment.author_id !== req.user.userId) return res.status(403).json({ error: '只能删除自己的回复' });

    const thread = [comment];
    const pending = [commentId];
    while (pending.length > 0) {
      const children = db.all(`SELECT * FROM ${table} WHERE parent_id = ?`, [pending.pop()]);
      for (const child of children) {
        thread.push(child);
        pending.push(child.id);
      }
    }
    for (const item of thread) deleteCommentImages(item.image_url);

    const ids = thread.map(item => item.id);
    const placeholders = ids.map(() => '?').join(',');
    db.run(`DELETE FROM comment_likes WHERE comment_type = ? AND comment_id IN (${placeholders})`, [type, ...ids]);
    for (const id of ids) db.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
    db.save();
    res.json({ message: '已删除', deleted_count: ids.length, comment_count: count(postId) });
  }

  function like(req, res) {
    const commentId = parseInt(req.params.commentId);
    const userId = req.user.userId;
    const comment = db.get(`SELECT id, like_count FROM ${table} WHERE id = ?`, [commentId]);
    if (!comment) return res.status(404).json({ error: '评论不存在' });
    try {
      db.run('INSERT INTO comment_likes (comment_type, comment_id, user_id) VALUES (?, ?, ?)', [type, commentId, userId]);
    } catch {
      return res.status(409).json({ error: '已点赞' });
    }
    db.run(`UPDATE ${table} SET like_count = like_count + 1 WHERE id = ?`, [commentId]);
    db.save();
    const updated = db.get(`SELECT like_count FROM ${table} WHERE id = ?`, [commentId]);
    res.json({ liked: true, like_count: updated?.like_count || 1 });
  }

  function unlike(req, res) {
    const commentId = parseInt(req.params.commentId);
    const params = [type, commentId, req.user.userId];
    const liked = db.get('SELECT id FROM comment_likes WHERE comment_type = ? AND comment_id = ? AND user_id = ?', params);
    if (!liked) return res.status(404).json({ error: '未点赞' });
    db.run('DELETE FROM comment_likes WHERE comment_type = ? AND comment_id = ? AND user_id = ?', params);
    db.run(`UPDATE ${table} SET like_count = MAX(0, like_count - 1) WHERE id = ?`, [commentId]);
    db.save();
    const updated = db.get(`SELECT like_count FROM ${table} WHERE id = ?`, [commentId]);
    res.json({ liked: false, like_count: updated?.like_count || 0 });
  }

  return { list, replies, remove, like, unlike };
}

module.exports = { createCommentHandlers, parseCommentImage, deleteCommentImages, COMMENT_CHAR_LIMIT, COMMENT_COOLDOWN };
