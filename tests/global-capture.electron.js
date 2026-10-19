const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { app, BrowserWindow, clipboard, globalShortcut, screen } = require('electron');

// Two consecutive production app starts exercise persisted shortcut registration,
// rather than equating a successful settings write with a successful restart.
const stage = process.env.SLATE_CAPTURE_TEST_STAGE;
const profile = process.env.TODO_TEST_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'slate-global-capture-'));
if (!stage) {
  for (const value of ['first', 'restart']) {
    const result = spawnSync(process.execPath, [__filename], {
      env: { ...process.env, TODO_TEST_USER_DATA: profile, SLATE_CAPTURE_TEST_STAGE: value },
      stdio: 'inherit', timeout: 90000,
    });
    if (result.error) console.error(result.error);
    if (result.status !== 0) app.exit(result.status || 1);
  }
  app.exit(0);
} else {
  app.commandLine.appendSwitch('user-data-dir', profile);
  if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
  fs.mkdirSync(profile, { recursive: true });
  if (stage === 'first') {
    fs.writeFileSync(path.join(profile, 'app-settings.json'), JSON.stringify({
      shortcut: 'Control+Alt+U', captureShortcut: 'Control+Alt+Q', defaultTab: 'notes',
      features: { home: true, todo: true, notes: true, links: true, recordings: false, credentials: false, clip: true },
      clipboard: { captureEnabled: false, retentionDays: 7, ignoredApps: [], pausedUntil: 0 },
    }));
    fs.writeFileSync(path.join(profile, 'workspace.json'), JSON.stringify({ version: 1, localStorage: {
      'slate-home-note': '未完成的首页写作，不得被快捷处理覆盖。',
    } }));
  }

  // Native inputs are isolated; all app IPC, preload, HTML, handlers, and storage
  // below are the production implementation. No external application is opened.
  const shortcuts = new Map();
  const occupied = new Set(['Control+Alt+X']);
  globalShortcut.register = (key, callback) => {
    if (occupied.has(key) || shortcuts.has(key)) return false;
    shortcuts.set(key, callback); return true;
  };
  globalShortcut.isRegistered = (key) => shortcuts.has(key);
  globalShortcut.unregister = (key) => shortcuts.delete(key);
  globalShortcut.unregisterAll = () => shortcuts.clear();
  let clipboardText = 'An explicit clipboard capture, not continuous history.';
  let clipboardReads = 0;
  const copied = [];
  clipboard.readText = () => { clipboardReads += 1; return clipboardText; };
  clipboard.writeText = (text) => copied.push(text);

  const { TranslationService } = require('../translation-service.cjs');
  let modelInstalled = false;
  let translationRunCount = 0;
  const unexpectedModelActions = [];
  let releaseCount = 0;
  let translator;
  const release = TranslationService.prototype.release;
  TranslationService.prototype.status = function () {
    translator = this;
    return { installed: modelInstalled, loaded: Boolean(this.worker), busy: Boolean(this.pending) };
  };
  TranslationService.prototype.run = function (action, text, source) {
    translator = this;
    if (action !== 'translate') unexpectedModelActions.push(action);
    assert.equal(action, 'translate', 'the capture flow must never download or install a model implicitly');
    if (this.pending) return Promise.reject(new Error('已有翻译任务，请等待完成或取消'));
    if (!modelInstalled) return Promise.reject(new Error('请先下载本地翻译模型'));
    if (text.length > 6000) return Promise.reject(new Error('请输入 1–6000 个字符'));
    translationRunCount += 1;
    this.worker ||= { kill() {} };
    return new Promise((resolve, reject) => { this.pending = { resolve, reject, text, source }; });
  };
  TranslationService.prototype.release = function () { releaseCount += 1; return release.call(this); };
  const finishTranslation = (text) => {
    const pending = translator.pending;
    assert.ok(pending, 'the test completes only a real in-flight translation request');
    translator.pending = null;
    pending.resolve({ text, source: 'en' });
    translator.notify({ type: 'status', ...translator.status() });
  };

  const errors = [];
  const diagnostic = (message) => {
    console.log(message);
    if (process.env.TODO_TEST_LOG) fs.appendFileSync(process.env.TODO_TEST_LOG, `${message}\n`);
  };
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
  const timeout = setTimeout(() => { diagnostic(`Global capture timed out: ${JSON.stringify(errors)}`); app.exit(1); }, 80000);
  const screenshotRoot = process.env.SLATE_CAPTURE_SCREENSHOTS;
  const evaluate = (win, script) => win.webContents.executeJavaScript(script).catch((error) => {
    throw new Error(`Renderer action failed: ${script.slice(0, 240)}\n${error.message}\n${errors.join('\n')}`, { cause: error });
  });
  const click = async (win, selector) => {
    const point = await evaluate(win, `(() => {
      const control = document.querySelector(${JSON.stringify(selector)});
      if (!control || control.disabled || control.hidden) throw new Error('Unavailable control: ' + ${JSON.stringify(selector)});
      const box = control.getBoundingClientRect();
      const x = Math.round(box.left + box.width / 2), y = Math.round(box.top + box.height / 2);
      const hit = document.elementFromPoint(x, y), style = getComputedStyle(control);
      if (!box.width || !box.height || style.visibility === 'hidden' || Number(style.opacity) === 0 || !(hit === control || control.contains(hit))) {
        throw new Error('Control cannot receive a pointer click: ' + ${JSON.stringify(selector)} + ' hit=' + (hit?.id || hit?.className));
      }
      return { x, y };
    })()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    await sleep(30);
  };
  const fill = async (win, selector, value) => {
    await waitFor(() => evaluate(win, `(() => { const input = document.querySelector(${JSON.stringify(selector)}); return input && !input.disabled && !input.readOnly; })()`), 'editable source');
    return evaluate(win, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input || input.disabled) throw new Error('Unavailable input: ' + ${JSON.stringify(selector)});
    input.focus(); input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  };
  async function screenshot(win, name, theme = 'light') {
    if (!screenshotRoot) return;
    fs.mkdirSync(screenshotRoot, { recursive: true });
    await evaluate(win, `document.documentElement.dataset.theme = ${JSON.stringify(theme)}; true`);
    await sleep(80);
    fs.writeFileSync(path.join(screenshotRoot, name), (await win.webContents.capturePage()).toPNG());
    diagnostic(`Global capture screenshot: ${path.join(screenshotRoot, name)}`);
  }

  app.whenReady().then(async () => {
    try {
      const main = await waitFor(() => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/renderer/index.html')), 'production main window');
      await waitFor(() => evaluate(main, "!!window.SlateTasks && !!window.SlateWorkNotes && typeof workspaceHydrating !== 'undefined' && !workspaceHydrating").catch(() => false), 'hydrated production workspace');
      assert.equal(path.resolve(app.getPath('userData')), path.resolve(profile), 'the real user profile is never used');
      const archives = () => evaluate(main, "JSON.parse(localStorage.getItem('slate-note-archive-v1') || '[]')");
      const tasks = () => evaluate(main, "Object.values(JSON.parse(localStorage.getItem('slate-todo-data') || '{}')).flat()");
      const settings = () => evaluate(main, 'window.slateAPI.getAppSettings()');
      const setShortcut = (value) => evaluate(main, `window.slateAPI.setCaptureShortcut(${JSON.stringify(value)})`);
      const captureWindow = () => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/renderer/quick-capture.html'));
      const expectCollapsed = async (tab = 'notes') => {
        assert.equal(await evaluate(main, "document.getElementById('app').classList.contains('collapsed')"), true, 'global actions do not expand the full Slate panel');
        assert.equal(await evaluate(main, "document.querySelector('.tab-panel.active').id"), `tab-${tab}`, 'global actions do not navigate the user away from the existing page');
      };
      const invokeShortcut = async () => {
        const key = (await settings()).captureShortcut;
        assert.equal(typeof shortcuts.get(key), 'function', 'the persisted global shortcut has a live registered callback');
        shortcuts.get(key)();
        const capture = await waitFor(captureWindow, 'on-demand capture window');
        await waitFor(() => evaluate(capture, "!!window.quickCaptureAPI && !document.getElementById('quick-text').disabled").catch(() => false), 'usable capture page');
        await waitFor(() => capture.isVisible(), 'visible capture window');
        await waitFor(() => evaluate(capture, `document.getElementById('quick-text').value === ${JSON.stringify(clipboardText)}`), 'initial capture source ready');
        return capture;
      };
      const closeCapture = async (capture) => {
        await click(capture, '#quick-close');
        await waitFor(() => capture.isDestroyed(), 'capture window destroyed on close');
        assert.equal(captureWindow(), undefined, 'closing releases the extra renderer rather than hiding it');
      };

      if (stage === 'restart') {
        assert.equal((await settings()).captureShortcut, 'Control+Alt+J', 'a fresh main process reads the saved custom shortcut');
        assert.equal(shortcuts.has('Control+Alt+J'), true);
        assert.equal(shortcuts.has('Control+Alt+Q'), false, 'the default shortcut is not reintroduced after restart');
        assert.ok((await tasks()).some((item) => item.text.includes('客户反馈需要跟进') && item.notes?.endsWith('尾句保留。')), 'the canonical task survives a complete process restart');
        assert.ok((await archives()).some((item) => item.content.length === 6000 && item.content.startsWith('快捷独立笔记\n') && item.content.endsWith('笔记结尾。')), 'the complete quick note survives a complete process restart');
        clipboardText = 'Restarted custom shortcut still works.';
        const restartTab = await evaluate(main, "document.querySelector('.tab-panel.active').id.replace('tab-', '')");
        const capture = await invokeShortcut();
        await waitFor(() => evaluate(capture, `document.getElementById('quick-text').value === ${JSON.stringify(clipboardText)}`), 'clipboard read after restart');
        await expectCollapsed(restartTab);
        await closeCapture(capture);
        diagnostic('Global capture: custom shortcut persists across a real app restart');
      } else {
        await waitFor(() => evaluate(main, "document.getElementById('app').classList.contains('collapsed')"), 'initial collapsed panel');
        assert.equal(captureWindow(), undefined, 'there is no permanent second application renderer for quick capture');
        assert.equal(clipboardReads, 0, 'disabled clipboard collection reads nothing until an explicit action');
        assert.equal((await settings()).captureShortcut, 'Control+Alt+Q');
        const baselineWindows = BrowserWindow.getAllWindows().length;
        const initialDraft = await evaluate(main, "document.getElementById('home-note').value");
        const initialArchiveId = await evaluate(main, "localStorage.getItem('slate-note-active-archive-v1')");

        await evaluate(main, "setMode(true); setPanelPinned(true); setActiveTab('todo'); window.SlateTasks.add('Existing editable task', { period: 'day', notes: 'Persisted original notes' }); true");
        await waitFor(() => evaluate(main, "document.getElementById('app').classList.contains('expanded') && !modeBusy"), 'task editing fixture panel after slide');
        main.show(); main.focus(); main.webContents.focus();
        const draftTask = (await tasks()).find((item) => item.text === 'Existing editable task');
        const draftRow = `#todo-list [data-id="${draftTask.id}"]`;
        await click(main, `${draftRow} [data-action="details"]`);
        await click(main, `${draftRow} [data-action="edit"]`);
        await fill(main, `${draftRow} [data-detail="notes"]`, '尚未保存的下一步与客户反馈\n'.repeat(12));
        await fill(main, `${draftRow} .todo-inline-name`, '尚未保存的任务名称');
        await evaluate(main, `document.querySelector(${JSON.stringify(`${draftRow} .todo-inline-name`)}).setSelectionRange(2, 6); setActiveTab('notes'); setPanelPinned(false); setMode(false); true`);
        await waitFor(() => evaluate(main, "document.getElementById('app').classList.contains('collapsed')"), 'collapse with unfinished task edits');
        const readTaskDraft = () => evaluate(main, `(() => {
          const row = document.querySelector(${JSON.stringify(draftRow)}), notes = row.querySelector('[data-detail="notes"]'), name = row.querySelector('.todo-inline-name');
          return { notes: notes.value, name: name.value, start: name.selectionStart, end: name.selectionEnd, hidden: notes.hidden };
        })()`);
        const unfinishedTask = await readTaskDraft();

        diagnostic('Global capture: direct shortcut opens an isolated, bounded editor');
        let capture = await invokeShortcut();
        await waitFor(() => evaluate(capture, `document.getElementById('quick-text').value === ${JSON.stringify(clipboardText)}`), 'full explicit clipboard source');
        await expectCollapsed();
        assert.equal(BrowserWindow.getAllWindows().length, baselineWindows + 1);
        assert.equal(await evaluate(capture, "typeof require + '/' + typeof window.slateAPI"), 'undefined/undefined', 'the quick renderer has only its narrow isolated preload');
        const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
        const bounds = capture.getBounds();
        assert.ok(bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height, `quick window remains within the pointer display work area: ${JSON.stringify({ bounds, area })}`);
        const readCount = clipboardReads;
        await sleep(450);
        assert.equal(clipboardReads, readCount, 'leaving the editor open does not continuously monitor clipboard text');
        clipboardText = 'Explicitly refresh the system clipboard.';
        await click(capture, '#quick-reread');
        await waitFor(() => evaluate(capture, `document.getElementById('quick-text').value === ${JSON.stringify(clipboardText)}`), 'explicit refresh source');
        assert.ok(clipboardReads > readCount);

        const editedSource = 'The user has already edited this source.';
        await fill(capture, '#quick-text', editedSource);
        clipboardText = 'New incoming clipboard text must not silently replace edits.';
        shortcuts.get((await settings()).captureShortcut)();
        await sleep(100);
        assert.equal(captureWindow().id, capture.id, 'invoking the shortcut twice reuses one existing temporary window');
        assert.equal(await evaluate(capture, "document.getElementById('quick-text').value"), editedSource, 'a repeated shortcut cannot overwrite unsaved edits');
        await click(capture, '#quick-reread');
        assert.equal(await evaluate(capture, "document.getElementById('quick-text').value"), editedSource, 'the first refresh click requests confirmation before discarding edits');
        await click(capture, '#quick-reread');
        await waitFor(() => evaluate(capture, `document.getElementById('quick-text').value === ${JSON.stringify(clipboardText)}`), 'confirmed replacement of edited source');

        const taskSource = '客户反馈需要跟进\n' + '全部反馈原文必须保留。'.repeat(400) + '\n尾句保留。';
        await fill(capture, '#quick-text', taskSource);
        await click(capture, '#quick-todo');
        const task = await waitFor(async () => (await tasks()).find((item) => item.text.includes('客户反馈需要跟进')), 'global task saved through the canonical workspace');
        assert.ok(String(task.notes || '').includes(taskSource), 'long task source is complete in its detail field');
        assert.equal(task.planKind, 'day', 'quick task enters Today');
        assert.equal((await tasks()).filter((item) => item.id === task.id).length, 1);
        assert.deepEqual(await readTaskDraft(), unfinishedTask, 'background task capture preserves unsaved detail notes, inline title, and caret selection');
        assert.equal((await tasks()).find((item) => item.id === draftTask.id).text, 'Existing editable task', 'background capture never implicitly saves an unfinished title');
        assert.equal((await tasks()).find((item) => item.id === draftTask.id).notes, 'Persisted original notes', 'background capture never implicitly saves unfinished details');
        await expectCollapsed();
        const notePrefix = '快捷独立笔记\n', noteSuffix = '\n笔记结尾。';
        const noteSource = notePrefix + '文'.repeat(6000 - notePrefix.length - noteSuffix.length) + noteSuffix;
        await fill(capture, '#quick-text', noteSource);
        await click(capture, '#quick-note');
        const note = await waitFor(async () => (await archives()).find((item) => item.content === noteSource), 'independent complete archive note');
        assert.notEqual(note.id, initialArchiveId);
        assert.equal(await evaluate(main, "document.getElementById('home-note').value"), initialDraft, 'the homepage writing session is untouched');
        assert.equal(await evaluate(main, "localStorage.getItem('slate-note-active-archive-v1')"), initialArchiveId);
        assert.equal((await settings()).clipboard.captureEnabled, false);
        assert.equal(await evaluate(main, "JSON.parse(localStorage.getItem('slate-clip-history') || '[]').length"), 0, 'global processing does not enable clipboard history');
        await expectCollapsed();

        diagnostic('Global capture: offline model and busy failures preserve original text');
        const uninstalledSource = 'Keep this original while the local model is unavailable.';
        await fill(capture, '#quick-text', uninstalledSource);
        await click(capture, '#quick-translate');
        await waitFor(() => evaluate(capture, "/模型|准备|下载/.test(document.getElementById('quick-feedback').textContent)"), 'explicit model preparation feedback');
        assert.equal(await evaluate(capture, "document.getElementById('quick-text').value"), uninstalledSource);
        assert.equal(translationRunCount, 0);
        await expectCollapsed();
        await screenshot(capture, '01-model-uninstalled-light.png');
        modelInstalled = true;
        const oversizedTranslation = '译'.repeat(6001);
        await fill(capture, '#quick-text', oversizedTranslation);
        await click(capture, '#quick-translate');
        await waitFor(() => evaluate(capture, "/6000|过长|长度/.test(document.getElementById('quick-feedback').textContent)"), '6000-character translation limit');
        assert.equal(await evaluate(capture, "document.getElementById('quick-text').value"), oversizedTranslation, 'overlong source is never silently truncated');
        assert.equal(translationRunCount, 0);
        const tasksBeforeOverflow = (await tasks()).length;
        const notesBeforeOverflow = (await archives()).length;
        for (const action of ['todo', 'note']) {
          await evaluate(capture, "document.getElementById('quick-feedback').textContent = ''; true");
          await click(capture, `#quick-${action}`);
          await waitFor(() => evaluate(capture, "/6000|过长|长度/.test(document.getElementById('quick-feedback').textContent)"), `overlong ${action} explicitly rejected`);
          const denied = await evaluate(capture, `window.quickCaptureAPI.perform({ action: ${JSON.stringify(action)}, text: ${JSON.stringify(oversizedTranslation)} })`);
          assert.equal(denied.ok, false, 'production IPC also refuses an overlong action');
        }
        assert.equal((await tasks()).length, tasksBeforeOverflow);
        assert.equal((await archives()).length, notesBeforeOverflow);
        assert.equal(await evaluate(capture, "document.getElementById('quick-text').value"), oversizedTranslation, 'all overlong actions retain the complete original for editing');
        await closeCapture(capture);

        await evaluate(main, "window.__quickMainTranslation = window.slateAPI.translateLocal({ text: 'Homepage-owned task', source: 'en' }); true");
        await waitFor(() => Boolean(translator?.pending), 'main-owned local translation');
        const mainReleaseCount = releaseCount;
        clipboardText = 'Second request must wait without cancelling the first.';
        capture = await invokeShortcut();
        await click(capture, '#quick-translate');
        await waitFor(() => evaluate(capture, "/运行|正在|等待|任务|稍后/.test(document.getElementById('quick-feedback').textContent)"), 'busy refusal');
        assert.equal(translationRunCount, 1, 'busy global request does not start a second translation');
        assert.equal(await evaluate(capture, "document.getElementById('quick-text').value"), clipboardText);
        await closeCapture(capture);
        assert.equal(releaseCount, mainReleaseCount, 'closing a quick window never stops a translation owned by the main panel');
        assert.equal(translator.pending.text, 'Homepage-owned task');
        finishTranslation('主页翻译已完成。');
        assert.equal((await evaluate(main, 'window.__quickMainTranslation')).ok, true);

        clipboardText = 'A quick-owned translation can be cancelled by closing only its own window.';
        capture = await invokeShortcut();
        await click(capture, '#quick-translate');
        await waitFor(() => translator?.pending?.text === clipboardText, 'quick-owned local translation');
        const ownedReleaseCount = releaseCount;
        await closeCapture(capture);
        assert.equal(releaseCount, ownedReleaseCount + 1, 'closing stops and releases its own translation worker');
        assert.equal(translator.pending, null);
        assert.equal(translator.worker, null);

        diagnostic('Global capture: late replies from a closed session do not reach the next window');
        const send = main.webContents.send.bind(main.webContents);
        const delayedContexts = [];
        main.webContents.send = (channel, payload, ...args) => {
          if (channel === 'quick-capture:request' && payload.action === 'context') { delayedContexts.push(payload); return; }
          return send(channel, payload, ...args);
        };
        clipboardText = 'An obsolete capture session.';
        shortcuts.get((await settings()).captureShortcut)();
        const obsolete = await waitFor(captureWindow, 'old pending context window');
        await waitFor(() => delayedContexts.length === 1, 'delayed real context request');
        obsolete.close();
        await waitFor(() => obsolete.isDestroyed(), 'obsolete window cleanup');
        clipboardText = 'Fresh source in a different capture session.';
        await evaluate(main, "document.documentElement.dataset.theme = 'light'; true");
        shortcuts.get((await settings()).captureShortcut)();
        capture = await waitFor(captureWindow, 'new capture session with pending context');
        await waitFor(() => delayedContexts.length === 2, 'new context awaiting its own reply');
        await evaluate(main, `window.slateAPI.replyQuickCapture({ id: ${JSON.stringify(delayedContexts[0].id)}, ok: true, theme: 'dark' }); true`);
        await sleep(100);
        assert.equal(await evaluate(capture, "document.getElementById('quick-text').disabled"), true, 'a stale acknowledgement cannot resolve the new session request');
        assert.notEqual(await evaluate(capture, 'document.documentElement.dataset.theme'), 'dark', 'an old dark-theme response cannot recolor the pending new window');
        main.webContents.send = send;
        send('quick-capture:request', delayedContexts[1]);
        await waitFor(() => evaluate(capture, `document.getElementById('quick-text').value === ${JSON.stringify(clipboardText)}`), 'new session initialized');
        assert.equal(await evaluate(capture, 'document.documentElement.dataset.theme'), 'light', 'only the current context acknowledgement chooses its theme');
        assert.equal(await evaluate(capture, "document.getElementById('quick-text').value"), clipboardText, 'old acknowledgement cannot replace the new source');
        const finalSource = 'Please send the revised proposal before 5 pm.\nWe need to confirm the scope and delivery date with the team.';
        const finalResult = '请在下午 5 点前发送修订后的方案。\n我们需要与团队确认工作范围和交付日期。';
        await fill(capture, '#quick-text', finalSource);
        await click(capture, '#quick-translate');
        await waitFor(() => translator?.pending?.text === finalSource, 'new translation after cancellation');
        finishTranslation(finalResult);
        await waitFor(() => evaluate(capture, `document.getElementById('quick-result').value === ${JSON.stringify(finalResult)}`), 'translated output shown in the small window');
        await screenshot(capture, '02-translation-light.png');
        await screenshot(capture, '03-translation-dark.png', 'dark');
        if (screenshotRoot) {
          const originalBounds = capture.getBounds();
          capture.setSize(420, 380);
          // Windows frameless resize borders and DPI rounding can add a few
          // client pixels. Verify the actual compact viewport, not exact DIP
          // equality between outer native bounds and CSS content dimensions.
          await waitFor(() => evaluate(capture, 'innerWidth >= 400 && innerWidth <= 440 && innerHeight >= 360 && innerHeight <= 400'), 'compact quick editor viewport');
          diagnostic(`Compact viewport: ${JSON.stringify(await evaluate(capture, '({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})'))}`);
          const unreachable = await evaluate(capture, `['close','reread','translate','note','todo','copy'].filter(id => {
            const control = document.getElementById('quick-' + id), box = control.getBoundingClientRect();
            const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
            return !box.width || !box.height || box.y < 0 || box.bottom > innerHeight || !(hit === control || control.contains(hit));
          })`);
          assert.deepEqual(unreachable, [], 'compact quick editor keeps every primary action reachable');
          await screenshot(capture, '04-translation-compact.png');
          capture.setBounds(originalBounds);
          await waitFor(() => evaluate(capture, `Math.abs(innerWidth - ${originalBounds.width}) <= 8 && Math.abs(innerHeight - ${originalBounds.height}) <= 8`), 'restore default quick editor viewport');
        }
        await click(capture, '#quick-copy');
        assert.equal(copied.at(-1), finalResult);
        await expectCollapsed();
        await closeCapture(capture);
        assert.equal(BrowserWindow.getAllWindows().length, baselineWindows, 'all temporary windows are released after use');

        diagnostic('Global capture: custom shortcuts are transactional and survive clearing');
        assert.equal((await setShortcut('Control+Alt+X')).error, 'occupied');
        assert.equal(shortcuts.has('Control+Alt+Q'), true, 'an OS conflict preserves the old live shortcut');
        assert.equal((await setShortcut('Control+Alt+U')).error, 'occupied', 'panel shortcut cannot be stolen');
        assert.equal((await setShortcut('Space')).error, 'invalid', 'global processing requires a modifier combination');
        assert.equal((await setShortcut('Control+Alt+J')).ok, true);
        assert.equal(shortcuts.has('Control+Alt+J'), true);
        assert.equal(shortcuts.has('Control+Alt+Q'), false);
        const rename = fs.renameSync;
        fs.renameSync = (source, target) => {
          if (path.resolve(target) === path.resolve(profile, 'app-settings.json')) throw Object.assign(new Error('Simulated settings write failure'), { code: 'EACCES' });
          return rename(source, target);
        };
        try {
          assert.equal((await setShortcut('Control+Alt+L')).error, 'save_failed');
        } finally { fs.renameSync = rename; }
        assert.equal(shortcuts.has('Control+Alt+L'), false);
        assert.equal(shortcuts.has('Control+Alt+J'), true, 'settings write failure rolls back native registration');
        assert.equal((await settings()).captureShortcut, 'Control+Alt+J');
        assert.equal((await setShortcut('')).ok, true);
        assert.equal(shortcuts.has('Control+Alt+J'), false, 'Clear really unregisters the shortcut');
        assert.equal((await settings()).captureShortcut, '');
        assert.equal((await settings()).captureShortcutRegistered, false);
        assert.equal((await setShortcut('Control+Alt+J')).ok, true);
        assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'app-settings.json'), 'utf8')).captureShortcut, 'Control+Alt+J');
        await expectCollapsed();
        const reloaded = new Promise((resolve) => main.webContents.once('did-finish-load', resolve));
        main.webContents.reload();
        await reloaded;
        await waitFor(() => evaluate(main, "!!window.SlateTasks && typeof workspaceHydrating !== 'undefined' && !workspaceHydrating").catch(() => false), 'workspace restored after reload');
        assert.equal((await tasks()).find((item) => item.id === task.id)?.notes.includes(taskSource), true, 'reload restores the complete captured task source');
        assert.equal((await archives()).find((item) => item.id === note.id)?.content, noteSource, 'reload restores the independent capture note');
        assert.equal(await evaluate(main, "document.getElementById('home-note').value"), initialDraft);

        diagnostic('Global capture: model setup and editable shortcut settings are explicit actions');
        await evaluate(main, "setActiveTab('notes')");
        modelInstalled = false;
        clipboardText = 'Original text retained when explicitly preparing the local model.';
        const previousTranslationDraft = 'Existing main translation draft must not be replaced by model setup.';
        await evaluate(main, `document.getElementById('translation-input').value = ${JSON.stringify(previousTranslationDraft)}; true`);
        capture = await invokeShortcut();
        await click(capture, '#quick-translate');
        await waitFor(() => evaluate(capture, "!document.getElementById('quick-setup').hidden"), 'explicit model setup action');
        const beforeSetupRuns = translationRunCount;
        await click(capture, '#quick-setup');
        await waitFor(() => evaluate(capture, "/草稿|原文|保留|已有|正在/.test(document.getElementById('quick-feedback').textContent)"), 'setup refuses to overwrite an existing different translation draft');
        assert.equal(capture.isDestroyed(), false);
        assert.equal(await evaluate(capture, "document.getElementById('quick-text').value"), clipboardText);
        assert.equal(await evaluate(main, "document.getElementById('translation-input').value"), previousTranslationDraft);
        await expectCollapsed();
        await evaluate(main, "document.getElementById('translation-input').value = ''; true");
        await click(capture, '#quick-setup');
        await waitFor(() => capture.isDestroyed(), 'model setup releases the temporary window');
        await waitFor(() => evaluate(main, "document.getElementById('app').classList.contains('expanded') && document.querySelector('.tab-panel.active').id === 'tab-settings'"), 'explicit model setup opens the settings page');
        assert.equal(translationRunCount, beforeSetupRuns, 'opening settings never silently starts a model download');
        assert.equal(await evaluate(main, "document.getElementById('translation-input').value"), clipboardText, 'source text follows the explicit setup flow for later translation');
        assert.equal(await evaluate(main, "document.getElementById('home-note').value"), initialDraft);
        assert.equal(await evaluate(main, "document.activeElement.id"), 'translation-install', 'setup targets offline translation rather than the recording API modal');
        await evaluate(main, 'setPanelPinned(true)');
        main.show(); main.focus(); main.webContents.focus();
        assert.equal((await setShortcut('Control+Alt+M')).ok, true);
        await click(main, '#settings-menu-shortcuts');
        await evaluate(main, "document.getElementById('settings-capture-shortcut-change').scrollIntoView({ block: 'center' }); true");
        await click(main, '#settings-capture-shortcut-change');
        await waitFor(() => evaluate(main, "!document.getElementById('shortcut-recorder').hidden && document.activeElement.id === 'shortcut-recorder'"), 'focused custom processing shortcut recorder');
        main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'X', modifiers: ['control', 'alt'] });
        main.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'X', modifiers: ['control', 'alt'] });
        await waitFor(() => evaluate(main, "/占用/.test(document.getElementById('shortcut-recorder-value').textContent)"), 'shortcut conflict feedback in the real recorder');
        assert.equal((await settings()).captureShortcut, 'Control+Alt+M', 'a rejected shortcut does not replace the previously saved one');
        assert.equal(shortcuts.has('Control+Alt+M'), true);
        main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'J', modifiers: ['control', 'alt'] });
        main.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'J', modifiers: ['control', 'alt'] });
        await waitFor(async () => (await settings()).captureShortcut === 'Control+Alt+J', 'custom shortcut saved from the real recording UI');
        await waitFor(() => evaluate(main, "document.getElementById('shortcut-recorder').hidden"), 'shortcut recorder closes after save');
        await evaluate(main, "document.getElementById('settings-capture-shortcut-clear').scrollIntoView({ block: 'center' }); true");
        await click(main, '#settings-capture-shortcut-clear');
        await waitFor(async () => (await settings()).captureShortcut === '', 'Clear button unregisters processing shortcut');
        assert.equal(shortcuts.has('Control+Alt+J'), false);
        assert.equal((await setShortcut('Control+Alt+J')).ok, true);
        await evaluate(main, "setActiveTab('notes'); setPanelPinned(false); setMode(false); true");
        await waitFor(() => evaluate(main, "document.getElementById('app').classList.contains('collapsed')"), 'return to previous collapsed notes page');
        await expectCollapsed();
      }
      diagnostic(`Production global capture ${stage} checks passed`);
      assert.deepEqual(unexpectedModelActions, [], 'quick processing never starts model installation or import implicitly');
      assert.deepEqual(errors, [], 'global text capture must not emit renderer errors');
      clearTimeout(timeout);
      app.quit();
    } catch (error) {
      diagnostic(error.stack || String(error)); clearTimeout(timeout); app.exit(1);
    }
  });
  require('../main.js');
}
