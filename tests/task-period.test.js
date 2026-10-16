const test = require('node:test');
const assert = require('node:assert/strict');
const workflow = require('../renderer/workflow');

const now = new Date(2026, 9, 14, 10, 30);
const stamp = (day, hour = 10) => new Date(2026, 9, day, hour).getTime();
const iso = (day, hour = 10) => new Date(2026, 9, day, hour).toISOString();
const task = (id, fields = {}) => ({ id, text: id, done: false, createdAt: 1, ...fields });
const planned = (id, kind, date = '', fields = {}) => workflow.setPlan(task(id, fields), kind, now, date);

test('migration preserves dates and does not invent when an older task joined a plan', () => {
  const samples = [
    [task('focus', { focusDate: '2026-10-13', deadline: iso(17) }), '2026-10-13'],
    [task('deadline', { deadline: iso(16) }), '2026-10-16'],
    [task('follow-up', { status: 'waiting', followupAt: iso(15) }), '2026-10-15'],
    [task('completed', { done: true, completedAt: stamp(12) }), '2026-10-12'],
  ];
  for (const [source, date] of samples) {
    const result = workflow.normalizeTodo(source, now);
    assert.equal(result.planKind, 'day');
    assert.equal(result.planDate, date);
    assert.equal(result.planWeek, '');
    assert.equal(result.planAddedAt, 0);
    assert.equal(source.planKind, undefined);
  }
  const historical = workflow.normalizeTodo(task('unknown', { done: true }), now);
  assert.equal(historical.planKind, 'later');
  assert.equal(historical.completedAt, 0);
  assert.equal(historical.planDate, '');
});

test('explicit plans remain independent of focus, deadline and follow-up', () => {
  const source = task('long term', {
    planKind: 'week', planWeek: '2026-10-19', planAddedAt: stamp(13),
    focusDate: '2026-10-14', deadline: iso(16), followupAt: iso(15), notes: '原有记录',
  });
  const result = workflow.normalizeTodo(source, now);
  assert.equal(result.planKind, 'week');
  assert.equal(result.planWeek, '2026-10-19');
  assert.equal(result.planDate, '');
  assert.equal(result.notes, '原有记录');
  assert.equal(result.deadline, source.deadline);
  assert.equal(result.followupAt, source.followupAt);
  const later = workflow.normalizeTodo({ ...source, planKind: 'later' }, now);
  assert.equal(later.planKind, 'later');
  assert.equal(later.planDate, '');
  assert.equal(later.planWeek, '');
});

test('corrupt plan fields become unscheduled rather than acquiring a fabricated date', () => {
  for (const fields of [
    { planKind: 'day', planDate: '2026-02-30' },
    { planKind: 'week', planWeek: 'bad date' },
    { planKind: 'invalid', planDate: '2026-10-14' },
  ]) {
    const result = workflow.normalizeTodo(task('invalid', { ...fields, focusDate: '2026-10-14', planAddedAt: NaN }), now);
    assert.equal(result.planKind, 'later');
    assert.equal(result.planDate, '');
    assert.equal(result.planWeek, '');
    assert.equal(result.planAddedAt, 0);
  }
  assert.equal(workflow.normalizeTodo({ planKind: 'week', planWeek: '2026-10-14' }, now).planWeek, '2026-10-12');
});

test('week keys use Monday in local time, including a Sunday across the year boundary', () => {
  assert.equal(workflow.weekKey(now), '2026-10-12');
  assert.equal(workflow.weekKey('2026-10-18'), '2026-10-12');
  assert.equal(workflow.weekKey(new Date(2027, 0, 3, 23, 59)), '2026-12-28');
  assert.equal(workflow.weekKey('2027-01-04'), '2027-01-04');
  assert.equal(workflow.weekKey('invalid'), '');
});

