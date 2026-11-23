const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

class Database {
  constructor(sqlDb, filePath) {
    this.db = sqlDb;
    this.filePath = filePath;
  }

  run(sql, params = []) {
    this.db.run(sql, params);
    const id = this.db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0][0];
    const changes = this.db.getRowsModified();
    return { lastInsertRowid: id, changes };
  }

  get(sql, params = []) {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      return stmt.step() ? stmt.getAsObject() : undefined;
    } finally {
      stmt.free();
    }
  }

  all(sql, params = []) {
    const results = this.db.exec(sql, params);
    if (results.length === 0) return [];
    return results[0].values.map(row => {
      const obj = {};
      results[0].columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
  }

  save() {
    const data = this.db.export();
    fs.writeFileSync(this.filePath, Buffer.from(data));
  }
}

async function openDatabase(filePath) {
  const SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file)
  });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const sqlDb = fs.existsSync(filePath)
    ? new SQL.Database(fs.readFileSync(filePath))
    : new SQL.Database();
  return new Database(sqlDb, filePath);
}

module.exports = openDatabase;
