const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { normalizeSettings, normalizeTasks, collectDue, getBadge, nextCheck, createTodoReminderService } = require('../todo-reminders.cjs');

const current = new Date(2026, 9, 16, 18, 0).getTime();
const iso = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();
const task = (id, fields = {}) => ({ id, text: id, done: false, deadline: '', planKind: 'later', ...fields });
const config = patch => normalizeSettings({ summaryMode: 'off', advanceMinutes: 30, ...patch });
const due = (tasks, settings = config(), receipts = {}, now = current) => collectDue(normalizeTasks(tasks), settings, receipts, now);

test('reminder settings normalize malformed values without enabling invalid booleans', () => {
  const defaults = normalizeSettings();
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.deadlines, true);
  assert.equal(defaults.advanceMinutes, 0, 'new users receive one deadline alert without an additional advance alert');
  assert.equal(defaults.summaryMode, 'daily');
  assert.equal(defaults.summaryTime, '18:00');
  const value = normalizeSettings({ enabled: 'false', deadlines: false, advanceMinutes: -10, intervalMinutes: 2, summaryTime: '25:00', summaryMode: 'nonsense', summaryWeekday: 9 });
  assert.equal(value.enabled, true);
  assert.equal(value.deadlines, false);
  assert.equal(value.advanceMinutes, 0);
  assert.equal(value.intervalMinutes, 15);
  assert.equal(value.summaryTime, '18:00');
  assert.equal(value.summaryMode, 'daily');
  assert.equal(value.summaryWeekday, 6);
});

test('normalization rejects invalid identities, impossible dates, duplicate tasks and executable text', () => {
  const result = normalizeTasks([null, task('same', { text: '<script>x</script>', planDate: '2026-02-30' }), task('same'), task('x'.repeat(257))]);
  assert.equal(result.length, 1);
  assert.equal(result[0].text, '<script>x</script>'); // Rendered through textContent.
  assert.equal(result[0].planDate, '');
});

test('exact deadlines and advance reminders are separate one-time events', () => {
  const tasks = [task('launch', { deadline: iso(16, 18, 30) })];
  const upcoming = due(tasks);
  assert.deepEqual(upcoming.map(item => item.kind), ['upcoming']);
  const receipts = { [upcoming[0].key]: current };
  assert.equal(due(tasks, config(), receipts).length, 0);
  const onTime = due(tasks, config(), receipts, current + 30 * 60000);
  assert.deepEqual(onTime.map(item => item.kind), ['deadline']);
  assert.notEqual(upcoming[0].key, onTime[0].key);
});

test('completed tasks and globally disabled reminders never alert', () => {
  assert.equal(due([task('done', { done: true, deadline: iso(16, 17) })]).length, 0);
  assert.equal(due([task('pending', { deadline: iso(16, 17) })], config({ enabled: false })).length, 0);
});

test('sleep or restart catch-up combines due deadlines and follow-ups without inventing user completion', () => {
  const events = due([task('one', { deadline: iso(16, 17) }), task('two', { followupAt: iso(16, 16) }), task('old', { deadline: iso(12, 10) })]);
  assert.deepEqual(new Set(events.map(item => item.kind)), new Set(['deadline', 'followup', 'overdue']));
  const receipts = Object.fromEntries(events.map(item => [item.key, current]));
  assert.equal(due([task('one', { deadline: iso(16, 17) }), task('two', { followupAt: iso(16, 16) }), task('old', { deadline: iso(12, 10) })], config(), receipts).length, 0);
});

test('acknowledgement is scoped to one deadline; rescheduling creates a fresh event', () => {
  const original = due([task('task', { deadline: iso(16, 17) })]);
  const receipts = { [original[0].key]: current };
  assert.equal(due([task('task', { deadline: iso(16, 17) })], config(), receipts).length, 0);
  assert.equal(due([task('task', { deadline: iso(16, 18) })], config(), receipts).length, 1);
});

test('daily summaries include planned tasks and allow later summaries after acknowledgement', () => {
  const tasks = [task('today', { planKind: 'day', planDate: '2026-10-16' }), task('old', { planKind: 'day', planDate: '2026-10-15' }), task('future', { planKind: 'day', planDate: '2026-10-17' })];
  const settings = config({ overdue: false, summaryMode: 'daily', summaryTime: '18:00' });
  assert.equal(due(tasks, settings, {}, current - 60000).length, 0);
  const events = due(tasks, settings);
  assert.deepEqual(events.map(item => item.id), ['today', 'old']);
  const receipts = Object.fromEntries(events.map(item => [item.key, current]));
  assert.equal(due(tasks, settings, receipts).length, 0);
  assert.equal(due(tasks, settings, receipts, current + 24 * 60 * 60000).length, 3);
});

