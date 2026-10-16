const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, clipboard } = require('electron');

// Exercise the production window, preload, search, and persistence in a disposable
// profile. Native launch and paste calls are intercepted to protect the desktop.
const profile = process.env.TODO_TEST_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'slate-ux-actions-'));
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'app-settings.json'), JSON.stringify({
  shortcut: 'Control+Alt+U', defaultTab: 'home',
  features: { home: true, todo: true, notes: true, links: true, recordings: false, credentials: false, clip: true },
  clipboard: { captureEnabled: false, retentionDays: 7, ignoredApps: [], pausedUntil: 0 },
}));
fs.writeFileSync(path.join(profile, 'workspace.json'), JSON.stringify({ version: 1, localStorage: {
  'slate-launcher-apps-v1': JSON.stringify([{ name: 'UX Search Alpha', path: 'C:/SlateTests/ux-search-alpha.exe', icon: null }]),
} }));

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, description, timeoutMs = 10000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const result = await check();
    if (result) return result;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
const timeout = setTimeout(() => { diagnostic(`UX actions timed out: ${JSON.stringify(errors)}`); app.exit(1); }, 90000);

app.whenReady().then(async () => {
  try {
    const main = await waitFor(() => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/renderer/index.html')), 'production main window');
    const evaluate = (script) => main.webContents.executeJavaScript(script).catch((error) => {
      throw new Error(`Renderer action failed: ${script.slice(0, 240)}\n${error.message}\n${errors.join('\n')}`, { cause: error });
    });
    const click = async (selector) => {
      const point = await evaluate(`(() => {
        const button = document.querySelector(${JSON.stringify(selector)});
        if (!button || button.disabled || button.hidden) throw new Error('Unavailable control: ' + ${JSON.stringify(selector)});
        const box = button.getBoundingClientRect();
        const x = Math.round(box.left + box.width / 2), y = Math.round(box.top + box.height / 2);
        const hit = document.elementFromPoint(x, y);
        const style = getComputedStyle(button);
        if (!box.width || !box.height || style.visibility === 'hidden' || Number(style.opacity) === 0 || !(hit === button || button.contains(hit))) {
          throw new Error('Control cannot receive a pointer click: ' + ${JSON.stringify(selector)} + ' hit=' + (hit?.id || hit?.className) + ' box=' + JSON.stringify({x:box.x,y:box.y,width:box.width,height:box.height}) + ' style=' + [style.visibility,style.opacity,style.pointerEvents].join('/'));
        }
        return { x, y };
      })()`);
      main.webContents.sendInputEvent({ type: 'mouseMove', ...point });
      main.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      main.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
      await sleep(30);
    };
    const fill = (selector, value) => evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input || input.disabled) throw new Error('Unavailable input: ' + ${JSON.stringify(selector)});
      input.focus(); input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const enter = () => {
      main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      main.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    };
    const closeCapture = async () => {
      // Escape may first return from the capture stage to ordinary search.
      for (let step = 0; step < 2; step++) {
        if (await evaluate("document.getElementById('global-search').hidden")) return;
        main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        main.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
        await sleep(40);
      }
      assert.equal(await evaluate("document.getElementById('global-search').hidden"), true, 'Escape can leave the processing/search overlay');
    };
    const tab = async (name) => {
      await evaluate(`setActiveTab(${JSON.stringify(name)})`);
      await waitFor(() => evaluate(`document.getElementById('tab-${name}').classList.contains('active')`), `${name} tab`);
    };
    const archives = () => evaluate("JSON.parse(localStorage.getItem('slate-note-archive-v1') || '[]')");
    const tasks = () => evaluate("Object.values(JSON.parse(localStorage.getItem('slate-todo-data') || '{}')).flat()");

    await waitFor(() => evaluate("!!window.SlateWorkspace && !!window.SlateTasks && typeof workspaceHydrating !== 'undefined' && !workspaceHydrating && !!document.getElementById('global-capture-open')").catch(() => false), 'hydrated workspace actions');
    assert.equal(path.resolve(app.getPath('userData')), path.resolve(profile), 'the real user profile is never used');
    await main.webContents.debugger.attach('1.3');
    await main.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await evaluate('setMode(true)');
    await evaluate('setPanelPinned(true)');
    main.show(); main.focus(); main.webContents.focus();
    const opened = [], pasted = [];
    ipcMain.removeHandler('launcher:open');
    ipcMain.handle('launcher:open', (_event, target) => { opened.push(target); return { ok: true, activated: false }; });
    ipcMain.removeHandler('clipboard:paste');
    ipcMain.handle('clipboard:paste', (_event, entry) => { pasted.push(entry); return { ok: true, pasted: false }; });

    assert.equal((await evaluate("window.slateAPI.getAppSettings()")).clipboard.captureEnabled, false, 'manual capture does not require clipboard history collection');
    assert.equal(await evaluate("JSON.parse(localStorage.getItem('slate-clip-history') || '[]').length"), 0, 'a fresh profile contains no clipboard examples');

    diagnostic('UX actions: manually capture clipboard text without enabling history');
    // Replace only the native read method, so the real IPC handler must return
    // the whole source and let the UI reject excessive input without truncation.
    const nativeReadText = clipboard.readText;
    const overlongSource = '原'.repeat(6001);
    const syntheticReadText = () => overlongSource;
    try {
      clipboard.readText = syntheticReadText;
      assert.equal(clipboard.readText === syntheticReadText, true, 'native clipboard read is isolated from the actual desktop');
      assert.equal((await evaluate('window.slateAPI.translationClipboard()')).length, overlongSource.length, 'the production clipboard IPC does not silently truncate the original text');
    } finally {
      clipboard.readText = nativeReadText;
    }
    let capturedClipboard = '客户反馈待跟进\n' + '这是必须完整保留的客户原文，不能只取预览。'.repeat(240) + '\n原文最后一句也必须保留。';
    ipcMain.removeHandler('translation:clipboard');
    ipcMain.handle('translation:clipboard', () => capturedClipboard);
    const openCapture = async (query = '') => {
      await click('#global-search-open');
      if (query) {
        await fill('#global-search-input', query);
        assert.ok(await evaluate("document.querySelectorAll('#global-search-results .global-search-result').length > 0"), 'the capture editor is tested with existing search matches');
      }
      await click('#global-capture-open');
      await waitFor(() => evaluate("!document.getElementById('global-capture').hidden"), 'manual capture panel');
      await waitFor(() => evaluate(`document.getElementById('capture-text').value === ${JSON.stringify(capturedClipboard)}`), 'explicit clipboard read');
      await sleep(30);
      assert.equal(await evaluate('document.activeElement.id'), 'capture-text', 'the source editor keeps focus after the search opening frame');
    };
    await openCapture();
    const editedTaskSource = capturedClipboard + '\n处理前补充：先确认交付范围。';
    await fill('#capture-text', editedTaskSource);
    await click('#capture-task');
    const capturedTask = await waitFor(async () => (await tasks()).find((item) => item.text.includes('客户反馈待跟进')), 'task captured from clipboard');
    assert.ok(String(capturedTask.notes || '').includes(editedTaskSource), 'a long clipboard task preserves the complete source and edits made before processing');
    assert.equal(capturedTask.planKind, 'day', 'quick capture inserts the new task in Today');
    assert.equal((await tasks()).filter((item) => item.id === capturedTask.id).length, 1, 'one action produces one task');
    await closeCapture();

    await tab('home');
    const homeDraft = '首页原来的草稿，不得被剪贴板笔记覆盖。';
    await fill('#home-note', homeDraft);
    await waitFor(async () => (await archives()).some((note) => note.content === homeDraft), 'existing homepage draft autosave');
    const draftId = await evaluate("localStorage.getItem('slate-note-active-archive-v1')");
    capturedClipboard = '剪贴板独立笔记\n' + '笔记中的长文正文要完整保存。'.repeat(200) + '\n笔记末尾。';
    await openCapture('客户反馈');
    await evaluate("document.getElementById('capture-text').focus(); document.getElementById('capture-text').setSelectionRange(0, 0)");
    main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
    main.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
    await sleep(30);
    assert.equal(await evaluate('document.activeElement.id'), 'capture-text', 'editing the source keeps focus away from the old search results');
    assert.ok(await evaluate("document.getElementById('capture-text').selectionStart > 0"), 'ArrowDown moves the text caret rather than being swallowed by search navigation');
    await click('#capture-note');
    const capturedNote = await waitFor(async () => (await archives()).find((note) => note.content === capturedClipboard), 'complete clipboard note');
    assert.notEqual(capturedNote.id, draftId);
    assert.equal(await evaluate("document.getElementById('home-note').value"), homeDraft, 'capturing a note preserves the homepage writing session');
    assert.equal(await evaluate("localStorage.getItem('slate-note-active-archive-v1')"), draftId, 'clipboard capture does not rebind the homepage draft');
    assert.equal((await archives()).find((note) => note.id === draftId).content, homeDraft);
    assert.equal((await evaluate("window.slateAPI.getAppSettings()")).clipboard.captureEnabled, false);
    assert.equal(await evaluate("JSON.parse(localStorage.getItem('slate-clip-history') || '[]').length"), 0, 'explicit processing neither starts background capture nor silently creates history');
    await closeCapture();

    diagnostic('UX actions: Undo keeps a newly started note and restores the removed note');
    await tab('notes');
    await click(`#notes-list [data-note-id="${capturedNote.id}"]`);
    await click('[data-action="delete-note"]');
    assert.equal((await archives()).some((note) => note.id === capturedNote.id), false);
    await click('#notes-new');
    const afterDeleteDraft = '删除后新写的笔记，撤销不能覆盖这段尚未防抖保存的文字。';
    await fill('#notes-editor', afterDeleteDraft);
    const afterDeleteId = await evaluate("document.getElementById('notes-editor').dataset.noteId");
    await click('#status-toast-action');
    const afterUndo = await archives();
    assert.equal(afterUndo.find((note) => note.id === capturedNote.id)?.content, capturedClipboard, 'Undo restores the removed note and original identity');
    assert.equal(afterUndo.find((note) => note.id === afterDeleteId)?.content, afterDeleteDraft, 'Undo flushes and preserves subsequent writing');
    assert.equal(afterUndo.find((note) => note.id === draftId)?.content, homeDraft, 'Undo merges with the current archive instead of replacing it with a stale snapshot');
    assert.equal(await evaluate("document.getElementById('notes-editor').dataset.noteId"), afterDeleteId, 'Undo keeps the newly started note open');

    diagnostic('UX actions: clipboard translation retains source without a model and refuses a second busy request');
    assert.equal((await evaluate('window.slateAPI.translationStatus()')).installed, false, 'this profile needs no downloaded model');
    capturedClipboard = 'Offline translation source retained for model preparation.';
    await openCapture();
    await click('#capture-translate');
    await waitFor(() => evaluate(`document.getElementById('translation-input').value === ${JSON.stringify(capturedClipboard)}`), 'uninstalled translation preserves the source');
    assert.equal(await evaluate("document.querySelector('.tab-panel.active').id"), 'tab-home', 'model preparation does not force a settings detour');
    assert.match(await evaluate("document.getElementById('translation-status').textContent"), /准备|模型|原文/);
    assert.equal(await evaluate("document.getElementById('translation-release').hidden"), true, 'idle translation exposes no misleading Stop action');
    await closeCapture();

    let finishTranslation;
    ipcMain.removeHandler('translation:status');
    ipcMain.handle('translation:status', () => ({ installed: true, loaded: true, busy: Boolean(finishTranslation), shortcut: '' }));
    ipcMain.removeHandler('translation:run');
    ipcMain.handle('translation:run', () => new Promise((resolve) => { finishTranslation = resolve; }));
    const firstTranslationSource = 'The first in-flight translation must keep its source.';
    capturedClipboard = firstTranslationSource;
    await openCapture();
    await click('#capture-translate');
    await waitFor(() => typeof finishTranslation === 'function', 'synthetic local translation pending');
    assert.equal(await evaluate("document.getElementById('translation-input').readOnly"), true);
    await closeCapture();
    capturedClipboard = 'The second source must remain available for retry.';
    await openCapture();
    await click('#capture-translate');
    assert.equal(await evaluate("document.getElementById('global-capture').hidden"), false, 'busy rejection keeps the unsent source available');
    assert.equal(await evaluate("document.getElementById('capture-text').value"), capturedClipboard);
    assert.equal(await evaluate("document.getElementById('translation-input').value"), firstTranslationSource, 'a second request cannot overwrite the active translation');
    finishTranslation({ ok: true, text: '第一条翻译完成。', source: 'en' });
    finishTranslation = null;
    await waitFor(() => evaluate("!document.getElementById('translation-input').readOnly"), 'translation controls released');
    await closeCapture();
    ipcMain.removeHandler('translation:status');
    ipcMain.handle('translation:status', () => ({ installed: false, loaded: false, busy: false, shortcut: '' }));

    capturedClipboard = overlongSource;
    await click('#global-search-open');
    await click('#global-capture-open');
    await waitFor(() => evaluate("/6000|过长|长度/.test(document.getElementById('capture-feedback').textContent)"), 'overlong clipboard is explicitly rejected');
    assert.notEqual(await evaluate("document.getElementById('capture-text').value"), overlongSource.slice(0, 6000), 'overlong text is never presented as a silently truncated valid source');
    await closeCapture();

    diagnostic('UX actions: Enter executes application and clipboard results directly');
    await tab('notes');
    await click('#global-search-open');
    await fill('#global-search-input', 'UX Search Alpha');
    assert.equal(await evaluate("document.querySelectorAll('#global-search-results [data-result-kind=\"应用\"]').length"), 1);
    enter();
    await waitFor(() => opened.length === 1, 'application launched by Enter');
    assert.deepEqual(opened, ['C:/SlateTests/ux-search-alpha.exe']);
    assert.equal(await evaluate("document.getElementById('global-search').hidden"), true);
    assert.equal(await evaluate("document.querySelector('.tab-panel.active').id"), 'tab-notes', 'launch does not require a detour through the homepage');

    const copiedText = 'Search-copy result: 原文与尾部都应保留。';
    await evaluate(`addClipEntry({ type: 'text', text: ${JSON.stringify(copiedText)} })`);
    await tab('clip');
    const clipId = await evaluate(`JSON.parse(localStorage.getItem('slate-clip-history') || '[]').find(item => item.text === ${JSON.stringify(copiedText)}).id`);
    const historyRow = '#clip-list [data-id="' + clipId + '"]';
    const hoverPoint = await evaluate(`(() => { const box = document.querySelector(${JSON.stringify(historyRow)}).getBoundingClientRect(); return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }; })()`);
    main.webContents.sendInputEvent({ type: 'mouseMove', ...hoverPoint });
    await sleep(100);
    await click(`${historyRow} [data-action="capture"]`);
    await waitFor(() => evaluate("!document.getElementById('global-capture').hidden"), 'history row opens text actions');
    assert.equal(await evaluate("document.getElementById('capture-text').value"), copiedText, 'processing a history card uses that entry rather than the current system clipboard');
    assert.equal(pasted.length, 0, 'the processing action must not also execute Copy');
    await closeCapture();
    await tab('notes');
    await click('#global-search-open');
    await fill('#global-search-input', 'Search-copy result');
    enter();
    await waitFor(() => pasted.length === 1, 'clipboard result copied by Enter');
    assert.equal(pasted[0].text, copiedText, 'search executes the original entry rather than the truncated preview');
    assert.equal(await evaluate("document.getElementById('global-search').hidden"), true);

    diagnostic('UX actions: selection indicator follows a real 1080 to 900 window resize');
    await tab('home');
    // Production deliberately disables drag-to-resize. Unlock only the fixture
    // window so Windows also accepts a programmatic smaller viewport for QA.
    main.setResizable(true);
    for (const width of [1080, 900]) {
      main.setSize(width, 616);
      diagnostic(`UX resize requested ${width}px, native bounds ${JSON.stringify(main.getBounds())}`);
      await waitFor(() => evaluate(`innerWidth === ${width}`), `${width}px viewport`);
      await sleep(100);
      const bounds = await evaluate(`(() => {
        const button = document.querySelector('#tabs .tab.active').getBoundingClientRect();
        const indicator = document.getElementById('tab-indicator').getBoundingClientRect();
        return { button: { x: button.x, width: button.width }, indicator: { x: indicator.x, width: indicator.width } };
      })()`);
      assert.ok(Math.abs(bounds.button.x - bounds.indicator.x) <= 2, `indicator left follows the active tab at ${width}px: ${JSON.stringify(bounds)}`);
      assert.ok(Math.abs(bounds.button.width - bounds.indicator.width) <= 2, `indicator width follows the active tab at ${width}px: ${JSON.stringify(bounds)}`);
      await click('#home-task-add');
      assert.equal(await evaluate('document.activeElement.id'), 'home-task-input', 'the empty Add action remains reachable at this viewport');
    }

    diagnostic('UX actions: homepage typography, heading rows, and primary task controls remain aligned');
    const visualMetrics = await evaluate(`(() => {
      const heads = ['.task-home-head', '.home-note .note-toolbar', '.home-translation .tile-head', '.home-launcher .tile-head'];
      const controls = ['#home-work-open', '#home-note-new', '#translation-paste', '#translation-run', '#translation-source', '#launcher-add'];
      return {
        headings: heads.map(selector => ({ selector, height: document.querySelector(selector).getBoundingClientRect().height })),
        fonts: ['#home-note', '#translation-input', '#translation-output'].map(selector => ({ selector, size: getComputedStyle(document.querySelector(selector)).fontSize, padding: getComputedStyle(document.querySelector(selector)).paddingTop })),
        controls: controls.map(selector => {
          const control = document.querySelector(selector), box = control.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return { selector, height: box.height, hit: hit === control || control.contains(hit) };
        })
      };
    })()`);
    for (const row of visualMetrics.headings) assert.ok(Math.abs(row.height - 28) <= 1, `homepage title rows follow the shared 28px size: ${JSON.stringify(row)}`);
    for (const editor of visualMetrics.fonts) {
      assert.equal(editor.size, '13px', `${editor.selector} shares readable long-text typography`);
      assert.equal(editor.padding, '12px', `${editor.selector} shares the editor text inset`);
    }
    for (const control of visualMetrics.controls) {
      assert.ok(control.height >= 28, `${control.selector} has a usable pointer target: ${JSON.stringify(control)}`);
      assert.equal(control.hit, true, `${control.selector} is not covered at 900px`);
    }
    const focusSelector = '#home-focus-list [data-id="' + capturedTask.id + '"] [data-work-action="focus"]';
    main.webContents.sendInputEvent({ type: 'mouseMove', x: 2, y: 2 });
    await evaluate("document.getElementById('home-task-input').focus()");
    const focusVisible = await evaluate(`(() => {
      let target = document.querySelector(${JSON.stringify(focusSelector)});
      if (!target) return false;
      while (target && !target.matches('[data-home-module]')) {
        const style = getComputedStyle(target);
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.5) return false;
        target = target.parentElement;
      }
      return true;
    })()`);
    assert.equal(focusVisible, true, 'making a task a focus is discoverable before hovering the row');
    await click(focusSelector);
    await waitFor(async () => Boolean((await tasks()).find((item) => item.id === capturedTask.id)?.focusDate), 'visible focus button activates today focus');
    assert.equal((await tasks()).find((item) => item.id === capturedTask.id)?.notes, capturedTask.notes, 'changing focus never truncates the captured task source');
    main.webContents.reload();
    await waitFor(() => evaluate("!!window.SlateTasks && typeof workspaceHydrating !== 'undefined' && !workspaceHydrating").catch(() => false), 'action data restored after reload');
    assert.equal((await tasks()).find((item) => item.id === capturedTask.id)?.notes, capturedTask.notes, 'reload preserves the complete long clipboard source');
    assert.equal((await archives()).find((note) => note.id === afterDeleteId)?.content, afterDeleteDraft, 'the note written during Undo survives a real reload');

    assert.deepEqual(errors, [], 'new action flows must not emit renderer console errors');
    diagnostic('Production UX action checks passed');
    clearTimeout(timeout);
    app.quit();
  } catch (error) {
    diagnostic(error.stack || String(error));
    clearTimeout(timeout);
    app.exit(1);
  }
});
require('../main.js');
