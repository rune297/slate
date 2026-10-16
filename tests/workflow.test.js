const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const workflow = require('../renderer/workflow');

const wednesday = new Date(2026, 9, 14, 10, 30);
const iso = (day, hour = 10) => new Date(2026, 9, day, hour).toISOString();
const task = (id, fields = {}) => ({ id, text: id, done: false, deadline: '', createdAt: 1, ...fields });

test('the dependency-free module works in the browser as well as Node', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer/workflow.js'), 'utf8'), context);
  assert.equal(typeof context.SlateWorkflow.makeReview, 'function');
  assert.equal(context.SlateWorkflow.dateKey(wednesday.getTime()), '2026-10-14');
});

test('local date keys do not drift into the previous UTC day', () => {
  const localMidnight = new Date(2026, 0, 1, 0, 5);
  assert.equal(workflow.dateKey(localMidnight), '2026-01-01');
  assert.equal(workflow.dateKey(new Date(NaN)), '');
});

test('existing pinned tasks migrate once and stop being focus tasks the following day', () => {
  const old = task('legacy', { pinnedToday: true, customData: { project: '示例' } });
  const normalized = workflow.normalizeTodo(old, wednesday);
  assert.equal(normalized.focusDate, '2026-10-14');
  assert.equal(normalized.pinnedToday, true);
  assert.equal(normalized.customData, old.customData);
  assert.equal(old.focusDate, undefined);
  const tomorrow = new Date(2026, 9, 15, 9);
  const loadedTomorrow = workflow.normalizeTodo(normalized, tomorrow);
  assert.equal(loadedTomorrow.focusDate, '2026-10-14');
  assert.equal(loadedTomorrow.pinnedToday, false);
  assert.equal(workflow.isFocus(loadedTomorrow, tomorrow), false);
});

test('an expired saved focus date is not migrated again even with the old pinned flag', () => {
  const expired = workflow.normalizeTodo(task('old', { pinnedToday: true, focusDate: '2026-10-13' }), wednesday);
  assert.equal(expired.focusDate, '2026-10-13');
  assert.equal(expired.pinnedToday, false);
  assert.equal(workflow.focusTasks([expired], wednesday).length, 0);
});

test('corrupt fields normalize to safe values and calendar dates must really exist', () => {
  const result = workflow.normalizeTodo(task('invalid', {
    status: 'nonsense', followupAt: 'bad date', followupRemindedAt: Infinity,
    focusDate: '2026-02-30', pinnedToday: true, focusOrder: -5,
    done: true, completedAt: -1, estimateMinutes: 99,
  }), wednesday);
  assert.equal(result.status, 'active');
  assert.equal(result.followupAt, '');
  assert.equal(result.followupRemindedAt, 0);
  assert.equal(result.focusDate, '');
  assert.equal(result.focusOrder, 0);
  assert.equal(result.pinnedToday, false);
  assert.equal(result.completedAt, 0);
  assert.equal(result.estimateMinutes, 0);
  assert.equal(workflow.normalizeTodo({ focusDate: '2028-02-29' }, wednesday).focusDate, '2028-02-29');
});

test('follow-up dates remain independent of delivery deadlines and their notification state', () => {
  const deadline = iso(16, 18);
  const original = task('等客户反馈', {
    status: 'waiting', deadline, remindedAt: 123,
    followupAt: iso(14, 15), followupRemindedAt: 456,
  });
  const normalized = workflow.normalizeTodo(original, wednesday);
  assert.equal(normalized.deadline, deadline);
  assert.equal(normalized.remindedAt, 123);
  assert.equal(normalized.followupAt, iso(14, 15));
  assert.equal(normalized.followupRemindedAt, 456);
  const focus = workflow.setFocus(normalized, true, wednesday, 2);
  assert.equal(focus.deadline, deadline);
  assert.equal(focus.followupAt, iso(14, 15));
});

test('focus can be selected and removed without changing the source task', () => {
  const original = Object.freeze(task('重点', { notes: '先做最难的一步' }));
  const selected = workflow.setFocus(original, true, wednesday, 2);
  assert.equal(workflow.isFocus(selected, wednesday), true);
  assert.equal(selected.focusOrder, 2);
  assert.equal(original.focusDate, undefined);
  const removed = workflow.setFocus(selected, false, wednesday);
  assert.equal(removed.focusDate, '');
  assert.equal(removed.pinnedToday, false);
  assert.equal(workflow.normalizeTodo(removed, wednesday).focusDate, '');
});

test('completion records the real event time, repeated completion preserves it, undo clears it', () => {
  const original = workflow.setFocus(task('发布'), true, wednesday);
  const completed = workflow.completeTodo(original, true, wednesday);
  assert.equal(completed.done, true);
  assert.equal(completed.completedAt, wednesday.getTime());
  assert.equal(completed.pinnedToday, false);
  assert.equal(original.done, false);
  const later = new Date(wednesday.getTime() + 60000);
  assert.equal(workflow.completeTodo(completed, true, later).completedAt, wednesday.getTime());
  const undone = workflow.completeTodo(completed, false, later);
  assert.equal(undone.done, false);
  assert.equal(undone.completedAt, 0);
  assert.equal(undone.pinnedToday, true);
});

test('legacy completed tasks do not acquire invented completion times', () => {
  const historical = task('旧成果', { done: true });
  assert.equal(workflow.normalizeTodo(historical, wednesday).completedAt, 0);
  assert.equal(workflow.completeTodo(historical, true, wednesday).completedAt, 0);
});

