const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { authMiddleware } = require('../middleware/auth');
const { createNotification } = require('../notifications');
const { isEnrolledInBigCourse, notifyBigCourseMembers } = require('./membership');
const { createCommentHandlers, parseCommentImage, deleteCommentImages, COMMENT_CHAR_LIMIT, COMMENT_COOLDOWN } = require('./comments');

const POST_ATTACHMENT_DIR = path.join(__dirname, '..', '..', 'uploads', 'post-attachments');
const POST_ATTACHMENT_LIMIT = 9;
const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

const attachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(POST_ATTACHMENT_DIR, { recursive: true });
      cb(null, POST_ATTACHMENT_DIR);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: MAX_ATTACHMENT_SIZE, files: POST_ATTACHMENT_LIMIT },
});

function parsePostAttachments(req, res, next) {
  if (!req.is('multipart/form-data')) return next();
  attachmentUpload.array('files', POST_ATTACHMENT_LIMIT)(req, res, (error) => {
    if (!error) return next();
    cleanupUploadedFiles(req.files);
    const message = error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE'
      ? '每个帖子最多上传 9 个附件'
      : error.code === 'LIMIT_FILE_SIZE'
        ? '单个附件不能超过 20MB'
        : '附件上传失败';
    res.status(400).json({ error: message });
  });
}

function cleanupUploadedFiles(files) {
  (files || []).forEach(file => {
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
  });
}

function toAttachmentResponse(attachment) {
  const base = `/api/courses/posts/attachments/${attachment.id}`;
  return {
    ...attachment,
    view_url: attachment.file_type === 'image' ? `${base}/view` : null,
    download_url: `${base}/download`,
  };
}


