'use strict';

const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_SETTINGS = Object.freeze({ enabled: true, deadlines: true, followups: true, overdue: true, advanceMinutes: 0, summaryMode: 'daily', summaryTime: '18:00', summaryWeekday: 5, intervalMinutes: 120 });
const SIX_HOURS = 6 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

function localDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  return localDate(new Date(`${value}T12:00:00`)) === value ? value : '';
}
function localWeek(value) { const date=new Date(value);date.setHours(12,0,0,0);date.setDate(date.getDate()-((date.getDay()+6)%7));return localDate(date); }
function time(value) { return typeof value === 'string' && value.trim() ? Date.parse(value) : NaN; }
function integer(value, fallback, min, max) { return Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Math.round(Number(value)))) : fallback; }
function normalizeSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  const normalized = { ...DEFAULT_SETTINGS };
  for (const key of ['enabled', 'deadlines', 'followups', 'overdue']) if (typeof source[key] === 'boolean') normalized[key] = source[key];
  normalized.advanceMinutes = integer(source.advanceMinutes, DEFAULT_SETTINGS.advanceMinutes, 0, 1440);
  normalized.intervalMinutes = integer(source.intervalMinutes, DEFAULT_SETTINGS.intervalMinutes, 15, 1440);
  normalized.summaryWeekday = integer(source.summaryWeekday, DEFAULT_SETTINGS.summaryWeekday, 0, 6);
  if (['off', 'daily', 'weekdays', 'weekly', 'interval'].includes(source.summaryMode)) normalized.summaryMode = source.summaryMode;
  if (typeof source.summaryTime === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(source.summaryTime)) normalized.summaryTime = source.summaryTime;
  return normalized;
}
function normalizeTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  const seen = new Set();
  return tasks.slice(0, 20000).filter(task => task && typeof task.id === 'string' && task.id.length <= 256 && !seen.has(task.id) && seen.add(task.id)).map(task => ({
    id: task.id, text: String(task.text || '').slice(0, 400), done: task.done === true,
    createdAt: Math.max(0,Number(task.createdAt)||0),planAddedAt:Math.max(0,Number(task.planAddedAt)||0),
    deadline: Number.isFinite(time(task.deadline)) ? new Date(time(task.deadline)).toISOString() : '',
    followupAt: Number.isFinite(time(task.followupAt)) ? new Date(time(task.followupAt)).toISOString() : '',
    planKind: task.planKind, planDate: validDate(task.planDate), planWeek: validDate(task.planWeek),
    focusDate: validDate(task.focusDate), pinnedToday: task.pinnedToday === true, bucket: task.bucket,
  }));
}
function isOverdue(task, now) {
  return !task.done && ((task.deadline && time(task.deadline) <= now) || (task.planKind === 'day' && task.planDate && task.planDate < localDate(now)) || (task.planKind==='week' && task.planWeek && task.planWeek<localWeek(now)));
}
function isImportant(task, now) { return Boolean(task.focusDate && task.focusDate <= localDate(now)) || task.pinnedToday; }
function getBadge(tasks, now = Date.now()) {
  const overdue = tasks.filter(task => isOverdue(task, now));
  return { overdue: overdue.length, important: overdue.filter(task => isImportant(task, now)).length, upcoming: tasks.filter(task => !task.done && task.deadline && time(task.deadline) > now && time(task.deadline) <= now + 60 * 60 * 1000).length };
}
function receiptKey(value) { return crypto.createHash('sha256').update(value).digest('hex').slice(0, 32); }
function summarySlot(settings, now) {
  if (settings.summaryMode === 'off') return null;
  if (settings.summaryMode === 'interval') {
    const slot = Math.floor(now / (settings.intervalMinutes * 60000));
    return { key: `interval:${settings.intervalMinutes}:${slot}`, at: slot * settings.intervalMinutes * 60000 };
  }
  const date = new Date(now);
  if (settings.summaryMode === 'weekdays' && [0, 6].includes(date.getDay())) return null;
  if (settings.summaryMode === 'weekly' && date.getDay() !== settings.summaryWeekday) return null;
  const [hour, minute] = settings.summaryTime.split(':').map(Number);
  date.setHours(hour, minute, 0, 0);
  return { key: `summary:${settings.summaryMode}:${localDate(now)}:${settings.summaryTime}`, at: date.getTime() };
}
function collectDue(tasks, settings, receipts, now = Date.now()) {
  if (!settings.enabled) return [];
  const events = [];
  const add = (task, kind, at, suffix = '') => {
    const key = receiptKey(`${kind}:${task.id}:${at}:${suffix}`);
    if (!receipts[key]) events.push({ key, id: task.id, text: task.text, deadline: task.deadline, planDate: task.planDate, planWeek:task.planWeek, followupAt: task.followupAt, kind, at, important: isImportant(task, now) });
  };
  for (const task of tasks) {
    if (task.done) continue;
    const deadline = time(task.deadline);
    if (settings.deadlines && Number.isFinite(deadline)) {
      if (deadline > now && settings.advanceMinutes && deadline - settings.advanceMinutes * 60000 <= now) add(task, 'upcoming', deadline);
      if (deadline <= now && deadline >= now - DAY) add(task, 'deadline', deadline);
    }
    const followup = time(task.followupAt);
    if (settings.followups && Number.isFinite(followup) && followup <= now && followup >= now - DAY) add(task, 'followup', followup);
    if (settings.followups && settings.overdue && Number.isFinite(followup) && followup < now - DAY) add(task, 'followup', followup, localDate(now));
    if (settings.overdue && isOverdue(task, now) && (!Number.isFinite(deadline) || deadline < now - DAY)) add(task, 'overdue', Number.isFinite(deadline) ? deadline : time(`${task.planDate||task.planWeek}T00:00:00`), localDate(now));
  }
  const slot = summarySlot(settings, now);
  if (slot && slot.at <= now) {
    for (const task of tasks) {
      if (task.done) continue;
      // Adding work after today's scheduled digest must not immediately pop up
      // that digest again. Exact deadlines and overdue alerts remain independent.
      if (Math.max(task.createdAt||0,task.planAddedAt||0)>slot.at) continue;
      const deadline = time(task.deadline);
      const followup = time(task.followupAt);
      const weeklyPlan=task.planKind==='week'&&task.planWeek&&(task.planWeek<localWeek(now)||(settings.summaryMode==='weekly'&&task.planWeek===localWeek(now)));
      if (weeklyPlan || (task.planKind === 'day' && task.planDate && task.planDate <= localDate(now)) || (Number.isFinite(deadline) && localDate(deadline) <= localDate(now)) || (Number.isFinite(followup) && followup <= now)) add(task, 'summary', slot.at, slot.key);
    }
  }
  // A task due now can also enter today's summary. It appears only once in a
  // popup; every matching receipt is retained so the next check stays quiet.
  return events.sort((a, b) => Number(b.important) - Number(a.important) || a.at - b.at);
}

