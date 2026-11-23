const fs = require('fs');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth');
const { createNotification } = require('../notifications');
const { isEnrolledInBigCourse } = require('./membership');
const { createCommentHandlers, parseCommentImage, COMMENT_CHAR_LIMIT, COMMENT_COOLDOWN } = require('./comments');

const COURSE_SQUARE_CATEGORIES = ['考研搭子', '考公搭子', '考证搭子', '项目组队', '技能交换', '竞赛组队', '其他'];
const COURSE_SQUARE_EXPIRY_DAYS = 7;

function registerSquare(router, db) {
  const comments = createCommentHandlers(db, 'square');

  // POST /api/courses/:id/square-posts — 发布课程搭子帖 [Auth + 选课]（:id 为大课 ID）
  router.post('/:id/square-posts', authMiddleware, (req, res) => {
    const bigCourseId = Number(req.params.id);
    const userId = req.user.userId;
    if (!isEnrolledInBigCourse(db, userId, bigCourseId)) return res.status(403).json({ error: '未选修该课程' });

    const { title, category, description, max_people } = req.body;
    if (!title || !category) return res.status(400).json({ error: '标题和类型为必填项' });
    if (!COURSE_SQUARE_CATEGORIES.includes(category)) return res.status(400).json({ error: '无效的需求类型' });

    const expiresAt = new Date(Date.now() + COURSE_SQUARE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const result = db.run(
      `INSERT INTO square_posts (creator_id, title, category, description, max_people, current_count, status, expires_at, course_id)
       VALUES (?, ?, ?, ?, ?, 0, 'open', ?, ?)`,
      [userId, title.trim(), category, (description || '').trim(), max_people || 1, expiresAt, bigCourseId]
    );
    db.save();

    res.status(201).json({ id: result.lastInsertRowid, message: '发布成功' });
  });

  // GET /api/courses/:id/square-posts — 课程搭子帖列表 [Auth + 选课]（:id 为大课 ID）
  router.get('/:id/square-posts', authMiddleware, (req, res) => {
    const bigCourseId = Number(req.params.id);
    const userId = req.user.userId;
    if (!isEnrolledInBigCourse(db, userId, bigCourseId)) return res.status(403).json({ error: '未选修该课程' });

    const { category } = req.query;
    let where = " WHERE sp.course_id = ? AND sp.expires_at > datetime('now', '+8 hours') AND sp.status != 'expired'";
    const params = [bigCourseId];

    if (category && category !== 'all') {
      where += ' AND sp.category = ?';
      params.push(category);
    }

    const posts = db.all(`
      SELECT sp.*,
        u.nickname AS creator_name,
        (SELECT COUNT(*) FROM square_interests si WHERE si.post_id = sp.id AND si.status = 'accepted') AS confirmed_count,
        (SELECT si2.status FROM square_interests si2 WHERE si2.post_id = sp.id AND si2.user_id = ?) AS my_status
      FROM square_posts sp
      JOIN users u ON sp.creator_id = u.id
      ${where}
      ORDER BY sp.created_at DESC
    `, [userId, ...params]);

    const result = posts.map(p => {
      const remaining = Math.max(0, Math.ceil((new Date(p.expires_at) - Date.now()) / (24 * 60 * 60 * 1000)));
      return { ...p, remaining_days: remaining };
    });

    res.json({ posts: result });
  });

  // GET /api/courses/:id/square-posts/:postId — 帖子详情 [Auth + 选课]（:id 为大课 ID）
  router.get('/:id/square-posts/:postId', authMiddleware, (req, res) => {
    const bigCourseId = Number(req.params.id);
    const postId = Number(req.params.postId);
    const userId = req.user.userId;
    if (!isEnrolledInBigCourse(db, userId, bigCourseId)) return res.status(403).json({ error: '未选修该课程' });

    const post = db.get(`
      SELECT sp.*, u.nickname AS creator_name, u.major AS creator_major, u.grade AS creator_grade
      FROM square_posts sp
      JOIN users u ON sp.creator_id = u.id
      WHERE sp.id = ? AND sp.course_id = ?
    `, [postId, bigCourseId]);

    if (!post) return res.status(404).json({ error: '帖子不存在' });
    if (new Date(post.expires_at) <= new Date()) post.status = 'expired';

    const confirmed = db.all(`
      SELECT u.id AS user_id, u.nickname, u.major, u.grade, u.avatar_url, u.qq
      FROM square_interests si
      JOIN users u ON si.user_id = u.id
      WHERE si.post_id = ? AND si.status = 'accepted'
      ORDER BY si.created_at ASC
    `, [postId]);

    let pending = [];
    if (post.creator_id === userId) {
      pending = db.all(`
        SELECT si.id AS interest_id, si.user_id, si.created_at,
          u.nickname, u.major, u.grade, u.avatar_url
        FROM square_interests si
        JOIN users u ON si.user_id = u.id
        WHERE si.post_id = ? AND si.status = 'pending'
        ORDER BY si.created_at ASC
      `, [postId]);
    }

    const myInterest = db.get(
      'SELECT status FROM square_interests WHERE post_id = ? AND user_id = ?',
      [postId, userId]
    );

    const remaining = Math.max(0, Math.ceil((new Date(post.expires_at) - Date.now()) / (24 * 60 * 60 * 1000)));

    res.json({ ...post, remaining_days: remaining, confirmed, pending, my_status: myInterest ? myInterest.status : null });
  });

  // DELETE /api/courses/:id/square-posts/:postId — 删除帖子 [Auth, 仅创建者]
  router.delete('/:id/square-posts/:postId', authMiddleware, (req, res) => {
    const bigCourseId = Number(req.params.id);
    const postId = Number(req.params.postId);
    const userId = req.user.userId;

    const post = db.get('SELECT * FROM square_posts WHERE id = ? AND course_id = ?', [postId, bigCourseId]);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    if (post.creator_id !== userId) return res.status(403).json({ error: '只能删除自己发布的帖子' });

    db.run('DELETE FROM square_posts WHERE id = ?', [postId]);
    db.save();
    res.json({ message: '已删除' });
  });

  // PUT /api/courses/:id/square-posts/:postId — 编辑帖子 [Auth, 仅创建者]
  router.put('/:id/square-posts/:postId', authMiddleware, (req, res) => {
    const bigCourseId = Number(req.params.id);
    const postId = Number(req.params.postId);
    const userId = req.user.userId;
    const { title, category, description, max_people } = req.body;

    const post = db.get('SELECT * FROM square_posts WHERE id = ? AND course_id = ?', [postId, bigCourseId]);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    if (post.creator_id !== userId) return res.status(403).json({ error: '只能编辑自己发布的帖子' });

    // 校验 category
    if (category && !COURSE_SQUARE_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: '无效的需求类型' });
    }

    db.run(
      `UPDATE square_posts SET
        title = COALESCE(?, title),
        category = COALESCE(?, category),
        description = COALESCE(?, description),
        max_people = COALESCE(?, max_people)
       WHERE id = ?`,
      [
        title?.trim() || null,
        category || null,
        description !== undefined ? description.trim() : null,
        max_people !== undefined ? Number(max_people) : null,
        postId
      ]
    );
    db.save();
    res.json({ message: '已更新' });
  });

  // POST /api/courses/:id/square-posts/:postId/interest — 表示感兴趣 [Auth + 选课]（:id 为大课 ID）
  router.post('/:id/square-posts/:postId/interest', authMiddleware, (req, res) => {
    const bigCourseId = Number(req.params.id);
    const postId = Number(req.params.postId);
    const userId = req.user.userId;
    if (!isEnrolledInBigCourse(db, userId, bigCourseId)) return res.status(403).json({ error: '未选修该课程' });

    const post = db.get('SELECT * FROM square_posts WHERE id = ? AND course_id = ?', [postId, bigCourseId]);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    if (post.creator_id === userId) return res.status(400).json({ error: '不能对自己的帖子感兴趣' });
    if (post.status !== 'open') return res.status(400).json({ error: '该帖子已不再接受申请' });
    if (new Date(post.expires_at) <= new Date()) return res.status(400).json({ error: '该帖子已过期' });

    const existing = db.get('SELECT * FROM square_interests WHERE post_id = ? AND user_id = ?', [postId, userId]);
    if (existing) return res.status(400).json({ error: '你已经申请过了' });

    db.run("INSERT INTO square_interests (post_id, user_id, status) VALUES (?, ?, 'pending')", [postId, userId]);
    db.save();

    const applicant = db.get('SELECT nickname FROM users WHERE id = ?', [userId]);
    createNotification(db, {
      userId: post.creator_id, type: 'course_square_interest', title: '有人对你的搭子帖感兴趣',
      message: `${applicant?.nickname || '匿名'} 对「${post.title}」感兴趣`,
      relatedType: 'course_square_post', relatedId: postId
    });
    db.save();

    res.json({ message: '已申请，等待对方确认' });
  });

  // PUT /api/courses/:id/square-interests/:interestId — 接受/拒绝 [Auth]
  router.put('/:id/square-interests/:interestId', authMiddleware, (req, res) => {
    const bigCourseId = Number(req.params.id);
    const interestId = Number(req.params.interestId);
    const userId = req.user.userId;
    const { action } = req.body;

    const interest = db.get('SELECT * FROM square_interests WHERE id = ?', [interestId]);
    if (!interest) return res.status(404).json({ error: '记录不存在' });

    const post = db.get('SELECT * FROM square_posts WHERE id = ? AND course_id = ?', [interest.post_id, bigCourseId]);
    if (!post || post.creator_id !== userId) return res.status(403).json({ error: '无权操作' });
    if (interest.status !== 'pending') return res.status(400).json({ error: '该申请已处理' });

    if (action === 'reject') {
      db.run("UPDATE square_interests SET status = 'rejected' WHERE id = ?", [interestId]);
      db.save();
      return res.json({ message: '已拒绝' });
    }

    const actualCount = db.get(
      "SELECT COUNT(*) AS cnt FROM square_interests WHERE post_id = ? AND status = 'accepted'",
      [post.id]
    );
    if (actualCount.cnt >= post.max_people) return res.status(400).json({ error: '人数已满' });

    db.run("UPDATE square_interests SET status = 'accepted' WHERE id = ?", [interestId]);
    const newCount = actualCount.cnt + 1;
    db.run('UPDATE square_posts SET current_count = ? WHERE id = ?', [newCount, post.id]);
    if (newCount >= post.max_people) db.run("UPDATE square_posts SET status = 'full' WHERE id = ?", [post.id]);
    db.save();

    createNotification(db, {
      userId: interest.user_id, type: 'course_square_accepted', title: '搭子申请已通过',
      message: `你对「${post.title}」的申请已被接受`,
      relatedType: 'course_square_post', relatedId: post.id
    });
    db.save();

    res.json({ message: '已接受' });
  });


  router.get('/:id/square-posts/:postId/comments', optionalAuthMiddleware, comments.list);

  // POST /api/courses/:id/square-posts/:postId/comments — 发评论 [Auth + 选课]（@mention + 200 字限制）
  router.post('/:id/square-posts/:postId/comments', authMiddleware, parseCommentImage, (req, res) => {
    const bigCourseId = Number(req.params.id);
    const postId = Number(req.params.postId);
    const userId = req.user.userId;
    if (!isEnrolledInBigCourse(db, userId, bigCourseId)) return res.status(403).json({ error: '未选修该课程' });

    const { content, parent_id } = req.body;
    const imageFile = req.file;

    // 风控：同一用户 COOLDOWN 秒内只能评论一次
    const lastComment = db.get('SELECT MAX(created_at) as last_time FROM square_comments WHERE author_id = ?', [userId]);
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

    const post = db.get('SELECT id, creator_id, title FROM square_posts WHERE id = ? AND course_id = ?', [postId, bigCourseId]);
    if (!post) {
      if (imageFile && fs.existsSync(imageFile.path)) fs.unlinkSync(imageFile.path);
      return res.status(404).json({ error: '帖子不存在' });
    }

    let parentId = null;
    if (parent_id) {
      parentId = Number(parent_id);
      const parentComment = db.get('SELECT id, author_id FROM square_comments WHERE id = ? AND post_id = ?', [parentId, postId]);
      if (!parentComment) {
        if (imageFile && fs.existsSync(imageFile.path)) fs.unlinkSync(imageFile.path);
        return res.status(400).json({ error: '被回复的评论不存在' });
      }
    }

    const imageUrl = imageFile ? `/uploads/comment-images/${imageFile.filename}` : '';
    const result = db.run(
      'INSERT INTO square_comments (post_id, author_id, content, parent_id, image_url) VALUES (?, ?, ?, ?, ?)',
      [postId, userId, (content || '').trim(), parentId, imageUrl]
    );
    const commentId = result.lastInsertRowid;

    // 通知
    const user = db.get('SELECT nickname, username FROM users WHERE id = ?', [userId]);
    const userName = user?.nickname || user?.username || '某用户';

    if (parentId) {
      const parentComment = db.get('SELECT author_id FROM square_comments WHERE id = ?', [parentId]);
      if (parentComment && parentComment.author_id !== userId) {
        createNotification(db, {
          userId: parentComment.author_id, type: 'comment_reply', title: '评论回复',
          message: `${userName} 回复了你在「${post.title}」下的评论`,
          relatedType: 'course_square_post', relatedId: postId, relatedCommentId: commentId, courseId: bigCourseId
        });
      }
    } else {
      if (post.creator_id !== userId) {
        createNotification(db, {
          userId: post.creator_id, type: 'post_comment', title: '新评论',
          message: `${userName} 评论了你的搭子帖「${post.title}」`,
          relatedType: 'course_square_post', relatedId: postId, relatedCommentId: commentId, courseId: bigCourseId
        });
      }
    }

    // @提及解析
    if (content) {
      const mentionedNames = [...new Set((content.match(/@(\w+)/g) || []).map(m => m.slice(1)))];
      if (mentionedNames.length > 0) {
        const mentionedUsers = db.all(
          `SELECT id, username FROM users WHERE username IN (${mentionedNames.map(() => '?').join(',')})`,
          mentionedNames
        );
        const parentAuthorId = parentId
          ? (db.get('SELECT author_id FROM square_comments WHERE id = ?', [parentId]) || {}).author_id
          : null;
        const alreadyNotified = new Set([userId, post.creator_id, parentAuthorId].filter(Boolean));
        for (const mentioned of mentionedUsers) {
          if (!alreadyNotified.has(mentioned.id)) {
            createNotification(db, {
              userId: mentioned.id, type: 'comment_mention', title: '有人@了你',
              message: `${userName} 在评论中@了你`,
              relatedType: 'course_square_post', relatedId: postId,
              relatedCommentId: commentId, courseId: bigCourseId
            });
          }
        }
      }
    }

    db.save();

    // 返回完整评论
    const comment = db.get(
      `SELECT sc.*, u.nickname AS author_name, u.username AS author_username, u.avatar_url AS author_avatar, u.grade AS author_grade, u.major AS author_major
       FROM square_comments sc LEFT JOIN users u ON u.id = sc.author_id WHERE sc.id = ?`, [commentId]);
    res.status(201).json(comment);
  });


  router.delete('/:id/square-posts/:postId/comments/:commentId', authMiddleware, comments.remove);
  router.post('/:id/square-posts/:postId/comments/:commentId/like', authMiddleware, comments.like);
  router.delete('/:id/square-posts/:postId/comments/:commentId/like', authMiddleware, comments.unlike);
  router.get('/:id/square-posts/:postId/comments/:commentId/replies', optionalAuthMiddleware, comments.replies);
}

module.exports = registerSquare;