function registerForum(router, db) {
  const comments = createCommentHandlers(db, 'course');

  // GET /api/courses/:id/posts — 帖子列表
  router.get('/:id/posts', (req, res) => {
    const courseId = Number(req.params.id);
    const posts = db.all(`
      SELECT p.*, u.nickname AS author_name,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
      FROM posts p
      JOIN users u ON p.author_id = u.id
      WHERE p.course_id = ?
      ORDER BY p.created_at DESC
    `, [courseId]);
    if (posts.length === 0) return res.json(posts);

    const attachmentsByPost = new Map();
    const attachments = db.all(`
      SELECT id, post_id, file_name, file_type, file_size
      FROM post_attachments
      WHERE post_id IN (SELECT id FROM posts WHERE course_id = ?)
      ORDER BY id ASC
    `, [courseId]);
    for (const { post_id, ...attachment } of attachments) {
      if (!attachmentsByPost.has(post_id)) attachmentsByPost.set(post_id, []);
      attachmentsByPost.get(post_id).push(toAttachmentResponse(attachment));
    }
    for (const post of posts) {
      post.attachments = attachmentsByPost.get(post.id) || [];
    }
    res.json(posts);
  });

  // POST /api/courses/:id/posts — 发帖 [Auth]（:id 为大课 ID）
  router.post('/:id/posts', authMiddleware, parsePostAttachments, (req, res) => {
    const { title, content } = req.body;
    if (!title || !content) {
      cleanupUploadedFiles(req.files);
      return res.status(400).json({ error: 'title 和 content 为必填项' });
    }

    const bigCourseId = Number(req.params.id);
    const course = db.get('SELECT id FROM courses WHERE id = ?', [bigCourseId]);
    if (!course) {
      cleanupUploadedFiles(req.files);
      return res.status(404).json({ error: '课程不存在' });
    }
    if (!isEnrolledInBigCourse(db, req.user.userId, bigCourseId)) {
      cleanupUploadedFiles(req.files);
      return res.status(403).json({ error: '只有课程成员可以发布帖子' });
    }

    const result = db.run(
      'INSERT INTO posts (course_id, author_id, title, content) VALUES (?, ?, ?, ?)',
      [bigCourseId, req.user.userId, title, content]
    );
    const attachments = (req.files || []).map(file => {
      const ext = path.extname(file.originalname).toLowerCase();
      const attachment = db.run(
        'INSERT INTO post_attachments (post_id, file_path, file_name, file_type, file_size) VALUES (?, ?, ?, ?, ?)',
        [result.lastInsertRowid, file.filename, file.originalname, IMAGE_EXTENSIONS.has(ext) ? 'image' : 'file', file.size]
      );
      return toAttachmentResponse({
        id: attachment.lastInsertRowid,
        file_name: file.originalname,
        file_type: IMAGE_EXTENSIONS.has(ext) ? 'image' : 'file',
        file_size: file.size,
      });
    });
    db.save();

    // 通知：大课空间有新帖
    const author = db.get('SELECT nickname FROM users WHERE id = ?', [req.user.userId]);
    const courseInfo = db.get('SELECT title FROM courses WHERE id = ?', [bigCourseId]);
    notifyBigCourseMembers(db, bigCourseId, req.user.userId,
      'new_post', '新帖子',
      `${author?.nickname || '匿名'} 在「${courseInfo?.title || ''}」发布了「${title}」`,
      'post', result.lastInsertRowid
    );
    db.save();

    res.status(201).json({
      id: result.lastInsertRowid,
      course_id: bigCourseId,
      author_id: req.user.userId,
      title,
      content,
      attachments
    });
  });

  router.get('/posts/attachments/:attachmentId/view', (req, res) => {
    const attachment = db.get('SELECT * FROM post_attachments WHERE id = ?', [Number(req.params.attachmentId)]);
    if (!attachment || attachment.file_type !== 'image') return res.status(404).json({ error: '图片不存在' });
    res.sendFile(path.join(POST_ATTACHMENT_DIR, attachment.file_path));
  });

  router.get('/posts/attachments/:attachmentId/download', (req, res) => {
    const attachment = db.get('SELECT * FROM post_attachments WHERE id = ?', [Number(req.params.attachmentId)]);
    if (!attachment) return res.status(404).json({ error: '附件不存在' });
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}`);
    res.sendFile(path.join(POST_ATTACHMENT_DIR, attachment.file_path));
  });


  router.get('/posts/:postId/comments', comments.list);

  // POST /api/courses/posts/:postId/comments — 发评论 [Auth]（支持图片 + 楼中楼 + @提及）
  router.post('/posts/:postId/comments', authMiddleware, parseCommentImage, (req, res) => {
    const { content, parent_id } = req.body;
    const imageFile = req.file;
    const userId = req.user.userId;

    // 风控：同一用户 30 秒内只能评论一次
    const lastComment = db.get('SELECT MAX(created_at) as last_time FROM comments WHERE author_id = ?', [userId]);
    if (lastComment?.last_time) {
      const elapsed = Date.now() - new Date(lastComment.last_time).getTime();
      if (elapsed < COMMENT_COOLDOWN * 1000) {
        if (imageFile && fs.existsSync(imageFile.path)) fs.unlinkSync(imageFile.path);
        return res.status(429).json({
          error: `评论发送太频繁，请 ${Math.ceil((COMMENT_COOLDOWN * 1000 - elapsed) / 1000)} 秒后再试`,
          retryAfter: Math.ceil((COMMENT_COOLDOWN * 1000 - elapsed) / 1000)
        });
      }
    }
    if ((!content || !content.trim()) && !imageFile) {
      if (imageFile && fs.existsSync(imageFile.path)) fs.unlinkSync(imageFile.path);
      return res.status(400).json({ error: '请输入内容或上传图片' });
    }
    if (content && content.length > COMMENT_CHAR_LIMIT) {
      if (imageFile && fs.existsSync(imageFile.path)) fs.unlinkSync(imageFile.path);
      return res.status(400).json({ error: `评论内容不能超过 ${COMMENT_CHAR_LIMIT} 字` });
    }

    const postId = Number(req.params.postId);
    const post = db.get('SELECT id, course_id FROM posts WHERE id = ?', [postId]);
    if (!post) {
      if (imageFile && fs.existsSync(imageFile.path)) fs.unlinkSync(imageFile.path);
      return res.status(404).json({ error: '帖子不存在' });
    }
    let parentId = null;
    if (parent_id) {
      parentId = Number(parent_id);
      const parentComment = db.get('SELECT id, post_id FROM comments WHERE id = ?', [parentId]);
      if (!parentComment || parentComment.post_id !== postId) {
        if (imageFile && fs.existsSync(imageFile.path)) fs.unlinkSync(imageFile.path);
        return res.status(400).json({ error: '被回复的评论不存在' });
      }
    }
    const imageUrl = imageFile ? `/uploads/comment-images/${imageFile.filename}` : '';
    const result = db.run(
      'INSERT INTO comments (post_id, author_id, content, parent_id, image_url) VALUES (?, ?, ?, ?, ?)',
      [postId, userId, (content || '').trim(), parentId, imageUrl]);
    const commentId = result.lastInsertRowid;

    const commenter = db.get('SELECT nickname, username FROM users WHERE id = ?', [userId]);
    const userName = commenter?.nickname || commenter?.username || '某用户';
    if (parentId) {
      const pc = db.get('SELECT author_id FROM comments WHERE id = ?', [parentId]);
      if (pc && pc.author_id !== userId)
        createNotification(db, { userId: pc.author_id, type: 'new_comment', title: '新回复', message: `${userName} 回复了你的评论`, relatedType: 'post', relatedId: postId, courseId: post.course_id, relatedCommentId: commentId });
    } else {
      const pd = db.get('SELECT author_id, title, course_id FROM posts WHERE id = ?', [postId]);
      if (pd && pd.author_id !== userId)
        createNotification(db, { userId: pd.author_id, type: 'new_comment', title: '新评论', message: `${userName} 评论了你的帖子「${pd.title}」`, relatedType: 'post', relatedId: postId, courseId: pd.course_id, relatedCommentId: commentId });
    }
    // @提及通知
    if (content) {
      const mentionedNames = [...new Set((content.match(/@(\w+)/g) || []).map(m => m.slice(1)))];
      if (mentionedNames.length > 0) {
        const mentionedUsers = db.all(`SELECT id, username FROM users WHERE username IN (${mentionedNames.map(() => '?').join(',')})`, mentionedNames);
        const parentAuthorId = parentId ? (db.get('SELECT author_id FROM comments WHERE id = ?', [parentId]) || {}).author_id : null;
        const alreadyNotified = new Set([userId, (db.get('SELECT author_id FROM posts WHERE id = ?', [postId]) || {}).author_id, parentAuthorId].filter(Boolean));
        for (const m of mentionedUsers) {
          if (!alreadyNotified.has(m.id))
            createNotification(db, { userId: m.id, type: 'comment_mention', title: '有人@了你', message: `${userName} 在评论中@了你`, relatedType: 'post', relatedId: postId, courseId: post.course_id, relatedCommentId: commentId });
        }
      }
    }
    db.save();
    const comment = db.get(`SELECT c.*, u.nickname AS author_name, u.username AS author_username, u.avatar_url AS author_avatar FROM comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.id = ?`, [commentId]);
    res.status(201).json(comment);
  });

  // DELETE /api/courses/posts/:postId — 删除帖子（级联删除所有回复）
  router.delete('/posts/:postId', authMiddleware, (req, res) => {
    const postId = Number(req.params.postId);
    const userId = req.user.userId;

    const post = db.get('SELECT * FROM posts WHERE id = ?', [postId]);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    if (post.author_id !== userId) return res.status(403).json({ error: '只能删除自己发布的帖子' });

    // 删除帖子相关的所有图片文件
    deleteCommentImages(post.image_url);

    // 删除所有回复的图片文件
    const comments = db.all('SELECT image_url FROM comments WHERE post_id = ?', [postId]);
    for (const comment of comments) deleteCommentImages(comment.image_url);

    // 级联删除所有回复
    db.run('DELETE FROM comments WHERE post_id = ?', [postId]);
    // 删除帖子
    db.run('DELETE FROM posts WHERE id = ?', [postId]);
    db.save();

    res.json({ message: '已删除' });
  });

  router.delete('/posts/:postId/comments/:commentId', authMiddleware, comments.remove);
  router.post('/posts/:postId/comments/:commentId/like', authMiddleware, comments.like);
  router.delete('/posts/:postId/comments/:commentId/like', authMiddleware, comments.unlike);
  router.get('/posts/:postId/comments/:commentId/replies', comments.replies);
}

module.exports = registerForum;
