const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { app, BrowserWindow, clipboard } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'slate-reports-ui-'));
process.env.TODO_TEST_USER_DATA = profile;
process.env.SLATE_NOTIFICATION_PORT ||= '44374';
app.commandLine.appendSwitch('user-data-dir', profile); fs.mkdirSync(profile, { recursive: true });
const today = new Date(); today.setHours(9, 0, 0, 0);
const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
const key = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const tasks = [
  { id: 'report-finished', text: '交付登录页', done: true, completedAt: today.getTime(), createdAt: yesterday.getTime(), planKind: 'day', planDate: key(today), notes: '已确认交付' },
  { id: 'report-pending', text: '等待需求确认', done: false, createdAt: today.getTime(), planKind: 'day', planDate: key(today), status: 'waiting', notes: '<img src="https://must-not-load.invalid/picture" onerror="throw 1">纯文本记录' },
  { id: 'report-old', text: '遗留合同核对', done: false, createdAt: yesterday.getTime(), planKind: 'day', planDate: key(yesterday) },
];
const legacy = [
  { id: 'legacy-report', title: '以前保存的完整日报', content: '保留旧历史正文\n' + '真实事项，不截断。'.repeat(200), period: 'day', createdAt: yesterday.getTime(), updatedAt: yesterday.getTime() },
  { id: 'legacy-week', title: '以前的周报', content: '旧周报独有的全文检索词\n保留原文。', period: 'week', createdAt: yesterday.getTime() - 60000, updatedAt: yesterday.getTime() },
];
fs.writeFileSync(path.join(profile, 'app-settings.json'), JSON.stringify({ shortcut: 'Control+Alt+U', defaultTab: 'todo', features: { home: true, todo: true, notes: true, links: true, recordings: false, credentials: false, clip: true }, clipboard: { captureEnabled: false }, todoReminders: { enabled: false, summaryMode: 'off' } }));
fs.writeFileSync(path.join(profile, 'workspace.json'), JSON.stringify({ version: 1, localStorage: { 'slate-todo-data': JSON.stringify({ P0: [], P1: [], P2: [], P3: tasks }), 'slate-reports-v1': JSON.stringify(legacy) } }));
const pending = [], sent = [], errors = [];
let clipboardText = '', failNext = false;
clipboard.readText = () => ''; clipboard.writeText = text => { clipboardText = text; };
require('electron').net.fetch = (url, options) => {
  assert.equal(String(url), 'https://reports.slate.test/v1/chat/completions', 'the test never contacts a real external API');
  sent.push(JSON.parse(options.body));
  if (failNext) { failNext = false; return Promise.resolve(new Response('limited private fixture', { status: 429 })); }
  return new Promise((resolve, reject) => {
    pending.push({ resolve: text => resolve(new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 })) });
    options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled fixture', 'AbortError')), { once: true });
  });
};
app.on('web-contents-created', (_event, contents) => contents.on('console-message', details => { if (details.level === 'error') errors.push(`${details.message} (${details.sourceId}:${details.lineNumber})`); }));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, description, timeoutMs = 12000) { const until = Date.now() + timeoutMs; while (Date.now() < until) { const value = await check(); if (value) return value; await sleep(30); } throw new Error('Timed out: ' + description); }
function log(text) { console.log(text); if (process.env.TODO_TEST_LOG) fs.appendFileSync(process.env.TODO_TEST_LOG, text + '\n'); }
const timeout = setTimeout(() => { log('Reports UI timed out ' + JSON.stringify(errors)); app.exit(1); }, 100000);
app.whenReady().then(async () => {
  try {
    const main = await waitFor(() => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/renderer/index.html')), 'production main');
    const evaluate = script => main.webContents.executeJavaScript(script).catch(error => { throw new Error('Renderer operation failed: ' + script.slice(0, 250) + '\n' + error.message + '\n' + errors.join('\n')); });
    const click = async selector => {
      const point = await waitFor(() => evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.hidden||el.disabled)return false;el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2),hit=document.elementFromPoint(x,y);return r.width&&r.height&&(hit===el||el.contains(hit))?{x,y}:false})()`), 'pointer-ready ' + selector);
      main.webContents.sendInputEvent({ type:'mouseMove', ...point }); main.webContents.sendInputEvent({ type:'mouseDown',button:'left',clickCount:1,...point }); main.webContents.sendInputEvent({ type:'mouseUp',button:'left',clickCount:1,...point }); await sleep(35);
    };
    const fill = (selector, value) => evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    const change = (selector, value) => evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    const saved = () => evaluate("JSON.parse(localStorage.getItem('slate-reports-v1')||'[]')");
    const rawHistory = () => evaluate("localStorage.getItem('slate-reports-v1')");
    const rawDraft = () => evaluate("localStorage.getItem('slate-report-draft-v1')");
    const editor = () => evaluate("document.getElementById('report-editor').value");
    const busy = () => evaluate("document.getElementById('report-generate').disabled");
    const restoreStorage = () => evaluate("Storage.prototype.setItem=window.__reportOriginalSetItem;delete window.__reportOriginalSetItem;true");
    const failHistoryWrites = () => evaluate("window.__reportOriginalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='slate-reports-v1')throw new DOMException('Quota fixture','QuotaExceededError');return window.__reportOriginalSetItem.call(this,k,v)};true");
    async function assertLayout(width, height, theme, expected) {
      main.setContentSize(width,height); await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      await waitFor(() => evaluate(`Math.abs(innerWidth-${width})<=1&&Math.abs(innerHeight-${height})<=1`), 'DPI-aware report viewport');
      const boxes = await evaluate(`(() => {const r=s=>{const b=document.querySelector(s).getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,height:b.height}};return {panel:r('#report-panel'),head:r('.reports-head'),controls:r('.reports-controls'),summary:r('#report-summary'),body:r('.reports-body'),history:r('.reports-history'),list:r('#report-history-list'),search:r('#report-search'),doc:r('.reports-document'),title:r('#report-title'),editor:r('#report-editor'),footer:r('.reports-document footer'),copy:r('#report-copy'),save:r('#report-save-history'),api:r('#report-configure')}})()`);
      const label=width+'x'+height+' '+theme;
      assert.ok(boxes.head.bottom<=boxes.controls.top+1,label+': header and controls align');
      assert.ok(boxes.controls.bottom<=boxes.summary.top+1,label+': controls do not cover summary');
      assert.ok(boxes.summary.bottom<=boxes.body.top+1,label+': summary stays above editor');
      assert.ok(boxes.search.bottom<=boxes.list.top+1,label+': history list starts below search');
      assert.ok(boxes.history.right<=boxes.doc.left,label+': history and document do not overlap');
      assert.ok(boxes.title.bottom<=boxes.editor.top&&boxes.editor.bottom<=boxes.footer.top,label+': title, text and actions never overlap');
      assert.ok(boxes.editor.height>=72,label+': editor retains a useful height '+JSON.stringify(boxes));
      assert.ok(boxes.copy.bottom<=boxes.panel.bottom-10&&boxes.save.bottom<=boxes.panel.bottom-10,label+': archive and copy actions remain reachable');
      assert.ok(boxes.api.height>=32,label+': API configuration is a real button');
      assert.equal(await evaluate("document.querySelectorAll('#report-configure svg').length"),1);
      await click('#report-copy'); assert.ok(clipboardText.includes(expected),label+': actual pointer copies full text');
      if(process.env.SLATE_REPORT_QA_DIR){fs.mkdirSync(process.env.SLATE_REPORT_QA_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.SLATE_REPORT_QA_DIR,'reports-'+label.replace(' ','-')+'.png'),(await main.webContents.capturePage()).toPNG());}
    }
    await waitFor(() => evaluate("!!window.SlateReports&&!!window.SlateReportPrompt&&!workspaceHydrating&&!workspaceReloadPending").catch(()=>false), 'hydrated report editor and prompt settings');
    assert.equal(path.resolve(app.getPath('userData')),path.resolve(profile));
    await main.webContents.debugger.attach('1.3');
    await main.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await evaluate("setMode(true);setPanelPinned(true);setActiveTab('todo')"); main.show();main.focus();
    await click('#reports-open');
    assert.match(await evaluate("document.getElementById('report-summary').textContent"),/共 3 项 · 已完成 1 · 未完成 1 · 顺延与遗留 1/);
    assert.equal(await evaluate("document.querySelector('#report-template-panel')"),null,'the report workspace contains no prompt editing dialog');
    assert.equal(await editor(),'','existing history is not silently turned into the working draft');
    const initialHistory=await rawHistory();
    await click('#report-generate'); await waitFor(async()=>!await busy(),'unconfigured AI check');
    await click('#report-generate'); await waitFor(async()=>!await busy(),'repeated unconfigured AI check');
    assert.equal(sent.length,0);assert.equal(await rawHistory(),initialHistory);assert.equal(await rawDraft(),null,'unconfigured generation does not create even a draft');
    assert.equal(await evaluate("document.getElementById('report-guide').hidden"),false,'configuration guidance is persistent and actionable');
    await click('#report-guide');
    await waitFor(()=>evaluate("!document.getElementById('transcription-settings-backdrop').hidden&&document.querySelector('.ai-hub').dataset.aiFeature==='reports'"),'unconfigured AI leads to report API settings');
    await click('#transcription-settings-close');
    const human='人工第一稿，配置失败也必须完整保留。\n第二行原始内容。';
    await fill('#report-title','我的人工报告');await fill('#report-editor',human);
    await waitFor(async()=>JSON.parse(await rawDraft()||'{}').content===human,'working draft autosave outside report history');
    const manualDraft=await rawDraft();
    await evaluate("document.getElementById('report-editor').focus();document.getElementById('report-editor').setSelectionRange(3,9)");
    await click('#report-generate');await waitFor(async()=>!await busy(),'missing API preserves existing draft');
    assert.equal(await editor(),human);assert.equal(await rawDraft(),manualDraft);assert.equal(await rawHistory(),initialHistory);assert.equal(sent.length,0);
    assert.deepEqual(await evaluate("({start:document.getElementById('report-editor').selectionStart,end:document.getElementById('report-editor').selectionEnd})"),{start:3,end:9});
    await click('#report-draft');
    assert.match(await editor(),/一、今日完成/);assert.doesNotMatch(await editor(),/(?:^|\n)#{1,6}\s/);assert.match(await editor(),/✓/);
    assert.equal((await saved()).length,2,'local task organization never archives automatically');
    assert.equal(await evaluate("document.getElementById('report-editor').selectionStart"),0);assert.equal(await evaluate("document.getElementById('report-editor').scrollTop"),0);
    await click('#report-save-history');
    assert.equal((await saved()).length,3,'only the explicit archive action creates a history entry');
    const firstId=(await saved())[0].id;
    assert.equal(await evaluate("document.getElementById('report-save-history').disabled"),true,'saving the same archived report cannot duplicate it');
    const editedSaved='编辑已有历史，只修改原条目。完整工作内容。';
    await fill('#report-editor',editedSaved);
    await evaluate("document.getElementById('report-editor').setSelectionRange(2,7)");
    await waitFor(async()=>(await saved()).find(row=>row.id===firstId)?.content===editedSaved,'existing report auto-saves to its original id');
    assert.equal((await saved()).length,3);
    assert.deepEqual(await evaluate("({active:document.activeElement.id,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd})"),{active:'report-editor',start:2,end:7},'autosave preserves typing focus and selection');

    const config=await evaluate("window.slateAPI.reportSaveConfig({baseURL:'https://reports.slate.test/v1',model:'slate-fixture-model',apiKey:'slate-test-report-key'})");assert.equal(config.ok,true);
    await click('#report-configure');
    await waitFor(()=>evaluate("!document.getElementById('transcription-settings-backdrop').hidden&&document.querySelector('.ai-hub').dataset.aiFeature==='reports'&&document.getElementById('ai-binding-reports').value!==''"),'unified API opens on reports');
    assert.equal(await evaluate("document.getElementById('ai-service-key').value"),'','saved secrets never return to report UI');
    await click('#transcription-settings-close');
    const beforeAI=await rawHistory(),beforeAIDraft=await rawDraft();
    await click('#report-generate');await waitFor(()=>pending.length===1,'configured report generation');
    assert.equal(await rawHistory(),beforeAI);assert.equal(await rawDraft(),beforeAIDraft,'in-flight generation does not pre-create a report');
    const during='生成期间的人工编辑必须保留';
    await fill('#report-editor',during);await waitFor(async()=>(await saved()).find(row=>row.id===firstId)?.content===during,'manual edits during generation update only their existing report');
    pending.shift().resolve('AI 完整工作报告\n<img src="https://must-not-load.invalid/ai">');
    await waitFor(async()=>!await busy(),'AI result available without overwrite');
    assert.equal(await editor(),during);assert.equal((await saved()).length,3);
    assert.equal(await evaluate("document.getElementById('report-candidate').hidden"),false);
    await click('#report-candidate-copy');assert.match(clipboardText,/AI 完整工作报告/);assert.equal(await editor(),during);
    await assertLayout(900,480,'dark',during);
    await click('#report-candidate-apply');
    assert.match(await editor(),/AI 完整工作报告/);assert.equal((await saved()).length,3,'applying a result only changes the working draft');
    assert.equal((await saved()).find(row=>row.id===firstId).content,during);
    assert.equal(await evaluate("document.querySelectorAll('#report-panel img').length"),0,'report and model text never execute HTML');
    await click('#report-save-history');assert.equal((await saved()).length,4);
    for(const text of ['第一次重新生成的草稿','第二次重新生成的草稿']){
      await click('#report-generate');await waitFor(()=>pending.length===1,'repeat generation request');pending.shift().resolve(text);await waitFor(async()=>!await busy(),'repeat draft result');assert.equal(await editor(),text);assert.equal((await saved()).length,4,'repeated AI generation does not accumulate history');
    }
    await click('#report-save-history');assert.equal((await saved()).length,5);
    await click('#report-current-draft');
    const preserved='取消和失败时不准替换的草稿\n包括完整原文。';
    await fill('#report-title','保留这份草稿');await fill('#report-editor',preserved);await waitFor(async()=>JSON.parse(await rawDraft()||'{}').content===preserved,'draft before cancel');
    const preservedDraft=await rawDraft(),preservedHistory=await rawHistory();
    await click('#report-generate');await waitFor(()=>pending.length===1,'cancellable AI request');const canceled=pending.shift();await click('#report-cancel');canceled.resolve('已经取消的过期回复');
    await waitFor(async()=>!await busy(),'cancel immediately releases UI');await sleep(120);
    assert.equal(await editor(),preserved);assert.equal(await rawDraft(),preservedDraft);assert.equal(await rawHistory(),preservedHistory);
    failNext=true;await click('#report-generate');await waitFor(async()=>!await busy(),'HTTP error settles');
    assert.match(await evaluate("document.getElementById('report-feedback').textContent"),/频繁|额度/);
    assert.equal(await rawDraft(),preservedDraft);assert.equal(await rawHistory(),preservedHistory);assert.equal(await editor(),preserved);

    await change('#report-prompt-mode','custom');const callsBeforeCustom=sent.length;
    await click('#report-generate');await waitFor(async()=>!await busy(),'missing custom prompt check');
    assert.equal(sent.length,callsBeforeCustom,'empty custom prompt does not fall back or call the API');
    assert.equal(await rawDraft(),preservedDraft);assert.equal(await rawHistory(),preservedHistory);
    assert.equal(await evaluate("document.getElementById('report-guide').dataset.target"),'prompt');
    await click('#report-guide');
    await waitFor(()=>evaluate("document.getElementById('tab-settings').classList.contains('active')&&!document.getElementById('settings-group-ai').hidden"),'custom prompt guidance reaches AI settings');
    const custom='自定义工作汇报要求：保持三个真实分类，不添加未知事实。';
    await change('#settings-report-prompt-mode','custom');await fill('#settings-report-prompt-text',custom);
    await waitFor(()=>evaluate(`window.SlateReportPrompt.getTemplate('custom','day')===${JSON.stringify(custom)}`),'custom daily prompt saved in AI settings');
    await evaluate("setActiveTab('todo');window.SlateReports.open()");
    assert.equal(await editor(),preserved,'visiting prompt settings preserves the current report draft');
    await click('#report-generate');await waitFor(()=>pending.length===1,'custom report request');
    assert.ok(sent.at(-1).messages.some(row=>row.content.includes(custom)),'the actual request uses the custom prompt');
    pending.shift().resolve('自定义规范生成的结果，先留在草稿。');await waitFor(async()=>!await busy(),'custom report result');
    assert.equal((await saved()).length,5);

    const draftBeforeArchive=await editor(),historyBeforeQuota=await rawHistory();
    await failHistoryWrites();await click('#report-save-history');
    assert.equal(await rawHistory(),historyBeforeQuota);assert.equal(await editor(),draftBeforeArchive);
    assert.match(await evaluate("document.getElementById('report-feedback').textContent"),/没有新增/);
    await restoreStorage();await click('#report-save');await waitFor(async()=>(await saved()).length===6,'retry explicit archive succeeds once');
    const quotaId=(await saved())[0].id,historyBeforeEdit=await rawHistory();
    await failHistoryWrites();
    const quotaText='磁盘不足也要保留的人工历史修改\n完整内容仍可复制。';
    await fill('#report-editor',quotaText);await waitFor(()=>evaluate("document.getElementById('report-save-status').textContent.includes('保存失败')"),'history auto-save failure is visible');
    assert.equal(await rawHistory(),historyBeforeEdit);
    await click('#reports-close');assert.equal(await evaluate("document.getElementById('report-panel').hidden"),false,'failed history edits cannot silently close');
    await click('#report-current-draft');assert.equal(await editor(),quotaText,'a failed save does not discard the current document on navigation');
    await restoreStorage();await click('#report-save');await waitFor(async()=>(await saved()).find(row=>row.id===quotaId)?.content===quotaText,'history save retry preserves original id');
    assert.equal((await saved()).length,6);
    const beforeDelete=await rawHistory();
    await failHistoryWrites();await click('#report-delete');
    assert.equal(await rawHistory(),beforeDelete);assert.equal(await editor(),quotaText,'failed deletion rolls back selection and the complete document');
    await restoreStorage();await click('#report-delete');assert.equal((await saved()).length,5);
    assert.equal(await evaluate("document.getElementById('report-undo').hidden"),false);
    await failHistoryWrites();await click('#report-undo');assert.equal((await saved()).length,5);assert.equal(await evaluate("document.getElementById('report-undo').hidden"),false,'failed undo remains available');
    await restoreStorage();await click('#report-undo');assert.equal((await saved()).length,6);
    assert.equal((await saved()).find(row=>row.id===quotaId).content,quotaText,'undo restores the exact full report and id');

    await fill('#report-search','旧周报独有的全文检索词');assert.equal(await evaluate("document.querySelectorAll('#report-history-list button').length"),1);
    await click('#report-history-list button');assert.equal(await editor(),legacy[1].content,'history searches and restores full text');
    await fill('#report-search','');await click('#report-current-draft');
    const reloadDraft='没有归档也能在重载后继续编辑的草稿。\n第二行。';
    await fill('#report-title','持续编辑的草稿');await fill('#report-editor',reloadDraft);await waitFor(async()=>JSON.parse(await rawDraft()||'{}').content===reloadDraft,'draft persistence before reload');
    const archiveBeforeReload=await rawHistory();main.webContents.reload();
    await waitFor(()=>evaluate("!!window.SlateReports&&!!window.SlateReportPrompt&&!workspaceHydrating&&!workspaceReloadPending").catch(()=>false),'real renderer reload');
    await evaluate("setMode(true);setPanelPinned(true);setActiveTab('todo')");await click('#reports-open');
    assert.equal(await editor(),reloadDraft);assert.equal(await rawHistory(),archiveBeforeReload);assert.equal((await saved()).length,6);
    for(const theme of ['dark','light'])for(const [width,height] of [[1290,620],[900,480],[1290,480],[900,620]])await assertLayout(width,height,theme,reloadDraft);
    main.setContentSize(900,480);await waitFor(()=>evaluate("Math.abs(innerWidth-900)<=1&&Math.abs(innerHeight-480)<=1"),'short history viewport');
    main.focus();main.webContents.focus();await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.equal(await evaluate("document.getElementById('report-history-list').scrollHeight>document.getElementById('report-history-list').clientHeight"),true);
    const point=await evaluate("(()=>{const r=document.getElementById('report-history-list').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()");
    const copyTop=await evaluate("document.getElementById('report-copy').getBoundingClientRect().top");
    main.webContents.sendInputEvent({type:'mouseMove',...point});await sleep(60);main.webContents.sendInputEvent({type:'mouseWheel',...point,deltaX:0,deltaY:-500,canScroll:true});
    await waitFor(()=>evaluate("document.getElementById('report-history-list').scrollTop>0"),'real history scroll wheel');
    assert.equal(await evaluate("document.getElementById('report-copy').getBoundingClientRect().top"),copyTop);await click('#report-copy');assert.match(clipboardText,/没有归档也能在重载后/);
    assert.doesNotMatch(JSON.stringify(sent),/attachments|data:image/);assert.deepEqual(errors,[]);
    log('Production reports passed: no-API/cancel/failure never archive or change drafts; explicit save; original-id edits; candidate protection; delete/undo rollback; settings prompts; persistent drafts; full-text history; responsive real-pointer copy and wheel');
    clearTimeout(timeout);app.quit();
  }catch(error){log(error.stack||String(error));clearTimeout(timeout);app.exit(1);}
});
require('../main.js');
