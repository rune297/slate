const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { createTodoReminderService } = require('../todo-reminders.cjs');
const root = path.join(__dirname, '..');
const profile = process.env.TODO_TEST_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'slate-v15-reminders-'));
app.setPath('userData', profile);
app.disableHardwareAcceleration(); // Deterministic headful test on Windows CI.
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, label) { const until = Date.now() + 12000; while (Date.now() < until) { const value = await predicate(); if (value) return value; await pause(30); } throw new Error(`Timed out: ${label}`); }
let service;
const errors = [];
app.on('web-contents-created', (_event, contents) => { contents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); }); });
const timeout = setTimeout(() => { console.error('Reminder UI timed out', errors); app.exit(1); }, 60000);
app.whenReady().then(async () => {
  try {
    let settings = { untouched: 'retained', todoReminders: { summaryMode: 'off' } };
    let saveFails = false;
    let actionFails = false;
    const calls = [];
    const views = [];
    const now = Date.now();
    const canonical = new BrowserWindow({ show: false, width: 920, height: 900, webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
    service = createTodoReminderService({ BrowserWindow, screen, ipcMain, readSettings: () => settings, saveSettings: value => { if (saveFails) return false; settings = value; return true; }, isMainSender: event => event.sender === canonical.webContents, preloadPath: path.join(root, 'todo-reminder-preload.js'), requestAction: async action => { calls.push(action); return actionFails ? { ok: false, error: '测试：保存失败，请重试。' } : { ok: true }; }, openTask: async id => views.push(id), now: () => now });
    await canonical.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><body><main id="tab-settings"><div class="settings-page"><div class="settings-column settings-column-secondary"></div></div></main></body></html>'));
    const evaluateSettings = script => canonical.webContents.executeJavaScript(script);
    await canonical.webContents.insertCSS('*{box-sizing:border-box}'); // Match the production styles.css reset.
    await canonical.webContents.insertCSS(fs.readFileSync(path.join(root, 'renderer', 'brand.css'), 'utf8') + '\n:root{--font:Segoe UI;--s-3:16px;--text-1:var(--brand-text);--text-2:var(--brand-text-secondary);--text-3:var(--brand-text-muted);--surface-1:var(--brand-surface);--hover-bg:var(--brand-surface-raised);--border-soft:var(--brand-control-border);--border-soft-strong:var(--brand-control-border);--hairline-soft:var(--brand-control-border)}' + fs.readFileSync(path.join(root, 'renderer', 'settings.css'), 'utf8'));
    await evaluateSettings(fs.readFileSync(path.join(root, 'renderer', 'reminder-settings.js'), 'utf8'));
    await waitFor(() => evaluateSettings("!!document.getElementById('reminders-enabled') && !document.getElementById('reminders-enabled').disabled"), 'reminder settings loaded through production preload');
    assert.equal(await evaluateSettings("document.getElementById('reminders-summary-enabled').checked"), false);
    await evaluateSettings("document.getElementById('reminders-summary-enabled').click()");
    await waitFor(() => evaluateSettings("!document.getElementById('reminders-summary-enabled').disabled"), 'daily summary setting persisted');
    assert.equal(settings.todoReminders.summaryMode, 'daily');
    assert.equal(await evaluateSettings("getComputedStyle(document.getElementById('reminders-time-row')).display !== 'none'"), true);
    assert.equal(await evaluateSettings("document.getElementById('reminders-summaryMode')"), null, 'frequency choices are not required for everyday reminders');
    assert.equal(await evaluateSettings("Math.round(document.getElementById('reminders-summaryTime').getBoundingClientRect().height)"), 32);
    saveFails = true;
    await evaluateSettings("document.getElementById('reminders-enabled').click()");
    await waitFor(() => evaluateSettings("!document.getElementById('reminders-enabled').disabled"), 'failed save unblocks settings');
    assert.equal(settings.todoReminders.enabled, true);
    assert.equal(await evaluateSettings("document.getElementById('reminders-enabled').checked"), true);
    assert.match(await evaluateSettings("document.getElementById('reminders-status').textContent"), /失败/);
    saveFails = false;
    service.setSettings({ summaryMode: 'off' });
    const tasks = [{ id: 'first', text: '测试：完成前必须保存成功', done: false, deadline: new Date(now - 60000).toISOString() }, { id: 'second', text: '测试：稍后处理任务的完整标题', done: false, deadline: new Date(now - 120000).toISOString() }];
    service.updateTasks(tasks, { theme: 'dark' });
    const popup = await waitFor(() => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/renderer/todo-reminder.html')), 'real reminder popup');
    const evaluate = script => popup.webContents.executeJavaScript(script);
    await waitFor(() => evaluate("document.body.classList.contains('ready')"), 'production reminder rendered');
    await waitFor(() => popup.isVisible(), 'native reminder ready-to-show');
    assert.equal(await evaluate('document.documentElement.dataset.theme'), 'dark');
    assert.equal(await evaluate("document.getElementById('reminder-count').textContent"), '1 / 2');
    assert.equal(popup.isAlwaysOnTop(), true);
    assert.equal(popup.isFocused(), false, 'reminders never steal focus');
    assert.equal(canonical.isVisible(), false, 'a reminder does not expand the main workspace');
    // ready is set before the renderer's animation-frame resize IPC arrives.
    // Wait for both dimensions: the initial height already satisfies < 300.
    await waitFor(() => { const bounds = popup.getBounds(); return bounds.width <= 365 && bounds.height < 300; }, 'content-sized compact reminder');
    assert.ok(popup.getBounds().width <= 365, JSON.stringify(popup.getBounds()));
    const boxes = await evaluate("['reminder-complete','reminder-reschedule','reminder-acknowledge'].map(id=>{const b=document.getElementById(id).getBoundingClientRect();return {id,x:b.x,right:b.right,y:b.y,height:b.height}})");
    for (const box of boxes) { assert.equal(box.height, 32); assert.ok(box.x >= 0 && box.right <= 420); }
    if (process.env.SLATE_V15_SCREENSHOT_DIR) { fs.mkdirSync(process.env.SLATE_V15_SCREENSHOT_DIR, { recursive: true }); fs.writeFileSync(path.join(process.env.SLATE_V15_SCREENSHOT_DIR, 'reminder-dark.png'), (await popup.webContents.capturePage()).toPNG()); }
    actionFails = true;
    await evaluate("document.getElementById('reminder-complete').click()");
    await waitFor(() => evaluate("document.getElementById('reminder-feedback').textContent.includes('失败')"), 'failed action feedback');
    assert.equal(popup.isDestroyed(), false);
    assert.equal(await evaluate("document.getElementById('reminder-count').textContent"), '1 / 2');
    const failedTaskId = calls.at(-1).id;
    actionFails = false;
    await evaluate("document.getElementById('reminder-complete').click()");
    await waitFor(() => evaluate("document.getElementById('reminder-count').textContent === '1 / 1'"), 'successful completion removes only saved task');
    assert.equal(calls.at(-1).id, failedTaskId);
    assert.equal(await evaluate("document.getElementById('reminder-prev').hidden && document.getElementById('reminder-next').hidden && document.getElementById('reminder-count').hidden"), true, 'a single remaining task has no empty pagination');
    assert.equal(await evaluate("document.getElementById('reminder-reschedule').textContent"), '调整任务');
    const compactHeight = popup.getBounds().height;
    await evaluate("document.getElementById('reminder-reschedule').click()");
    assert.equal(await evaluate("document.getElementById('reminder-reschedule-fields').hidden"), false);
    await waitFor(() => popup.getBounds().height > compactHeight, 'adjustment grows only as much as the form needs');
    assert.equal(await evaluate("document.getElementById('reminder-edit').checkVisibility()"), true, 'cancelled or changed work can be opened for editing');
    const later = new Date(now + 2 * 24 * 60 * 60000);
    const local = `${later.getFullYear()}-${String(later.getMonth()+1).padStart(2,'0')}-${String(later.getDate()).padStart(2,'0')}T12:00`;
    await evaluate(`document.getElementById('reminder-deadline').value=${JSON.stringify(local)};document.getElementById('reminder-confirm').click()`);
    await waitFor(() => popup.isDestroyed(), 'reschedule closes final notification');
    assert.equal(calls.at(-1).action, 'reschedule');
    assert.equal(calls.at(-1).planDate, local.slice(0,10));
    const saved = JSON.parse(JSON.stringify(settings));
    service.dispose();
    service = createTodoReminderService({ BrowserWindow, screen, ipcMain, readSettings: () => saved, saveSettings: value => Object.assign(saved, value), isMainSender: event => event.sender === canonical.webContents, preloadPath: path.join(root, 'todo-reminder-preload.js'), requestAction: async action => { calls.push(action); return { ok: true }; }, openTask: async id => views.push(id), now: () => now });
    service.updateTasks(tasks);
    await pause(100);
    assert.equal(BrowserWindow.getAllWindows().filter(win => win.webContents.getURL().endsWith('/renderer/todo-reminder.html')).length, 0, 'restart receipts suppress the same notification');
    service.updateTasks([{ id: 'fresh', text: '测试：查看时打开原任务', done: false, deadline: new Date(now - 60000).toISOString() }], { theme: 'light' });
    const viewPopup = await waitFor(() => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/renderer/todo-reminder.html')), 'fresh task popup');
    await waitFor(() => viewPopup.webContents.executeJavaScript("document.body.classList.contains('ready')"), 'fresh popup ready');
    await waitFor(() => viewPopup.getBounds().height < 300, 'single item compact height');
    if (process.env.SLATE_V15_SCREENSHOT_DIR) fs.writeFileSync(path.join(process.env.SLATE_V15_SCREENSHOT_DIR, 'reminder-light.png'), (await viewPopup.webContents.capturePage()).toPNG());
    await viewPopup.webContents.executeJavaScript("document.getElementById('reminder-reschedule').click();document.getElementById('reminder-edit').click()");
    await waitFor(() => viewPopup.isDestroyed(), 'view hands off original task');
    assert.deepEqual(views, ['fresh']);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Slate 1.5 reminder settings and production notification UI passed.');
    clearTimeout(timeout); service.dispose(); canonical.destroy(); app.exit(0);
  } catch (error) { clearTimeout(timeout); console.error(error.stack); console.error(errors.join('\n')); service?.dispose(); app.exit(1); }
});
