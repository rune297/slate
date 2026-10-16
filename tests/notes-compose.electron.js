const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const profile = process.env.TODO_TEST_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'slate-notes-compose-'));
app.commandLine.appendSwitch('user-data-dir', profile);
const homeDraft = '隐藏首页组件里的草稿必须保持原样';
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'workspace.json'), JSON.stringify({ version: 1, localStorage: {
  'slate-home-note': homeDraft,
  'slate-home-hidden-modules-v1': JSON.stringify(['note', 'recorder']),
  'slate-note-archive-v1': '[]',
} }));
fs.writeFileSync(path.join(profile, 'app-settings.json'), JSON.stringify({
  shortcut: 'Control+Alt+N', defaultTab: 'notes',
  features: { home: true, todo: true, notes: true, links: true, recordings: false, credentials: false, clip: true },
  clipboard: { captureEnabled: false, retentionDays: 7, ignoredApps: [], pausedUntil: 0 },
}));
const errors = [];
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
});
const timeout = setTimeout(() => { console.error(`Notes compose timed out: ${JSON.stringify(errors)}`); app.exit(1); }, 60000);
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
    const main = await waitFor(() => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/renderer/index.html')), 'main window');
    const evaluate = (script) => main.webContents.executeJavaScript(script);
    const archives = () => evaluate("JSON.parse(localStorage.getItem('slate-note-archive-v1') || '[]')");
    const click = (selector) => evaluate(`(() => { const item = document.querySelector(${JSON.stringify(selector)}); if (!item || item.disabled) throw new Error('Unavailable control: ' + ${JSON.stringify(selector)}); item.click(); })()`);
    const fill = (selector, value) => evaluate(`(() => { const item = document.querySelector(${JSON.stringify(selector)}); if (!item) throw new Error('Missing input: ' + ${JSON.stringify(selector)}); item.focus(); item.value = ${JSON.stringify(value)}; item.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const editorId = () => evaluate("document.getElementById('notes-editor')?.dataset.noteId");
    const tab = async (name) => {
      await evaluate(`setActiveTab(${JSON.stringify(name)})`);
      await waitFor(() => evaluate(`document.getElementById('tab-${name}').classList.contains('active')`), `${name} tab`);
    };
    await waitFor(() => evaluate("!!window.SlateHome && typeof workspaceHydrating !== 'undefined' && !workspaceHydrating && document.getElementById('home-note').value === " + JSON.stringify(homeDraft)).catch(() => false), 'hydrated workspace');
    assert.equal(path.resolve(app.getPath('userData')), path.resolve(profile), 'never touch the real user profile');
    await evaluate("window.SlateHome.setModuleVisible('note', false)");
    await evaluate('setMode(true)');
    // This group verifies editor focus and storage. Automatic outside dismissal
    // has its own group and must not interfere while autosave is pending.
    await evaluate('setPanelPinned(true)');
    await tab('notes');
    assert.equal(await evaluate("document.querySelector('[data-home-module=\"note\"]').hidden"), true, 'reproduce with homepage notes disabled');
    assert.ok(await editorId(), 'empty library opens a usable editor with a stable draft identity');
    assert.equal(await evaluate("document.getElementById('notes-editor').readOnly"), false);
    assert.equal((await archives()).length, 0);
    await click('#notes-new');
    await click('#notes-new');
    assert.equal((await archives()).length, 0, 'opening blank drafts never creates empty archive records');

    const firstId = await editorId();
    await fill('#notes-editor', '第一');
    await fill('#notes-editor', '第一篇独立笔记\n记录一次客户确认。');
    await waitFor(async () => (await archives()).find((note) => note.id === firstId)?.content.includes('客户确认'), 'first autosave');
    assert.equal((await archives()).length, 1, 'rapid input creates exactly one record');
    assert.equal(await editorId(), firstId, 'autosave keeps the same editor and draft id');
    assert.equal(await evaluate("document.activeElement.id"), 'notes-editor', 'autosave does not steal keyboard focus');
    assert.match(await evaluate("document.querySelector('#notes-list strong').textContent"), /第一篇独立笔记/);
    await fill('#notes-editor', '第一篇独立笔记\n未等防抖即切页也会保留。');
    await tab('todo');
    assert.match((await archives())[0].content, /未等防抖/);
    await tab('notes');
    assert.equal(await editorId(), firstId);
    await fill('#notes-editor', '第一篇独立笔记\n重载前尚未到防抖时间。');
    main.webContents.reload();
    await waitFor(() => evaluate("typeof workspaceHydrating !== 'undefined' && !workspaceHydrating && document.getElementById('home-note').value === " + JSON.stringify(homeDraft)).catch(() => false), 'reload hydration');
    await tab('notes');
    assert.equal(await editorId(), firstId, 'reload returns to the active independently saved note');
    assert.match(await evaluate("document.getElementById('notes-editor').value"), /重载前/);

    await click('#notes-new');
    const secondId = await editorId();
    assert.notEqual(secondId, firstId);
    await fill('.notes-detail-title', '只有标题也应保存');
    await waitFor(async () => (await archives()).find((note) => note.id === secondId)?.title === '只有标题也应保存', 'title-only save');
    await fill('#notes-editor', '第二篇正文');
    await waitFor(async () => (await archives()).find((note) => note.id === secondId)?.content === '第二篇正文', 'body after title');
    assert.equal((await archives()).length, 2);
    await fill('#notes-search', '第二篇正文');
    await fill('#notes-editor', '正文修改后不再命中当前搜索');
    await waitFor(async () => (await archives()).find((note) => note.id === secondId)?.content === '正文修改后不再命中当前搜索', 'filtered editor save');
    assert.equal(await editorId(), secondId, 'typing out of a search match does not silently switch the open note');

    await fill('#notes-search', '绝不匹配的关键词');
    assert.ok(await evaluate("!!document.querySelector('[data-action=\"clear-note-search\"]')"), 'no-results state offers clear search');
    await click('[data-action="clear-note-search"]');
    assert.equal(await evaluate("document.getElementById('notes-search').value"), '');
    await fill('#notes-search', '仍然没有匹配');
    await click('[data-action="new-note"]');
    assert.equal(await evaluate("document.getElementById('notes-search').value"), '', 'new note escapes search filtering');
    assert.equal(await evaluate("document.getElementById('notes-editor').value"), '');
    assert.equal((await archives()).length, 2, 'empty search-created draft does not contaminate archive');
    await click(`#notes-list [data-note-id="${firstId}"]`);
    await fill('.notes-detail-title', '修改第一篇标题');
    assert.equal((await archives()).find((note) => note.id === firstId).title, '修改第一篇标题');
    const beforeDeleteBody = '重载前的内容仍保留。\n删除前刚输入，尚未等到自动保存。';
    await fill('#notes-editor', beforeDeleteBody);
    await click('[data-action="delete-note"]');
    assert.equal((await archives()).length, 1);
    assert.equal(await evaluate("document.getElementById('status-toast-action').hidden"), false, 'a deleted note offers an immediate Undo action');
    await click('#status-toast-action');
    assert.equal((await archives()).length, 2, 'Undo restores the deleted note without removing another note');
    const restored = (await archives()).find((note) => note.id === firstId);
    assert.equal(restored.title, '修改第一篇标题', 'Undo preserves the edited title and identity');
    assert.equal(restored.content, beforeDeleteBody, 'Undo preserves the complete body, including a pending edit flushed by Delete');
    assert.ok(await editorId(), 'Undo leaves a usable editor without discarding the current writing session');
    await click('[data-action="delete-note"]');
    assert.equal((await archives()).length, 1);
    await click('[data-action="delete-note"]');
    assert.equal((await archives()).length, 0);
    assert.ok(await editorId(), 'after deleting the last note, editor remains immediately available');

    const storedHome = await evaluate("({ content: document.getElementById('home-note').value, stored: localStorage.getItem('slate-home-note'), active: localStorage.getItem('slate-note-active-archive-v1') })");
    assert.equal(storedHome.content, homeDraft);
    assert.equal(storedHome.stored, homeDraft);
    assert.equal(storedHome.active, null, 'independent note creation never binds to the homepage archive id');
    assert.deepEqual(errors, []);
    console.log('Independent notes compose checks passed');
    clearTimeout(timeout);
    app.quit();
  } catch (error) {
    console.error(error.stack || error);
    console.error(errors);
    clearTimeout(timeout);
    app.exit(1);
  }
});
require('../main.js');
