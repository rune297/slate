const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { createTodoReminderService } = require('../todo-reminders.cjs');
const root = path.join(__dirname, '..');
const profile = process.env.TODO_TEST_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'slate-todo-mvp-'));
app.setPath('userData', profile);
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, label) {
  const until = Date.now() + 10000;
  while (Date.now() < until) { if (await predicate()) return; await pause(30); }
  throw new Error(`Timed out: ${label}`);
}
let service, canonical;
const errors = [];
app.on('web-contents-created', (_event, contents) => contents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); }));
const timeout = setTimeout(() => { console.error('MVP UI timed out', errors); app.exit(1); }, 60000);
app.whenReady().then(async () => {
  try {
    let settings = {}, saveFails = false;
    fs.mkdirSync(profile, { recursive: true });
    const fixture = path.join(profile, 'mvp-fixture.html');
    fs.writeFileSync(fixture, '<!doctype html><html data-theme="dark"><head><meta charset="utf-8"></head><body><main id="tab-settings"><div class="settings-page"><div class="settings-column settings-column-secondary"></div></div></main><section id="tab-todo"><div class="todo-toolbar"></div><div id="todo-list"></div></section></body></html>');
    canonical = new BrowserWindow({ show: false, width: 1040, height: 620, webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
    service = createTodoReminderService({ BrowserWindow, screen, ipcMain, readSettings: () => settings, saveSettings: value => { if (saveFails) return false; settings = value; return true; }, isMainSender: event => event.sender === canonical.webContents, preloadPath: path.join(root, 'todo-reminder-preload.js'), requestAction: async () => ({ ok: true }), openTask: () => {} });
    await canonical.loadFile(fixture);
    const evaluate = script => canonical.webContents.executeJavaScript(script);
    const source = filename => fs.readFileSync(path.join(root, 'renderer', filename), 'utf8');
    await canonical.webContents.insertCSS(source('brand.css') + '\n:root{--font:Segoe UI;--s-3:16px;--bg-base:var(--brand-canvas);--text-1:var(--brand-text);--text-2:var(--brand-text-secondary);--text-3:var(--brand-text-muted);--surface-1:var(--brand-surface);--hover-bg:var(--brand-surface-raised);--hover-bg-strong:var(--brand-surface-hover);--border-soft:var(--brand-control-border);--border-soft-strong:var(--brand-control-border);--hairline-soft:var(--brand-control-border);--focus-ring:var(--brand-focus);--scrollbar-thumb-hover:var(--brand-control-border)}body{margin:0;padding:20px;background:var(--bg-base);color:var(--text-1);font-family:var(--font)}' + source('settings.css') + source('task-planner.css'));
    async function reloadSettings() {
      await evaluate("document.getElementById('settings-todo-reminders')?.remove()");
      await evaluate(source('reminder-settings.js'));
      await waitFor(() => evaluate("!!document.getElementById('reminders-enabled') && !document.getElementById('reminders-enabled').disabled"), 'reminder settings ready');
    }
    async function waitSaved() { await waitFor(() => evaluate("!document.getElementById('reminders-enabled').disabled"), 'settings save complete'); }
    await reloadSettings();
    assert.equal(await evaluate("document.getElementById('reminders-enabled').checked"), true);
    assert.equal(await evaluate("document.getElementById('reminders-summary-enabled').checked"), true);
    assert.equal(await evaluate("document.getElementById('reminders-summaryTime').value"), '18:00');
    assert.equal(await evaluate("document.getElementById('reminders-custom-settings').hidden"), true, 'first-time users do not see advanced reminder controls');
    assert.equal(await evaluate("document.querySelectorAll('#settings-todo-reminders input').length"), 3);
    assert.equal(await evaluate("document.querySelectorAll('#settings-todo-reminders select').length"), 0);
    saveFails = true;
    await evaluate("document.getElementById('reminders-enabled').click()");
    await waitSaved();
    assert.equal(await evaluate("document.getElementById('reminders-enabled').checked"), true, 'failed master switch rolls back to stored state');
    assert.match(await evaluate("document.getElementById('reminders-status').textContent"), /失败/);
    await evaluate("document.getElementById('reminders-summary-enabled').click()");
    await waitSaved();
    assert.equal(await evaluate("document.getElementById('reminders-summary-enabled').checked"), true, 'failed summary switch also rolls back');
    saveFails = false;
    service.setSettings({ summaryMode: 'weekly', summaryWeekday: 3, summaryTime: '17:20', deadlines: false, advanceMinutes: 15 });
    await reloadSettings();
    assert.match(await evaluate("document.getElementById('reminders-summary-description').textContent"), /每周三/);
    await evaluate("document.getElementById('reminders-summaryTime').value='17:40';document.getElementById('reminders-summaryTime').dispatchEvent(new Event('change'))");
    await waitSaved();
    assert.equal(settings.todoReminders.summaryMode, 'weekly', 'changing a visible field does not silently change legacy cadence');
    assert.equal(settings.todoReminders.summaryWeekday, 3);
    assert.equal(settings.todoReminders.advanceMinutes, 15);
    assert.equal(settings.todoReminders.deadlines, false);
    await evaluate("document.getElementById('reminders-summary-enabled').click()"); await waitSaved();
    assert.equal(settings.todoReminders.summaryMode, 'off');
    await evaluate("document.getElementById('reminders-summary-enabled').click()"); await waitSaved();
    assert.equal(settings.todoReminders.summaryMode, 'weekly', 'temporary disable retains the previously selected cadence');
    await evaluate("document.getElementById('reminders-reset').click()"); await waitSaved();
    assert.equal(settings.todoReminders.summaryMode, 'daily');
    assert.equal(settings.todoReminders.summaryTime, '18:00');
    assert.equal(settings.todoReminders.deadlines, true);
    assert.equal(settings.todoReminders.advanceMinutes, 0);
    assert.equal(await evaluate("document.getElementById('reminders-custom-settings').hidden"), true);
    await evaluate(`window.__tasks=[];window.SlateTasks={isReady:()=>true,categories:()=>[{id:'P3',name:'工作'}],getAll:()=>window.__tasks,addScheduled:(task,bucket)=>{if(!window.__tasks.some(row=>row.id===task.id))window.__tasks.push({...task,bucket});return true;}};void 0`);
    await evaluate(source('recurrence.js'));
    await evaluate(source('task-planner.js'));
    await evaluate("document.querySelector('[data-recurring-open]').click()");
    assert.equal(await evaluate("document.querySelector('#repeat-dialog .repeat-more').open"), false);
    assert.equal(await evaluate("document.querySelector('#repeat-dialog [name=startDate]').value===window.SlateRecurrence.key(new Date())"), true);
    assert.equal(await evaluate("document.querySelector('#repeat-dialog [name=deadlineTime]').value"), '18:00');
    assert.equal(await evaluate("document.querySelector('#repeat-dialog [name=bucket]').checkVisibility()"), false, 'low-frequency fields are collapsed');
    await evaluate("document.querySelector('#repeat-dialog [name=title]').value='每日检查';document.querySelector('#repeat-dialog form').requestSubmit()");
    assert.equal(await evaluate("window.SlateRecurring.getRules().length"), 1);
    assert.equal(await evaluate("window.__tasks.filter(task=>task.text==='每日检查').length"), 1);
    await evaluate("window.SlateRecurring.generate();window.SlateRecurring.generate()");
    assert.equal(await evaluate("window.__tasks.filter(task=>task.text==='每日检查').length"), 1);
    await evaluate("document.querySelector('#repeat-dialog .repeat-more').open=true;document.querySelector('#repeat-dialog [name=endDate]').value='2099-12-31';document.querySelector('#repeat-dialog [name=notes]').value='结束日期和说明需要保留';document.querySelector('#repeat-dialog [name=important]').checked=true;document.querySelector('#repeat-dialog .repeat-more').open=false;document.querySelector('#repeat-dialog form').requestSubmit()");
    assert.equal(await evaluate("window.SlateRecurring.getRules()[0].endDate"), '2099-12-31');
    await evaluate("document.querySelector('#repeat-dialog [data-repeat=edit]').click();document.querySelector('#repeat-dialog [name=title]').value='修改后的每日检查';document.querySelector('#repeat-dialog form').requestSubmit()");
    assert.equal(await evaluate("window.SlateRecurring.getRules()[0].endDate"), '2099-12-31', 'editing basic fields preserves hidden end date');
    assert.equal(await evaluate("window.SlateRecurring.getRules()[0].notes"), '结束日期和说明需要保留');
    assert.equal(await evaluate("window.SlateRecurring.getRules()[0].important"), true);
    await evaluate("document.querySelector('#repeat-dialog [data-repeat=toggle]').click()");
    assert.equal(await evaluate("window.SlateRecurring.getRules()[0].enabled"), false);
    assert.equal(await evaluate("document.querySelector('#repeat-dialog [data-repeat=toggle]').textContent"), '恢复');
    await evaluate("document.querySelector('#repeat-dialog [data-repeat=toggle]').click()");
    assert.equal(await evaluate("window.SlateRecurring.getRules()[0].enabled"), true);
    await evaluate("(()=>{const rows=window.SlateRecurring.getRules(),sample=rows[0];for(let i=1;i<40;i++)rows.push({...sample,id:'long-rule-'+i,title:'长列表中的事项 '+i});localStorage.setItem('slate-recurring-tasks-v1',JSON.stringify(rows));window.SlateRecurring.open();})()");
    const desktop = await evaluate("(()=>{const d=document.getElementById('repeat-dialog'),f=d.querySelector('footer').getBoundingClientRect(),h=d.querySelector('header').getBoundingClientRect(),r=d.querySelector('.repeat-rules');return{footer:f.bottom,header:h.top,height:innerHeight,scrolls:r.scrollHeight>r.clientHeight,buttonHeight:d.querySelector('[type=submit]').getBoundingClientRect().height}})()");
    assert.ok(desktop.footer <= desktop.height && desktop.header >= 0, JSON.stringify(desktop));
    assert.equal(desktop.scrolls, true, 'the rule list scrolls without pushing save controls off screen');
    assert.equal(desktop.buttonHeight, 32);
    if (process.env.SLATE_V15_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.SLATE_V15_SCREENSHOT_DIR, { recursive: true });
      fs.writeFileSync(path.join(process.env.SLATE_V15_SCREENSHOT_DIR, 'recurring-mvp-dark.png'), (await canonical.webContents.capturePage()).toPNG());
    }
    canonical.setSize(520, 620);
    await pause(60);
    const compact = await evaluate("(()=>{const d=document.getElementById('repeat-dialog'),f=d.querySelector('footer').getBoundingClientRect();return{footer:f.bottom,height:innerHeight,overflow:d.scrollWidth>d.clientWidth}})()");
    assert.ok(compact.footer <= compact.height, JSON.stringify(compact));
    assert.equal(compact.overflow, false);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Todo MVP defaults, save rollback, legacy settings preservation, compact recurrence form and long-list layout passed.');
    clearTimeout(timeout); service.dispose(); canonical.destroy(); app.exit(0);
  } catch (error) { clearTimeout(timeout); console.error(error.stack, errors); service?.dispose(); app.exit(1); }
});
