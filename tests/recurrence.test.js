const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('../renderer/recurrence.js');

const rule = fields => ({ id: 'repeat-rule', title: '整理项目进展', frequency: 'daily', startDate: '2026-10-01', enabled: true, deadlineTime: '09:00', ...fields });

test('recurrence engine is dependency-free in Node and browser', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer/recurrence.js'), 'utf8'), context);
  assert.equal(typeof context.SlateRecurrence.taskForDate, 'function');
  assert.equal(context.SlateRecurrence.key(new Date(2026, 9, 16, 0, 5)), '2026-10-16');
});

test('rule validation rejects invalid dates, reversed ranges, missing titles and unsafe ids', () => {
  for (const fields of [{ id: '../escape' }, { id: '' }, { title: '' }, { startDate: '2026-02-30' }, { startDate: 'invalid' }, { endDate: '2026-09-30' }]) assert.equal(engine.normalizeRule(rule(fields)), null);
  assert.ok(engine.normalizeRule(rule({ startDate: '2028-02-29' })));
  assert.equal(engine.date('2026-02-29'), null);
  assert.equal(engine.date('2026-13-01'), null);
});

test('daily occurrences respect inclusive beginning and ending dates', () => {
  const source = rule({ startDate: '2026-10-16', endDate: '2026-10-18' });
  assert.equal(engine.occursOn(source, '2026-10-15'), false);
  assert.equal(engine.occursOn(source, '2026-10-16'), true);
  assert.equal(engine.occursOn(source, '2026-10-18'), true);
  assert.equal(engine.occursOn(source, '2026-10-19'), false);
});

test('weekly recurrence accepts multiple weekdays and falls back to start weekday', () => {
  const source = rule({ frequency: 'weekly', weekdays: [1, 5, 5, -1, 8, '2'] });
  assert.deepEqual(engine.normalizeRule(source).weekdays, [1, 5]);
  assert.equal(engine.occursOn(source, '2026-10-16'), true);
  assert.equal(engine.occursOn(source, '2026-10-17'), false);
  assert.equal(engine.occursOn(source, '2026-10-19'), true);
  const fallback = engine.normalizeRule(rule({ frequency: 'weekly', startDate: '2026-10-16', weekdays: [] }));
  assert.deepEqual(fallback.weekdays, [5]);
});

test('monthly 31st occurs on the final day of short months and leap February', () => {
  const source = rule({ frequency: 'monthly', startDate: '2026-01-01', monthDay: 31 });
  assert.equal(engine.occursOn(source, '2026-02-28'), true);
  assert.equal(engine.occursOn(source, '2026-02-27'), false);
  assert.equal(engine.occursOn(source, '2026-04-30'), true);
  assert.equal(engine.occursOn(source, '2028-02-29'), true);
  assert.equal(engine.occursOn(source, '2028-02-28'), false);
});

test('monthly day is normalized to an integer so imported fractional dates cannot silently stop generation', () => {
  const source = rule({ frequency: 'monthly', monthDay: 15.5 });
  assert.equal(Number.isInteger(engine.normalizeRule(source).monthDay), true);
  assert.equal(engine.occursOn(source, '2026-10-15'), true);
});

test('a one-time rule appears only on its named date', () => {
  const source = rule({ frequency: 'once', startDate: '2026-10-16' });
  assert.equal(engine.occursOn(source, '2026-10-15'), false);
  assert.equal(engine.occursOn(source, '2026-10-16'), true);
  assert.equal(engine.occursOn(source, '2026-10-17'), false);
  assert.equal(engine.latestOccurrence(source, '2026-10-18'), '2026-10-16');
  assert.equal(engine.latestOccurrence({ ...source, lastGeneratedDate: '2026-10-16' }, '2026-10-18'), '');
  assert.equal(engine.latestOccurrence({ ...source, startDate: '2024-01-02' }, '2026-10-18'), '2024-01-02', 'a single occurrence does not disappear behind the bounded regular-rule lookback');
});

test('offline catch-up returns only the latest occurrence and never every missed day', () => {
  const source = rule({ lastGeneratedDate: '2026-10-01' });
  assert.equal(engine.latestOccurrence(source, '2026-10-16'), '2026-10-16');
  assert.equal(engine.latestOccurrence({ ...source, lastGeneratedDate: '2026-10-16' }, '2026-10-16'), '');
  assert.equal(engine.latestOccurrence(rule({ frequency: 'weekly', weekdays: [1], lastGeneratedDate: '2026-10-05' }), '2026-10-16'), '2026-10-12');
});

test('expired recurrence catches up its last valid occurrence but never exceeds its ending date', () => {
  const source = rule({ frequency: 'weekly', weekdays: [5], endDate: '2026-10-12' });
  assert.equal(engine.latestOccurrence(source, '2026-10-16'), '2026-10-09');
  assert.equal(engine.latestOccurrence({ ...source, lastGeneratedDate: '2026-10-09' }, '2026-10-16'), '');
});

test('pause generates nothing; resume watermark skips paused occurrences while allowing today', () => {
  const paused = rule({ enabled: false, lastGeneratedDate: '2026-10-01' });
  assert.equal(engine.latestOccurrence(paused, '2026-10-16'), '');
  assert.equal(engine.taskForDate(paused, '2026-10-16'), null);
  const resumed = { ...paused, enabled: true, lastGeneratedDate: '2026-10-15' };
  assert.equal(engine.latestOccurrence(resumed, '2026-10-16'), '2026-10-16');
  assert.equal(engine.latestOccurrence({ ...resumed, frequency: 'weekly', weekdays: [1] }, '2026-10-16'), '');
});

test('new recurring tasks have stable per-date ids and preserve notes, images and importance', () => {
  const source = rule({ notes: '第一步确认范围\n第二步发出报告', attachments: [{ id: 'image-a', name: '参考图.png' }], important: true });
  const first = engine.taskForDate(source, '2026-10-16', 1);
  const retried = engine.taskForDate(source, '2026-10-16', 2);
  const tomorrow = engine.taskForDate(source, '2026-10-17', 3);
  assert.equal(first.id, retried.id);
  assert.notEqual(first.id, tomorrow.id);
  assert.equal(first.recurrenceId, source.id);
  assert.equal(first.occurrenceDate, '2026-10-16');
  assert.equal(first.planDate, '2026-10-16');
  assert.equal(first.focusDate, '2026-10-16');
  assert.equal(first.done, false);
  assert.equal(first.notes, source.notes);
  assert.deepEqual(first.attachments, source.attachments);
  assert.equal(new Date(first.deadline).getHours(), 9);
  assert.equal(engine.key(new Date(first.deadline)), '2026-10-16');
});

test('a recurring task without a deadline remains a date-only plan', () => {
  const task = engine.taskForDate(rule({ deadlineTime: '' }), '2026-10-16', 1);
  assert.equal(task.deadline, '');
  assert.equal(task.planKind, 'day');
  assert.equal(task.planDate, '2026-10-16');
  assert.equal(task.focusDate, '');
  assert.equal(task.createdAt, 1);
});

test('task creation rejects dates outside the active rule and does not mutate rule metadata', () => {
  const source = rule({ lastGeneratedDate: '2026-10-01', endDate: '2026-10-17' });
  const snapshot = JSON.stringify(source);
  assert.equal(engine.taskForDate(source, '2026-09-30'), null);
  assert.equal(engine.taskForDate(source, '2026-10-18'), null);
  engine.latestOccurrence(source, '2026-10-16');
  engine.taskForDate(source, '2026-10-16');
  assert.equal(JSON.stringify(source), snapshot);
});
