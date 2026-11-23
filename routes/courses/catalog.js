const { authMiddleware } = require('../middleware/auth');

function registerCatalog(router, db) {
  // GET /api/courses/semesters — 当前用户已选课程涉及的学期列表
  router.get('/semesters', authMiddleware, (req, res) => {
    const userId = req.user.userId;
    const rows = db.all(
      'SELECT DISTINCT semester_key FROM user_courses WHERE user_id = ? AND semester_key != "" ORDER BY semester_key DESC',
      [userId]
    );
    res.json(rows.map(r => r.semester_key));
  });

  // GET /api/courses/all — 全校大课列表（公开，供课程广场使用，不需要登录）
  router.get('/all', (req, res) => {
    const courses = db.all(`
      SELECT c.*,
        (SELECT COUNT(*) FROM user_courses uc
         WHERE uc.course_id = c.id
            OR uc.course_id IN (SELECT c2.id FROM courses c2 WHERE c2.big_course_id = c.id)
        ) AS enrollment_count
      FROM courses c
      WHERE c.big_course_id IS NULL
      ORDER BY c.title ASC
    `);
    res.json(courses);
  });

  // GET /api/courses — 当前用户的课程列表（支持学期筛选）
  router.get('/', authMiddleware, (req, res) => {
    const userId = req.user.userId;
    const { semester, year } = req.query;

    let sql = `
      SELECT DISTINCT c.*,
        uc.semester_key AS enrolled_semester_key,
        (SELECT COUNT(*) FROM user_courses uc2 WHERE uc2.course_id = c.id) AS enrollment_count
      FROM courses c
      JOIN user_courses uc ON uc.course_id = c.id
      WHERE uc.user_id = ?
    `;
    const params = [userId];

    if (semester && semester !== 'all') {
      if (semester.includes('-')) {
        sql += ' AND uc.semester_key = ?';
        params.push(semester);
      } else {
        sql += ' AND uc.semester_key LIKE ?';
        params.push(`%-${semester}`);
      }
    } else if (year && year !== 'all') {
      sql += ' AND uc.semester_key LIKE ?';
      params.push(`${year}-%`);
    } else if (req.query.type && req.query.type !== 'all') {
      sql += ' AND uc.semester_key LIKE ?';
      params.push(`%-${req.query.type}`);
    }

    sql += ' ORDER BY c.created_at DESC';
    const courses = db.all(sql, params);
    res.json(courses);
  });

  // GET /api/courses/:id — 课程详情（支持大课和小课 ID）
  router.get('/:id', (req, res) => {
    const courseId = Number(req.params.id);
    const course = db.get('SELECT * FROM courses WHERE id = ?', [courseId]);
    if (!course) return res.status(404).json({ error: '课程不存在' });

    // 判断是大课还是小课
    const isBig = !course.big_course_id;
    if (isBig) {
      // 大课：enrollment_count = 直接选课 + 所有小课的选课人数总和
      const count = db.get(
        'SELECT COUNT(*) AS cnt FROM user_courses uc WHERE uc.course_id = ? OR uc.course_id IN (SELECT c2.id FROM courses c2 WHERE c2.big_course_id = ?)',
        [courseId, courseId]
      );
      course.enrollment_count = count ? count.cnt : 0;
    } else {
      // 小课：enrollment_count = 该小课的选课人数
      const count = db.get(
        'SELECT COUNT(*) AS cnt FROM user_courses WHERE course_id = ?',
        [courseId]
      );
      course.enrollment_count = count ? count.cnt : 0;
    }

    res.json(course);
  });

  // POST /api/courses/:id/enroll — 加入课程 [Auth]
  router.post('/:id/enroll', authMiddleware, (req, res) => {
    const userId = req.user.userId;
    const courseId = Number(req.params.id);
    const course = db.get('SELECT * FROM courses WHERE id = ?', [courseId]);
    if (!course) return res.status(404).json({ error: '课程不存在' });

    const enrolled = db.get(
      'SELECT * FROM user_courses WHERE user_id = ? AND course_id = ?',
      [userId, courseId]
    );
    if (enrolled) {
      return res.status(400).json({ error: '已加入该课程' });
    }

    const semesterKey = req.body.semester_key || '';

    // 检查本学期课程数上限（每学期 50 门）
    const count = db.get(
      'SELECT COUNT(*) AS cnt FROM user_courses WHERE user_id = ? AND semester_key = ?',
      [userId, semesterKey]
    );
    if (count.cnt >= 50) {
      return res.status(400).json({ error: '本学期课程数已达 50 门上限，请先退出部分课程' });
    }

    db.run(
      'INSERT INTO user_courses (user_id, course_id, semester_key) VALUES (?, ?, ?)',
      [userId, courseId, semesterKey]
    );
    db.save();
    res.json({ message: '加入成功' });
  });

  // DELETE /api/courses/:id/leave — 退出课程 [Auth]
  router.delete('/:id/leave', authMiddleware, (req, res) => {
    const userId = req.user.userId;
    const courseId = Number(req.params.id);

    const enrolled = db.get(
      'SELECT * FROM user_courses WHERE user_id = ? AND course_id = ?',
      [userId, courseId]
    );
    if (!enrolled) {
      return res.status(400).json({ error: '未加入该课程' });
    }

    db.run(
      'DELETE FROM user_courses WHERE user_id = ? AND course_id = ?',
      [userId, courseId]
    );
    db.save();
    res.json({ message: '已退出课程' });
  });

  // PUT /api/courses/:id/move-semester — 移动课程到指定学期 [Auth]
  router.put('/:id/move-semester', authMiddleware, (req, res) => {
    const userId = req.user.userId;
    const courseId = Number(req.params.id);
    const { semester_key } = req.body;

    if (!semester_key) {
      return res.status(400).json({ error: '请指定目标学期' });
    }

    const enrolled = db.get(
      'SELECT * FROM user_courses WHERE user_id = ? AND course_id = ?',
      [userId, courseId]
    );
    if (!enrolled) {
      return res.status(400).json({ error: '未加入该课程' });
    }

    db.run(
      'UPDATE user_courses SET semester_key = ? WHERE user_id = ? AND course_id = ?',
      [semester_key, userId, courseId]
    );
    db.save();
    res.json({ message: '移动成功' });
  });
}

module.exports = registerCatalog;
