const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app, BrowserWindow,screen } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'slate-pull-'));
process.env.TODO_TEST_USER_DATA = profile;
process.env.SLATE_DISMISS_DEBUG = '1';
app.setPath('userData', profile);
app.commandLine.appendSwitch('user-data-dir', profile);
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'app-settings.json'), JSON.stringify({ shortcut: 'Control+Alt+Y', clipboard: { captureEnabled: false } }));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await check(); if (result) return result; await sleep(25); }
  throw new Error(`Timed out: ${label}`);
}
const deadline = setTimeout(() => { console.error('Real pointer pull timed out'); app.exit(1); }, 80000);
app.whenReady().then(async () => {
  let main,pointer;
  try {
    main = await waitFor(() => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/renderer/index.html')), 'production renderer');
    const js = source => main.webContents.executeJavaScript(source);
    assert.equal(path.resolve(app.getPath('userData')), path.resolve(profile), 'drag tests must use the isolated profile');
    await waitFor(() => !main.webContents.isLoading() && js('Boolean(window.SlatePull && window.SlateTasks?.isReady())'), 'pull controller');
    await waitFor(() => main.isVisible() && main.getBounds().width <= 125, 'native collapsed handle ready');
    const point = (fraction=.5) => js(`(() => { const b=document.getElementById("slate").getBoundingClientRect(); return {x:Math.round(b.x+b.width*${fraction}),y:Math.round(b.y+b.height/2)}; })()`);
    await js('window.pullEvents=[];for(const name of ["pointerdown","pointermove","pointerup","pointercancel","lostpointercapture","gotpointercapture"])document.addEventListener(name,e=>pullEvents.push({type:name,y:e.clientY,target:e.target.id,id:e.pointerId,buttons:e.buttons,captured:document.getElementById("slate").hasPointerCapture(e.pointerId)}),true)');
    pointer=require('./native-pointer.cjs').createNativePointer(profile,screen);
    const input = (type, p, extra = {}) => {if(!pointer.send(type,p,main))main.webContents.sendInputEvent({ type, ...p, ...extra });};
    const collapsed = () => waitFor(() => js('document.getElementById("app").classList.contains("collapsed") && !window.SlatePull.isDragging() && !modeBusy'), 'settled collapsed');
    const expanded = () => waitFor(() => js('document.getElementById("app").classList.contains("expanded") && !window.SlatePull.isDragging() && !modeBusy'), 'settled expanded');
    let origin, initialHeight = 0, closing = false;
    async function start(fromExpanded = false, fraction=.5) {
      await (fromExpanded ? expanded() : collapsed());
      main.show(); main.moveTop(); main.focus();
      main.webContents.focus();
      await waitFor(() => main.isFocused() && js('document.hasFocus()'), 'native drag focus');
      const bounds=main.getContentBounds();
      await waitFor(()=>js(`Math.abs(innerWidth-${bounds.width})<=1&&Math.abs(innerHeight-${bounds.height})<=1`),'native pointer viewport');
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const p = await point(fraction);
      input('mouseMove', p);
      await waitFor(()=>{const b=main.getContentBounds(),actual=screen.getCursorScreenPoint();return Math.abs(actual.x-b.x-p.x)<=1&&Math.abs(actual.y-b.y-p.y)<=1;},'native pointer at handle');
      input('mouseDown', p, { button: 'left', clickCount: 1 });
      await waitFor(() => js('document.getElementById("app").classList.contains("pull-ready")'), 'captured drag canvas');
      origin = { ...(fromExpanded ? p : await point()), y: p.y };
      initialHeight = await js('document.getElementById("panel").getBoundingClientRect().height');
      closing = fromExpanded;
    }
    async function move(y) {
      const p = { ...origin, y: origin.y + y };
      input('mouseMove', p, { modifiers: ['leftButtonDown'] });
      const visible = Math.max(0, Math.min(initialHeight, (closing ? initialHeight : 0) + y));
      await waitFor(() => js(`Math.abs(parseFloat(document.getElementById('app').style.getPropertyValue('--pull-distance')) - ${visible}) < 1`), `pointer frame ${y}`, 2500);
      return js('(() => {const a=document.getElementById("app"),p=document.getElementById("panel"),h=document.querySelector(".topbar"),c=document.querySelector(".panels");return {clip:getComputedStyle(p).clipPath,transform:getComputedStyle(a).transform,header:h.getBoundingClientRect().top,content:c.getBoundingClientRect().top,inert:p.inert,distance:parseFloat(a.style.getPropertyValue("--pull-distance")),height:a.getBoundingClientRect().height};})()');
    }
    async function up(distance) { input('mouseUp', { ...origin, y: origin.y + distance }, { button: 'left', clickCount: 1 }); }
    await start();
    const canvas = main.getBounds();
    const first = await move(60), second = await move(100);
    assert.equal(Math.round(first.distance), 60); assert.equal(Math.round(second.distance), 100);
    assert.equal(first.inert, true); assert.equal(second.inert, true);
    assert.equal(first.clip,'none');assert.equal(second.clip,'none');
    assert.notEqual(first.transform,second.transform,'whole sheet follows actual pointer positions');
    assert.equal(Math.round(second.header-first.header),40);assert.equal(Math.round(second.content-first.content),40,'header and content move together');
    assert.deepEqual(main.getBounds(), canvas, 'pointer frames do not resize the native window');
    await up(60); await collapsed();
    assert.equal(main.getBounds().width, 120);
    assert.equal(main.getOpacity(), 1);
    await sleep(450); await collapsed();
    await start(); await move(180); await up(180); await expanded();
    assert.equal(await js('document.getElementById("panel").inert'), false);
    assert.equal(main.getOpacity(), 1);
    await sleep(450); await expanded();
    // Preserve whole-sheet resistance beyond the open position, without a
    // transparent desktop gap above it, in either shipped theme.
    await start(true); const overpull = await move(96);
    assert.ok(overpull.header > 0, 'the topbar still follows downward resistance');
    assert.deepEqual(main.getBounds(), canvas, 'overscroll keeps the same native canvas');
    const qa = process.env.SLATE_BETA8_QA_DIR;
    if (qa) fs.mkdirSync(qa, {recursive:true});
    for (const theme of ['dark','light']) {
      await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const coverage=await js("(() => {const p=document.getElementById('panel'),r=p.getBoundingClientRect(),s=getComputedStyle(p,'::before');return {top:r.top+parseFloat(s.top),overflow:getComputedStyle(p).overflow,translate:r.top};})()");
      assert.ok(coverage.translate>0&&coverage.top<=0,JSON.stringify(coverage));
      assert.equal(coverage.overflow,'visible');
      const shot=await main.webContents.capturePage(),size=shot.getSize(),bitmap=shot.toBitmap();
      for(const x of [.1,.5,.9].map(f=>Math.floor(size.width*f)))assert.ok(bitmap[(size.width*2+x)*4+3]>=240,'top surface remains opaque in '+theme);
      if(qa)fs.writeFileSync(path.join(qa,'overpull-'+theme+'.png'),shot.toPNG());
    }
    await up(96); await expanded();
    assert.equal(await js("document.getElementById('app').getAnimations().length"),0,'rebound animation is released');
    assert.equal(await js("getComputedStyle(document.getElementById('panel'),'::before').top"),'0px','ordinary panel surface returns after rebound');
    await js("document.documentElement.dataset.theme='dark'");
    const hotzone = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/hotzone.html'));
    await hotzone.webContents.executeJavaScript("window.nativePresses=0;document.addEventListener('mousedown',()=>window.nativePresses++)");
    console.log('Dismiss surface before outside click',JSON.stringify({visible:hotzone.isVisible(),enabled:hotzone.isEnabled(),bounds:hotzone.getBounds(),content:hotzone.getContentBounds(),renderer:await hotzone.webContents.executeJavaScript('({width:innerWidth,height:innerHeight,hidden:document.hidden,background:getComputedStyle(document.body).backgroundColor})'),focused:BrowserWindow.getFocusedWindow()?.webContents.getURL()}));
    const nativePanel=main.getBounds(),nativeZone=hotzone.getContentBounds();
    const outside = { x: nativePanel.x-nativeZone.x-8, y:nativePanel.y-nativeZone.y+Math.round(nativePanel.height/2) };
    pointer.send('mouseMove', outside, hotzone);
    const zone=hotzone.getContentBounds();
    await waitFor(()=>{const p=screen.getCursorScreenPoint();return Math.abs(p.x-zone.x-outside.x)<=1&&Math.abs(p.y-zone.y-outside.y)<=1;},'native outside point');
    console.log('Native outside hit',JSON.stringify({pid:process.pid,main:main.getNativeWindowHandle().readBigUInt64LE().toString(),sensor:hotzone.getNativeWindowHandle().readBigUInt64LE().toString(),hit:await pointer.inspect(outside,hotzone)}));
    pointer.send('mouseDown', outside, hotzone);
    pointer.send('mouseUp', outside, hotzone);
    const releaseEvidence=await pointer.inspect(outside,hotzone);
    assert.equal(hotzone.isFocusable(),false,'the outside detector never becomes a focusable window');
    assert.equal(releaseEvidence.foregroundHwnd,main.getNativeWindowHandle().readBigUInt64LE().toString(),'the outside detector does not steal foreground focus');
    await collapsed();
    assert.match(fs.readFileSync(path.join(profile,'dismiss-debug.log'),'utf8'),/dismiss:native-press/,'outside click really reached the non-activating native dismiss surface');
    await start(); await move(180); await move(0); await up(0); await collapsed();
    await start(); await move(180);
    input('keyDown', {}, { keyCode: 'Escape' }); input('keyUp', {}, { keyCode: 'Escape' });
    await up(180); await collapsed();
    await start(); await up(0); await expanded();
    assert.equal(await js('document.getElementById("slate").getAttribute("aria-hidden")'), 'false');
    await js('document.getElementById("home-note").focus()');
    await start(true);
    const collapseCanvas = main.getBounds();
    const closeFirst = await move(-60), closeSecond = await move(-100);
    assert.ok(Math.abs(closeFirst.distance-(initialHeight-60))<1);
    assert.ok(Math.abs(closeSecond.distance-(initialHeight-100))<1);
    assert.equal(closeFirst.inert, true);
    assert.notEqual(closeFirst.transform, closeSecond.transform);
    assert.equal(Math.round(closeSecond.header-closeFirst.header),-40);assert.equal(Math.round(closeSecond.content-closeFirst.content),-40);
    assert.deepEqual(main.getBounds(), collapseCanvas);
    await up(-60); await expanded();
    assert.equal(await js('document.activeElement.id'), 'home-note', 'short upward drag restores the writing focus');
    await start(true); await move(-180); await up(-180); await collapsed();
    for(const fraction of [.04,.96]){
      await start(); await up(0); await expanded();
      assert.equal(await js('document.getElementById("slate").getBoundingClientRect().width >= innerWidth-1'),true,'entire bottom edge is draggable');
      await start(true,fraction);await move(-180);await up(-180);await collapsed();
    }
    await start(); await up(0); await expanded();
    await start(true); await move(-180); await move(0); await up(0); await expanded();
    await start(true); await move(-180);
    input('keyDown', {}, { keyCode: 'Escape' }); input('keyUp', {}, { keyCode: 'Escape' });
    await up(-180); await expanded();
    await start(true); await up(0); await collapsed();
    await sleep(450);
    await js('document.getElementById("slate").focus()');
    input('keyDown', {}, { keyCode: 'Enter' }); input('keyUp', {}, { keyCode: 'Enter' });
    await expanded();
    await js('document.getElementById("slate").focus()');
    input('keyDown', {}, { keyCode: 'Enter' }); input('keyUp', {}, { keyCode: 'Enter' });
    await collapsed();
    assert.equal(await js('document.getElementById("app").classList.contains("pulling")'), false);
    console.log('Actual bidirectional pointer pull: fixed canvas, short/long/reverse releases, focus restoration, Escape, tap, Enter and outside dismissal passed');
    pointer.close();clearTimeout(deadline); app.quit();
  } catch (error) {
    console.error(error);
    if (main && !main.isDestroyed()) console.error(await main.webContents.executeJavaScript('JSON.stringify({app:document.getElementById("app").className,busy:modeBusy,drag:window.SlatePull?.isDragging(),clip:getComputedStyle(document.getElementById("panel")).clipPath,events:window.pullEvents})').catch(() => 'renderer unavailable'));
    const debug=path.join(profile,'dismiss-debug.log');if(fs.existsSync(debug))console.error(fs.readFileSync(debug,'utf8'));
    const sensor=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/hotzone.html'));if(sensor)console.error('Native sensor presses',await sensor.webContents.executeJavaScript('window.nativePresses'));
    pointer?.close();clearTimeout(deadline); app.exit(1);
  }
});
require('../main.js');
