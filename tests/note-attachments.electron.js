const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, dialog, nativeImage } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'slate-note-images-'));
process.env.TODO_TEST_USER_DATA = profile;
process.env.SLATE_NOTIFICATION_PORT ||= '44461';
app.commandLine.appendSwitch('user-data-dir', profile);
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'app-settings.json'), JSON.stringify({
  shortcut: 'Control+Alt+I', defaultTab: 'home', clipboard: { captureEnabled: false },
  features: { home: true, todo: true, notes: true, clip: true },
}));
const fixture = path.join(profile, 'note-fixture.png'), backup = path.join(profile, 'notes-backup.json');
let openPath = fixture, pendingPicker = null, pickerMode = 'normal';
dialog.showOpenDialog = async () => pickerMode === 'cancel' ? { canceled: true, filePaths: [] }
  : pickerMode === 'pending' ? new Promise(resolve => { pendingPicker = resolve; }) : { canceled: false, filePaths: [openPath] };
dialog.showSaveDialog = async () => ({ canceled: false, filePath: backup });
const errors = [];
app.on('web-contents-created', (_event, contents) => contents.on('console-message', details => {
  if (details.level === 'error') errors.push(`${details.message} (${details.sourceId}:${details.lineNumber})`);
}));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await check(); if (value) return value; await sleep(35); }
  throw new Error(`Timed out: ${label}`);
}
const timeout = setTimeout(() => { console.error('Note image UI timed out', errors); app.exit(1); }, 105000);
app.whenReady().then(async () => {
  try {
    fs.writeFileSync(fixture, nativeImage.createFromBitmap(Buffer.alloc(20 * 14 * 4, 205), { width: 20, height: 14 }).toPNG());
    const main = await waitFor(() => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/renderer/index.html')), 'production main renderer');
    const evaluate = script => main.webContents.executeJavaScript(script);
    const click = async selector => {
      const point = await waitFor(() => evaluate(`(() => {
        const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled||!el.getClientRects().length)return false;
        el.scrollIntoView({block:'nearest'});const b=el.getBoundingClientRect(),x=Math.round(b.left+b.width/2),y=Math.round(b.top+b.height/2),hit=document.elementFromPoint(x,y);
        return hit===el||el.contains(hit)?{x,y}:false;
      })()`), `pointer-ready ${selector}`);
      main.webContents.sendInputEvent({ type: 'mouseMove', ...point });
      main.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      main.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point }); await sleep(40);
    };
    const fill = (selector, value) => evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const getTarget = kind => evaluate(`window.SlateNotesImages.getTarget(${JSON.stringify(kind)})`);
    const archive = () => evaluate("JSON.parse(localStorage.getItem('slate-note-archive-v1')||'[]')");
    const count = async kind => (await getTarget(kind))?.attachments?.length || 0;
    const home = '.home-note .note-images', library = '#notes-detail .note-images';
    await waitFor(() => evaluate("!!window.SlateNoteAttachments && !!window.SlateNotesImages && !workspaceHydrating && !workspaceReloadPending").catch(() => false), 'note image adapters');
    assert.equal(path.resolve(app.getPath('userData')), path.resolve(profile));
    await evaluate("(async()=>{await setMode(true);setPanelPinned(true);await setActiveTab('home')})()"); main.show(); main.focus(); await sleep(420);
    await click(`${home} .note-image-add`);
    await waitFor(async () => await count('home') === 1, 'image-only note saved from homepage');
    const firstHomeId = (await getTarget('home')).noteId;
    let note = (await archive()).find(item => item.id === firstHomeId);
    assert.ok(note, 'image-only captures remain in the note archive');
    assert.equal(note.content, ''); assert.equal(note.attachments.length, 1);
    const original = note.attachments[0];
    assert.equal(fs.existsSync(path.join(profile, original.relativePath)), true);
    assert.equal(original.width, 20); assert.equal(original.height, 14); assert.equal('dataUrl' in original, false);
    await waitFor(() => evaluate(`document.querySelector('${home} .note-image-preview img')?.naturalWidth>0`), 'thumbnail decoded');
    await evaluate("setActiveTab('notes')"); await fill('#notes-search', '图片笔记');
    await waitFor(() => evaluate(`!!document.querySelector('#notes-list [data-note-id="${firstHomeId}"]')`), 'image-only note title is searchable');
    await fill('#notes-search', ''); await evaluate("setActiveTab('home')");
    pickerMode = 'cancel'; await click(`${home} .note-image-add`); await sleep(60);
    assert.equal(await count('home'), 1, 'canceling the file picker preserves existing images'); pickerMode = 'normal';
    await fill('#home-note', '图片说明正文不会被替换。');
    const bytes = JSON.stringify(Array.from(fs.readFileSync(fixture)));
    await evaluate(`(() => {const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(${bytes})],'笔记粘贴图.png',{type:'image/png'}));document.getElementById('home-note').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));})()`);
    await waitFor(async () => await count('home') === 2, 'pasted note image saved');
    assert.equal(await evaluate("document.getElementById('home-note').value"), '图片说明正文不会被替换。');
    await evaluate(`(() => {const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(${bytes})],'笔记拖放图.png',{type:'image/png'}));document.querySelector('.home-note').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));})()`);
    await waitFor(async () => await count('home') === 3, 'dropped note image saved');
    await click(`${home} .note-image-preview`);
    await waitFor(() => evaluate("document.querySelector('.note-image-viewer')?.open && document.querySelector('.note-image-viewer img').naturalWidth===20"), 'full note image viewer');
    await click('.note-image-viewer [data-note-image-fit]');
    assert.equal(await evaluate("document.querySelector('.note-image-viewer').classList.contains('is-original')"), true);
    await click('.note-image-viewer [data-note-image-close]');
    await click(`${home} .note-image-remove`); await waitFor(async () => await count('home') === 2, 'image reference removed');
    assert.equal(fs.existsSync(path.join(profile, original.relativePath)), true, 'remove retains bytes for undo');
    await click(`${home} .note-image-undo`); await waitFor(async () => await count('home') === 3, 'image removal undone');

    const beforeFailure = (await getTarget('home')).attachments;
    await evaluate("window.__noteImageOriginalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='slate-note-archive-v1')throw new DOMException('Quota fixture','QuotaExceededError');return window.__noteImageOriginalSetItem.call(this,k,v)};true");
    await click(`${home} .note-image-add`);
    await waitFor(() => evaluate(`document.querySelector('${home} .note-image-status').dataset.error==='true'`), 'image save failure is visible');
    assert.deepEqual((await getTarget('home')).attachments, beforeFailure);
    assert.equal(await evaluate("document.getElementById('home-note').value"), '图片说明正文不会被替换。');
    await evaluate('Storage.prototype.setItem=window.__noteImageOriginalSetItem;delete window.__noteImageOriginalSetItem');
    await click(`${home} .note-image-add`); await waitFor(async () => await count('home') === 4, 'save retry after storage recovery');
    await click('#home-note-new');
    await waitFor(async () => await count('home') === 0, 'new quick note resets pictures without deleting archive');
    assert.ok((await archive()).some(item => item.attachments?.length === 4));
    await evaluate("setActiveTab('notes')");
    await waitFor(() => evaluate(`!!document.querySelector('${library} .note-image-add')`), 'note library image toolbar');
    await click('#notes-new'); await click(`${library} .note-image-add`);
    await waitFor(async () => await count('library') === 1, 'image-only library note saved');
    const libraryNote = await getTarget('library');
    assert.ok((await archive()).some(item => item.id === libraryNote.id && item.attachments.length === 1));
    await fill('#notes-editor', '资料库新笔记正文。'); await fill('#notes-detail .notes-detail-title', '图片笔记回归');
    await click(`${library} .note-image-add`); await waitFor(async () => await count('library') === 2, 'library attachment preserves pending text/title');
    note = (await archive()).find(item => item.id === libraryNote.id);
    assert.equal(note.content, '资料库新笔记正文。'); assert.equal(note.title, '图片笔记回归');
    pickerMode = 'pending'; await click(`${library} .note-image-add`);
    await waitFor(() => pendingPicker, 'picker request held while switching notes');
    await click('#notes-new');
    const switched = await getTarget('library');
    assert.notEqual(switched.id, libraryNote.id);
    pendingPicker({ canceled: false, filePaths: [fixture] }); pendingPicker = null; pickerMode = 'normal';
    await waitFor(() => evaluate(`document.querySelector('${library} .note-image-status').textContent.includes('切换')`), 'late file chooser result is not attached to a different note');
    assert.equal(await count('library'), 0);
    assert.equal((await archive()).find(item => item.id === libraryNote.id).attachments.length, 2);
    await fill('#notes-search', '图片笔记回归');
    await waitFor(() => evaluate("document.querySelectorAll('#notes-list [data-note-id]').length===1"), 'image note title remains searchable');
    await click('#notes-list [data-note-id]');
    await waitFor(async () => await count('library') === 2, 'searched image note restored');
    const savedAttachments = (await getTarget('library')).attachments;
    const loaded = new Promise(resolve => main.webContents.once('did-finish-load', resolve)); main.webContents.reload(); await loaded;
    await waitFor(() => evaluate("!!window.SlateNoteAttachments && !!window.SlateNotesImages && !workspaceHydrating && !workspaceReloadPending").catch(() => false), 'reload note images');
    await evaluate("(async()=>{await setMode(true);setPanelPinned(true);await setActiveTab('notes')})()"); await sleep(350);
    assert.deepEqual((await getTarget('library')).attachments, savedAttachments, 'note images survive a real renderer restart');
    await evaluate("(async()=>{await setActiveTab('settings');window.SlateSettingsNavigation?.activate('data')})()"); await click('#settings-backup-export');
    await waitFor(() => fs.existsSync(backup), 'backup contains note image files');
    const data = JSON.parse(fs.readFileSync(backup, 'utf8'));
    const files = data.todoImages || [];
    for (const attachment of (await archive()).flatMap(item => item.attachments || [])) {
      assert.ok(files.some(entry => entry.attachment.id === attachment.id && entry.base64), `backup includes note image ${attachment.id}`);
    }
    if (process.env.SLATE_NOTE_IMAGES_QA_DIR) {
      fs.mkdirSync(process.env.SLATE_NOTE_IMAGES_QA_DIR, { recursive: true });
      for (const width of [1080, 760]) for (const theme of ['dark', 'light']) for (const tab of ['home', 'notes']) {
        main.setBounds({ ...main.getBounds(), width, height: 600 });
        await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)};setActiveTab(${JSON.stringify(tab)})`);
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const selector = tab === 'home' ? home : library;
        const geometry = await evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;const b=el.getBoundingClientRect();return {within:b.left>=0&&b.right<=innerWidth+1&&b.top>=0&&b.bottom<=innerHeight+1,overflow:el.scrollWidth>el.clientWidth+1}})()`);
        assert.equal(geometry.within, true); assert.equal(geometry.overflow, false);
        fs.writeFileSync(path.join(process.env.SLATE_NOTE_IMAGES_QA_DIR, `note-images-${width}-${theme}-${tab}.png`), (await main.webContents.capturePage()).toPNG());
      }
    }
    assert.deepEqual(errors, []);
    console.log('Note images passed: quick capture/library, image-only notes, paste/drop, zoom, remove/undo, storage failure, target switching, reload and backup');
    clearTimeout(timeout); app.quit();
  } catch (error) { console.error(error.stack || error, errors); clearTimeout(timeout); app.exit(1); }
});
require('../main.js');
