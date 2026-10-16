const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

// main.js selects its data path from Chromium's switch. A test app.setPath alone
// would be overwritten by production bootstrap and touch the user's real data.
const profile = process.env.TODO_TEST_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'slate-workflow-test-'));
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
const now = new Date();
const localDate = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const today = localDate(now);
const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
const oldCompletion = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 35, 12).getTime();
const draft = '首页草稿保留：方案范围已确认，等采购回信。';
const existingArchive = { id: 'existing-work-note', title: '已有工作记录', titleSource: 'user', content: draft, createdAt: now.getTime() - 10000, updatedAt: now.getTime() - 10000 };
const initialTasks = { P0: [], P1: [], P2: [], P3: [
  { id: 'yesterday-focus', text: '昨天重点需要重新安排', done: false, createdAt: yesterday.getTime(), focusDate: localDate(yesterday), focusOrder: 0, deadline: '', pinnedToday: false },
  { id: 'old-completion', text: '上月完成的旧成果', done: true, createdAt: oldCompletion - 3600000, completedAt: oldCompletion, deadline: '' },
] };
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'workspace.json'), JSON.stringify({ version: 1, localStorage: {
  'slate-todo-data': JSON.stringify(initialTasks),
  'slate-home-note': draft,
  'slate-note-archive-v1': JSON.stringify([existingArchive]),
  'slate-note-active-archive-v1': existingArchive.id,
} }));
fs.writeFileSync(path.join(profile, 'app-settings.json'), JSON.stringify({
  shortcut: 'Control+Alt+S', defaultTab: 'home',
  features: { home: true, todo: true, notes: true, links: true, recordings: false, credentials: false, clip: true },
  clipboard: { captureEnabled: false, retentionDays: 7, ignoredApps: [], pausedUntil: 0 },
}));

