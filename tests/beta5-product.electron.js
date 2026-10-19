const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow,clipboard,dialog,nativeImage}=require('electron');
const profile=process.env.TODO_TEST_USER_DATA||fs.mkdtempSync(path.join(os.tmpdir(),'slate-beta5-'));
process.env.TODO_TEST_USER_DATA=profile;process.env.SLATE_NOTIFICATION_PORT||='44491';app.commandLine.appendSwitch('user-data-dir',profile);fs.mkdirSync(profile,{recursive:true});
fs.writeFileSync(path.join(profile,'app-settings.json'),JSON.stringify({shortcut:'Control+Alt+I',defaultTab:'home',clipboard:{captureEnabled:false,feedbackEnabled:false},todoReminders:{enabled:true,summaryMode:'daily',summaryTime:'18:00'}}));
const date=new Date(),key=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const future=new Date(date.getFullYear(),date.getMonth()+1,5);
const tasks=[{id:'beta5-task',text:'交付项目方案',done:false,createdAt:Date.now(),planKind:'day',planDate:key(date),notes:'保留任务说明'}, {id:'beta5-done',text:'完成需求确认',done:true,createdAt:Date.now(),completedAt:Date.now(),planKind:'day',planDate:key(date)}, {id:'beta5-future',text:'下月交付正式版本',done:false,createdAt:Date.now(),planKind:'day',planDate:key(future)}];
const legacy={id:'beta5-legacy',title:'旧报告',content:'## 旧标题\n\n**保留历史原文**\n- 第一项',period:'day',createdAt:Date.now(),updatedAt:Date.now()};
fs.writeFileSync(path.join(profile,'workspace.json'),JSON.stringify({version:1,localStorage:{'slate-todo-data':JSON.stringify({P0:[],P1:[],P2:[],P3:tasks}),'slate-reports-v1':JSON.stringify([legacy]),'slate-home-commands':JSON.stringify([{id:'beta5-snippet',text:'收到，稍后回复你。',createdAt:1}])}}));
let copied='';clipboard.writeText=value=>{copied=value;};const picture=path.join(profile,'fixture.png');dialog.showOpenDialog=async()=>({canceled:false,filePaths:[picture]});
const errors=[];app.on('web-contents-created',(_,wc)=>wc.on('console-message',d=>{if(d.level==='error')errors.push(d.message);}));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));async function wait(check,label,timeout=14000){const until=Date.now()+timeout;while(Date.now()<until){const value=await check().catch(()=>false);if(value)return value;await sleep(40);}throw Error('Timed out: '+label);}
const deadline=setTimeout(()=>{console.error('beta5 product timed out',errors);app.exit(1);},150000);
app.whenReady().then(async()=>{try{
  fs.writeFileSync(picture,nativeImage.createFromBitmap(Buffer.alloc(32*20*4,210),{width:32,height:20}).toPNG());
  const main=await wait(async()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')),'main');const js=s=>main.webContents.executeJavaScript(s);
  const click=async selector=>{const p=await wait(()=>js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled||!e.getClientRects().length)return false;e.scrollIntoView({block:'nearest'});const b=e.getBoundingClientRect(),x=Math.round(b.x+b.width/2),y=Math.round(b.y+b.height/2),h=document.elementFromPoint(x,y);return e===h||e.contains(h)?{x,y}:false})()`),'click '+selector);for(const type of ['mouseMove','mouseDown','mouseUp'])main.webContents.sendInputEvent({type,button:'left',clickCount:1,...p});await sleep(45);};
  const fill=(selector,value,change=false)=>js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(change?'change':'input')},{bubbles:true}));})()`);
  const keypress=keyCode=>{for(const type of ['keyDown','keyUp'])main.webContents.sendInputEvent({type,keyCode});};
  await wait(()=>js('!!window.SlateSnippets&&window.SlateTasks.isReady()&&!workspaceHydrating&&!workspaceReloadPending'),'hydrate');await js('setMode(true);setPanelPinned(true)');main.show();main.focus();await sleep(400);
  assert.equal(await js("document.querySelector('#settings-page .home-commands')"),null,'snippets leave settings');
  await click('#quick-snippets-open');assert.equal(await js('window.SlateSnippets.isOpen()'),true);
  await click('.command-text');assert.equal(copied,'收到，稍后回复你。');assert.equal(await js("document.querySelector('.command-edit')"),null,'copy does not start editing');
  await click('#snippet-new');await fill('#command-add','cmd /c echo 不会执行');await click('#snippet-editor-save');await wait(()=>js("document.querySelectorAll('.command-item').length===2"),'new snippet');
  await fill('#quick-snippets-search','不会执行');assert.equal(await js("document.querySelectorAll('.command-item:not([hidden])').length"),1);
  await click('.command-item:not([hidden]) [data-action="edit-command"]');await fill('#command-add','仅复制，不执行命令');await click('#snippet-editor-save');await fill('#quick-snippets-search','仅复制');await click('.command-item:not([hidden]) .command-text');assert.equal(copied,'仅复制，不执行命令');
  keypress('Escape');await sleep(80);assert.equal(await js('window.SlateSnippets.isOpen()'),false);assert.equal(await js("document.getElementById('app').classList.contains('expanded')"),true,'Escape closes popover first');
  await js("window.SlateTasks.open('beta5-task')");await click('[data-id="beta5-task"] .todo-extra-options summary');
  await fill('[data-id="beta5-task"] [data-detail="support"]','需要设计同事确认最终素材，确认后才能交付');await click('[data-id="beta5-task"] [data-action="save-details"]');
  assert.equal(await js("window.SlateTasks.getAll().find(t=>t.id==='beta5-task').support"),'需要设计同事确认最终素材，确认后才能交付');
  await js('window.SlateReports.open()');await fill('#report-period','month',true);await click('#report-draft');
  let report=await js("document.getElementById('report-editor').value");assert.match(report,/三、问题与需要支持/);assert.match(report,/需要设计同事确认最终素材/);assert.match(report,/下月交付正式版本/);assert.doesNotMatch(report,/(?:^|\n)#{1,6}\s|\*\*/);
  assert.equal(await js("JSON.parse(localStorage.getItem('slate-reports-v1')).length"),1,'organizing never archives');
  await js("window.SlateReportPrompt.openSettings('month')");const custom='月度工作回顾\n交付成果\n{{已完成}}\n待跟进\n{{未完成}}\n需要支持\n{{问题与协助}}';
  await fill('#settings-report-format',custom);await fill('#settings-report-period','day',true);assert.notEqual(await js("document.getElementById('settings-report-format').value"),custom);
  await fill('#settings-report-period','month',true);assert.equal(await js("document.getElementById('settings-report-format').value"),custom);
  await js("setActiveTab('todo');window.SlateReports.open()");await click('#report-draft');report=await js("document.getElementById('report-editor').value");assert.ok(report.startsWith('月度工作回顾'));assert.match(report,/需要设计同事确认最终素材/);
  await click('#report-history-list [data-report-id="beta5-legacy"] + button');await click('#report-copy');assert.match(copied,/旧标题\n\n保留历史原文\n○ 第一项/);assert.doesNotMatch(copied,/##|\*\*/);assert.equal(await js("JSON.parse(localStorage.getItem('slate-reports-v1'))[0].content"),legacy.content,'copy does not rewrite historical source');
  await js("window.SlateReports.close();setActiveTab('home')");await click('.home-note .note-image-add');await wait(()=>js("document.querySelectorAll('.home-note .note-image-remove').length===1"),'thumbnail');
  const icon=await js("(()=>{const e=document.querySelector('.home-note .note-image-remove'),p=e.closest('.note-image-item'),a=e.getBoundingClientRect(),b=p.getBoundingClientRect();return {icon:!!e.querySelector('svg'),text:e.textContent.trim(),right:Math.abs(a.right-b.right),top:Math.abs(a.top-b.top),color:getComputedStyle(e).color}})()");assert.equal(icon.icon,true);assert.equal(icon.text,'');assert.ok(icon.right<=5&&icon.top<=5);const rgb=icon.color.match(/\d+/g).map(Number);assert.ok(rgb[0]>rgb[1]&&rgb[0]>rgb[2],'destructive icon is warm red');
  await click('.home-note .note-image-remove');assert.equal(await js("window.SlateNotesImages.getTarget('home').attachments.length"),0);await click('.home-note .note-image-undo');assert.equal(await js("window.SlateNotesImages.getTarget('home').attachments.length"),1);
  const qa=process.env.SLATE_BETA5_QA_DIR;if(qa)fs.mkdirSync(qa,{recursive:true});
  for(const width of [1100,700])for(const theme of ['dark','light']){
    main.setContentSize(width,650);await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)};window.SlateSettingsNavigation.open('reminders')`);await sleep(200);
    const edges=await js("['reminders-enabled','reminders-summary-enabled','reminders-summaryTime'].map(id=>{const e=document.getElementById(id);return (e.type==='checkbox'?e.parentElement:e).getBoundingClientRect().right})");assert.ok(Math.max(...edges)-Math.min(...edges)<1.1,`${width} ${theme}: reminder controls right-align ${edges}`);
    if(qa)for(const surface of ['reminders','templates','reports','notes','snippets']){
      await js("window.SlateSnippets.close();window.SlateReports.close()");
      await js(surface==='reminders'?"window.SlateSettingsNavigation.open('reminders')":surface==='templates'?"window.SlateReportPrompt.openSettings('month')":surface==='reports'?"setActiveTab('todo');window.SlateReports.open();document.getElementById('report-current-draft').click()":surface==='notes'?"setActiveTab('home')":"setActiveTab('home');window.SlateSnippets.open()");await sleep(160);
      const overflow=await js("document.documentElement.scrollWidth>innerWidth+1");assert.equal(overflow,false,`${surface} ${width} ${theme} no viewport overflow`);
      fs.writeFileSync(path.join(qa,`${surface}-${width}-${theme}.png`),(await main.webContents.capturePage()).toPNG());
    }
  }
  await js('window.SlateSnippets.close();window.SlateReports.flush()');
  const loaded=new Promise(resolve=>main.webContents.once('did-finish-load',resolve));main.webContents.reload();await loaded;
  await wait(()=>js('!!window.SlateReportPrompt&&window.SlateTasks.isReady()&&!workspaceHydrating&&!workspaceReloadPending'),'reload');
  assert.equal(await js("window.SlateTasks.getAll().find(t=>t.id==='beta5-task').support"),'需要设计同事确认最终素材，确认后才能交付');assert.equal(await js("window.SlateReportPrompt.getFormat('month')"),custom);assert.notEqual(await js("window.SlateReportPrompt.getFormat('day')"),custom);
  assert.deepEqual(errors,[]);console.log('Beta5 product passed: per-period plain reports, support facts, independent templates, legacy copy preservation, topbar snippets copy/edit/search, red thumbnail icons, aligned reminders and restart persistence');clearTimeout(deadline);app.quit();
}catch(error){console.error(error.stack||error,errors);clearTimeout(deadline);app.exit(1);}});require('../main.js');