test('weekday, weekly and interval summaries observe local schedule and recurrence boundaries', () => {
  const tasks = [task('today', { planKind: 'day', planDate: '2026-10-16' })];
  assert.equal(due(tasks, config({ summaryMode: 'weekly', summaryWeekday: 5 })).length, 1);
  assert.equal(due(tasks, config({ summaryMode: 'weekly', summaryWeekday: 1 })).length, 0);
  assert.equal(due(tasks, config({ summaryMode: 'weekdays', overdue: false }), {}, current + 24 * 60 * 60000).length, 0);
  const interval = config({ summaryMode: 'interval' });
  const events = due(tasks, interval);
  const receipts = { [events[0].key]: current };
  assert.equal(due(tasks, interval, receipts, current + 5 * 60000).length, 0);
  assert.equal(due(tasks, interval, receipts, current + 120 * 60000).length, 1);
});

test('work added after the daily digest waits for a later digest without suppressing due alerts',()=>{
  const added=current+60000,tasks=normalizeTasks([task('new',{createdAt:added,planAddedAt:added,planKind:'day',planDate:'2026-10-16'})]);
  const settings=config({overdue:false,summaryMode:'daily',summaryTime:'18:00'});
  assert.equal(due(tasks,settings,{},added+60000).length,0);
  assert.equal(due(tasks,settings,{},current+24*60*60000).length,1);
  assert.equal(due(normalizeTasks([{...tasks[0],deadline:new Date(added).toISOString()}]),settings,{},added+60000)[0].kind,'deadline');
});

test('badge distinguishes important overdue tasks from ordinary planned work', () => {
  const result = getBadge(normalizeTasks([task('ordinary', { planKind: 'day', planDate: '2026-10-15', bucket: 'P1' }), task('focus', { deadline: iso(16, 17), focusDate: '2026-10-16' }), task('zero', { deadline: iso(16, 17), bucket: 'P0' }), task('next', { deadline: iso(16, 18, 45) }), task('done', { done: true, deadline: iso(16, 17) })]), current);
  assert.deepEqual(result, { overdue: 3, important: 1, upcoming: 1 });
  assert.deepEqual(getBadge(normalizeTasks([task('old-focus',{planKind:'day',planDate:'2026-10-15',focusDate:'2026-10-15'}),task('future-focus',{deadline:iso(16,17),focusDate:'2026-10-17'})]),current),{overdue:2,important:1,upcoming:0});
});

test('past week plans expire after the week while current week plans enter only weekly summaries',()=>{
  const tasks=[task('past',{planKind:'week',planWeek:'2026-10-05',focusDate:'2026-10-05'}),task('this',{planKind:'week',planWeek:'2026-10-12'}),task('future',{planKind:'week',planWeek:'2026-10-19'})];
  const overdue=due(tasks);assert.deepEqual(overdue.map(row=>row.id),['past']);assert.equal(overdue[0].planWeek,'2026-10-05');assert.ok(Number.isFinite(overdue[0].at));
  assert.deepEqual(getBadge(normalizeTasks(tasks),current),{overdue:1,important:1,upcoming:0});
  const weekly=due(tasks,config({overdue:false,summaryMode:'weekly',summaryWeekday:5,summaryTime:'18:00'}));
  assert.deepEqual(weekly.map(row=>row.id),['past','this']);
  assert.deepEqual(due(tasks,config({overdue:false,summaryMode:'daily',summaryTime:'18:00'})).map(row=>row.id),['past']);
});

test('scheduler waits until the actual next due time and never busy-polls elapsed events', () => {
  const tasks = normalizeTasks([task('soon', { deadline: iso(16, 18, 31) })]);
  assert.equal(nextCheck(tasks, config(), current), current + 60000);
  assert.equal(nextCheck(normalizeTasks([task('old', { deadline: iso(16, 17) })]), config(), current), new Date(2026, 9, 17, 0).getTime());
});

