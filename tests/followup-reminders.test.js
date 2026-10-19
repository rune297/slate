const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { todoReminderState, todoFollowupReminderState, todoReminderTimerDelay } = require('../main-services');

const hour = 60 * 60 * 1000;
const instant = Date.parse('2026-10-14T08:00:00.000Z');
const iso = (value) => new Date(value).toISOString();

function scheduler(now = instant) {
  const notifications = [];
  const events = [];
  const timers = new Map();
  let current = now;
  let timerSequence = 0;
  let schedule;
  class Clock extends Date { static now() { return current; } }
  const context = vm.createContext({
    Date: Clock,
    todoReminderState,
    todoFollowupReminderState,
    todoReminderTimerDelay,
    TODO_REMINDER_LEAD_MS: hour,
    todoReminderTimer: null,
    scheduledTodoReminders: [],
    // Exercise the legacy fallback; v1.5's registered service is tested by the
    // dedicated reminder unit and production Electron integration suites.
    todoRemindersV15: null,
    isMainRenderer: () => true,
    setTimeout(callback, delay) { const id = ++timerSequence; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    enqueueTaskNotification(item) { notifications.push(item); },
    mainWindow: { isDestroyed: () => false, webContents: { send(channel, payload) { events.push({ channel, payload }); } } },
    ipcMain: { handle(channel, callback) { assert.equal(channel, 'todos:schedule-reminders'); schedule = callback; } },
  });
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const start = source.indexOf('function clearTodoReminderTimer()');
  const end = source.indexOf('function getTaskNotificationBounds(', start);
  assert.ok(start > 0 && end > start, 'real main-process reminder scheduler can be isolated');
  vm.runInContext(source.slice(start, end), context);
  return {
    notifications, events, timers,
    schedule: (items) => schedule({}, items),
    wake(at) {
      current = at;
      assert.equal(timers.size, 1, 'only the nearest reminder has a timer');
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.callback();
    },
  };
}

test('follow-up remains due after a late wake, without changing deadline expiry', () => {
  const todo = { deadline: iso(instant), followupAt: iso(instant), done: false };
  assert.equal(todoFollowupReminderState(todo, instant - hour).state, 'scheduled');
  assert.equal(todoFollowupReminderState(todo, instant - 1).delayMs, 1);
  assert.equal(todoFollowupReminderState(todo, instant + 250).state, 'due');
  assert.equal(todoReminderState(todo, instant + 250).state, 'expired');
  assert.equal(todoFollowupReminderState({ ...todo, followupRemindedAt: instant }, instant + hour).state, 'notified');
  assert.equal(todoFollowupReminderState({ ...todo, done: true }, instant + hour).state, 'done');
});

test('deadline and follow-up keep independent times and reminder acknowledgements', () => {
  const app = scheduler();
  const item = {
    id: 'task-a', text: '客户方案', status: 'waiting',
    deadline: iso(instant + 3 * hour), followupAt: iso(instant + hour),
    remindedAt: 0, followupRemindedAt: 0,
  };
  app.schedule([item]);
  assert.equal(app.notifications.length, 0);
  assert.equal([...app.timers.values()][0].delay, hour);
  app.wake(instant + hour + 10);
  assert.equal(app.notifications.length, 1);
  assert.equal(app.notifications[0].title, '等待反馈 · 客户方案');
  assert.match(app.notifications[0].detail, /联系对方/);
  assert.equal(app.events[0].payload.kind, 'followup');
  assert.equal(app.events[0].payload.followupAt, item.followupAt);
  assert.equal(app.events[0].payload.deadline, item.deadline);
  // Re-rendering can resend the original payload before the renderer has saved
  // its acknowledgement; this must not cause another notification.
  app.schedule([item]);
  assert.equal(app.notifications.length, 1);
  app.wake(instant + 2 * hour + 10);
  assert.equal(app.notifications.length, 2);
  assert.equal(app.notifications[1].title, '客户方案');
  assert.equal(app.notifications[1].detail, '将在 1 小时内截止');
  assert.equal(app.events[1].payload.kind, 'deadline');
  assert.notEqual(app.notifications[0].eventId, app.notifications[1].eventId);
  assert.equal(app.timers.size, 0);
  app.schedule([item]);
  assert.equal(app.notifications.length, 2);
});

test('simultaneous reminders do not suppress each other and completed tasks stay quiet', () => {
  const app = scheduler();
  app.schedule([
    { id: 'follow', text: '回访', status: 'followup', deadline: iso(instant + hour), followupAt: iso(instant) },
    { id: 'done', text: '已处理', done: true, deadline: iso(instant + hour), followupAt: iso(instant) },
  ]);
  assert.equal(app.notifications.length, 2);
  assert.deepEqual(app.events.map((event) => event.payload.kind), ['deadline', 'followup']);
  assert.match(app.notifications[1].title, /持续跟进/);
  assert.match(app.notifications[1].detail, /安排下一步/);
  assert.equal(app.timers.size, 0);
});

test('rescheduling a follow-up creates a new event and an active task says when to look again', () => {
  const app = scheduler();
  const item = { id: 'active', text: '准备材料', status: 'active', followupAt: iso(instant - hour) };
  app.schedule([item]);
  assert.equal(app.notifications.length, 1);
  assert.match(app.notifications[0].title, /再次查看/);
  app.schedule([{ ...item, followupAt: iso(instant + hour), followupRemindedAt: 0 }]);
  assert.equal(app.notifications.length, 1);
  app.wake(instant + hour + 1);
  assert.equal(app.notifications.length, 2);
  assert.notEqual(app.notifications[0].eventId, app.notifications[1].eventId);
});