const errors = [];
function diagnostic(message) {
  console.log(message);
  if (process.env.TODO_TEST_LOG) fs.appendFileSync(process.env.TODO_TEST_LOG, `${message}\n`);
}
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(`${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
});
const timeout = setTimeout(() => { diagnostic(`Work workflow timed out: ${JSON.stringify(errors)}`); app.exit(1); }, 60000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, description, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await sleep(30);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

app.whenReady().then(async () => {
  try {
    const main = await waitFor(() => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/renderer/index.html')), 'production main window');
    const evaluate = (script) => main.webContents.executeJavaScript(script).catch((error) => {
      throw new Error(`Renderer action failed: ${script.slice(0, 350)}\n${errors.join('\n')}\n${error.message}`, { cause: error });
    });
    const tasks = () => evaluate("Object.values(JSON.parse(localStorage.getItem('slate-todo-data') || '{}')).flat()");
    const archives = () => evaluate("JSON.parse(localStorage.getItem('slate-note-archive-v1') || '[]')");
    const click = (selector) => evaluate(`(() => { const target = document.querySelector(${JSON.stringify(selector)}); if (!target || target.disabled) throw new Error('Missing or disabled control: ' + ${JSON.stringify(selector)}); target.click(); return target.textContent.trim(); })()`);
    const fill = (selector, value) => evaluate(`(() => { const target = document.querySelector(${JSON.stringify(selector)}); if (!target) throw new Error('Missing input: ' + ${JSON.stringify(selector)}); target.value = ${JSON.stringify(value)}; target.dispatchEvent(new Event('input', { bubbles: true })); target.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const row = (id) => `#todo-list [data-id="${id}"]`;
    const homeRow = (id) => `#home-focus-list [data-id="${id}"]`;
    const homeIds = () => evaluate("[...document.querySelectorAll('#home-focus-list [data-id]')].map((row) => row.dataset.id)");
    const tab = async (name) => {
      await click(`#tab-button-${name}`);
      await waitFor(() => evaluate(`document.getElementById('tab-${name}').classList.contains('active')`), `${name} tab`);
    };
    const submit = async (selector, text) => {
      await fill(selector, text);
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
      main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      main.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      return waitFor(async () => (await tasks()).find((item) => item.text === text), `task ${text}`);
    };
    await waitFor(() => evaluate(`!!window.SlateHome && typeof workspaceHydrating !== 'undefined' && !workspaceHydrating && document.getElementById('home-note').value === ${JSON.stringify(draft)} && !!document.getElementById('home-task-input')`).catch(() => false), 'workspace recovery and workflow controls');
    assert.equal(path.resolve(app.getPath('userData')), path.resolve(profile), 'production bootstrap must use the isolated test profile');
    const workspace = await evaluate('window.slateAPI.getWorkspace()');
    assert.equal(path.resolve(workspace.path), path.resolve(profile), 'production workspace must also stay inside the isolated profile');
    await evaluate('setMode(true)');
    await waitFor(() => evaluate("document.getElementById('app').classList.contains('expanded')"), 'expanded panel');
    await tab('home');
    assert.ok(await evaluate("document.querySelector('[data-home-module=\"tasks\"] #home-task-input') !== null"), 'task capture belongs to its dedicated homepage tile');
    assert.ok(await evaluate("document.querySelector('[data-home-module=\"note\"] #home-note') !== null"), 'notes remain independently editable beside task planning');
    assert.deepEqual(await homeIds(), ['yesterday-focus'], 'unfinished earlier work is visible for rescheduling instead of silently disappearing');
    assert.equal(await evaluate("window.SlateWorkflow.isFocus(window.SlateTasks.getAll().find(item => item.id === 'yesterday-focus'))"), false,
      'an unfinished earlier focus must not silently become today\'s focus');

    diagnostic('Workflow: create and reorder today focus through homepage');
    const first = await submit('#home-task-input', '工作流主任务');
    const second = await submit('#home-task-input', '第二项交付任务');
    assert.equal(first.planDate, today, 'homepage entry binds its plan to the selected date');
    assert.equal(second.planDate, today);
    assert.equal(first.focusDate, '', 'quick capture never promotes every task to a focus');
    await click(`${homeRow(second.id)} [data-work-action="focus"]`);
    await click(`${homeRow(first.id)} [data-work-action="focus"]`);
    assert.deepEqual(await homeIds(), [first.id, second.id, 'yesterday-focus']);
    await click(`${homeRow(first.id)} [data-work-action="down"]`);
    assert.deepEqual(await homeIds(), [second.id, first.id, 'yesterday-focus'], 'focus order changes without creating duplicate task records');
    await click(`${homeRow(first.id)} [data-work-action="up"]`);
    assert.deepEqual(await homeIds(), [first.id, second.id, 'yesterday-focus']);

    diagnostic('Workflow: independent deadline and external follow-up in existing task details');
    await click('#home-work-open');
    await waitFor(() => evaluate("document.getElementById('tab-todo').classList.contains('active')"), 'homepage opens existing todo tab');
    await click('.todo-view[data-view="inbox"]');
    const waiting = await submit('#todo-quick-input', '等待采购反馈');
    await click(`${row(waiting.id)} [data-action="edit"]`);
    await click(`${row(waiting.id)} [data-action="edit-deadline"]`);
    await click('#todo-calendar-next');
    await click('#todo-calendar-grid [data-day="15"]');
    const deadline = (await tasks()).find((item) => item.id === waiting.id).deadline;
    assert.ok(Number.isFinite(Date.parse(deadline)), 'original calendar still saves the deadline');
    await evaluate("document.getElementById('todo-quick-input').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))");
    await click('.todo-view[data-view="inbox"]');
    await click(`${row(waiting.id)} [data-action="save-edit"]`);
    const pinLabel = await click(`${row(waiting.id)} [data-action="pin"]`);
    assert.match(pinLabel, /设为重点|今日重点/, 'focus action has a clear label');
    assert.equal((await tasks()).find((item) => item.id === waiting.id).focusDate, today);
    await click('.todo-view[data-view="today"]');
    await click(`${row(waiting.id)} [data-action="details"]`);
    const followupDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 10, 30);
    const followupInput = `${localDate(followupDate)}T10:30`;
    const detailNotes = '等待采购同事确认范围\n- [ ] 联系采购\n- [ ] 更新方案';
    await fill(`${row(waiting.id)} [data-detail="status"]`, 'waiting');
    await fill(`${row(waiting.id)} [data-detail="followup"]`, followupInput);
    await fill(`${row(waiting.id)} [data-detail="estimate"]`, '45');
    await fill(`${row(waiting.id)} [data-detail="notes"]`, detailNotes);
    await click(`${row(waiting.id)} [data-action="save-details"]`);
    let savedWaiting = (await tasks()).find((item) => item.id === waiting.id);
    assert.equal(savedWaiting.status, 'waiting');
    assert.equal(savedWaiting.followupAt, followupDate.toISOString());
    assert.equal(savedWaiting.deadline, deadline, 'follow-up time must not overwrite delivery deadline');
    assert.equal(savedWaiting.notes, detailNotes);
    assert.equal(savedWaiting.estimateMinutes, 45);

    diagnostic('Workflow: completion is shared with todo and gets a timestamp');
    await tab('home');
    assert.ok((await homeIds()).includes(waiting.id), 'todo focus and homepage refer to the same record');
    const beforeComplete = await evaluate('Date.now()');
    await click(`${homeRow(first.id)} [data-work-action="toggle"]`);
    const completed = (await tasks()).find((item) => item.id === first.id);
    const afterComplete = await evaluate('Date.now()');
    assert.equal(completed.done, true);
    assert.ok(Number(completed.completedAt) >= beforeComplete && Number(completed.completedAt) <= afterComplete,
      `completion records the actual renderer time: before=${beforeComplete}, completed=${completed.completedAt}, after=${afterComplete}`);
    assert.ok(!(await homeIds()).includes(first.id), 'completed focus leaves homepage');

    diagnostic('Workflow: reload keeps task state, focus order and note draft');
    await main.webContents.reload();
    await waitFor(() => evaluate(`!!window.SlateHome && !workspaceHydrating && document.getElementById('home-note').value === ${JSON.stringify(draft)}`).catch(() => false), 'reload recovers draft');
    await evaluate('setMode(true)');
    await tab('home');
    savedWaiting = (await tasks()).find((item) => item.id === waiting.id);
    assert.equal(savedWaiting.status, 'waiting');
    assert.equal(savedWaiting.followupAt, followupDate.toISOString());
    assert.equal(savedWaiting.deadline, deadline);
    assert.equal(savedWaiting.notes, detailNotes);
    assert.equal(savedWaiting.estimateMinutes, 45);
    assert.equal(savedWaiting.focusDate, today);
    assert.equal((await tasks()).find((item) => item.id === first.id).completedAt, completed.completedAt);
    assert.deepEqual(await homeIds(), [second.id, waiting.id, 'yesterday-focus'], 'reload preserves remaining focus order and overdue work');

    await tab('todo');
    await click('.todo-view[data-view="today"]');
    await click(`${row(waiting.id)} [data-action="details"]`);
    const restoredDetails = await evaluate(`(() => {
      const item = document.querySelector(${JSON.stringify(row(waiting.id))});
      return Object.fromEntries(['status', 'followup', 'notes', 'estimate'].map((key) => [key, item.querySelector('[data-detail="' + key + '"]').value]));
    })()`);
    assert.deepEqual(restoredDetails, { status: 'waiting', followup: followupInput, notes: detailNotes, estimate: '45' }, 'expanded task details recover their saved values');
    await fill(`${row(waiting.id)} [data-detail="status"]`, 'followup');
    await click(`${row(waiting.id)} [data-action="save-details"]`);
    const following = (await tasks()).find((item) => item.id === waiting.id);
    assert.equal(following.status, 'followup', 'waiting and ongoing follow-up are states of the same task');
    assert.equal(following.followupAt, followupDate.toISOString());
    assert.equal(following.deadline, deadline);
    assert.equal((await tasks()).filter((item) => item.id === waiting.id).length, 1);
    diagnostic('Workflow: day and week reviews become separate editable notes without taking over the draft');
    await tab('todo');
    const initialArchiveCount = (await archives()).length;
    await click('#home-review-day');
    await waitFor(() => evaluate("document.getElementById('tab-notes').classList.contains('active') && !!document.getElementById('notes-editor')"), 'day review editor');
    const dayEditor = await evaluate("({ id: document.getElementById('notes-editor').dataset.noteId, content: document.getElementById('notes-editor').value })");
    assert.equal((await archives()).length, initialArchiveCount + 1);
    assert.notEqual(dayEditor.id, existingArchive.id);
    assert.match(dayEditor.content, /工作流主任务/);
    assert.match(dayEditor.content, /第二项交付任务/);
    assert.match(dayEditor.content, /等待采购反馈/);
    assert.doesNotMatch(dayEditor.content, /上月完成的旧成果/);
    await fill('#notes-editor', `${dayEditor.content}\n人工补充阻滞：采购尚未回信。`);
    await evaluate("document.getElementById('notes-editor').dispatchEvent(new Event('focusout', { bubbles: true }))");
    await waitFor(async () => (await archives()).find((note) => note.id === dayEditor.id)?.content.includes('人工补充阻滞'), 'review edit autosave');
    await tab('todo');
    await click('#home-review-week');
    await waitFor(() => evaluate("document.getElementById('tab-notes').classList.contains('active') && document.getElementById('notes-editor').dataset.noteId !== " + JSON.stringify(dayEditor.id)), 'separate week review editor');
    const weekEditor = await evaluate("({ id: document.getElementById('notes-editor').dataset.noteId, content: document.getElementById('notes-editor').value })");
    assert.notEqual(weekEditor.id, existingArchive.id);
    assert.notEqual(weekEditor.id, dayEditor.id);
    assert.match(weekEditor.content, /工作流主任务/);
    assert.doesNotMatch(weekEditor.content, /上月完成的旧成果/, 'weekly completed results use completedAt, not creation time');
    assert.equal((await archives()).length, initialArchiveCount + 2);
    const finalState = await evaluate("({ draft: document.getElementById('home-note').value, storedDraft: localStorage.getItem('slate-home-note'), activeId: localStorage.getItem('slate-note-active-archive-v1'), old: JSON.parse(localStorage.getItem('slate-note-archive-v1')).find((note) => note.id === 'existing-work-note') })");
    assert.equal(finalState.draft, draft);
    assert.equal(finalState.storedDraft, draft);
    assert.equal(finalState.activeId, existingArchive.id, 'reviews never bind themselves to the homepage note draft');
    assert.equal(finalState.old.content, draft, 'existing archived note remains intact');

    diagnostic('Workflow: homepage reschedule reuses calendar and separates plan date from delivery deadline');
    await tab('home');
    const beforeReschedule = (await tasks()).find((item) => item.id === second.id);
    await click(`${homeRow(second.id)} [data-work-action="reschedule"]`);
    assert.equal(await evaluate("document.getElementById('todo-date-popover').hidden"), false, 'homepage reschedule reuses the calendar for a plan date');
    await click('#todo-calendar-next');
    await click('#todo-calendar-grid [data-day="20"]');
    const rescheduled = (await tasks()).find((item) => item.id === second.id);
    assert.ok(rescheduled.planDate > today, 'reschedule saves a future plan date');
    assert.equal(rescheduled.deadline, beforeReschedule.deadline, 'moving the work plan does not change its delivery deadline');
    assert.equal(rescheduled.focusDate, '', 'moving work away from today clears its previous focus');
    assert.ok(!(await homeIds()).includes(second.id), 'future focus leaves the homepage today list');
    await evaluate("document.getElementById('home-task-input').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))");
    await tab('todo');
    await click('.todo-view[data-view="inbox"]');
    assert.ok(await evaluate(`!!document.querySelector(${JSON.stringify(row(second.id))})`), 'a task rescheduled beyond this week remains available in Later');
    assert.deepEqual(errors, [], 'workflow must run without renderer console errors');
    diagnostic('Production daily workflow checks passed');
    clearTimeout(timeout);
    app.quit();
  } catch (error) {
    diagnostic(error.stack || String(error));
    clearTimeout(timeout);
    app.exit(1);
  }
});

require('../main.js');
