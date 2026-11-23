const express = require('express');
const helmet = require('helmet');
const path = require('path');

function createApp(db) {
  const app = express();
  // --- Middleware ---
  // 仅保留必要安全头：COOP + CORP + X-Content-Type + X-Frame + STS + Referrer-Policy
  // 禁用 CSP（与 CDN 资源冲突）、禁用 X-Permitted-Cross-Domain（无 Adobe 需求）
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      xDnsPrefetchControl: false,
      xPermittedCrossDomainPolicies: false,
    })
  );
  app.use(express.json({ limit: '10mb' }));
  // 环境变量注入：将 .env 中前端需要公开的 Key 注入为全局变量
  app.get('/env.js', (req, res) => {
    res.type('application/javascript');
    res.send(`window.ENV = {
  TURNSTILE_SITE_KEY: '${process.env.TURNSTILE_SITE_KEY || ''}'
};`);
  });
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
  app.use('/data', express.static(path.join(__dirname, 'data')));

  const coursesRouter = require('./routes/courses')(db);
  const userRouter = require('./routes/user')(db);
  const scheduleRouter = require('./routes/schedule')(db);
  const authRouter = require('./routes/auth')(db);
  const materialsRouter = require('./routes/materials')(db);
  const invitesRouter = require('./routes/invites')(db);
  const notificationsRouter = require('./routes/notifications')(db);
  const searchRouter = require('./routes/search')(db);
  const squareRouter = require('./routes/square')(db);
  const myPostsRouter = require('./routes/my_posts')(db);
  const favoritesRouter = require('./routes/favorites')(db);
  const explorePostsRouter = require('./routes/explore_posts')(db);
  const exploreCardsRouter = require('./routes/explore_cards')(db);
  const cardTemplatesRouter = require('./routes/card_templates')(db);
  const exploreCommentsRouter = require('./routes/explore_comments')(db);
  const echoCaveRouter = require('./routes/echo_cave')(db);

  app.use('/api/courses', coursesRouter);
  app.use('/api/materials', materialsRouter);
  app.use('/api/invites', invitesRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/square', squareRouter);
  app.use('/api/user', userRouter);
  app.use('/api/schedule', scheduleRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/my-posts', myPostsRouter);
  app.use('/api/favorites', favoritesRouter);
  app.use('/api/explore/posts', explorePostsRouter);
  app.use('/api/explore/cards', exploreCardsRouter);
  app.use('/api/card-templates', cardTemplatesRouter);
  app.use('/api/explore/posts', exploreCommentsRouter); // comments nested under posts
  app.use('/api/echo-cave', echoCaveRouter);

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}

module.exports = createApp;
