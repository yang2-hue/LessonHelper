function seedEchoCave(db) {
  // Seed: 开发者自建回声洞语录（仅首次插入）
  const echoSeeds = [
    '世界上最遥远的距离，不是生与死，而是你在写作业，我在写另一个作业。',
    '今天也是被DDL追着跑的一天呢。',
    '学习不是为了考试，是为了在考试的时候不那么慌。',
    '你以为的大学：自由、浪漫、探索。实际的大学：签到、作业、绩点。',
    '不要害怕慢，你只是在蓄力。乌龟赢了兔子，你忘了？',
    '今天不想学习？没关系，明天也不会想的。但还是得学。',
    '人生就像一场考试，你永远不知道下一题会考什么。',
    '如果学习让你感到痛苦，说明你正在走上坡路。',
    '每个学霸背后，都有一个默默崩溃然后又默默振作的自己。',
    '你有多努力，就有多幸运。这不是鸡汤，是概率。',
    '休息是为了走更长的路，不是为了让路变短。',
    '成功不是终点，失败也不是末日，重要的是继续前进的勇气。',
    '代码跑通了就是对程序员最好的赞美。',
    '生活不止眼前的bug，还有远方的bug。',
    '你以为你在摸鱼，其实鱼也在摸你。',
    '没有什么是一杯奶茶解决不了的，如果有，那就两杯。',
    '做一个温柔的人，但不要做一个好欺负的人。',
    '这个世界需要你去改变，哪怕只是一点点。',
    '当你在凝视深渊的时候，深渊也在凝视你的ddl。',
    '别看了，快去学习。这条回声来自一个小时前的你。'
  ];
  for (const seed of echoSeeds) {
    db.run('INSERT OR IGNORE INTO echo_cave_quotes (content, source) VALUES (?, ?)', [seed, 'system']);
  }
}

function seedCardTemplates(db) {
  // 预置官方模板数据
  const templates = [
    {
      id: 'book_sale',       styles: { bg: '#FDF6E8', accent: '#E8A838' },
      name: '二手书',        description: '出二手教材/书籍',    icon: 'ri-book-2-line',         category: 'trade',
      components_schema: JSON.stringify([
        { type: 'input', icon: 'ri-book-2-line', label: '书名', value: '' },
        { type: 'price', icon: 'ri-money-cny-circle-line', label: '价格', value: '' },
        { type: 'contact', icon: 'ri-wechat-line', label: '联系方式', value: '' },
        { type: 'link', icon: 'ri-links-line', label: '链接', value: '' },
        { type: 'input', icon: 'ri-chat-check-line', label: '可议价', value: '' }
      ])
    },
    {
      id: 'study_invite',    styles: { bg: '#EBF3FC', accent: '#4A90D9' },
      name: '自习邀约',      description: '组队自习',            icon: 'ri-book-open-line',      category: 'study',
      components_schema: JSON.stringify([
        { type: 'input', icon: 'ri-calendar-line', label: '时间', value: '' },
        { type: 'input', icon: 'ri-map-pin-line', label: '地点', value: '' },
        { type: 'input', icon: 'ri-file-text-line', label: '要求', value: '' },
        { type: 'days_matter', icon: 'ri-calendar-event-line', label: '倒数日', value: '' }
      ])
    },
    {
      id: 'social_buddy',    styles: { bg: '#F3EFFE', accent: '#7B61FF' },
      name: '找搭子',        description: '通用交友/搭伴',      icon: 'ri-team-line',           category: 'social',
      components_schema: JSON.stringify([
        { type: 'input', icon: 'ri-user-line', label: '简介', value: '' },
        { type: 'input', icon: 'ri-focus-3-line', label: '目标', value: '' },
        { type: 'contact', icon: 'ri-wechat-line', label: '联系方式', value: '' }
      ])
    },
    {
      id: 'project_team',    styles: { bg: '#E8F8EF', accent: '#2EAD6B' },
      name: '项目组队',      description: '课程项目/竞赛组队',  icon: 'ri-group-line',          category: 'project',
      components_schema: JSON.stringify([
        { type: 'input', icon: 'ri-lightbulb-line', label: '项目描述', value: '' },
        { type: 'input', icon: 'ri-user-add-line', label: '需要人数', value: '' },
        { type: 'input', icon: 'ri-tools-line', label: '技能要求', value: '' },
        { type: 'days_matter', icon: 'ri-calendar-event-line', label: '截止日期', value: '' }
      ])
    },
    {
      id: 'event_buddy',     styles: { bg: '#FDEEF1', accent: '#E85D75' },
      name: '活动搭子',      description: '演唱会/运动/聚餐等', icon: 'ri-calendar-event-line', category: 'social',
      components_schema: JSON.stringify([
        { type: 'input', icon: 'ri-music-line', label: '活动', value: '' },
        { type: 'input', icon: 'ri-calendar-line', label: '时间', value: '' },
        { type: 'input', icon: 'ri-map-pin-line', label: '地点', value: '' },
        { type: 'price', icon: 'ri-money-cny-circle-line', label: '费用', value: '' }
      ])
    },
    {
      id: 'skill_exchange',  styles: { bg: '#FEF6E7', accent: '#F59E0B' },
      name: '技能交换',      description: '互教互学',            icon: 'ri-exchange-line',       category: 'study',
      components_schema: JSON.stringify([
        { type: 'input', icon: 'ri-book-2-line', label: '我会的', value: '' },
        { type: 'input', icon: 'ri-focus-3-line', label: '想学的', value: '' },
        { type: 'contact', icon: 'ri-wechat-line', label: '联系方式', value: '' }
      ])
    },
    {
      id: 'study_group',     styles: { bg: '#EBF3FC', accent: '#3B82F6' },
      name: '学习小组',      description: '长期学习小组',        icon: 'ri-book-open-line',      category: 'study',
      components_schema: JSON.stringify([
        { type: 'input', icon: 'ri-book-2-line', label: '学习内容', value: '' },
        { type: 'input', icon: 'ri-calendar-line', label: '计划时间', value: '' },
        { type: 'input', icon: 'ri-map-pin-line', label: '地点', value: '' },
        { type: 'input', icon: 'ri-file-text-line', label: '要求', value: '' }
      ])
    }
  ];

  for (const t of templates) {
    db.run(
      `INSERT OR IGNORE INTO card_templates (id, name, description, icon, category, components_schema, is_official, styles)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [t.id, t.name, t.description, t.icon, t.category, t.components_schema, JSON.stringify(t.styles)]
    );
    // Update existing official rows that were seeded before styles column existed
    db.run(
      `UPDATE card_templates SET styles = ? WHERE id = ? AND is_official = 1 AND (styles IS NULL OR styles = '{}')`,
      [JSON.stringify(t.styles), t.id]
    );
  }
}

module.exports = { seedEchoCave, seedCardTemplates };
