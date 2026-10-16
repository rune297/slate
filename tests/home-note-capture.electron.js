const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, dialog } = require('electron');

// Production bootstrap and preload, with a disposable user-data directory.
const profile = process.env.TODO_TEST_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'slate-home-capture-'));
app.commandLine.appendSwitch('user-data-dir', profile);
fs.mkdirSync(profile, { recursive: true });
const now = Date.now();
const previousNote = { id: 'previous-home-record', content: '之前已保存的记录', createdAt: now - 60000, updatedAt: now - 60000 };
fs.writeFileSync(path.join(profile, 'workspace.json'), JSON.stringify({ version: 1, localStorage: {
  'slate-home-note': '',
  'slate-note-archive-v1': JSON.stringify([previousNote]),
} }));
fs.writeFileSync(path.join(profile, 'app-settings.json'), JSON.stringify({
  shortcut: 'Control+Alt+N', defaultTab: 'home',
  features: { home: true, todo: true, notes: true, links: true, recordings: false, credentials: false, clip: true },
  clipboard: { captureEnabled: false, retentionDays: 7, ignoredApps: [], pausedUntil: 0 },
}));
const importedContent = '从备份恢复的首页内容，不得被旧编辑器覆盖';
const importedNote = { id: 'imported-home-record', content: importedContent, createdAt: now, updatedAt: now };
const backupPath = path.join(profile, 'import-test.json');
fs.writeFileSync(backupPath, JSON.stringify({ format: 'slate-backup', version: 1, storage: {
  'slate-home-note': importedContent,
  'slate-note-active-archive-v1': importedNote.id,
  'slate-note-archive-v1': JSON.stringify([importedNote]),
} }));
// Only the native file picker is substituted; production import validation and UI run.
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [backupPath] });
const errors = [];
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
});
const timeout = setTimeout(() => { console.error(`Homepage note capture timed out: ${JSON.stringify(errors)}`); app.exit(1); }, 70000);
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
    const evaluate = (script) => main.webContents.executeJavaScript(script);
    const archives = () => evaluate("JSON.parse(localStorage.getItem('slate-note-archive-v1') || '[]')");
    const activeId = () => evaluate("localStorage.getItem('slate-note-active-archive-v1')");
    const homeContent = () => evaluate("document.getElementById('home-note').value");
    const saveState = () => evaluate("document.getElementById('home-note-save-state').textContent");
    const click = (selector) => evaluate(`(() => { const item = document.querySelector(${JSON.stringify(selector)}); if (!item || item.disabled) throw new Error('Unavailable control: ' + ${JSON.stringify(selector)}); item.click(); })()`);
    const fill = (selector, value) => evaluate(`(() => { const item = document.querySelector(${JSON.stringify(selector)}); if (!item) throw new Error('Missing input: ' + ${JSON.stringify(selector)}); item.focus(); item.value = ${JSON.stringify(value)}; item.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const tab = async (name) => {
      await evaluate(`setActiveTab(${JSON.stringify(name)})`);
      await waitFor(() => evaluate(`document.getElementById('tab-${name}').classList.contains('active')`), `${name} tab`);
    };
    await waitFor(() => evaluate("!!window.SlateHome && typeof workspaceHydrating !== 'undefined' && !workspaceHydrating && !!document.getElementById('home-note-new')").catch(() => false), 'hydrated capture controls');
    assert.equal(path.resolve(app.getPath('userData')), path.resolve(profile), 'must never use the real profile');
    await evaluate("window.SlateHome.setModuleVisible('note', true); setMode(true)");
    await tab('home');
    assert.equal(await evaluate("document.getElementById('home-note').hidden"), false, 'capture is immediately editable');
    assert.equal(await evaluate("!document.getElementById('home-note-preview') || document.getElementById('home-note-preview').hidden"), true);
    assert.equal((await archives()).length, 1, 'opening an empty capture creates no blank notes');

    console.log('Homepage note capture: no Save or Preview step, stable archive id');
    await fill('#home-note', '客户');
    assert.match(await saveState(), /正在保存/);
    await fill('#home-note', '客户确认采用第一版方案。\n明天跟进合同。');
    await waitFor(async () => (await archives()).length === 2, 'first capture autosave');
    const firstId = await activeId();
    assert.ok(firstId && firstId !== previousNote.id);
    assert.equal((await archives()).find((note) => note.id === firstId).content, await homeContent());
    assert.match(await saveState(), /已自动保存/);
    assert.equal(await evaluate('document.activeElement.id'), 'home-note', 'autosave keeps cursor in capture');
    await fill('#home-note', '客户确认采用第一版方案。\n明天跟进合同。补充交付时间。');
    await waitFor(async () => (await archives()).find((note) => note.id === firstId)?.content.endsWith('补充交付时间。'), 'continuous edit autosave');
    assert.equal(await activeId(), firstId);
    assert.equal((await archives()).length, 2, 'typing never creates one record per input');

    console.log('Homepage note capture: shared library and reload before debounce');
    await tab('notes');
    await click(`#notes-list [data-note-id="${firstId}"]`);
    assert.equal(await evaluate("document.getElementById('notes-editor').value"), await homeContent());
    await fill('#notes-editor', '从笔记库修改同一条首页记录');
    await tab('home');
    assert.equal(await homeContent(), '从笔记库修改同一条首页记录', 'library edits synchronize the linked homepage draft');
    await fill('#home-note', '首页刚改完即切到笔记库，也要显示最新内容');
    await tab('notes');
    assert.equal(await evaluate("document.getElementById('notes-editor').value"), '首页刚改完即切到笔记库，也要显示最新内容', 'immediate tab switch refreshes the linked editor after the capture flush');
    await tab('home');
    await fill('#home-note', '重载前立刻输入，未等待防抖');
    main.webContents.reload();
    await waitFor(() => evaluate("typeof workspaceHydrating !== 'undefined' && !workspaceHydrating && document.getElementById('home-note').value === '重载前立刻输入，未等待防抖'").catch(() => false), 'capture recovered on reload');
    assert.equal(await activeId(), firstId);
    assert.equal((await archives()).find((note) => note.id === firstId).content, '重载前立刻输入，未等待防抖');
    await evaluate('setMode(true)');
    await tab('home');

    console.log('Homepage note capture: new note and accidental clear preserve archive');
    await fill('#home-note', '第一条记录收尾，立刻新一条');
    await click('#home-note-new');
    assert.equal(await homeContent(), '');
    assert.equal(await activeId(), null);
    assert.equal((await archives()).find((note) => note.id === firstId).content, '第一条记录收尾，立刻新一条');
    assert.equal((await archives()).length, 2, 'new empty draft is not archived');
    await fill('#home-note', '第二条独立随手记录');
    await waitFor(async () => (await archives()).length === 3, 'second capture');
    const secondId = await activeId();
    assert.notEqual(secondId, firstId);
    await fill('#home-note', '');
    await waitFor(async () => await activeId() === null, 'clear detaches saved record');
    assert.equal((await archives()).find((note) => note.id === secondId).content, '第二条独立随手记录', 'clearing capture never erases the saved note');
    await fill('#home-note', '第三条独立随手记录');
    await waitFor(async () => (await archives()).length === 4, 'typing after clear creates a new note');
    const thirdId = await activeId();
    assert.notEqual(thirdId, secondId);

    console.log('Homepage note capture: IME and truthful failure state');
    await evaluate("document.getElementById('home-note').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))");
    await fill('#home-note', '第三条记录，输入法尚在组合');
    await sleep(400);
    assert.equal((await archives()).find((note) => note.id === thirdId).content, '第三条独立随手记录', 'IME composing does not save an intermediate composition');
    await evaluate("document.getElementById('home-note').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))");
    await waitFor(async () => (await archives()).find((note) => note.id === thirdId)?.content === '第三条记录，输入法尚在组合', 'IME commit');
    await evaluate("window.__captureSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === 'slate-note-archive-v1') throw new DOMException('Storage full', 'QuotaExceededError'); return window.__captureSetItem.call(this, key, value); }; true");
    await fill('#home-note', '写入失败后内容必须还在输入框');
    await waitFor(async () => /未能保存/.test(await saveState()), 'honest save failure status');
    assert.equal(await homeContent(), '写入失败后内容必须还在输入框');
    assert.equal((await archives()).find((note) => note.id === thirdId).content, '第三条记录，输入法尚在组合');
    await evaluate('Storage.prototype.setItem = window.__captureSetItem; delete window.__captureSetItem');
    await fill('#home-note', '写入恢复后仍更新原来这一条');
    await waitFor(async () => /已自动保存/.test(await saveState()), 'retry after storage recovery');
    assert.equal(await activeId(), thirdId);
    assert.equal((await archives()).length, 4);

    console.log('Homepage note capture: review stays independent from capture');
    const captureBeforeReview = await homeContent();
    await evaluate("window.SlateWorkNotes.review('day')");
    await waitFor(() => evaluate("document.getElementById('tab-notes').classList.contains('active')"), 'review editor');
    const reviewId = await evaluate("document.getElementById('notes-editor').dataset.noteId");
    assert.notEqual(reviewId, thirdId);
    await fill('#notes-editor', '复盘草稿的独立编辑，不覆盖首页');
    await tab('home');
    assert.equal(await homeContent(), captureBeforeReview);
    assert.equal(await activeId(), thirdId);
    assert.equal((await archives()).find((note) => note.id === thirdId).content, captureBeforeReview);

    console.log('Homepage note capture: production backup import cancels stale pending writes');
    await fill('#home-note', '导入前尚未保存的旧编辑器内容');
    await click('#settings-backup-import');
    await waitFor(() => evaluate(`typeof workspaceHydrating !== 'undefined' && !workspaceHydrating && document.getElementById('home-note').value === ${JSON.stringify(importedContent)}`).catch(() => false), 'imported capture after reload');
    await sleep(400);
    assert.equal(await activeId(), importedNote.id);
    assert.deepEqual(await archives(), [importedNote]);
    assert.equal(await homeContent(), importedContent);

    console.log('Homepage note capture: a 201st note never evicts older records');
    await evaluate('setMode(true)');
    await tab('home');
    await click('#home-note-new');
    const retainedNotes = Array.from({ length: 200 }, (_, index) => ({
      id: `retained-history-${index + 1}`,
      title: `历史记录 ${index + 1}`,
      titleSource: 'user',
      content: `必须保留的历史正文 ${index + 1}`,
      createdAt: now - (index + 1) * 1000,
      updatedAt: now - (index + 1) * 1000,
    }));
    await evaluate(`localStorage.setItem('slate-note-archive-v1', ${JSON.stringify(JSON.stringify(retainedNotes))})`);
    assert.equal((await archives()).length, 200);
    await fill('#home-note', '第201条新随手记录');
    await waitFor(async () => (await archives()).some((note) => note.content === '第201条新随手记录'), 'capture beyond 200 records');
    const overflowId = await activeId();
    const oldestNote = retainedNotes[retainedNotes.length - 1];
    const assertRetainedHistory = async (expectedTotal) => {
      const notes = await archives();
      assert.equal(notes.length, expectedTotal, 'saving additional notes must not silently truncate the archive');
      assert.equal(notes.find((note) => note.id === oldestNote.id)?.content, oldestNote.content, 'the oldest saved record remains intact');
      for (const retained of retainedNotes) {
        assert.equal(notes.find((note) => note.id === retained.id)?.content, retained.content, `history ${retained.id} stays available`);
      }
      assert.equal(notes.filter((note) => note.id === overflowId).length, 1, 'ongoing edits retain one identity');
    };
    await assertRetainedHistory(201);
    await fill('#home-note', '第201条持续编辑，不能挤掉最早的笔记');
    await waitFor(async () => (await archives()).find((note) => note.id === overflowId)?.content === '第201条持续编辑，不能挤掉最早的笔记', 'stable edit beyond archive size');
    assert.equal(await activeId(), overflowId);
    await assertRetainedHistory(201);

    console.log('Homepage note capture: library edits and reviews retain all older notes too');
    await tab('notes');
    await click(`#notes-list [data-note-id="${overflowId}"]`);
    await fill('#notes-editor', '在笔记库编辑第201条也不截断历史');
    await waitFor(async () => (await archives()).find((note) => note.id === overflowId)?.content === '在笔记库编辑第201条也不截断历史', 'large library edit autosave');
    await fill('.notes-detail-title', '第201条的修改标题');
    await assertRetainedHistory(201);
    await evaluate("window.SlateWorkNotes.review('week')");
    await waitFor(async () => (await archives()).length >= 202, 'review beyond 200 records');
    const overflowReviewId = await evaluate("document.getElementById('notes-editor').dataset.noteId");
    assert.notEqual(overflowReviewId, overflowId);
    await assertRetainedHistory(202);
    await fill('#notes-editor', '第202条复盘的独立修改也保留完整历史');
    await tab('home');
    await assertRetainedHistory(202);
    assert.equal((await archives()).find((note) => note.id === overflowReviewId)?.content, '第202条复盘的独立修改也保留完整历史');
    assert.equal(await homeContent(), '在笔记库编辑第201条也不截断历史');
    assert.equal(await activeId(), overflowId);
    assert.deepEqual(errors, []);
    console.log('Production homepage note autosave checks passed');
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
