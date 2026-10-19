const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {app,BrowserWindow,dialog,nativeImage} = require('electron');
const profile=process.env.TODO_TEST_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(),'slate-task-images-'));
app.commandLine.appendSwitch('user-data-dir',profile);
fs.mkdirSync(profile,{recursive:true});
const task={id:'attachment-task',text:'有图片说明的任务',done:false,createdAt:Date.now(),planKind:'day',planDate:new Date().toLocaleDateString('en-CA'),notes:'已保存说明',attachments:[]};
fs.writeFileSync(path.join(profile,'workspace.json'),JSON.stringify({version:1,localStorage:{'slate-todo-data':JSON.stringify({P0:[],P1:[],P2:[],P3:[task]})}}));
fs.writeFileSync(path.join(profile,'app-settings.json'),JSON.stringify({shortcut:'Control+Alt+J',defaultTab:'todo',clipboard:{captureEnabled:false,retentionDays:7,ignoredApps:[],pausedUntil:0}}));
const fixture=path.join(profile,'fixture.png');
const backupFile=path.join(profile,'images-backup.json');let openPath=fixture;
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[openPath]});
dialog.showSaveDialog=async()=>({canceled:false,filePath:backupFile});
const errors=[];
app.on('web-contents-created',(_event,contents)=>contents.on('console-message',details=>{if(details.level==='error')errors.push(details.message);}));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(check,label,ms=10000){const end=Date.now()+ms;while(Date.now()<end){const value=await check();if(value)return value;await sleep(35);}throw new Error(`Timed out: ${label}`);}
function finish(code){clearTimeout(timeout);for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed())win.destroy();app.exit(code);}
const timeout=setTimeout(()=>{console.error('Task image test timed out',errors);finish(1);},65000);
app.whenReady().then(async()=>{
  try {
    const bitmap=Buffer.alloc(16*12*4,210);
    fs.writeFileSync(fixture,nativeImage.createFromBitmap(bitmap,{width:16,height:12}).toPNG());
    const main=await waitFor(()=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().endsWith('/renderer/index.html')),'production renderer');
    const evaluate=script=>main.webContents.executeJavaScript(script);
    const row='#todo-list [data-id="attachment-task"]';
    const click=selector=>evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node || node.disabled)throw new Error('Missing/disabled '+${JSON.stringify(selector)});node.click();})()`);
    const images=()=>evaluate("window.SlateTasks.getAll().find(t=>t.id==='attachment-task').attachments");
    await waitFor(()=>evaluate("typeof workspaceHydrating !== 'undefined' && !workspaceHydrating && !!window.SlateTaskAttachments && !!window.slateAPI.taskAttachmentChoose && !!window.SlateTasks.updateTask").catch(()=>false),'attachments bridge');
    assert.equal(path.resolve(app.getPath('userData')),path.resolve(profile));
    await evaluate("setMode(true);window.SlateTasks.open('attachment-task')");
    await waitFor(()=>evaluate(`!!document.querySelector('${row} .task-image-add')`),'opened detail attachment controls');
    await evaluate(`(()=>{const field=document.querySelector('${row} [data-detail="notes"]');field.value='未保存的详情草稿不能丢';field.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('${row} [data-detail="followup"]').value='2026-12-20T14:30';})()`);
    await click(`${row} .task-image-add`);
    await waitFor(async()=>(await images()).length===1,'native chosen picture saved');
    assert.equal(await evaluate(`document.querySelector('${row} [data-detail="notes"]').value`),'未保存的详情草稿不能丢');
    assert.equal(await evaluate(`document.querySelector('${row} [data-detail="followup"]').value`),'2026-12-20T14:30');
    const first=(await images())[0];
    assert.equal(first.width,16);assert.equal(first.height,12);assert.equal(typeof first.relativePath,'string');
    assert.equal('dataUrl' in first,false);assert.equal(fs.existsSync(path.join(profile,first.relativePath)),true);
    await waitFor(()=>evaluate(`document.querySelector('${row} .task-image-preview img')?.naturalWidth > 0`),'real thumbnail decode');
    await click(`${row} .task-image-preview`);
    await waitFor(()=>evaluate("document.querySelector('.task-image-viewer')?.open && document.querySelector('.task-image-viewer img').naturalWidth===16"),'original image preview');
    await click('.task-image-viewer [data-image-fit]');
    assert.equal(await evaluate("document.querySelector('.task-image-viewer').classList.contains('is-original')"),true);
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");
    assert.equal(await evaluate("document.querySelector('.task-image-viewer').open"),false);
    assert.equal(await evaluate("document.getElementById('app').classList.contains('expanded')"),true,'closing preview does not collapse Slate');

    const bytes=Array.from(fs.readFileSync(fixture));
    await evaluate(`(()=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(${JSON.stringify(bytes)})],'粘贴图片.png',{type:'image/png'}));document.querySelector('${row} [data-detail="notes"]').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));})()`);
    await waitFor(async()=>(await images()).length===2,'picture pasted only into opened task');
    await evaluate(`(()=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(${JSON.stringify(bytes)})],'拖入图片.png',{type:'image/png'}));document.querySelector('${row} .todo-work-details').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));})()`);
    await waitFor(async()=>(await images()).length===3,'picture dragged into task');
    await click(`${row} .task-image-remove`);
    await waitFor(async()=>(await images()).length===2,'picture reference removed');
    assert.equal(fs.existsSync(path.join(profile,first.relativePath)),true,'removing a reference keeps files for undo');
    assert.equal(await evaluate(`document.querySelector('${row} [data-detail="notes"]').value`),'未保存的详情草稿不能丢');
    const saved=await images();
    await waitFor(()=>{try{return Object.values(JSON.parse(JSON.parse(fs.readFileSync(path.join(profile,'workspace.json'),'utf8')).localStorage['slate-todo-data'])).flat().find(item=>item.id==='attachment-task').attachments.length===2;}catch{return false;}},'workspace snapshot persisted');
    const reloaded=new Promise(resolve=>main.webContents.once('did-finish-load',resolve));main.webContents.reload();await reloaded;
    await waitFor(()=>evaluate("typeof workspaceHydrating !== 'undefined' && !workspaceHydrating && !!window.SlateTaskAttachments && !!window.SlateTasks").catch(()=>false),'reloaded workspace');
    assert.deepEqual(await images(),saved,'image descriptors survive reload');

    // An image converted from clipboard history owns an independent copy, so
    // clipboard retention/cleanup cannot break the task's supporting evidence.
    const clipFolder=path.join(profile,'clipboard-images');fs.mkdirSync(clipFolder,{recursive:true});
    const clipFile=path.join(clipFolder,'clip-attachmentfixture.png');fs.copyFileSync(fixture,clipFile);
    await evaluate("(async()=>{await addClipEntry({type:'image',imagePath:'clipboard-images/clip-attachmentfixture.png',capturedAt:Date.now()});await setActiveTab('clip');})()");
    await click('#clip-list .clip-item-image [data-action="image-task"]');
    const clipTask=await waitFor(()=>evaluate("window.SlateTasks.getAll().find(t=>t.text==='图片待办' && t.attachments?.length===1)"),'clipboard image converted to task');
    fs.unlinkSync(clipFile);
    const independent=await evaluate(`window.slateAPI.taskAttachmentRead(${JSON.stringify(clipTask.attachments[0])})`);
    assert.equal(independent.ok,true,'clipboard cleanup does not delete task image');
    const rule={id:'attachment-rule',title:'周期事项图片说明',startDate:'2099-01-01',frequency:'daily',enabled:false,attachments:[first]};
    await evaluate(`localStorage.setItem('slate-recurring-tasks-v1',JSON.stringify([window.SlateRecurrence.normalizeRule(${JSON.stringify(rule)})]));setActiveTab('settings')`);
    await click('#settings-backup-export');
    await waitFor(()=>fs.existsSync(backupFile),'portable backup exported');
    const backup=JSON.parse(fs.readFileSync(backupFile,'utf8'));
    assert.equal(backup.version,2);assert.equal(backup.todoImages.length,4,'backup includes ordinary tasks, clipboard-created task and recurring-rule-only references');
    for(const entry of backup.todoImages)assert.ok(entry.base64 && entry.attachment.relativePath.startsWith('todo-images/'));
    // Delete only this test profile's image directory before restoring, so a
    // successful read proves import restored bytes rather than reusing files.
    const imageFolder=path.join(profile,'todo-images');assert.equal(path.dirname(imageFolder),profile);fs.rmSync(imageFolder,{recursive:true,force:true});
    await evaluate("window.SlateTasks.updateTask('attachment-task',{notes:'恢复前的临时修改',attachments:[]});localStorage.removeItem('slate-recurring-tasks-v1')");
    openPath=backupFile;
    const imported=new Promise(resolve=>main.webContents.once('did-finish-load',resolve));await click('#settings-backup-import');await imported;
    await waitFor(()=>evaluate("typeof workspaceHydrating !== 'undefined' && !workspaceHydrating && !!window.SlateTasks && !!window.SlateTaskAttachments").catch(()=>false),'backup reload ready');
    assert.deepEqual(await images(),saved,'import restores exact task descriptors');
    assert.equal(await evaluate("JSON.parse(localStorage.getItem('slate-recurring-tasks-v1'))[0].attachments[0].id"),first.id,'recurring-rule-only image reference is retained');
    for(const entry of backup.todoImages)assert.deepEqual(fs.readFileSync(path.join(profile,entry.attachment.relativePath)),Buffer.from(entry.base64,'base64'));
    console.log('Task images: clipboard independence and real workspace export/import roundtrip passed');
    const malformedFile=path.join(profile,'invalid-image-refs.json');
    for(const change of [
      document=>{document.todoImages.pop();},
      document=>{const rows=JSON.parse(document.storage['slate-todo-data']),item=Object.values(rows).flat().find(item=>item.id==='attachment-task');item.attachments[0]={...item.attachments[0],relativePath:item.attachments[0].relativePath.replace(/\.png$/,'.jpg'),mime:'image/jpeg'};document.storage['slate-todo-data']=JSON.stringify(rows);},
      document=>{const rows=JSON.parse(document.storage['slate-recurring-tasks-v1']);rows[0].attachments[0].relativePath='../outside.png';document.storage['slate-recurring-tasks-v1']=JSON.stringify(rows);},
    ]) {
      const malformed=structuredClone(backup);change(malformed);fs.writeFileSync(malformedFile,JSON.stringify(malformed));openPath=malformedFile;
      assert.equal((await evaluate('window.slateAPI.importBackup()')).ok,false,'missing or inconsistent attachment references reject rather than importing broken tasks');
      assert.deepEqual(await images(),saved,'rejected backup never changes current task references');
    }
    const limitFile=path.join(profile,'oversized-backup.json');const handle=fs.openSync(limitFile,'w');fs.ftruncateSync(handle,145*1024*1024+1);fs.closeSync(handle);openPath=limitFile;
    assert.equal((await evaluate('window.slateAPI.importBackup()')).ok,false,'oversized backup rejects before parsing');
    fs.unlinkSync(limitFile);
    const rejected=await evaluate("window.slateAPI.exportBackup({'slate-todo-data':'{\"P3\":[]}','slate-reports-v1':'x'.repeat(8*1024*1024+1)})");
    assert.equal(rejected.ok,false,'oversized allowed storage key must fail instead of silently disappearing');
    assert.deepEqual(errors,[]);
    console.log('Production task image attachment checks passed');finish(0);
  } catch(error) {console.error(error.stack || error);console.error(errors);finish(1);}
});
require('../main.js');