function nextCheck(tasks, settings, now) {
  let next = now + SIX_HOURS;
  if (!settings.enabled) return next;
  for (const task of tasks) {
    if (task.done) continue;
    for (const at of [settings.deadlines ? time(task.deadline) : NaN, settings.deadlines && settings.advanceMinutes ? time(task.deadline) - settings.advanceMinutes * 60000 : NaN, settings.followups ? time(task.followupAt) : NaN]) if (at > now && at < next) next = at;
  }
  if (settings.summaryMode === 'interval') next = Math.min(next, (Math.floor(now / (settings.intervalMinutes * 60000)) + 1) * settings.intervalMinutes * 60000);
  else if (settings.summaryMode !== 'off') {
    const date = new Date(now);
    const [hour, minute] = settings.summaryTime.split(':').map(Number);
    date.setHours(hour, minute, 0, 0);
    if (date.getTime() <= now) date.setDate(date.getDate() + 1);
    next = Math.min(next, date.getTime());
  }
  const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
  return Math.min(next, midnight.getTime());
}

function createTodoReminderService(options) {
  const { BrowserWindow, screen, ipcMain, readSettings, saveSettings, requestAction, openTask, onBadge } = options;
  const now = options.now || Date.now;
  const later = options.setTimeout || setTimeout;
  const cancelLater = options.clearTimeout || clearTimeout;
  let settings = normalizeSettings(readSettings()?.todoReminders);
  let receipts = {};
  for (const [key, at] of Object.entries(readSettings()?.todoReminderReceipts || {})) if (/^[a-f0-9]{32}$/.test(key) && Number.isFinite(at) && at > now() - 90 * DAY) receipts[key] = at;
  let tasks = [];
  let theme = 'light';
  let popup = null;
  let timer = null;
  let disposed = false;
  let alertEntries = [];
  let actionPending = false;
  let lastBadge = '';
  let saveError = '';
  const channels = [];
  const isMain = event => options.isMainSender ? options.isMainSender(event) : event.sender === options.getMainWindow?.()?.webContents;
  const isPopup = event => popup && !popup.isDestroyed() && event.sender === popup.webContents;
  function persistReceipts() {
    receipts = Object.fromEntries(Object.entries(receipts).filter(([, at]) => at > now() - 90 * DAY).sort((a, b) => b[1] - a[1]).slice(0, 2500));
    return saveSettings({ ...readSettings(), todoReminders: settings, todoReminderReceipts: receipts }) !== false;
  }
  function payload() { return { entries: alertEntries, theme, error: saveError, total: alertEntries.length }; }
  function sendPopup() { if (popup && !popup.isDestroyed()) popup.webContents.send('todo-v15:reminder-data', payload()); }
  function closePopup() { if (actionPending) return false; if (popup && !popup.isDestroyed()) popup.close(); return true; }
  function fitPopup(requestedHeight) {
    const current = popup.getBounds();
    const area = (screen.getDisplayMatching?.(current) || screen.getPrimaryDisplay()).workArea;
    const width = Math.min(360, area.width);
    const height = Math.min(Math.max(180, Math.ceil(requestedHeight)), 520, area.height);
    popup.setBounds({ width, height, x: Math.max(area.x, area.x + area.width - width - 16), y: Math.max(area.y, area.y + area.height - height - 16) });
    return { ok: true, height };
  }
  function showPopup(events) {
    const byId = new Map(alertEntries.map(entry => [entry.id, entry]));
    for (const entry of events) if (!byId.has(entry.id) || entry.kind !== 'summary') byId.set(entry.id, entry);
    alertEntries = [...byId.values()].slice(0, 100);
    if (popup && !popup.isDestroyed()) { sendPopup(); return; }
    const display = screen.getPrimaryDisplay();
    const area = display.workArea;
    const width = Math.min(360, area.width);
    const height = Math.min(260, area.height);
    popup = new BrowserWindow({ width, height, x: Math.max(area.x, area.x + area.width - width - 16), y: Math.max(area.y, area.y + area.height - height - 16), show: false, frame: false, resizable: false, maximizable: false, minimizable: false, alwaysOnTop: true, skipTaskbar: true, backgroundColor: theme === 'dark' ? '#3b3833' : '#f4f2ee', webPreferences: { preload: options.preloadPath || path.join(__dirname, 'todo-reminder-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    const created = popup;
    created.webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
    created.webContents.on('will-navigate', event => event.preventDefault());
    created.on('close', event => { if (actionPending) event.preventDefault(); });
    created.on('closed', () => { if (popup === created) { popup = null; alertEntries = []; } });
    created.once('ready-to-show', () => { if (!created.isDestroyed()) { created.setAlwaysOnTop(true, 'screen-saver'); created.showInactive(); } });
    created.loadFile(path.join(__dirname, 'renderer', 'todo-reminder.html'));
  }
  function schedule() {
    if (timer) cancelLater(timer);
    timer = null;
    if (disposed) return;
    timer = later(() => { timer = null; checkNow(); }, Math.max(500, nextCheck(tasks, settings, now()) - now()));
    timer?.unref?.();
  }
  function checkNow() {
    if (disposed) return;
    const badge = getBadge(tasks, now());
    if (JSON.stringify(badge) !== lastBadge) { lastBadge = JSON.stringify(badge); onBadge?.(badge); }
    if (popup && !popup.isDestroyed()) {
      const active = new Map(tasks.filter(task => !task.done).map(task => [task.id, task]));
      alertEntries = alertEntries.filter(entry => {
        const task = active.get(entry.id);
        if (!task || task.deadline !== entry.deadline || task.planDate !== entry.planDate || task.planWeek !== entry.planWeek || task.followupAt !== entry.followupAt) return false;
        entry.text = task.text;
        return true;
      });
      if (!alertEntries.length && !actionPending) closePopup(); else sendPopup();
    }
    const events = collectDue(tasks, settings, receipts, now());
    if (events.length) {
      for (const event of events) receipts[event.key] = now();
      saveError = persistReceipts() ? '' : '提醒记录保存失败；请检查数据文件夹权限。';
      showPopup(events);
    }
    schedule();
  }
  function getSettings() { return { ...settings }; }
  function setSettings(patch) {
    const candidate = normalizeSettings({ ...settings, ...(patch && typeof patch === 'object' ? patch : {}) });
    if (saveSettings({ ...readSettings(), todoReminders: candidate, todoReminderReceipts: receipts }) === false) return { ok: false, error: '提醒设置保存失败，请检查数据文件夹权限。', settings: getSettings() };
    settings = candidate;
    if (!settings.enabled) closePopup();
    checkNow();
    return { ok: true, settings: getSettings() };
  }
  function updateTasks(value, context = {}) {
    tasks = normalizeTasks(value);
    theme = context.theme === 'dark' ? 'dark' : 'light';
    checkNow();
    return { ok: true, badge: getBadge(tasks, now()) };
  }
  function handle(channel, callback) { ipcMain.handle(channel, callback); channels.push(channel); }
  handle('todo-v15:reminders-get', event => isMain(event) ? { ok: true, settings: getSettings() } : { ok: false, error: '无权读取提醒设置' });
  handle('todo-v15:reminders-set', (event, patch) => isMain(event) ? setSettings(patch) : { ok: false, error: '无权修改提醒设置' });
  handle('todo-v15:reminders-update', (event, data) => isMain(event) ? updateTasks(data?.tasks, { theme: data?.theme }) : { ok: false, error: '无权更新待办提醒' });
  handle('todo-v15:reminder-ready', event => isPopup(event) ? { ok: true, ...payload() } : { ok: false });
  handle('todo-v15:reminder-resize', (event, height) => isPopup(event) && Number.isFinite(height) && height > 0 ? fitPopup(height) : { ok: false });
  handle('todo-v15:reminder-close', event => isPopup(event) ? { ok: closePopup() } : { ok: false });
  handle('todo-v15:reminder-action', async (event, data) => {
    if (!isPopup(event) || actionPending || !data || typeof data.id !== 'string') return { ok: false, error: '请等待当前操作完成' };
    const task = tasks.find(item => item.id === data.id && !item.done);
    if (!task || !alertEntries.some(entry => entry.id === task.id)) return { ok: false, error: '这条任务已变更，请查看待办列表。' };
    if (data.action === 'view') { await openTask?.(task.id); closePopup(); return { ok: true }; }
    if (!['complete', 'reschedule', 'acknowledge'].includes(data.action)) return { ok: false, error: '不支持的操作' };
    const action = { action: data.action, id: task.id };
    if (data.action === 'reschedule') {
      if (!Number.isFinite(time(data.deadline)) || time(data.deadline) <= now()) return { ok: false, error: '请选择当前时间之后的日期与时间。' };
      action.deadline = new Date(time(data.deadline)).toISOString();
      action.planDate = localDate(time(data.deadline));
    }
    actionPending = true;
    try {
      const result = await requestAction(action);
      if (result === false || result?.ok === false) return { ok: false, error: result?.error || '保存失败，任务未更改。请重试。' };
      if (data.action === 'complete') task.done = true;
      if (data.action === 'reschedule') { task.deadline = action.deadline; task.planDate = action.planDate; task.planKind = 'day'; }
      alertEntries = alertEntries.filter(entry => entry.id !== task.id);
      return { ok: true };
    } catch (error) { return { ok: false, error: error.message || '操作失败，请重试。' }; }
    finally { actionPending = false; if (!alertEntries.length || !settings.enabled) closePopup(); else sendPopup(); schedule(); const badge = getBadge(tasks, now()); lastBadge = JSON.stringify(badge); onBadge?.(badge); }
  });
  return {
    updateTasks, getSettings, setSettings, checkNow, closePopup,
    getBadge: () => getBadge(tasks, now()),
    dispose() { disposed = true; if (timer) cancelLater(timer); timer = null; actionPending = false; closePopup(); for (const channel of channels) ipcMain.removeHandler(channel); },
  };
}

module.exports = { DEFAULT_SETTINGS, normalizeSettings, normalizeTasks, collectDue, getBadge, nextCheck, createTodoReminderService };
