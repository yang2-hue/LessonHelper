const express = require('express');
const registerCatalog = require('./courses/catalog');
const registerForum = require('./courses/forum');
const registerSquare = require('./courses/square');

module.exports = function createCoursesRouter(db) {
  const router = express.Router();
  registerCatalog(router, db);
  registerForum(router, db);
  registerSquare(router, db);
  return router;
};