test('assigning a day/week/later plan records the actual assignment and retains unrelated task data', () => {
  const source = Object.freeze(task('source', {
    notes: '说明', status: 'waiting', deadline: iso(20), followupAt: iso(15),
    remindedAt: 123, followupRemindedAt: 456, category: '客户',
  }));
  const today = workflow.setPlan(source, 'day', now);
  assert.equal(today.planDate, '2026-10-14');
  assert.equal(today.planAddedAt, now.getTime());
  const week = workflow.setPlan(today, 'week', now);
  assert.equal(week.planWeek, '2026-10-12');
  assert.equal(week.planDate, '');
  const later = workflow.setPlan(week, 'later', now);
  assert.equal(later.planKind, 'later');
  assert.equal(later.planWeek, '');
  assert.equal(later.planDate, '');
  for (const field of ['notes', 'status', 'deadline', 'followupAt', 'remindedAt', 'followupRemindedAt', 'category']) {
    assert.equal(later[field], source[field]);
  }
  assert.equal(source.planKind, undefined);
  assert.equal(workflow.setPlan(source, 'day', now, '2026-11-03').planDate, '2026-11-03');
  assert.equal(workflow.setPlan(source, 'week', now, '2026-11-03').planWeek, '2026-11-02');
  assert.throws(() => workflow.setPlan(source, 'day', now, '2026-02-30'), /日期无效/);
  assert.throws(() => workflow.setPlan(source, 'month', now), /安排无效/);
  assert.throws(() => workflow.setPlan(source, 'day', new Date(NaN)), /日期无效/);
});

test('rescheduling removes stale focus while pinning does not rewrite a week or later plan', () => {
  const week = planned('week', 'week', '2026-10-19');
  const focus = workflow.setFocus(week, true, now, 2);
  assert.equal(focus.planKind, 'week');
  assert.equal(focus.planWeek, '2026-10-19');
  assert.equal(workflow.isInPeriod(focus, 'day', now), true);
  assert.equal(workflow.isInPeriod(focus, 'week', now), true);
  assert.equal(workflow.isInPeriod(focus, 'later', now), true);
  const cleared = workflow.setFocus(focus, false, now);
  assert.equal(workflow.isInPeriod(cleared, 'day', now), false);
  assert.equal(workflow.isInPeriod(cleared, 'week', now), false);
  assert.equal(workflow.isInPeriod(cleared, 'later', now), true);
  const moved = workflow.setPlan(focus, 'week', now);
  assert.equal(moved.focusDate, '');
  assert.equal(moved.focusOrder, 0);
  assert.equal(moved.pinnedToday, false);
  const stillToday = workflow.setPlan(workflow.setFocus(planned('today', 'day'), true, now), 'day', now);
  assert.equal(workflow.isFocus(stillToday, now), true);
  const tomorrow = workflow.setPlan(stillToday, 'day', now, '2026-10-15');
  assert.equal(workflow.isFocus(tomorrow, now), false);
});

test('today and this week include their plans and unfinished past plans, but not all completed work', () => {
  const samples = [
    [planned('today', 'day'), true, true, false],
    [planned('tomorrow', 'day', '2026-10-15'), false, true, false],
    [planned('this week', 'week'), false, true, false],
    [planned('last Monday open', 'day', '2026-10-05'), true, true, false],
    [planned('last week open', 'week', '2026-10-05'), true, true, false],
    [planned('past completed', 'day', '2026-10-05', { done: true, completedAt: now.getTime() }), false, false, false],
    [planned('next month', 'day', '2026-11-03'), false, false, true],
    [planned('next week', 'week', '2026-10-19'), false, false, true],
    [planned('unscheduled', 'later'), false, false, true],
  ];
  for (const [item, day, week, later] of samples) {
    assert.equal(workflow.isInPeriod(item, 'day', now), day, `${item.id} today`);
    assert.equal(workflow.isInPeriod(item, 'week', now), week, `${item.id} week`);
    assert.equal(workflow.isInPeriod(item, 'later', now), later, `${item.id} later`);
  }
  assert.equal(workflow.isInPeriod(null, 'day', now), false);
  assert.equal(workflow.isInPeriod(task('x'), 'month', now), false);
});