function harness({ stored = {}, requestAction = async () => ({ ok: true }), failedSave = false } = {}) {
  const handlers = new Map();
  const windows = [];
  const timerIds = new Set();
  const main = {};
  const opened = [];
  const badges = [];
  let store = { unrelated: 'keep', ...stored };
  let fails = failedSave;
  class Window extends EventEmitter {
    constructor(opts) { super(); this.options = opts; this.destroyed = false; this.webContents = new EventEmitter(); this.webContents.send = (channel, payload) => { this.sent = { channel, payload }; }; this.webContents.setWindowOpenHandler = () => {}; windows.push(this); }
    loadFile(file) { this.file = file; }
    isDestroyed() { return this.destroyed; }
    setAlwaysOnTop(value, level) { this.topmost = { value, level }; }
    showInactive() { this.shownInactive = true; }
    getBounds() { const { x, y, width, height } = this.options; return { x, y, width, height }; }
    setBounds(bounds) { Object.assign(this.options, bounds); }
    close() { let prevented = false; this.emit('close', { preventDefault() { prevented = true; } }); if (!prevented) { this.destroyed = true; this.emit('closed'); } }
  }
  const service = createTodoReminderService({ BrowserWindow: Window, screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) }, ipcMain: { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) }, isMainSender: event => event.sender === main, readSettings: () => store, saveSettings: candidate => { if (fails) return false; store = candidate; return true; }, requestAction, openTask: async id => opened.push(id), onBadge: badge => badges.push(badge), now: () => current, setTimeout: callback => { timerIds.add(callback); return callback; }, clearTimeout: callback => timerIds.delete(callback) });
  return { service, handlers, windows, timerIds, main, opened, badges, get store() { return store; }, failSave(value) { fails = value; }, invoke: (name, data, sender = windows.at(-1)?.webContents) => handlers.get(name)({ sender }, data) };
}

test('service persists only receipt hashes and settings, preserves unrelated configuration, rejects untrusted senders', () => {
  const h = harness();
  h.service.updateTasks([task('private-id', { text: 'SECRET TASK CONTENT', deadline: iso(16, 17) })], { theme: 'dark' });
  assert.equal(h.windows.length, 1);
  assert.equal(h.windows[0].options.show, false);
  assert.equal(h.windows[0].options.webPreferences.nodeIntegration, false);
  h.windows[0].emit('ready-to-show');
  assert.deepEqual(h.windows[0].topmost, { value: true, level: 'screen-saver' }, 'native layer is reasserted when the reminder is shown');
  assert.equal(h.windows[0].shownInactive, true);
  assert.equal(JSON.stringify(h.store).includes('SECRET'), false);
  assert.equal(JSON.stringify(h.store).includes('private-id'), false);
  assert.equal(h.store.unrelated, 'keep');
  assert.equal(h.invoke('todo-v15:reminders-set', { enabled: false }, {}).ok, false);
  assert.equal(h.invoke('todo-v15:reminder-ready', null, {}).ok, false);
  assert.equal(h.invoke('todo-v15:reminders-get', null, h.main).ok, true);
  assert.equal(h.timerIds.size, 1);
  h.service.dispose();
  assert.equal(h.timerIds.size, 0);
  assert.equal(h.handlers.size, 0);
});

test('persisted acknowledgement prevents restart spam and completion removes popup only after save succeeds', async () => {
  let success = false;
  const h = harness({ requestAction: async () => ({ ok: success, error: 'disk full' }) });
  const tasks = [task('one', { deadline: iso(16, 17) })];
  h.service.updateTasks(tasks);
  const failed = await h.invoke('todo-v15:reminder-action', { action: 'complete', id: 'one' });
  assert.equal(failed.ok, false);
  assert.equal(h.windows[0].isDestroyed(), false);
  assert.equal(h.invoke('todo-v15:reminder-ready').entries.length, 1);
  const restarted = harness({ stored: h.store });
  restarted.service.updateTasks(tasks);
  assert.equal(restarted.windows.length, 0);
  success = true;
  assert.equal((await h.invoke('todo-v15:reminder-action', { action: 'complete', id: 'one' })).ok, true);
  assert.equal(h.windows[0].isDestroyed(), true);
  assert.equal(h.service.getBadge().overdue, 0);
  h.service.dispose(); restarted.service.dispose();
});

