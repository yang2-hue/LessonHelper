const cleanBigCourseName = require('../lib/course-name');

function migrateBigCourses(db) {
  // 检查是否有小课尚未关联大课
  const unlinked = db.all('SELECT id, title, owner_id FROM courses WHERE big_course_id IS NULL AND description != ""');
  if (unlinked.length > 0) {
    console.log(`  ✓ 大课迁移: 发现 ${unlinked.length} 门小课需要关联大课`);

    // 按大课名分组
    const bigCourseMap = new Map();

    for (const small of unlinked) {
      const bigName = cleanBigCourseName(small.title);
      if (!bigName || bigName === small.title) {
        // 无法提取大课名（没有班号），自身即为大课
        continue;
      }
      if (!bigCourseMap.has(bigName)) {
        bigCourseMap.set(bigName, { ownerId: small.owner_id, bigCourseId: null, smallCourseIds: [] });
      }
      bigCourseMap.get(bigName).smallCourseIds.push(small.id);
    }

    // 为每个大课名查找或创建大课记录
    for (const [bigName, info] of bigCourseMap) {
      let big = db.get('SELECT id FROM courses WHERE title = ? AND big_course_id IS NULL AND description = ""', [bigName]);
      if (!big) {
        db.run('INSERT INTO courses (title, description, owner_id, teacher) VALUES (?, "", ?, "")', [bigName, info.ownerId]);
        big = db.get('SELECT id FROM courses WHERE title = ? AND big_course_id IS NULL AND description = ""', [bigName]);
        console.log(`    + 创建大课: ${bigName} (id=${big.id})`);
      }
      info.bigCourseId = big.id;

      // 更新小课的 big_course_id
      for (const smallId of info.smallCourseIds) {
        db.run('UPDATE courses SET big_course_id = ? WHERE id = ?', [info.bigCourseId, smallId]);
      }
    }

    // 迁移 posts/materials/square_posts 的 course_id 到大课
    let migratedPosts = 0, migratedMaterials = 0, migratedSquare = 0;
    for (const info of bigCourseMap.values()) {
      const placeholders = info.smallCourseIds.map(() => '?').join(',');
      const r1 = db.run(`UPDATE posts SET course_id = ? WHERE course_id IN (${placeholders})`, [info.bigCourseId, ...info.smallCourseIds]);
      migratedPosts += r1.changes || 0;
      const r2 = db.run(`UPDATE materials SET course_id = ? WHERE course_id IN (${placeholders})`, [info.bigCourseId, ...info.smallCourseIds]);
      migratedMaterials += r2.changes || 0;
      const r3 = db.run(`UPDATE square_posts SET course_id = ? WHERE course_id IN (${placeholders})`, [info.bigCourseId, ...info.smallCourseIds]);
      migratedSquare += r3.changes || 0;
    }

    console.log(`  ✓ 大课迁移完成: ${bigCourseMap.size} 个大课, 帖子 ${migratedPosts}, 资料 ${migratedMaterials}, 搭子 ${migratedSquare}`);
  }
}

module.exports = migrateBigCourses;
