'use strict';
const path=require('node:path');
function reduceFeedback(previous,event,now=Date.now()){
  if(!event||event.type!=='clipboard'||!Number.isInteger(event.sequence)||event.sequence<=0||event.concealed||!['files','text','image'].includes(event.kind))return null;
  if(previous?.sequence===event.sequence)return null;
  const names=Array.isArray(event.names)?event.names.filter(n=>typeof n==='string').slice(0,3).map(n=>n.replace(/[\r\n\x00-\x1f]/g,' ').slice(0,160)):[];
  const preview=String(event.preview||'').replace(/[\r\n\x00-\x1f]+/g,' ').trim().slice(0,160);
  if(event.kind==='text'&&!preview||event.kind==='files'&&!names.length)return null;
  const count=previous&&now-previous.at<=1600?Math.min(999,previous.count+1):1;
  return {sequence:event.sequence,at:now,count,title:count>1?'去粘贴吧':'已成功复制',description:event.kind==='files'?names.join('、')+(Number(event.total)>names.length?` 等 ${Number(event.total)} 个文件`:''):event.kind==='image'?'已复制图片':preview};
}
function createCopyFeedbackService({BrowserWindow,screen,spawn,helperPath,preloadPath,readSettings,now=Date.now,getTheme=()=> 'light',delayMs=1900,idleMs=20000}){
  let child=null,window=null,loading=null,buffer='',ready=false,enabled=false,previous=null,mutedUntil=0,version=0,theme='',fadeTimer,hideTimer,destroyTimer;
  const clear=()=>{clearTimeout(fadeTimer);clearTimeout(hideTimer);clearTimeout(destroyTimer);};
  function destroyWindow(){if(window&&!window.isDestroyed())window.destroy();window=null;loading=null;}
  function status(){return {supported:process.platform==='win32',enabled,running:!!child&&ready};}
  function ignored(event){const source=String(event.source||'').toLocaleLowerCase();return (readSettings().clipboard?.ignoredApps||[]).some(name=>source.includes(String(name).replace(/\.exe$/i,'').toLocaleLowerCase()));}
  function bounds(){const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea,width=Math.min(380,area.width-32),height=Math.min(112,area.height-32);return{x:area.x+16,y:area.y+area.height-height-16,width,height};}
  async function show(state){
    clear();const id=++version;
    if(!window||window.isDestroyed()){
      window=new BrowserWindow({...bounds(),show:false,frame:false,transparent:true,focusable:false,resizable:false,skipTaskbar:true,hasShadow:false,alwaysOnTop:true,webPreferences:{preload:preloadPath,contextIsolation:true,nodeIntegration:false,sandbox:true}});
      window.setIgnoreMouseEvents(true);window.setMenu(null);window.setAlwaysOnTop(true,'pop-up-menu');
      const created=window;loading=created.loadFile(path.join(__dirname,'renderer','copy-feedback.html')).catch(()=>{if(window===created)destroyWindow();});
    }
    await loading;
    if(id!==version||!enabled||!window||window.isDestroyed())return;
    window.setBounds(bounds());window.webContents.send('copy-feedback:state',{...state,theme:theme||getTheme(),visible:true});window.showInactive();
    fadeTimer=setTimeout(()=>{if(id!==version||!window||window.isDestroyed())return;window.webContents.send('copy-feedback:state',{visible:false});hideTimer=setTimeout(()=>{if(id===version&&window&&!window.isDestroyed())window.hide();},220);},delayMs);
    destroyTimer=setTimeout(()=>{if(id===version)destroyWindow();},idleMs);
  }
  function observe(event){
    if(!event||!enabled||now()<mutedUntil||ignored(event))return;
    const next=reduceFeedback(previous,event,now());if(!next)return;previous=next;void show(next);
  }
  function stop(){++version;clear();ready=false;previous=null;buffer='';const process=child;child=null;if(process){process.stdin?.end();process.kill();}destroyWindow();}
  function configure(settings){
    enabled=process.platform==='win32'&&settings.clipboard?.feedbackEnabled!==false;
    if(!enabled){stop();return;}if(child)return;
    try{
      const process=spawn(helperPath,[],{windowsHide:true,stdio:['pipe','pipe','ignore']});child=process;buffer='';
      process.stdout.setEncoding('utf8');process.stdout.on('data',part=>{buffer+=part;if(buffer.length>16384){buffer='';return;}let end;while((end=buffer.indexOf('\n'))>=0){const raw=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const event=JSON.parse(raw);if(event.type==='ready')ready=true;else observe(event);}catch{}}});
      const gone=()=>{if(child===process){child=null;ready=false;}};process.once('error',gone);process.once('exit',gone);
    }catch{child=null;ready=false;}
  }
  function mute(ms=1200){mutedUntil=now()+ms;previous=null;++version;clear();destroyWindow();}
  return {configure,observe,status,mute,setTheme:value=>{if(['light','dark'].includes(value))theme=value;},dispose:()=>{enabled=false;stop();}};
}
module.exports={reduceFeedback,createCopyFeedbackService};