test('acknowledge does not mark tasks done and later summaries still contain them', async () => {
  const calls = [];
  const h = harness({ requestAction: async action => { calls.push(action); return { ok: true }; } });
  h.service.updateTasks([task('one', { deadline: iso(16, 17) })]);
  assert.equal((await h.invoke('todo-v15:reminder-action', { action: 'acknowledge', id: 'one' })).ok, true);
  assert.deepEqual(calls, [{ action: 'acknowledge', id: 'one' }]);
  assert.equal(h.service.getBadge().overdue, 1);
  h.service.checkNow();
  assert.equal(h.windows.length, 1);
  h.service.dispose();
});

test('reschedule validates future time, forwards both date and deadline, and permits fresh reminder', async () => {
  const calls = [];
  const h = harness({ requestAction: async action => { calls.push(action); return { ok: true }; } });
  h.service.updateTasks([task('one', { deadline: iso(16, 17) })]);
  assert.equal((await h.invoke('todo-v15:reminder-action', { action: 'reschedule', id: 'one', deadline: iso(16, 17) })).ok, false);
  assert.equal((await h.invoke('todo-v15:reminder-action', { action: 'reschedule', id: 'one', deadline: iso(17, 17) })).ok, true);
  assert.equal(calls[0].planDate, '2026-10-17');
  assert.equal(calls[0].deadline, iso(17, 17));
  assert.equal(h.service.getBadge().overdue, 0);
  h.service.dispose();
});

test('configuration saves roll back on disk failure, disabling destroys popup and replaces timer', () => {
  const h = harness();
  h.service.updateTasks([task('one', { deadline: iso(16, 17) })]);
  h.failSave(true);
  assert.equal(h.service.setSettings({ enabled: false }).ok, false);
  assert.equal(h.service.getSettings().enabled, true);
  assert.equal(h.windows[0].isDestroyed(), false);
  h.failSave(false);
  assert.equal(h.service.setSettings({ enabled: false }).ok, true);
  assert.equal(h.windows[0].isDestroyed(), true);
  assert.equal(h.timerIds.size, 1);
  h.service.dispose();
});

test('canonical task updates dismiss deleted or externally rescheduled tasks, and view opens original id', async () => {
  const h = harness();
  h.service.updateTasks([task('one', { deadline: iso(16, 17) })]);
  h.service.updateTasks([task('one', { deadline: iso(17, 17) })]);
  assert.equal(h.windows[0].isDestroyed(), true);
  h.service.updateTasks([task('two', { deadline: iso(16, 17) })]);
  assert.equal((await h.invoke('todo-v15:reminder-action', { action: 'view', id: 'two' })).ok, true);
  assert.deepEqual(h.opened, ['two']);
  h.service.dispose();
});

test('pending action blocks duplicate writes and window close, then releases on failed save', async () => {
  let resolve;
  const h = harness({ requestAction: () => new Promise(done => { resolve = done; }) });
  h.service.updateTasks([task('one', { deadline: iso(16, 17) })]);
  const pending = h.invoke('todo-v15:reminder-action', { action: 'complete', id: 'one' });
  assert.equal(h.service.closePopup(), false);
  assert.equal((await h.invoke('todo-v15:reminder-action', { action: 'complete', id: 'one' })).ok, false);
  resolve({ ok: false });
  assert.equal((await pending).ok, false);
  assert.equal(h.service.closePopup(), true);
  h.service.dispose();
});

test('only the reminder window can resize its compact content and it stays in the work area', () => {
  const h = harness();
  h.service.updateTasks([task('compact', { deadline: iso(16, 17) })]);
  const popup = h.windows.at(-1), before = popup.getBounds();
  assert.equal(before.width, 360);
  assert.deepEqual(h.invoke('todo-v15:reminder-resize', 1000, {}), { ok: false });
  assert.deepEqual(h.invoke('todo-v15:reminder-resize', Infinity), { ok: false });
  assert.deepEqual(popup.getBounds(), before);
  assert.deepEqual(h.invoke('todo-v15:reminder-resize', 1000), { ok: true, height: 520 });
  assert.equal(popup.getBounds().y + popup.getBounds().height, 1064);
  assert.deepEqual(h.invoke('todo-v15:reminder-resize', 230), { ok: true, height: 230 });
  assert.equal(popup.getBounds().y + popup.getBounds().height, 1064);
  h.service.dispose();
});
