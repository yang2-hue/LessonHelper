require('dotenv').config();
const fs = require('fs');
const path = require('path');
const createApp = require('./app');
const openDatabase = require('./db/database');
const initializeSchema = require('./db/schema');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'db', 'eduspace.db');

async function start() {
  const db = await openDatabase(DB_PATH);
  fs.mkdirSync(path.join(__dirname, 'uploads', 'materials'), { recursive: true });
  fs.mkdirSync(path.join(__dirname, 'uploads', 'comment-images'), { recursive: true });

  initializeSchema(db);
  db.save();

  const app = createApp(db);
  function saveAndExit() {
    db.save();
    process.exit();
  }
  process.on('SIGINT', saveAndExit);
  process.on('SIGTERM', saveAndExit);

  app.listen(PORT, () => {
    console.log(`课搭子 server running at http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
