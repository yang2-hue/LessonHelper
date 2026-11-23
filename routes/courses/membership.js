const { createNotification } = require('../notifications');

function isEnrolledInBigCourse(db, userId, bigCourseId) {
  // 检查是否直接选了这门大课，或选了其下的任意小课
  return !!db.get(
    `SELECT 1 FROM user_courses uc
     JOIN courses c ON uc.course_id = c.id
     WHERE uc.user_id = ? AND (c.id = ? OR c.big_course_id = ?)`,
    [userId, bigCourseId, bigCourseId]
  );
}

function getSmallCourseIds(db, bigCourseId) {
  return db.all('SELECT id FROM courses WHERE big_course_id = ?', [bigCourseId]).map(r => r.id);
}

function notifyBigCourseMembers(db, bigCourseId, excludeUserId, type, title, message, relatedType, relatedId) {
  const smallIds = getSmallCourseIds(db, bigCourseId);
  if (smallIds.length === 0) return;
  const placeholders = smallIds.map(() => '?').join(',');
  const members = db.all(
    `SELECT DISTINCT user_id FROM user_courses WHERE course_id IN (${placeholders}) AND user_id != ?`,
    [...smallIds, excludeUserId]
  );
  for (const m of members) {
    createNotification(db, {
      userId: m.user_id, type, title, message, relatedType, relatedId, courseId: bigCourseId
    });
  }
}

module.exports = { isEnrolledInBigCourse, notifyBigCourseMembers };
