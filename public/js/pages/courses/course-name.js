export function cleanBigCourseName(title) {
  if (!title) return '';
  const parens = title.match(/[（(].+?[)）]/g) || [];
  let temp = title;
  parens.forEach((p, i) => { temp = temp.replace(p, `__PH${i}__`); });
  // 清除末尾班级号：支持 "07班"、"25班"、孤立数字 "25"、带空格 " 25"
  temp = temp.replace(/\d{1,3}\s*班\s*$/, '');
  temp = temp.replace(/[\s ]*\d{1,3}\s*$/, '');
  temp = temp.replace(/\d{1,3}$/, '');
  parens.forEach((p, i) => { temp = temp.replace(`__PH${i}__`, p); });
  return temp.trim();
}
