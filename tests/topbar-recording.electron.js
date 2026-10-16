const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

// Run the production app, preload, MediaRecorder, and recording-file IPC. Chromium
// supplies a synthetic microphone so the test never uses the person's real mic.
const profile = process.env.TODO_TEST_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'slate-topbar-recording-'));
app.commandLine.appendSwitch('user-data-dir', profile);
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'app-settings.json'), JSON.stringify({
  shortcut: 'Control+Alt+R', defaultTab: 'home',
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, description, timeoutMs = 12000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const result = await check();
    if (result) return result;
    await sleep(30);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
const timeout = setTimeout(() => { diagnostic(`Topbar recording timed out: ${JSON.stringify(errors)}`); app.exit(1); }, 100000);

app.whenReady().then(async () => {
  try {
    const main = await waitFor(() => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/renderer/index.html')), 'production main window');
    const evaluate = (script) => main.webContents.executeJavaScript(script).catch((error) => {
      throw new Error(`Renderer action failed: ${script}\n${errors.join('\n')}\n${error.message}`, { cause: error });
    });
    const state = () => evaluate("document.getElementById('quick-recorder').dataset.state");
    const records = () => evaluate("JSON.parse(localStorage.getItem('slate-recordings') || '[]')");
    const activeTab = () => evaluate("document.querySelector('.tab-panel.active')?.id");
    const click = async (selector) => {
      const point = await evaluate(`(() => {
        const button = document.querySelector(${JSON.stringify(selector)});
        if (!button || button.disabled || button.hidden) throw new Error('Unavailable control: ' + ${JSON.stringify(selector)});
        const box = button.getBoundingClientRect();
        const x = Math.round(box.left + box.width / 2), y = Math.round(box.top + box.height / 2);
        const hit = document.elementFromPoint(x, y);
        if (!box.width || !box.height || !(hit === button || button.contains(hit))) throw new Error('Control cannot receive a pointer click: ' + ${JSON.stringify(selector)});
        return { x, y };
      })()`);
      main.webContents.sendInputEvent({ type: 'mouseMove', ...point });
      main.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      main.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    };
    await waitFor(() => evaluate("!!window.SlateWorkspace && typeof workspaceHydrating !== 'undefined' && !workspaceHydrating && !!document.getElementById('quick-recorder')").catch(() => false), 'hydrated workspace and topbar recording');
    assert.equal(path.resolve(app.getPath('userData')), path.resolve(profile), 'test must never use the real profile');
    const workspace = await evaluate('window.slateAPI.getWorkspace()');
    assert.equal(path.resolve(workspace.path), path.resolve(profile), 'audio files stay inside the isolated workspace');
    await evaluate('setMode(true)');
    await waitFor(() => evaluate("document.getElementById('app').classList.contains('expanded')"), 'expanded panel');
    main.show();
    main.focus();
    main.webContents.focus();
    // This group waits for six-second deletion windows while exercising media
    // controls. Keep its panel open if the person uses another desktop app;
    // outside-click dismissal is covered separately by dismiss-outside.
    await evaluate('setPanelPinned(true)');
    // No cloud/browser transcription is needed for quick local audio recording.
    await evaluate('window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; true');
    assert.equal(await evaluate("document.getElementById('tab-button-recordings').hidden"), true, 'recording library starts disabled');
    assert.equal(await evaluate("getComputedStyle(document.getElementById('quick-recorder')).display !== 'none'"), true, 'quick recording stays available independently of the library setting');
    assert.equal(await evaluate("document.querySelector('#home-bento [data-home-module=recorder]')"), null, 'recording consumes no homepage tile');
    assert.equal(await evaluate("document.getElementById('recording-strands')"), null, 'compact recorder needs no waveform canvas');

    diagnostic('Topbar recording: record locally without opening a page or configuring an API');
    await click('#record-start');
    await waitFor(async () => await state() === 'recording', 'recording begins');
    assert.equal(await activeTab(), 'tab-home', 'starting quick recording keeps the current page');
    assert.equal(await evaluate("document.getElementById('record-start').hidden"), true);
    assert.equal(await evaluate("document.getElementById('record-stop').disabled"), false);
    await waitFor(() => evaluate("document.getElementById('home-recording-time').textContent !== '00:00'"), 'elapsed recording time');
    await click('#record-pause');
    await waitFor(async () => await state() === 'paused', 'pause');
    const pausedTime = await evaluate("document.getElementById('home-recording-time').textContent");
    await sleep(1100);
    assert.equal(await evaluate("document.getElementById('home-recording-time').textContent"), pausedTime, 'pause freezes the elapsed time');
    assert.equal(await evaluate("document.getElementById('record-pause').getAttribute('aria-label')"), '继续录音');
    assert.equal(await evaluate("document.querySelector('#record-pause [data-record-label]').textContent"), '继续');
    await click('#record-pause');
    await waitFor(async () => await state() === 'recording', 'resume');

    diagnostic('Topbar recording: library opens on demand and shares pause/continue/stop controls');
    await click('#record-open-library');
    await waitFor(async () => await activeTab() === 'tab-recordings', 'recording library');
    assert.equal((await evaluate('window.slateAPI.getAppSettings()')).features.recordings, true, 'explicit library entry persists its navigation preference');
    assert.equal(await evaluate("document.querySelectorAll('.recording-item.is-live').length"), 1);
    await click('.recording-live-pause');
    await waitFor(async () => await state() === 'paused', 'detail pause reflected in topbar');
    await click('#record-pause');
    await waitFor(async () => await state() === 'recording', 'topbar resume reflected in detail');
    assert.equal(await evaluate("document.querySelector('.recording-live-pause').textContent"), '暂停');
    await sleep(400);
    await click('.recording-live-stop');
    await waitFor(async () => await state() === 'saved', 'saved local recording');
    assert.equal(await evaluate("window.SlateWorkspace.isRecordingActive()"), false);
    assert.equal(await evaluate("document.getElementById('home-recording-state').textContent"), '已保存');
    assert.equal(await evaluate("document.querySelectorAll('.recording-item.is-live').length"), 0);
    const saved = await records();
    assert.equal(saved.length, 1);
    assert.ok(saved[0].durationMs >= 1000);
    assert.ok(saved[0].audioPath && !saved[0].isDraft);
    const audioPath = path.isAbsolute(saved[0].audioPath) ? saved[0].audioPath : path.resolve(workspace.path, saved[0].audioPath);
    assert.ok(audioPath.startsWith(`${path.resolve(profile)}${path.sep}`));
    assert.ok(fs.statSync(audioPath).size > 0, 'production IPC writes real audio bytes');
    const read = await evaluate(`window.slateAPI.readRecording(${JSON.stringify(saved[0].audioPath)})`);
    assert.ok(read?.bytes?.byteLength > 0, 'production playback can read the persisted recording');
    await sleep(700);
    assert.equal(await evaluate("window.SlateWorkspace.isRecordingActive()"), false, 'stopping leaves no active recording timer or draft');

    diagnostic('Topbar recording: storage failure reports failure instead of a successful save');
    const productionSave = ipcMain._invokeHandlers.get('recordings:save');
    const productionDelete = ipcMain._invokeHandlers.get('recordings:delete');
    assert.equal(typeof productionSave, 'function');
    assert.equal(typeof productionDelete, 'function');
    ipcMain.removeHandler('recordings:save');
    let finishSave;
    let saveRequests = 0;
    let failNextSave = true;
    ipcMain.handle('recordings:save', (event, payload) => {
      saveRequests += 1;
      if (failNextSave) return new Promise((resolve) => { finishSave = resolve; });
      return productionSave(event, payload);
    });
    await click('#record-start');
    await waitFor(async () => await state() === 'recording', 'second local recording');
    main.webContents.send('transcription:event', { type: 'transcript', final: '保存失败时必须保留的转写内容', interim: '' });
    await waitFor(() => evaluate("document.querySelector('[data-recording-live-transcript]').value.includes('必须保留')"), 'transcript delivered through the production subscription');
    const failedDraftId = await evaluate("document.querySelector('.recording-item.is-live').dataset.id");
    await sleep(350);
    await click('#record-stop');
    await waitFor(async () => await state() === 'saving' && typeof finishSave === 'function', 'pending disk write');
    assert.equal(await evaluate("document.getElementById('record-stop').disabled"), true);
    assert.equal(await evaluate("document.getElementById('home-recording-state').textContent"), '正在保存');
    finishSave({ ok: false, error: 'write_failed' });
    await waitFor(async () => await state() === 'error', 'honest write failure');
    assert.equal(await evaluate("document.getElementById('home-recording-state').textContent"), '保存失败');
    assert.match(await evaluate("document.getElementById('quick-recorder').title"), /保存失败/);
    assert.equal((await records()).length, 1, 'failed write creates no phantom saved row');
    assert.equal(await evaluate("document.querySelectorAll('.recording-item.is-live').length"), 1, 'failed save keeps the captured draft');
    assert.match(await evaluate("document.querySelector('[data-recording-meta]').textContent"), /未保存/);
    assert.match(await evaluate("document.querySelector('[data-recording-live-transcript]').value"), /必须保留/);
    assert.equal(await evaluate("document.getElementById('record-start').disabled && document.getElementById('recording-new').disabled"), true, 'new recording cannot replace unsaved audio');
    assert.equal(await evaluate("window.SlateWorkspace.isRecordingActive()"), true, 'unsaved content remains protected from workspace replacement');
    failNextSave = false;
    await click('#record-retry');
    await waitFor(async () => await state() === 'saved', 'retry preserves and saves the original audio');
    const recovered = (await records()).find((item) => item.id === failedDraftId);
    assert.ok(recovered, 'retry uses the same recording identity');
    assert.match(recovered.transcript, /必须保留/);
    const recoveredPath = path.resolve(workspace.path, recovered.audioPath);
    assert.ok(fs.statSync(recoveredPath).size > 0);
    assert.equal(saveRequests, 2);
    assert.equal(await evaluate("window.SlateWorkspace.isRecordingActive()"), false);

    diagnostic('Topbar recording: metadata retry reuses the written audio file');
    await click('#record-start');
    await waitFor(async () => await state() === 'recording', 'third recording');
    const listFailureId = await evaluate("document.querySelector('.recording-item.is-live').dataset.id");
    await evaluate(`window.__recordingSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === 'slate-recordings') throw new DOMException('Injected quota failure', 'QuotaExceededError');
        return window.__recordingSetItem.call(this, key, value);
      }; true`);
    await sleep(350);
    await click('#record-stop');
    await waitFor(async () => await state() === 'error', 'metadata write failure');
    assert.equal(await evaluate("document.getElementById('home-recording-state').textContent"), '列表保存失败');
    assert.equal((await records()).length, 2);
    assert.equal(saveRequests, 3, 'one audio write happened before the list failure');
    const audioDirectory = path.dirname(audioPath);
    const filesBeforeRetry = fs.readdirSync(audioDirectory).sort();
    await evaluate('Storage.prototype.setItem = window.__recordingSetItem; delete window.__recordingSetItem; true');
    await click('.recording-live-retry');
    await waitFor(async () => await state() === 'saved', 'retry list only');
    assert.equal(saveRequests, 3, 'metadata retry never creates a duplicate audio file');
    assert.deepEqual(fs.readdirSync(audioDirectory).sort(), filesBeforeRetry);
    assert.equal((await records()).filter((item) => item.id === listFailureId).length, 1);

    diagnostic('Topbar recording: recording deletion supports undo without deleting audio');
    await click(`.recording-item[data-id="${failedDraftId}"] [data-action="delete-recording-item"]`);
    await waitFor(async () => (await records()).length === 2, 'optimistic deletion');
    assert.ok(fs.existsSync(recoveredPath), 'audio stays intact throughout the undo window');
    await click('#status-toast-action');
    await waitFor(async () => (await records()).some((item) => item.id === failedDraftId), 'undo restores metadata');
    assert.ok(fs.existsSync(recoveredPath));
    const reread = await evaluate(`window.slateAPI.readRecording(${JSON.stringify(recovered.audioPath)})`);
    assert.ok(reread?.bytes?.byteLength > 0, 'undo leaves the recovered audio playable');

    diagnostic('Topbar recording: expired deletion actually deletes the audio');
    await click(`.recording-item[data-id="${failedDraftId}"] [data-action="delete-recording-item"]`);
    await waitFor(() => !fs.existsSync(recoveredPath), 'expired delete removes the physical file', 10000);
    assert.equal((await records()).some((item) => item.id === failedDraftId), false);
    await waitFor(() => evaluate("JSON.parse(localStorage.getItem('slate-recording-deletions') || '[]').length === 0"), 'delete journal committed');
    assert.equal(await evaluate(`window.slateAPI.deleteRecording(${JSON.stringify(recovered.audioPath)})`), true, 'deleting the same safe missing recording is idempotent');
    assert.equal(await evaluate("window.slateAPI.deleteRecording('../not-a-recording.webm')"), false, 'missing-file idempotency never permits a path outside the recording directory');

    diagnostic('Topbar recording: failed file deletion restores the saved row');
    ipcMain.removeHandler('recordings:delete');
    ipcMain.handle('recordings:delete', () => false);
    const listRecording = (await records()).find((item) => item.id === listFailureId);
    const listAudioPath = path.resolve(workspace.path, listRecording.audioPath);
    await click(`.recording-item[data-id="${listFailureId}"] [data-action="delete-recording-item"]`);
    await evaluate('dismissStatusToast(true); true');
    await waitFor(async () => (await records()).some((item) => item.id === listFailureId), 'file deletion failure restores metadata');
    assert.ok(fs.existsSync(listAudioPath));
    ipcMain.removeHandler('recordings:delete');
    ipcMain.handle('recordings:delete', productionDelete);

    diagnostic('Topbar recording: explicit discard requires a second action');
    failNextSave = true;
    finishSave = null;
    await click('#record-start');
    await waitFor(async () => await state() === 'recording', 'fourth recording');
    await sleep(350);
    await click('#record-stop');
    await waitFor(() => typeof finishSave === 'function', 'fourth audio write');
    finishSave({ ok: false, error: 'write_failed' });
    await waitFor(async () => await state() === 'error', 'fourth save failure');
    await click('#record-discard');
    assert.equal(await evaluate("document.querySelectorAll('.recording-item.is-live').length"), 1, 'first discard click cannot destroy the captured recording');
    assert.equal(await evaluate("document.getElementById('status-toast-action').textContent"), '放弃本次录音');
    await click('#status-toast-action');
    await waitFor(async () => await state() === 'idle', 'confirmed discard');
    assert.equal(await evaluate("document.querySelectorAll('.recording-item.is-live').length"), 0);
    assert.equal((await records()).length, 2);
    failNextSave = false;

    diagnostic('Topbar recording: rejected permission creates no recording and allows retry');
    ipcMain.removeHandler('media:microphone');
    let finishPermission;
    let requests = 0;
    ipcMain.handle('media:microphone', () => { requests += 1; return new Promise((resolve) => { finishPermission = resolve; }); });
    await click('#record-start');
    await waitFor(async () => await state() === 'requesting' && typeof finishPermission === 'function', 'permission pending');
    assert.equal(await evaluate("document.getElementById('record-start').disabled && document.getElementById('recording-new').disabled"), true);
    assert.match(await evaluate("document.getElementById('quick-recorder').title"), /等待确认麦克风权限/);
    assert.equal(await evaluate("document.querySelectorAll('.recording-item.is-live').length"), 0);
    finishPermission(false);
    await waitFor(async () => await state() === 'error' && !await evaluate('window.SlateWorkspace.isRecordingActive()'), 'rejected permission cleanup');
    assert.equal(requests, 1);
    assert.equal(await evaluate("document.getElementById('home-recording-state').textContent"), '麦克风未授权');
    assert.equal(await evaluate("document.getElementById('record-start').disabled"), false);
    assert.equal((await records()).length, 2);
    await click('#record-start');
    await waitFor(async () => await state() === 'requesting' && requests === 2, 'permission retry');
    finishPermission(true);
    await waitFor(async () => await state() === 'recording', 'permission retry starts recording');
    await sleep(350);
    await click('#record-stop');
    await waitFor(async () => await state() === 'saved', 'permission retry saves normally');
    assert.equal((await records()).length, 3);

    diagnostic('Topbar recording: interrupted deletion resumes after reload');
    let deleteCalls = 0;
    ipcMain.removeHandler('recordings:delete');
    ipcMain.handle('recordings:delete', (event, audioFile) => {
      deleteCalls += 1;
      if (deleteCalls === 1) return new Promise(() => {});
      return productionDelete(event, audioFile);
    });
    await click(`.recording-item[data-id="${listFailureId}"] [data-action="delete-recording-item"]`);
    await evaluate('dismissStatusToast(true); true');
    await waitFor(() => deleteCalls === 1, 'interrupted delete request');
    const reloaded = new Promise((resolve) => main.webContents.once('did-finish-load', resolve));
    main.webContents.reload();
    await reloaded;
    await waitFor(() => evaluate("!!window.SlateWorkspace && !workspaceHydrating").catch(() => false), 'reloaded workspace');
    await waitFor(() => !fs.existsSync(listAudioPath), 'journal finishes interrupted physical deletion');
    await waitFor(() => evaluate("JSON.parse(localStorage.getItem('slate-recording-deletions') || '[]').length === 0"), 'reloaded journal committed');
    assert.equal((await records()).length, 2);
    assert.deepEqual(errors, [], 'recording controls must not produce renderer console errors');
    diagnostic('Production topbar recording checks passed');
    clearTimeout(timeout);
    app.quit();
  } catch (error) {
    diagnostic(error.stack || String(error));
    clearTimeout(timeout);
    app.exit(1);
  }
});

require('../main.js');
