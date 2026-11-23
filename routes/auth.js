const express = require('express');
const bcrypt = require('bcryptjs');
const { generateToken } = require('./middleware/auth');
const { sendVerificationCode } = require('./middleware/email');
const registerAccountRoutes = require('./auth/account');

const SALT_ROUNDS = 10;
const CODE_EXPIRY_MINUTES = 5;
const MAX_VERIFY_ATTEMPTS = 3;

// Turnstile Secret Key — 从环境变量读取；详见 .env 中的测试/正式密钥说明
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '';

// 简单内存限流（生产环境建议用 Redis）
const rateLimitMap = new Map();

module.exports = function (db) {
  const router = express.Router();

  // ========== 工具函数 ==========

  // 学号格式验证（3种正则）
  function validateStudentId(studentId) {
    if (!studentId) return false;
    // 本科：9位纯数字
    if (/^\d{9}$/.test(studentId)) return true;
    // 研究生（2022+）：12位纯数字
    if (/^\d{12}$/.test(studentId)) return true;
    // 研究生（2021-）：MG/MF/BH开头 + 8位数字
    if (/^(MG|MF|BH)\d{8}$/.test(studentId)) return true;
    return false;
  }

  // 密码规范验证（30位以内，仅大小写字母和数字）
  function validatePassword(password) {
    if (!password || password.length < 8 || password.length > 30) return false;
    if (!/^[a-zA-Z0-9]+$/.test(password)) return false;
    // 必须包含大小写字母和数字
    return /[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password);
  }

  // 生成6位数字验证码
  function generateCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  function isExpiredDate(value) {
    if (!value) return true;
    const text = String(value);
    const normalized = text.includes('T') ? text : `${text.replace(' ', 'T')}Z`;
    const timestamp = Date.parse(normalized);
    if (Number.isNaN(timestamp)) return true;
    return timestamp < Date.now();
  }

  // 生成默认昵称
  function generateNickname(studentId) {
    if (/^\d{9,12}$/.test(studentId)) {
      return `同学_${studentId.slice(0, 4)}`;
    }
    // 字母开头：同学_MG2021 等
    const match = studentId.match(/^([A-Z]{2})(\d{4})/);
    if (match) {
      return `同学_${match[1]}${match[2]}`;
    }
    return `同学_${studentId.slice(0, 6)}`;
  }

  // 限流检查（60秒冷却 + 每天最多5次）
  function checkRateLimit(email) {
    const now = Date.now();
    const key = `rate_${email}`;

    if (!rateLimitMap.has(key)) {
      rateLimitMap.set(key, { lastSent: 0, dailyCount: 0, dailyDate: '' });
    }

    const record = rateLimitMap.get(key);
    const today = new Date().toISOString().slice(0, 10);

    // 重置每日计数
    if (record.dailyDate !== today) {
      record.dailyDate = today;
      record.dailyCount = 0;
    }

    // 60秒冷却检查
    if (now - record.lastSent < 60000) {
      return { ok: false, error: '验证码发送过于频繁，请60秒后重试' };
    }

    // 每天最多5次
    if (record.dailyCount >= 5) {
      return { ok: false, error: '今日验证码发送次数已达上限，请明天再试' };
    }

    return { ok: true, record };
  }

  // 更新限流记录
  function updateRateLimit(email) {
    const key = `rate_${email}`;
    const record = rateLimitMap.get(key);
    if (record) {
      record.lastSent = Date.now();
      record.dailyCount += 1;
    }
  }

  // 清理过期验证码
  function cleanExpiredVerifications() {
    try {
      db.run("DELETE FROM email_verifications WHERE expires_at < datetime('now')");
      db.save();
    } catch (e) {
      console.error('[Auth] 清理过期验证码失败:', e.message);
    }
  }

  // Cloudflare Turnstile 验证
  async function verifyTurnstile(token, ip) {
    // 如果 Secret Key 未配置（环境变量未设置），返回失败
    if (!TURNSTILE_SECRET_KEY) {
      console.error('[Auth] Turnstile Secret Key 未配置');
      return { ok: false, error: '系统出现未知错误，请在看到此消息后及时反馈' };
    }

    // 测试密钥：跳过 Cloudflare API 调用，直接放行（便于本地开发）
    if (TURNSTILE_SECRET_KEY === '1x0000000000000000000000000000000AA') {
      console.log('[Auth] Turnstile 测试密钥，跳过云端验证');
      return { ok: true };
    }


    try {
      const formData = new URLSearchParams();
      formData.append('secret', TURNSTILE_SECRET_KEY);
      formData.append('response', token);
      if (ip) formData.append('remoteip', ip);

      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!data.success) {
        console.error('[Auth] Turnstile 验证失败:', JSON.stringify(data));
        return { ok: false, error: '系统出现未知错误，请在看到此消息后及时反馈' };
      }

      return { ok: true };
    } catch (e) {
      console.error('[Auth] Turnstile 请求异常:', e.message);
      return { ok: false, error: '系统出现未知错误，请在看到此消息后及时反馈' };
    }
  }

  // 获取客户端 IP
  function getClientIp(req) {
    return req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || '';
  }

  // ========== API 路由 ==========

  // POST /api/auth/register — 注册（发送验证码）
  router.post('/register', async (req, res) => {
    try {
      const { studentId, password, confirmPassword, turnstileToken, honeypot } = req.body;

      // 蜜罐检测：如果被填了，伪造成功响应
      if (honeypot) {
        return res.json({ message: '验证码已发送' });
      }

      // 参数校验
      if (!studentId || !password || !confirmPassword) {
        return res.status(400).json({ error: '请填写完整信息' });
      }

      // 学号格式验证
      if (!validateStudentId(studentId)) {
        return res.status(400).json({ error: '学号格式不正确' });
      }

      // 密码规范验证
      if (!validatePassword(password)) {
        return res.status(400).json({ error: '密码须为1-30位，仅包含大小写字母和数字' });
      }

      // 确认密码一致性
      if (password !== confirmPassword) {
        return res.status(400).json({ error: '两次输入的密码不一致' });
      }

      // 拼接邮箱
      const email = `${studentId}@smail.nju.edu.cn`;

      // 查重拦截
      const existingUser = db.get('SELECT id FROM users WHERE email = ?', [email]);
      if (existingUser) {
        return res.status(409).json({ error: '该学号已注册，请直接登录' });
      }

      // Turnstile 验证
      if (!turnstileToken) {
        return res.status(400).json({ error: '系统出现未知错误，请在看到此消息后及时反馈' });
      }

      const clientIp = getClientIp(req);
      const turnstileResult = await verifyTurnstile(turnstileToken, clientIp);
      if (!turnstileResult.ok) {
        return res.status(403).json({ error: turnstileResult.error });
      }

      // 测试密钥：跳过邮件验证码，直接创建用户并返回 token
      if (TURNSTILE_SECRET_KEY === '1x0000000000000000000000000000000AA') {
        const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
        const nickname = generateNickname(studentId);
        const username = email;

        db.run(
          `INSERT INTO users (username, display_name, email, password_hash, nickname, email_verified)
           VALUES (?, ?, ?, ?, ?, 1)`,
          [username, nickname, email, passwordHash, nickname]
        );
        db.save();

        const newUser = db.get('SELECT * FROM users WHERE email = ?', [email]);
        const token = generateToken(newUser);
        const { password_hash, ...safeUser } = newUser;

        console.log(`[Auth] 测试密钥注册成功（跳过邮件验证）: ${email}`);
        return res.status(201).json({ token, user: safeUser });
      }


      // 限流检查
      const rateLimitResult = checkRateLimit(email);
      if (!rateLimitResult.ok) {
        return res.status(429).json({ error: rateLimitResult.error });
      }

      // 生成验证码
      const code = generateCode();
      const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000).toISOString();

      // 写入验证码表（UPSERT）
      db.run(
        `INSERT INTO email_verifications (email, code, attempts, expires_at)
         VALUES (?, ?, 0, ?)
         ON CONFLICT(email) DO UPDATE SET code = ?, attempts = 0, expires_at = ?, created_at = CURRENT_TIMESTAMP`,
        [email, code, expiresAt, code, expiresAt]
      );
      db.save();

      // 更新限流记录
      updateRateLimit(email);

      // 异步清理过期验证码
      cleanExpiredVerifications();

      // 发送邮件
      const sendResult = await sendVerificationCode(email, code);
      if (!sendResult.success) {
        return res.status(500).json({ error: '系统出现未知错误，请在看到此消息后及时反馈' });
      }

      console.log(`[Auth] 注册验证码已发送: ${email}`);
      res.status(201).json({ message: '验证码已发送至你的学号邮箱' });

    } catch (e) {
      console.error('[Auth] 注册失败:', e);
      res.status(500).json({ error: '系统出现未知错误，请在看到此消息后及时反馈' });
    }
  });

  // POST /api/auth/verify-email — 验证邮箱（完成注册）
  router.post('/verify-email', async (req, res) => {
    try {
      const { studentId, code, password } = req.body;

      if (!studentId || !code || !password) {
        return res.status(400).json({ error: '请填写完整信息' });
      }

      const email = `${studentId}@smail.nju.edu.cn`;

      // 查询验证码记录
      const record = db.get('SELECT * FROM email_verifications WHERE email = ?', [email]);

      if (!record) {
        return res.status(400).json({ error: '验证码已过期，请重新获取' });
      }

      // 检查过期
      if (new Date(record.expires_at) < new Date()) {
        db.run('DELETE FROM email_verifications WHERE email = ?', [email]);
        db.save();
        return res.status(400).json({ error: '验证码已过期，请重新获取' });
      }

      // 检查错误次数（3次销毁）
      if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
        db.run('DELETE FROM email_verifications WHERE email = ?', [email]);
        db.save();
        return res.status(400).json({ error: '验证码输入错误次数过多，请重新获取' });
      }

      // 验证码比对
      if (record.code !== code) {
        // 增加错误计数
        db.run('UPDATE email_verifications SET attempts = attempts + 1 WHERE email = ?', [email]);
        db.save();

        const remaining = MAX_VERIFY_ATTEMPTS - record.attempts - 1;
        if (remaining <= 0) {
          db.run('DELETE FROM email_verifications WHERE email = ?', [email]);
          db.save();
          return res.status(400).json({ error: '验证码输入错误次数过多，请重新获取' });
        }
        return res.status(400).json({ error: `验证码错误，还可尝试${remaining}次` });
      }

      // 验证码正确，创建用户
      const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
      const nickname = generateNickname(studentId);
      const username = email; // username = 邮箱

      db.run(
        `INSERT INTO users (username, display_name, email, password_hash, nickname, email_verified)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [username, nickname, email, passwordHash, nickname]
      );
      db.save();

      // 删除验证码记录
      db.run('DELETE FROM email_verifications WHERE email = ?', [email]);
      db.save();

      // 查询新用户
      const newUser = db.get('SELECT * FROM users WHERE email = ?', [email]);
      const token = generateToken(newUser);
      const { password_hash, ...safeUser } = newUser;

      console.log(`[Auth] 注册成功: ${email}`);
      res.json({ token, user: safeUser });

    } catch (e) {
      console.error('[Auth] 验证失败:', e);
      res.status(500).json({ error: '系统出现未知错误，请在看到此消息后及时反馈' });
    }
  });

  // POST /api/auth/login — 登录
  router.post('/login', async (req, res) => {
    try {
      const { studentId, password, turnstileToken } = req.body;

      // Turnstile 人机验证
      if (!turnstileToken) {
        return res.status(400).json({ error: '人机验证未完成' });
      }
      const clientIp = getClientIp(req);
      const turnstileResult = await verifyTurnstile(turnstileToken, clientIp);
      if (!turnstileResult.ok) {
        return res.status(403).json({ error: turnstileResult.error });
      }

      if (!studentId || !password) {
        return res.status(400).json({ error: '请填写完整信息' });
      }

      // 学号格式验证
      if (!validateStudentId(studentId)) {
        return res.status(400).json({ error: '学号格式不正确' });
      }

      // 密码规范验证
      if (!validatePassword(password)) {
        return res.status(400).json({ error: '密码格式不正确' });
      }

      const email = `${studentId}@smail.nju.edu.cn`;
      const user = db.get('SELECT * FROM users WHERE email = ?', [email]);

      // 模糊错误消息：不暴露账号是否存在
      if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).json({ error: '账号或密码错误' });
      }

      const token = generateToken(user);
      const { password_hash, ...safeUser } = user;

      console.log(`[Auth] 登录成功: ${email}`);
      res.json({ token, user: safeUser });

    } catch (e) {
      console.error('[Auth] 登录失败:', e);
      res.status(500).json({ error: '系统出现未知错误，请在看到此消息后及时反馈' });
    }
  });

  // POST /api/auth/resend-code — 重新发送验证码
  router.post('/forgot-password', async (req, res) => {
    try {
      const { studentId, turnstileToken } = req.body;
      if (!studentId) return res.status(400).json({ error: '请填写学号' });
      if (!validateStudentId(studentId)) return res.status(400).json({ error: '学号格式不正确' });

      const email = `${studentId}@smail.nju.edu.cn`;
      const user = db.get('SELECT id FROM users WHERE email = ?', [email]);
      if (!user) return res.status(404).json({ error: '该学号尚未注册' });

      // Turnstile 验证
      if (!turnstileToken) {
        return res.status(400).json({ error: '系统出现未知错误，请在看到此消息后及时反馈' });
      }

      const clientIp = getClientIp(req);
      const turnstileResult = await verifyTurnstile(turnstileToken, clientIp);
      if (!turnstileResult.ok) {
        return res.status(403).json({ error: turnstileResult.error });
      }

      const rateLimitResult = checkRateLimit(email);
      if (!rateLimitResult.ok) return res.status(429).json({ error: rateLimitResult.error });

      const code = generateCode();
      const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000).toISOString();
      db.run(
        `INSERT INTO email_verifications (email, code, attempts, expires_at)
         VALUES (?, ?, 0, ?)
         ON CONFLICT(email) DO UPDATE SET code = ?, attempts = 0, expires_at = ?, created_at = CURRENT_TIMESTAMP`,
        [email, code, expiresAt, code, expiresAt]
      );
      db.save();
      updateRateLimit(email);
      cleanExpiredVerifications();

      if (process.env.NODE_ENV !== 'test') {
        const sendResult = await sendVerificationCode(email, code);
        if (!sendResult.success) {
          return res.status(500).json({ error: '系统出现未知错误，请在看到此消息后及时反馈' });
        }
      }

      res.json({ message: '验证码已发送至你的学号邮箱' });
    } catch (e) {
      console.error('[Auth] forgot password failed:', e);
      res.status(500).json({ error: '系统出现未知错误，请在看到此消息后及时反馈' });
    }
  });

  router.post('/reset-password', async (req, res) => {
    try {
      const { studentId, code, password, confirmPassword } = req.body;
      if (!studentId || !code || !password || !confirmPassword) {
        return res.status(400).json({ error: '请填写完整信息' });
      }
      if (!validateStudentId(studentId)) return res.status(400).json({ error: '学号格式不正确' });
      if (!validatePassword(password)) {
        return res.status(400).json({ error: '密码须为8-30位，且包含大小写字母和数字' });
      }
      if (password !== confirmPassword) return res.status(400).json({ error: '两次输入的密码不一致' });

      const email = `${studentId}@smail.nju.edu.cn`;
      const user = db.get('SELECT id FROM users WHERE email = ?', [email]);
      if (!user) return res.status(404).json({ error: '该学号尚未注册' });

      const record = db.get('SELECT * FROM email_verifications WHERE email = ?', [email]);
      if (!record) return res.status(400).json({ error: '验证码已过期，请重新获取' });
      if (isExpiredDate(record.expires_at)) {
        db.run('DELETE FROM email_verifications WHERE email = ?', [email]);
        db.save();
        return res.status(400).json({ error: '验证码已过期，请重新获取' });
      }
      if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
        db.run('DELETE FROM email_verifications WHERE email = ?', [email]);
        db.save();
        return res.status(400).json({ error: '验证码输入错误次数过多，请重新获取' });
      }
      if (record.code !== code) {
        db.run('UPDATE email_verifications SET attempts = attempts + 1 WHERE email = ?', [email]);
        db.save();
        const remaining = MAX_VERIFY_ATTEMPTS - record.attempts - 1;
        if (remaining <= 0) {
          db.run('DELETE FROM email_verifications WHERE email = ?', [email]);
          db.save();
          return res.status(400).json({ error: '验证码输入错误次数过多，请重新获取' });
        }
        return res.status(400).json({ error: `验证码错误，还可尝试${remaining}次` });
      }

      const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
      db.run('UPDATE users SET password_hash = ? WHERE email = ?', [passwordHash, email]);
      db.run('DELETE FROM email_verifications WHERE email = ?', [email]);
      db.save();
      res.json({ message: '密码已重置，请使用新密码登录' });
    } catch (e) {
      console.error('[Auth] reset password failed:', e);
      res.status(500).json({ error: '系统出现未知错误，请在看到此消息后及时反馈' });
    }
  });

  router.post('/resend-code', async (req, res) => {
    try {
      const { studentId } = req.body;

      if (!studentId) {
        return res.status(400).json({ error: '请填写学号' });
      }

      if (!validateStudentId(studentId)) {
        return res.status(400).json({ error: '学号格式不正确' });
      }

      const email = `${studentId}@smail.nju.edu.cn`;

      // 检查是否已有验证码记录
      const existing = db.get('SELECT * FROM email_verifications WHERE email = ?', [email]);
      if (!existing) {
        return res.status(400).json({ error: '请先获取验证码' });
      }

      // 限流检查
      const rateLimitResult = checkRateLimit(email);
      if (!rateLimitResult.ok) {
        return res.status(429).json({ error: rateLimitResult.error });
      }

      // 生成新验证码
      const code = generateCode();
      const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000).toISOString();

      db.run(
        'UPDATE email_verifications SET code = ?, attempts = 0, expires_at = ? WHERE email = ?',
        [code, expiresAt, email]
      );
      db.save();

      // 更新限流记录
      updateRateLimit(email);

      // 发送邮件
      const sendResult = await sendVerificationCode(email, code);
      if (!sendResult.success) {
        return res.status(500).json({ error: '系统出现未知错误，请在看到此消息后及时反馈' });
      }

      console.log(`[Auth] 验证码已重新发送: ${email}`);
      res.json({ message: '验证码已重新发送' });

    } catch (e) {
      console.error('[Auth] 重发失败:', e);
      res.status(500).json({ error: '系统出现未知错误，请在看到此消息后及时反馈' });
    }
  });

  registerAccountRoutes(router, db);

  return router;
};