test('focus tasks sort before deadlines, retain the chosen order, and do not silently drop a fourth item', () => {
  const items = [
    task('overdue', { deadline: iso(12) }),
    ...[3, 1, 0, 2].map(order => workflow.setFocus(task(`focus-${order}`), true, wednesday, order)),
    task('completed-focus', { done: true, focusDate: '2026-10-14', focusOrder: 0 }),
    task('inbox'),
  ];
  const originalIds = items.map(item => item.id);
  assert.deepEqual(workflow.focusTasks(items, wednesday).map(item => item.id), ['focus-0', 'focus-1', 'focus-2', 'focus-3']);
  assert.deepEqual(workflow.sortTasks(items, wednesday).map(item => item.id), ['focus-0', 'focus-1', 'focus-2', 'focus-3', 'overdue', 'inbox', 'completed-focus']);
  assert.deepEqual(items.map(item => item.id), originalIds);
});

test('daily review includes todays focus, deadlines and follow-ups, with overdue tasks still visible', () => {
  const review = workflow.makeReview([
    workflow.setFocus(task('今日重点'), true, wednesday),
    task('今天交付', { deadline: iso(14) }),
    task('逾期待处理', { deadline: iso(11) }),
    task('今天催反馈', { status: 'waiting', followupAt: iso(14, 15), deadline: iso(16) }),
    task('持续跟进客户', { status: 'followup', followupAt: iso(13) }),
    task('明日交付', { deadline: iso(15) }),
    task('收件箱未安排'),
    task('昨天重点未继续', { focusDate: '2026-10-13' }),
  ], 'day', wednesday);
  for (const name of ['今日重点', '今天交付', '逾期待处理', '今天催反馈', '持续跟进客户']) assert.ok(review.includes(name));
  for (const name of ['明日交付', '收件箱未安排', '昨天重点未继续']) assert.ok(!review.includes(name));
  assert.match(review, /## 等待反馈\n\n- \[ \] 今天催反馈/);
  assert.match(review, /## 持续跟进\n\n- \[ \] 持续跟进客户/);
  assert.match(review, /## 阻滞原因与下一步/);
  assert.match(review, /## 次日计划/);
});

test('daily review counts only real completion timestamps inside the local day', () => {
  const start = new Date(2026, 9, 14).getTime();
  const next = new Date(2026, 9, 15).getTime();
  const review = workflow.makeReview([
    task('当天零点完成', { done: true, completedAt: start }),
    task('当天结束完成', { done: true, completedAt: next - 1 }),
    task('前一天完成', { done: true, completedAt: start - 1 }),
    task('第二天完成', { done: true, completedAt: next }),
    task('未知历史成果', { done: true }),
    task('已撤销', { done: false, completedAt: start }),
  ], 'day', wednesday);
  assert.ok(review.includes('当天零点完成'));
  assert.ok(review.includes('当天结束完成'));
  for (const name of ['前一天完成', '第二天完成', '未知历史成果', '已撤销']) assert.ok(!review.includes(name));
  assert.match(review, /另有 1 条已完成事项未记录完成时间，未计入本周期成果/);
});

test('weekly reviews begin on Monday and exclude the following weeks plans and completions', () => {
  const monday = new Date(2026, 9, 12).getTime();
  const nextMonday = new Date(2026, 9, 19).getTime();
  const review = workflow.makeReview([
    task('周一成果', { done: true, completedAt: monday }),
    task('周日成果', { done: true, completedAt: nextMonday - 1 }),
    task('上周成果', { done: true, completedAt: monday - 1 }),
    task('下周成果', { done: true, completedAt: nextMonday }),
    task('周五交付', { deadline: iso(16) }),
    task('周日跟进', { status: 'followup', followupAt: iso(18) }),
    task('周一重点', { focusDate: '2026-10-12' }),
    task('下周交付', { deadline: iso(19) }),
    task('下周跟进', { followupAt: iso(20) }),
    task('下周重点', { focusDate: '2026-10-19' }),
  ], 'week', wednesday);
  assert.match(review, /记录周期：2026-10-12 至 2026-10-18（周一至周日）/);
  for (const name of ['周一成果', '周日成果', '周五交付', '周日跟进', '周一重点']) assert.ok(review.includes(name));
  for (const name of ['上周成果', '下周成果', '下周交付', '下周跟进', '下周重点']) assert.ok(!review.includes(name));
  assert.match(review, /## 下周计划/);
  const sundayReview = workflow.makeReview([], 'week', new Date(2026, 9, 18));
  assert.match(sundayReview, /2026-10-12 至 2026-10-18/);
});

test('Chinese and emoji survive normalization and notes never end in a broken surrogate', () => {
  const original = task('沟通方案 👩‍💻', { notes: '确认阻滞：客户反馈未到 ✅', estimateMinutes: 45 });
  const normalized = workflow.normalizeTodo(original, wednesday);
  assert.equal(normalized.text, original.text);
  assert.equal(normalized.notes, original.notes);
  assert.equal(normalized.estimateMinutes, 45);
  const clipped = workflow.normalizeTodo({ notes: `${'字'.repeat(5999)}😀` });
  assert.equal(clipped.notes.length, 5999);
  assert.equal(clipped.notes, '字'.repeat(5999));
});

test('review generation is safe on frozen inputs and keeps multi-line task titles in their own row', () => {
  const original = Object.freeze(task('名称', {
    text: '确认方案 ✅\n## 假标题', deadline: iso(14), notes: '先确认\n再执行',
  }));
  const items = Object.freeze([original]);
  const snapshot = JSON.stringify(items);
  const result = workflow.makeReview(items, 'day', wednesday);
  assert.equal(JSON.stringify(items), snapshot);
  assert.ok(result.includes('确认方案 ✅ \\#\\# 假标题'));
  assert.ok(result.includes('记录：先确认 再执行'));
});
