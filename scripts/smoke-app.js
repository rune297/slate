// Exercises the actual packaged application through Chromium's test-only debugging switch.
// No testing IPC, test flags or remote debugging are enabled during ordinary launches.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const WebSocket = require('ws');
const http = require('node:http');
const executable = process.argv[2];
if (!executable) throw new Error('Usage: node scripts/smoke-app.js <executable> [profile] [retained]');
const profile = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'todo-smoke-'));
const retained = process.argv[4] === 'retained';
const evidence = process.env.SMOKE_ARTIFACT_DIR || path.join(profile, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
const activePortFile = path.join(profile, 'DevToolsActivePort');
if (fs.existsSync(activePortFile)) fs.unlinkSync(activePortFile);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.SLATE_NOTIFICATION_PORT = env.SLATE_NOTIFICATION_PORT || '43831';
const notificationBaseUrl = `http://127.0.0.1:${env.SLATE_NOTIFICATION_PORT}`;
const child = spawn(executable, [
  `--user-data-dir=${profile}`, '--remote-debugging-port=0',
  '--remote-debugging-address=127.0.0.1', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', (data) => { log += data; });
child.stderr.on('data', (data) => { log += data; });
child.on('error', (error) => { log += error.stack; });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label, timeout = 25000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await delay(100);
  }
  throw new Error(`Timed out: ${label}; ${last || log.slice(-2000)}`);
}
let socket;
let aiTestServer;
let nativePointer;
let sequence = 0;
const pending = new Map();
const exceptions = [];
const deadline = setTimeout(() => { console.error('Application smoke timed out'); cleanup(); process.exit(1); }, 150000);
function cleanup() {
  nativePointer?.close();nativePointer=null;
  aiTestServer?.closeAllConnections();aiTestServer?.close();
  clearTimeout(deadline);
  socket?.close();
  fs.writeFileSync(path.join(evidence, retained ? 'retained.log' : 'app.log'), log);
  if (child.pid && child.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
}
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 20000);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function main() {
  const port = await until(() => {
    const match = log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
    if (match) return match[1];
    return fs.existsSync(activePortFile) && fs.readFileSync(activePortFile, 'utf8').split(/\r?\n/)[0];
  }, 'DevTools startup');
  const page = await until(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    return pages.find((item) => item.url.endsWith('/renderer/index.html'));
  }, 'application renderer');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.on('message', (data) => {
    const value = JSON.parse(data);
    if (value.method === 'Runtime.exceptionThrown') exceptions.push(value.params.exceptionDetails);
    if (!value.id) return;
    const call = pending.get(value.id);
    pending.delete(value.id);
    if (value.error) call?.reject(new Error(JSON.stringify(value.error)));
    else call?.resolve(value.result);
  });
  await send('Runtime.enable');
  await until(() => evaluate("Boolean(window.SlateHome && window.SlateWorkspace && window.slateAPI && document.readyState === 'complete' && typeof workspaceHydrating !== 'undefined' && !workspaceHydrating && !workspaceReloadPending)"), 'renderer initialization and workspace recovery');
  assert.equal(await evaluate('window.slateAPI.platform'), 'win32');
  assert.equal(await evaluate("typeof window.SlateSampleLogic === 'undefined' && typeof window.slateAPI.getSampleResources === 'undefined' && !document.querySelector('script[src*=\"sample-data\"], [id^=\"samples-\"]')"), true, 'the release has no sample generator or demo entry');
  fs.writeFileSync(path.join(evidence, `no-demo-${retained ? 'retained' : 'fresh'}.json`), JSON.stringify({ ok: true }));
  await until(() => evaluate('window.slateAPI.getCopyFeedbackStatus().then(s=>s.supported&&s.running)'), 'packaged native clipboard listener');
  assert.equal(await evaluate('!!window.SlateSnippets && Object.values(window.SlateReportsLogic.DEFAULT_FORMATS).every(s=>!/^#{1,6}\\s/m.test(s))'), true, 'packaged snippets and plain-text templates');
  assert.equal(await evaluate('window.slateAPI.getAppSettings().then(s => s.features.clip)'), true);
  assert.equal(await evaluate('window.slateAPI.getAppSettings().then(s => s.clipboard.captureEnabled)'), false);
  assert.deepEqual(await evaluate('window.SlateHome.getVisibility().visibleIds'), ['tasks', 'launcher', 'note', 'translation']);
  assert.equal(await evaluate('document.querySelector("#home-bento [data-home-module=recorder]")'), null);
  assert.equal(await evaluate('window.SlateHome.setModuleVisible("windows", true).ok'), false);
  assert.equal(await evaluate('window.slateAPI.listWindows().then(r => r.error)'), 'unsupported');
  await evaluate('document.getElementById("slate").click()');
  await until(() => evaluate('document.getElementById("app").classList.contains("expanded")'), 'expand');
  await evaluate('setPanelPinned(true)');
  assert.equal(await evaluate('window.slateAPI.getMetrics().then(m => m.stripHeight)'), 8);
  assert.deepEqual(await evaluate('window.slateAPI.pasteClipboard({type:"text", text:"Windows smoke copy"})'), { ok: true, pasted: false });
  const feedbackPage = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(page => page.url.endsWith('/renderer/copy-feedback.html')), 'packaged desktop copy feedback window');
  assert.ok(feedbackPage.webSocketDebuggerUrl, 'packaged copy feedback renderer loads from the archive');
  const hubFile=path.join(profile,'ai-services.json'),originalHub=fs.readFileSync(hubFile,'utf8'),aiCalls=[];
  aiTestServer=http.createServer((request,response)=>{let raw='';request.on('data',bytes=>raw+=bytes);request.on('end',()=>{const body=raw?JSON.parse(raw):null;aiCalls.push({url:request.url,model:body?.model,keyMatches:request.headers.authorization==='Bearer packaged-fixture-key'});response.setHeader('Content-Type','application/json');response.end(JSON.stringify(request.method==='GET'?{data:[{id:'packaged-prompt'},{id:'packaged-report'}]}:{choices:[{message:{content:body.model==='packaged-report'?'Packaged report result':'Packaged prompt result'},finish_reason:'stop'}]}));});});
  await new Promise(resolve=>aiTestServer.listen(0,'127.0.0.1',resolve));
  try{
    const saved=await evaluate(`window.slateAPI.saveAIService(${JSON.stringify({provider:'custom',name:'Packaged QA only',baseURL:'http://127.0.0.1:'+aiTestServer.address().port+'/v1',apiKey:'packaged-fixture-key',defaultModel:'packaged-prompt'})})`);assert.equal(saved.ok,true);
    assert.doesNotMatch(JSON.stringify(saved),/packaged-fixture-key|encryptedKey/,'saved keys never return to renderer');assert.doesNotMatch(fs.readFileSync(hubFile,'utf8'),/packaged-fixture-key/,'packaged service credentials are encrypted');
    assert.equal((await evaluate(`window.slateAPI.saveAIBindings(${JSON.stringify({bindings:{prompt:{serviceId:saved.savedId,model:'packaged-prompt'},reports:{serviceId:saved.savedId,model:'packaged-report'}}})})`)).ok,true);
    assert.equal((await evaluate(`window.slateAPI.listAIModels(${JSON.stringify({id:saved.savedId,provider:'custom',model:'packaged-prompt'})})`)).models.length,2);
    const prompt=await evaluate('window.slateAPI.optimizePrompt({text:"Rewrite this test prompt. Keep {{value}} unchanged."})');assert.equal(prompt.text,'Packaged prompt result');
    const report=await evaluate('window.slateAPI.reportGenerate({tasks:[],period:"day",date:window.SlateReportsLogic.dateKey()})');assert.equal(report.text,'Packaged report result');assert.ok(aiCalls.every(call=>call.keyMatches));assert.deepEqual(aiCalls.filter(call=>call.model).map(call=>call.model),['packaged-prompt','packaged-report']);
    fs.writeFileSync(path.join(evidence,retained?'ai-retained.json':'ai-fresh.json'),JSON.stringify({providerTemplateAndRegistry:true,encryptedKey:true,modelDiscovery:true,assignedPromptModel:true,assignedReportModel:true,transport:'real isolated local HTTP'},null,2));
  }finally{fs.writeFileSync(hubFile,originalHub);aiTestServer.closeAllConnections();aiTestServer.close();aiTestServer=null;}
  assert.equal(typeof await evaluate('window.slateAPI.getAppSettings().then(r => r.autoLaunch)'), 'boolean', 'read native startup preference without changing the desktop registration');
  assert.equal(await evaluate('window.slateAPI.setPanelShortcut("Control+Shift+F9").then(r => r.ok)'), true);
  assert.equal(await evaluate('window.slateAPI.setClipShortcut("Control+Shift+F10").then(r => r.ok)'), true);
  assert.equal(await evaluate('window.slateAPI.setClipShortcut("").then(r => r.ok)'), true);
  assert.equal(await evaluate('window.slateAPI.setClipboardPreferences({retentionDays:30, ignoredApps:["1Password"]}).then(r => r.ok)'), true);
  assert.equal(await evaluate('window.slateAPI.setPanelShortcut("Space").then(r => r.ok)'), true);
  if (retained) {
    assert.equal(await evaluate('localStorage.getItem("slate-home-note")'), 'Windows retained data');
    assert.equal(await evaluate('window.slateAPI.listCredentials().then(r => r.items.some(i => i.service === "CI smoke"))'), true);
    assert.equal(await evaluate('window.slateAPI.listCredentials().then(async r => (await window.slateAPI.getCredential(r.items.find(i => i.service === "CI smoke").id)).item.password)'), 'test-only-password');
    const recordings = await evaluate('JSON.parse(localStorage.getItem("slate-recordings") || "[]")');
    assert.ok(recordings.some((item) => item.audioPath), 'Saved recording survives reinstall');
    assert.equal(await evaluate('window.slateAPI.readRecording(JSON.parse(localStorage.getItem("slate-recordings"))[0].audioPath).then(r => r.bytes.length > 0)'), true);
  } else {
    const credentials = await evaluate('window.slateAPI.saveCredential({service:"CI smoke",account:"test",password:"test-only-password"})');
    assert.equal(credentials.ok, true);
    assert.equal(await evaluate('window.slateAPI.listCredentials().then(r => r.items.some(i => Object.hasOwn(i, "password")))'), false);
    const vault = fs.readFileSync(path.join(profile, 'credentials.vault.json'), 'utf8');
    assert.ok(!vault.includes('test-only-password'), 'Password is encrypted at rest');
    await evaluate(`(() => {
      window.smokeTracks = [];
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (...args) => {
        const stream = await original(...args); window.smokeTracks.push(...stream.getTracks()); return stream;
      };
    })()`);
    await evaluate('document.getElementById("tab-button-home").click(); document.getElementById("record-start").click()');
    await until(() => evaluate('window.SlateWorkspace.isRecordingActive() && window.smokeTracks.some(t => t.kind === "audio" && t.readyState === "live")'), 'fake recording starts');
    await delay(1500);
    await evaluate('document.getElementById("record-stop").click()');
    await until(() => evaluate('!window.SlateWorkspace.isRecordingActive() && window.smokeTracks.every(t => t.readyState === "ended")'), 'microphone released');
    await until(() => evaluate('JSON.parse(localStorage.getItem("slate-recordings") || "[]").some(r => r.audioPath)'), 'recording persisted');
    assert.ok(fs.readdirSync(path.join(profile, 'recordings')).some((file) => fs.statSync(path.join(profile, 'recordings', file)).size > 0));
    await evaluate('document.getElementById("home-note").value = "Windows retained data"; document.getElementById("home-note").dispatchEvent(new Event("input", {bubbles:true}))');
    await until(() => evaluate('localStorage.getItem("slate-home-note") === "Windows retained data"'), 'note persisted');
    await evaluate('window.slateAPI.saveWorkspaceData(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])))');
  }
  const notify = await fetch(`${notificationBaseUrl}/notify/gpt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Windows smoke complete', task_id: `smoke-${Date.now()}` }) });
  assert.equal(notify.ok, true);
  assert.equal((await fetch(`${notificationBaseUrl}/notify/unknown`, { method: 'POST' })).status, 404);
  await until(() => evaluate('window.slateAPI.listTaskCompletions().then(r => r.some(i => i.title === "Windows smoke complete"))'), 'notification recorded');
  await evaluate('document.getElementById("tab-button-settings").click()');
  await delay(300);
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("[data-settings-home-module]")).filter(i => !i.closest("label").hidden && i.checked).map(i => i.dataset.settingsHomeModule).sort()'), ['launcher', 'note', 'tasks', 'translation']);
  assert.equal(await evaluate('document.querySelectorAll("#settings-todo-reminders input").length'), 3);
  assert.equal(await evaluate('!!window.SlateApiSettings && !!window.SlatePull'), true);
  await evaluate('window.SlateSettingsNavigation.open("ai")');
  assert.equal(await evaluate('document.getElementById("settings-api-configure").checkVisibility()'), true);
  assert.equal(await evaluate('document.getElementById("settings-report-prompt-mode").checkVisibility()'), true);
  assert.equal(await evaluate('window.SlateSettingsNavigation.getSelected()'), 'ai');
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(evidence, retained ? 'retained.png' : 'windows-settings.png'), Buffer.from(screenshot.data, 'base64'));
  assert.deepEqual(exceptions, [], 'No uncaught renderer errors');
  if(process.platform==='win32'){
    await evaluate("setPanelPinned(false);setActiveTab('home')");
    await until(()=>evaluate("isExpanded&&!modeBusy&&!window.SlatePull.isDragging()"),'packaged panel ready for native outside press');
    const bounds=await evaluate('({x:screenX,y:screenY,width:outerWidth,height:outerHeight,scale:devicePixelRatio})');
    const pointerScreen={dipToScreenPoint:point=>({x:Math.round(point.x*bounds.scale),y:Math.round(point.y*bounds.scale)})},nativeWindow={getContentBounds:()=>bounds};
    nativePointer=require('../tests/native-pointer.cjs').createNativePointer(profile,pointerScreen);
    const point={x:-8,y:Math.round(bounds.height/2)};
    nativePointer.send('mouseMove',point,nativeWindow);
    const hit=await nativePointer.inspect(point,nativeWindow);assert.equal(hit.rootPid,child.pid,'the real outside click must hit this packaged instance, never another app');
    nativePointer.send('mouseDown',point,nativeWindow);nativePointer.send('mouseUp',point,nativeWindow);await nativePointer.inspect(point,nativeWindow);
    await until(()=>evaluate("!isExpanded&&!modeBusy&&document.getElementById('panel').inert"),'packaged native outside click collapses');
    const dismissLog=fs.readFileSync(path.join(profile,'dismiss-debug.log'),'utf8');assert.match(dismissLog,/dismiss:native-press/);
    fs.writeFileSync(path.join(evidence,retained?'native-dismiss-retained.json':'native-dismiss-fresh.json'),JSON.stringify({ok:true,realWindowsMouse:true,ownWindowMessage:true,exactOutsideEdge:true},null,2));
    nativePointer.close();nativePointer=null;
  }
  // Exercise an ordinary application shutdown, not taskkill /F: Chromium flushes
  // profile preferences (including Windows OS-crypt metadata) during shutdown.
  // Browser.close is Electron's own CDP shutdown path; no testing IPC is shipped.
  const browser = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const shutdown = new WebSocket(browser.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { shutdown.once('open', resolve); shutdown.once('error', reject); });
  shutdown.send(JSON.stringify({ id: 1, method: 'Browser.close', params: {} }));
  await until(() => child.exitCode !== null, 'normal application exit');
  shutdown.close();
  assert.equal(child.exitCode, 0, 'Application exits cleanly before reinstall/uninstall');
  fs.writeFileSync(path.join(evidence, retained ? 'retained.json' : 'smoke.json'), JSON.stringify({ ok: true, platform: process.platform, retained, profile, checks: ['real startup', 'four home modules and topbar recorder', 'IPC', 'clipboard copy', 'auto-launch', 'shortcuts', 'encrypted credentials', 'fake recording release and persistence', 'notifications', 'unified API and simplified reminders'] }, null, 2));
  console.log(`Windows application smoke passed (${retained ? 'retained profile' : 'fresh profile'})`);
}
main().catch(async (error) => {
  console.error(error);
  console.error('Renderer exceptions:', JSON.stringify(exceptions));
  process.exitCode = 1;
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      console.error('Renderer state:', await evaluate('JSON.stringify({home:!!window.SlateHome,workspace:!!window.SlateWorkspace,api:!!window.slateAPI,ready:document.readyState,storage:Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))})'));
      const screenshot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(evidence, 'failure.png'), Buffer.from(screenshot.data, 'base64'));
    } catch { /* Startup logs remain available even if the renderer has crashed. */ }
  }
}).finally(cleanup);
