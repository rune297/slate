const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, dialog } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'slate-settings-nav-'));
process.env.TODO_TEST_USER_DATA = profile;
process.env.SLATE_NOTIFICATION_PORT ||= '44423';
app.commandLine.appendSwitch('user-data-dir', profile);
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'app-settings.json'), JSON.stringify({ shortcut: 'Control+Alt+Y', defaultTab: 'settings', clipboard: { captureEnabled: false } }));
let backupPath = null;
dialog.showOpenDialog = async () => backupPath ? { canceled: false, filePaths: [backupPath] } : { canceled: true, filePaths: [] };
const errors = [];
app.on('web-contents-created', (_event, contents) => contents.on('console-message', details => {
  if (details.level === 'error') errors.push(`${details.message} (${details.sourceId}:${details.lineNumber})`);
}));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await check(); if (value) return value; await sleep(30); }
  throw new Error(`Timed out: ${label}`);
}
const timeout = setTimeout(() => { console.error('Settings navigation timed out', errors); app.exit(1); }, 100000);
app.whenReady().then(async () => {
  try {
    const main = await waitFor(() => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/renderer/index.html')), 'production renderer');
    const evaluate = script => main.webContents.executeJavaScript(script);
    const click = async selector => {
      const point = await waitFor(() => evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled||!el.getClientRects().length)return false;el.scrollIntoView({block:'nearest'});const b=el.getBoundingClientRect(),x=Math.round(b.left+b.width/2),y=Math.round(b.top+b.height/2),hit=document.elementFromPoint(x,y);return hit===el||el.contains(hit)?{x,y}:false;})()`), `pointer-ready ${selector}`);
      main.webContents.sendInputEvent({ type: 'mouseMove', ...point });
      main.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      main.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point }); await sleep(35);
    };
    const fill = (selector, value) => evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const select = (selector, value) => evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const key = name => { const keyCode = ({ ArrowDown: 'Down', ArrowUp: 'Up' })[name] || name; main.webContents.sendInputEvent({ type: 'keyDown', keyCode }); main.webContents.sendInputEvent({ type: 'keyUp', keyCode }); };
    await waitFor(() => evaluate('!!window.SlateSettingsNavigation && !!window.SlateReportPrompt && window.SlateTasks.isReady()').catch(() => false), 'settings mounted');
    await evaluate("(async()=>{await setMode(true);setPanelPinned(true);await window.SlateSettingsNavigation.open('general')})()"); main.show(); main.focus(); await sleep(420);
    assert.equal(await evaluate('window.SlateSettingsNavigation.getSelected()'), 'general');
    assert.equal(await evaluate("document.querySelectorAll('.settings-group:not([hidden])').length"), 1);
    const ids = ['settings-shortcut-change', 'settings-default-tab', 'settings-appearance', 'settings-workspace-open', 'settings-auto-launch', 'settings-clip-capture', 'settings-backup-export', 'settings-api-configure', 'reminders-enabled', 'translation-install'];
    for (const id of ids) assert.equal(await evaluate(`document.querySelectorAll('#${id}').length`), 1, `${id} retains one canonical control`);

    await click('#settings-menu-appearance');
    await select('#settings-appearance', 'dark');
    await waitFor(() => evaluate("document.documentElement.dataset.theme==='dark'"), 'appearance listener survives moving controls');
    await click('#settings-menu-reminders');
    const before = (await evaluate('window.slateAPI.getReminderSettings()')).settings;
    await click('label:has(#reminders-enabled)');
    await waitFor(async () => (await evaluate('window.slateAPI.getReminderSettings()')).settings.enabled !== before.enabled, 'reminder listener survives moving controls');
    await click('label:has(#reminders-enabled)');
    await waitFor(async () => (await evaluate('window.slateAPI.getReminderSettings()')).settings.enabled === before.enabled, 'reminder settings restored');
    await click('#settings-search'); await fill('#settings-search', '忽略');
    assert.equal(await evaluate('window.SlateSettingsNavigation.getSelected()'), 'clipboard');
    assert.equal(await evaluate("document.getElementById('settings-clip-ignored-apps').getClientRects().length>0"), true);
    assert.equal(await evaluate("document.querySelectorAll('.settings-menu-item:not([hidden])').length"), 1);
    await fill('#settings-search', 'no-such-setting-2af49');
    assert.equal(await evaluate("document.getElementById('settings-search-empty').hidden"), false);
    await click('#settings-search-clear');
    assert.equal(await evaluate("document.querySelectorAll('.settings-menu-item:not([hidden])').length"), 9);
    await evaluate("document.getElementById('settings-search').focus()"); key('ArrowDown'); await sleep(30);
    assert.equal(await evaluate('document.activeElement.id'), 'settings-menu-general');
    key('ArrowDown'); await sleep(30);
    assert.equal(await evaluate('window.SlateSettingsNavigation.getSelected()'), 'shortcuts');
    key('End'); await sleep(30);
    assert.equal(await evaluate('window.SlateSettingsNavigation.getSelected()'), 'data');

    await evaluate("localStorage.removeItem('slate-report-template-mode-v1');localStorage.removeItem('slate-report-template-v1')");
    await evaluate('window.SlateReportPrompt.openSettings()');
    assert.equal(await evaluate('document.activeElement.id'), 'settings-report-prompt-mode');
    assert.equal(await evaluate('window.SlateReportPrompt.getMode()'), 'builtin');
    assert.equal(await evaluate('window.SlateReportPrompt.getTemplate()===window.SlateReportsLogic.DEFAULT_TEMPLATES.day'), true);
    await select('#settings-report-prompt-mode', 'custom');
    assert.equal(await evaluate("window.SlateReportPrompt.getTemplate('custom')"), '', 'empty custom prompts do not silently use builtin');
    const custom = '按真实事项写三段，保留时间。\n不虚构原因。';
    await fill('#settings-report-prompt-text', custom);
    assert.equal(await evaluate('window.SlateReportPrompt.getTemplate()'), custom);
    await evaluate("window.SlateSettingsNavigation.activate('general');window.SlateSettingsNavigation.activate('ai')");
    assert.equal(await evaluate("document.getElementById('settings-report-prompt-text').value"), custom);
    await click('#settings-report-prompt-reset');
    assert.equal(await evaluate('window.SlateReportPrompt.getMode()'), 'builtin');
    assert.equal(await evaluate("window.SlateReportPrompt.getTemplate('custom')"), custom, 'restore retains previous custom requirements');
    await evaluate("localStorage.removeItem('slate-report-template-mode-v1')");
    assert.equal(await evaluate('window.SlateReportPrompt.getMode()'), 'builtin', 'per-period configuration takes precedence over legacy flags');
    await select('#settings-report-prompt-mode', 'custom');
    const imported = '每一项都保留原始计划与截止时间。';
    await evaluate(`(() => {const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(imported)}],'rules.md',{type:'text/markdown'}));const file=document.getElementById('settings-report-prompt-file');file.files=transfer.files;file.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await waitFor(() => evaluate(`window.SlateReportPrompt.getTemplate()===${JSON.stringify(imported)}`), 'prompt text imported');
    for (const fixture of [{ name: 'too-long.txt', text: 'a'.repeat(16001) }, { name: 'binary.txt', text: '\0bad' }, { name: 'script.js', text: 'not a prompt' }, { name: 'oversized.txt', text: 'a'.repeat(102401) }]) {
      await evaluate(`(() => {document.getElementById('settings-report-prompt-status').classList.remove('error');const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(fixture.text)}],${JSON.stringify(fixture.name)}));const file=document.getElementById('settings-report-prompt-file');file.files=transfer.files;file.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await waitFor(() => evaluate("document.getElementById('settings-report-prompt-status').classList.contains('error')"), `invalid import ${fixture.name}`);
      assert.equal(await evaluate('window.SlateReportPrompt.getTemplate()'), imported);
    }
    await evaluate("window.__settingsSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='slate-report-profiles-v2')throw new Error('fixture quota');return window.__settingsSetItem.call(this,key,value)};void 0");
    await fill('#settings-report-prompt-text', '保存失败时也不能丢掉这段文字');
    assert.equal(await evaluate('window.SlateReportPrompt.getTemplate()'), imported, 'storage error cannot replace the saved prompt');
    assert.equal(await evaluate("document.getElementById('settings-report-prompt-text').value"), '保存失败时也不能丢掉这段文字');
    assert.equal(await evaluate("document.getElementById('settings-report-prompt-status').classList.contains('error')"), true);
    await evaluate("window.SlateSettingsNavigation.activate('general');window.SlateSettingsNavigation.activate('ai')");
    assert.equal(await evaluate("document.getElementById('settings-report-prompt-text').value"), '保存失败时也不能丢掉这段文字', 'unsaved prompt remains after navigating settings');
    await evaluate('Storage.prototype.setItem=window.__settingsSetItem;delete window.__settingsSetItem');
    await fill('#settings-report-prompt-text', custom);
    const qaDir = process.env.SLATE_SETTINGS_QA_DIR || path.join(__dirname, '..', 'dist.noindex', 'windows-smoke', 'beta3-settings');
    if (qaDir) fs.mkdirSync(qaDir, { recursive: true });
    for (const [width, height] of [[1080, 560], [900, 480]]) for (const theme of ['dark', 'light']) {
      main.setBounds({ ...main.getBounds(), width, height });
      await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      await sleep(180);
      for (const group of ['general', 'ai', 'home', 'reminders']) {
        await evaluate(`window.SlateSettingsNavigation.activate(${JSON.stringify(group)})`);
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const geometry = await evaluate("(() => {const page=document.getElementById('settings-page'),nav=document.querySelector('.settings-navigation'),content=document.querySelector('.settings-content-scroll'),selected=document.querySelector('.settings-group:not([hidden])');const p=page.getBoundingClientRect(),n=nav.getBoundingClientRect(),c=content.getBoundingClientRect();return {inside:p.left>=0&&p.top>=0&&p.right<=innerWidth+1&&p.bottom<=innerHeight+1,columns:n.right<=c.left+1,overflow:page.scrollWidth>page.clientWidth+1||content.scrollWidth>content.clientWidth+1,group:!!selected};})()");
        assert.deepEqual(geometry, { inside: true, columns: true, overflow: false, group: true }, `geometry ${width}x${height} ${theme} ${group}`);
        assert.equal(await evaluate(`(() => {const b=document.getElementById('settings-menu-${group}').getBoundingClientRect(),m=document.querySelector('.settings-menu').getBoundingClientRect();return b.top>=m.top-1&&b.bottom<=m.bottom+1})()`), true, 'selected menu remains visible in compact windows');
        if (qaDir && group === 'ai') fs.writeFileSync(path.join(qaDir, `settings-${width}-${height}-${theme}-${group}.png`), (await main.webContents.capturePage()).toPNG());
      }
    }
    // Import through the actual settings action and production IPC, then let the
    // real recovery reload prove that stale mode/draft settings do not survive.
    backupPath = path.join(profile, 'settings-prompt-backup.json');
    await evaluate("localStorage.setItem('slate-report-template-mode-v1','builtin');localStorage.setItem('slate-report-draft-v1','stale-draft-fixture')");
    for (const storage of [
      { 'slate-report-template-v1': '来自旧备份的自定义报告要求' },
      { 'slate-report-template-v1': custom, 'slate-report-template-mode-v1': 'builtin' },
    ]) {
      fs.writeFileSync(backupPath, JSON.stringify({ format: 'slate-backup', version: 1, storage, settings: { defaultTab: 'settings' } }));
      await evaluate("window.SlateSettingsNavigation.open('data')");
      const loaded = new Promise(resolve => main.webContents.once('did-finish-load', resolve));
      await click('#settings-backup-import'); await loaded;
      await waitFor(() => evaluate('!!window.SlateSettingsNavigation && window.SlateTasks.isReady()').catch(() => false), 'settings restored after importing backup');
      assert.equal(await evaluate("localStorage.getItem('slate-report-template-v1')"), storage['slate-report-template-v1']);
      assert.equal(await evaluate('window.SlateReportPrompt.getMode()'), storage['slate-report-template-mode-v1'] || 'custom');
      assert.notEqual(await evaluate("localStorage.getItem('slate-report-draft-v1')"), 'stale-draft-fixture');
      await evaluate("(async()=>{await setMode(true);setPanelPinned(true)})()");
    }
    assert.deepEqual(errors, []);
    console.log('Settings navigation passed: canonical controls, search and keyboard, live preference save, builtin/custom prompts, import validation, storage errors, compact/theme geometry');
    clearTimeout(timeout); app.quit();
  } catch (error) { console.error(error.stack || error, errors); clearTimeout(timeout); app.exit(1); }
});
require('../main.js');
