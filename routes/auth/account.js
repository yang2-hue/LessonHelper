const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authMiddleware } = require('../middleware/auth');

const AVATAR_DIR = path.join(__dirname, '..', '..', 'uploads', 'avatars');
const AVATAR_MAX = 2 * 1024 * 1024;
const AVATAR_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const AVATAR_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(AVATAR_DIR, { recursive: true });
      cb(null, AVATAR_DIR);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `av_${req.user.userId}_${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: AVATAR_MAX, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // 双重校验：MIME 类型 + 扩展名
    if (!AVATAR_MIME.has(file.mimetype) || !AVATAR_EXT.has(ext)) {
      return cb(new Error('AVATAR_FORMAT'));
    }
    cb(null, true);
  }
});

function getAccount(db, userId) {
  return db.get(
    'SELECT id, username, email, nickname, major, grade, avatar_url, qq, wechat, douyin, avatar_desc, mbti, gender, checkin_streak, last_checkin_date, grace_days, privacy_show_profile, privacy_allow_match, privacy_show_following, privacy_show_followers, email_verified, created_at FROM users WHERE id = ?',
    [userId]
  );
}

function registerAccountRoutes(router, db) {
  // GET /api/auth/me — 获取当前用户信息（保留）
  router.get('/me', authMiddleware, (req, res) => {
    const user = getAccount(db, req.user.userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    res.json(user);
  });

  // PUT /api/auth/me — 更新个人信息（保留）
  router.put('/me', authMiddleware, (req, res) => {
    const { nickname, major, grade, avatar_url, qq, wechat, douyin, avatar_desc, mbti, gender, privacy_show_profile, privacy_allow_match, privacy_show_following, privacy_show_followers } = req.body;
    const user = db.get('SELECT * FROM users WHERE id = ?', [req.user.userId]);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // 验证 avatar_desc 长度
    if (avatar_desc !== undefined && avatar_desc.length > 80) {
      return res.status(400).json({ error: '肖像描述不能超过80字' });
    }

    // 验证 mbti 选项
    const validMbti = ['INTJ','INTP','ENTJ','ENTP','INFJ','INFP','ENFJ','ENFP','ISTJ','ISFJ','ESTJ','ESFJ','ISTP','ISFP','ESTP','ESFP'];
    if (mbti !== undefined && mbti !== '' && !validMbti.includes(mbti)) {
      return res.status(400).json({ error: '无效的MBTI人格类型' });
    }

    // 验证 gender 选项
    const validGender = ['', 'male', 'female'];
    if (gender !== undefined && !validGender.includes(gender)) {
      return res.status(400).json({ error: '无效的性别选项' });
    }

    // 如果清空头像（恢复默认），删除旧头像文件
    if (avatar_url === '' && user.avatar_url && user.avatar_url.startsWith('/uploads/avatars/')) {
      const oldPath = path.join(__dirname, '..', '..', user.avatar_url);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    db.run(
      'UPDATE users SET nickname = ?, major = ?, grade = ?, avatar_url = ?, qq = ?, wechat = ?, douyin = ?, avatar_desc = ?, mbti = ?, gender = ?, privacy_show_profile = ?, privacy_allow_match = ?, privacy_show_following = ?, privacy_show_followers = ? WHERE id = ?',
      [
        nickname !== undefined ? nickname : user.nickname,
        major !== undefined ? major : user.major,
        grade !== undefined ? grade : user.grade,
        avatar_url !== undefined ? avatar_url : user.avatar_url,
        qq !== undefined ? qq : user.qq,
        wechat !== undefined ? wechat : user.wechat,
        douyin !== undefined ? douyin : user.douyin,
        avatar_desc !== undefined ? avatar_desc : user.avatar_desc,
        mbti !== undefined ? mbti : user.mbti,
        gender !== undefined ? gender : user.gender,
        privacy_show_profile !== undefined ? (privacy_show_profile ? 1 : 0) : user.privacy_show_profile,
        privacy_allow_match !== undefined ? (privacy_allow_match ? 1 : 0) : user.privacy_allow_match,
        privacy_show_following !== undefined ? (privacy_show_following ? 1 : 0) : user.privacy_show_following,
        privacy_show_followers !== undefined ? (privacy_show_followers ? 1 : 0) : user.privacy_show_followers,
        req.user.userId
      ]
    );
    db.save();

    const updated = getAccount(db, req.user.userId);
    res.json(updated);
  });

  // POST /api/auth/checkin — 每日签到（保留）
  router.post('/checkin', authMiddleware, (req, res) => {
    const user = db.get(
      'SELECT id, checkin_streak, last_checkin_date, grace_days FROM users WHERE id = ?',
      [req.user.userId]
    );
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const today = req.body.date || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });

    if (user.last_checkin_date === today) {
      return res.json({ streak: user.checkin_streak, alreadyCheckedIn: true });
    }

    let streak = user.checkin_streak || 0;
    let graceDays = user.grace_days || 0;

    const lastDate = user.last_checkin_date ? new Date(user.last_checkin_date) : null;
    const todayDate = new Date(today);
    const daysDiff = lastDate ? Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24)) : 999;

    if (daysDiff === 1) {
      streak += 1;
      graceDays = 0;
    } else if (daysDiff > 1 && streak > 0) {
      if (streak >= 45) {
        if (daysDiff <= 7 + 1) {
          graceDays = 0;
          streak += 1;
        } else {
          streak = 1;
          graceDays = 0;
        }
      } else if (streak >= 7) {
        if (daysDiff <= 3 + 1) {
          graceDays = 0;
          streak += 1;
        } else {
          streak = 1;
          graceDays = 0;
        }
      } else {
        streak = 1;
        graceDays = 0;
      }
    } else if (daysDiff > 1) {
      streak = 1;
      graceDays = 0;
    }

    db.run(
      'UPDATE users SET checkin_streak = ?, last_checkin_date = ?, grace_days = ? WHERE id = ?',
      [streak, today, graceDays, req.user.userId]
    );
    db.save();

    res.json({ streak, alreadyCheckedIn: false });
  });

  // POST /api/auth/avatar — 上传头像 [Auth]（前端已完成三级压缩，后端直接存盘）
  router.post('/avatar', authMiddleware, (req, res) => {
    avatarUpload.single('avatar')(req, res, async (error) => {
      if (error) {
        const message = error.code === 'LIMIT_FILE_SIZE'
          ? '头像不能超过 2MB'
          : '仅支持 jpg/jpeg/png/gif/webp 格式';
        return res.status(400).json({ error: message });
      }

      if (!req.file) {
        return res.status(400).json({ error: '请选择图片文件' });
      }

      const originalPath = req.file.path;
      // 统一输出为 .jpg（前端已保证 JPEG 格式，后端做兜底重命名）
      const ext = path.extname(req.file.originalname).toLowerCase();
      const jpgExts = new Set(['.jpg', '.jpeg']);
      const outputFilename = jpgExts.has(ext)
        ? path.basename(req.file.filename)
        : req.file.filename.replace(ext, '.jpg');
      const outputPath = path.join(AVATAR_DIR, outputFilename);

      // 如果需要重命名
      if (outputPath !== originalPath) {
        fs.renameSync(originalPath, outputPath);
      }

      const avatarUrl = `/uploads/avatars/${outputFilename}`;

      try {
        // 删除旧头像文件（如果有的话）
        const user = db.get('SELECT avatar_url FROM users WHERE id = ?', [req.user.userId]);
        if (user?.avatar_url && user.avatar_url.startsWith('/uploads/avatars/')) {
          const oldPath = path.join(__dirname, '..', '..', user.avatar_url);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }

        db.run('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, req.user.userId]);
        db.save();

        res.json({ avatar_url: avatarUrl, message: '头像已更新' });
      } catch (err) {
        // 清理残留文件
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        console.error('Avatar save error:', err);
        res.status(500).json({ error: '头像保存失败，请重试' });
      }
    });
  });
}

module.exports = registerAccountRoutes;