test('local Monday and next Monday form a precise weekly boundary', () => {
  const sunday = new Date(2026, 9, 18, 23, 59);
  const monday = new Date(2026, 9, 19, 0, 0);
  const taskSunday = planned('Sunday', 'day', '2026-10-18');
  const taskMonday = planned('Monday', 'day', '2026-10-19');
  assert.equal(workflow.isInPeriod(taskSunday, 'week', sunday), true);
  assert.equal(workflow.isInPeriod(taskMonday, 'week', sunday), false);
  assert.equal(workflow.isInPeriod(taskMonday, 'later', sunday), true);
  assert.equal(workflow.isInPeriod(taskMonday, 'day', monday), true);
  assert.equal(workflow.isInPeriod(taskSunday, 'day', monday), true); // unfinished carryover
  assert.equal(workflow.isInPeriod({ ...taskSunday, done: true }, 'day', monday), false);
});

test('progress describes current plans; completion elsewhere does not inflate this periods completed count', () => {
  const items = [
    planned('finished today', 'day', '', { done: true, completedAt: now.getTime() }),
    planned('waiting today', 'day', '', { status: 'waiting' }),
    planned('follow up today', 'day', '', { status: 'followup', followupAt: iso(14, 8) }),
    planned('carryover', 'day', '2026-10-13', { planAddedAt: 0 }),
    planned('finished future', 'day', '2026-11-03', { done: true, completedAt: now.getTime() }),
    planned('future open', 'week', '2026-10-19'),
  ];
  assert.deepEqual(workflow.periodStats(items, 'day', now), {
    total: 4, completed: 1, pending: 3, waiting: 1, followup: 1, overdue: 2, added: 4,
  });
  const review = workflow.makeReview(items, 'day', now);
  assert.ok(review.includes('finished future')); // real completion remains visible in accomplishments
  assert.ok(review.includes('carryover'));
  assert.ok(!review.includes('future open'));
});

test('inserting a task updates the current denominator, and moving it later removes it from that denominator', () => {
  const old = workflow.normalizeTodo(task('existing', { focusDate: '2026-10-14' }), now);
  const items = [workflow.completeTodo(old, true, now), planned('new waiting', 'day', '', { status: 'waiting' })];
  assert.deepEqual(workflow.periodStats(items, 'day', now), {
    total: 2, completed: 1, pending: 1, waiting: 1, followup: 0, overdue: 0, added: 1,
  });
  const later = workflow.setPlan(items[1], 'later', now);
  assert.deepEqual(workflow.periodStats([items[0], later], 'day', now), {
    total: 1, completed: 1, pending: 0, waiting: 0, followup: 0, overdue: 0, added: 0,
  });
  assert.equal(workflow.periodStats([later], 'later', now).total, 1);
});

test('period additions require a real assignment inside the period and cannot count future timestamps', () => {
  const items = [
    { ...planned('legacy', 'day'), planAddedAt: 0 },
    { ...planned('before week', 'day'), planAddedAt: stamp(11, 23) },
    { ...planned('Monday', 'day'), planAddedAt: stamp(12, 0) },
    { ...planned('today midnight', 'day'), planAddedAt: stamp(14, 0) },
    { ...planned('future assignment', 'day'), planAddedAt: stamp(14, 11) },
  ];
  assert.equal(workflow.periodStats(items, 'day', now).added, 1);
  assert.equal(workflow.periodStats(items, 'week', now).added, 2);
  assert.equal(workflow.periodStats(items, 'later', now).added, 0);
});

test('review includes an explicit weekly plan even when it has no focus, deadline or reminder', () => {
  const items = [planned('本周安排', 'week'), planned('以后再做', 'later'), planned('下周安排', 'week', '2026-10-19')];
  const review = workflow.makeReview(items, 'week', now);
  assert.ok(review.includes('本周安排'));
  assert.ok(!review.includes('以后再做'));
  assert.ok(!review.includes('下周安排'));
});
