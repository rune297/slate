const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, screen } = require('electron');
const { createNativePointer } = require('./native-pointer.cjs');

const profile = process.env.TODO_TEST_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'slate-dismiss-'));
process.env.TODO_TEST_USER_DATA = profile;
process.env.SLATE_NOTIFICATION_PORT ||= '43831';
process.env.SLATE_DISMISS_DEBUG = '1';
app.setPath('userData', profile);
app.commandLine.appendSwitch('user-data-dir', profile);
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'app-settings.json'), JSON.stringify({
  shortcut: 'Control+Alt+Y', clipboard: { captureEnabled: false, feedbackEnabled: false },
}));

const timeout = setTimeout(() => {
  console.error('Outside-dismiss production test timed out');
  app.exit(1);
}, 80000);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await sleep(15);
  }
  throw new Error(`Timed out: ${label}`);
}

app.whenReady().then(async () => {
  let main, pointer;
  let scenario = 'startup';
  try {
    const windows = await waitFor(() => {
      const all = BrowserWindow.getAllWindows();
      const main = all.find(win => win.webContents.getURL().endsWith('/renderer/index.html'));
      const hotzone = all.find(win => win.webContents.getURL().endsWith('/hotzone.html'));
      return main && hotzone ? { main, hotzone } : null;
    }, 'production main and hotzone windows');
    main = windows.main;
    const hotzone = windows.hotzone;
    const js = source => main.webContents.executeJavaScript(source);
    assert.equal(path.resolve(app.getPath('userData')), path.resolve(profile), 'dismiss tests must use an isolated profile');
    await waitFor(() => !main.webContents.isLoading() && js('Boolean(window.SlatePull && window.SlateTasks?.isReady())'), 'renderer ready');
    await waitFor(() => !hotzone.webContents.isLoading(), 'hotzone ready');
    pointer = createNativePointer(profile, screen);

    const settled = mode => waitFor(() => js(`document.getElementById('app').classList.contains('${mode}') && !modeBusy && !window.SlatePull.isDragging()`), `settled ${mode}: ${scenario}`);
    function nativeAt(type, point) {
      const bounds = hotzone.getContentBounds();
      pointer.send(type, { x: point.x - bounds.x, y: point.y - bounds.y }, hotzone);
    }
    async function moveTo(point) {
      nativeAt('mouseMove', point);
      await waitFor(() => {
        const actual = screen.getCursorScreenPoint();
        return Math.abs(actual.x - point.x) <= 1 && Math.abs(actual.y - point.y) <= 1;
      }, 'actual Windows pointer position');
    }
    async function clickAt(point) {
      await moveTo(point);
      nativeAt('mouseDown', point);
      nativeAt('mouseUp', point);
    }
    function outsidePoint(side = 'left') {
      const bounds = main.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      const point = { x: side === 'left' ? bounds.x - 8 : bounds.x + bounds.width + 8, y: bounds.y + Math.round(bounds.height / 2) };
      assert.ok(point.x >= area.x && point.x < area.x + area.width, 'the exact outside-edge fixture must be on the same screen');
      return point;
    }
    async function openWithoutFocus() {
      await settled('collapsed');
      // No content is clicked. Keeping the pointer in the future panel rectangle
      // also prevents the cursor-dwell fallback from masking the click result.
      const bounds = main.getBounds();
      await moveTo({ x: bounds.x + Math.round(bounds.width / 2), y: bounds.y + 120 });
      main.blur();
      await waitFor(() => !main.isFocused(), 'panel genuinely has no native focus');
      main.webContents.send('shortcut:toggle-panel');
      await settled('expanded');
      assert.equal(main.isFocused(), false, 'expansion should not acquire focus before the first outside click');
    }
    async function focusInside() {
      const bounds = main.getBounds();
      await moveTo({ x: bounds.x + bounds.width / 2, y: bounds.y + 80 });
      main.focus();
      main.webContents.focus();
      await waitFor(() => main.isFocused() && js('document.hasFocus()'), 'native focus before pull');
    }

    // Keep production IPC covered independently of Windows hit tests.
    scenario = 'stationary press IPC';
    await openWithoutFocus();
    const farOutside = { x: 8, y: hotzone.getBounds().height - 8 };
    const zoneBounds=hotzone.getContentBounds();
    await moveTo({x:zoneBounds.x+farOutside.x,y:zoneBounds.y+farOutside.y});
    hotzone.webContents.sendInputEvent({ type: 'mouseDown', ...farOutside, button: 'left', clickCount: 1 });
    hotzone.webContents.sendInputEvent({ type: 'mouseUp', ...farOutside, button: 'left', clickCount: 1 });
    await settled('collapsed');

    // An explicit press is not pointer jitter. The old 16px leave tolerance
    // incorrectly swallowed a click only 8px beyond the visible panel.
    scenario = 'native first click just outside an unfocused panel';
    await openWithoutFocus();
    await clickAt(outsidePoint());
    await settled('collapsed');

    scenario = 'native outside click after focused use';
    await openWithoutFocus();
    await focusInside();
    await clickAt(outsidePoint('right'));
    await settled('collapsed');

    scenario = 'outside click while the ordinary opening is still animating';
    const collapsedBounds = main.getBounds();
    await moveTo({ x: collapsedBounds.x + collapsedBounds.width / 2, y: collapsedBounds.y + 120 });
    main.blur();
    await waitFor(() => !main.isFocused(), 'unfocused animated expansion');
    main.webContents.send('shortcut:toggle-panel');
    await waitFor(() => main.getBounds().width > 120 && js("modeBusy && document.getElementById('app').classList.contains('expanded')"), 'actual opening animation');
    await clickAt(outsidePoint());
    await settled('collapsed');

    // A short upward pull rebounds to expanded. A click during that rebound
    // must survive the native pull session and its eventual focus-state reset.
    scenario = 'outside click during upward-pull rebound';
    await openWithoutFocus();
    await focusInside();
    const viewport = main.getContentBounds();
    await waitFor(() => js(`Math.abs(innerWidth-${viewport.width}) <= 1 && Math.abs(innerHeight-${viewport.height}) <= 1`), 'drag viewport matches native bounds');
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const handle = await js("(() => { const r=document.getElementById('slate').getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()");
    pointer.send('mouseMove', handle, main);
    pointer.send('mouseDown', handle, main);
    await waitFor(() => js("document.getElementById('app').classList.contains('pull-ready') && window.SlatePull.isDragging()"), 'native upward drag captured');
    const pulled = { x: handle.x, y: handle.y - 48 };
    pointer.send('mouseMove', pulled, main);
    await waitFor(() => js("parseFloat(document.getElementById('app').style.getPropertyValue('--pull-translate')) < -20"), 'visible upward pull');
    pointer.send('mouseUp', pulled, main);
    const reducedMotion = await js("matchMedia('(prefers-reduced-motion: reduce)').matches");
    if (!reducedMotion) {
      await waitFor(() => js("window.SlatePull.isDragging() && document.getElementById('app').getAnimations().some(animation => animation.playState === 'running')"), 'real rebound animation is running');
      await clickAt(outsidePoint());
      await settled('collapsed');
    } else {
      await settled('expanded');
      await clickAt(outsidePoint());
      await settled('collapsed');
      console.log('Reduced motion has no rebound interval; checked the first click immediately after settling');
    }

    assert.equal(main.getBounds().width, 120, 'native window returns to the collapsed handle');
    assert.equal(main.getOpacity(), 1, 'outside dismissal does not leave an invisible native window');
    assert.equal(await js("document.getElementById('panel').inert"), true, 'collapsed content is not interactive');
    console.log('Outside dismissal passed: IPC, native unfocused first press, 8px edges, focused use, opening animation and pull rebound');
    pointer.close();
    clearTimeout(timeout);
    app.quit();
  } catch (error) {
    console.error(`Outside dismissal failed during: ${scenario}`);
    console.error(error);
    if (main && !main.isDestroyed()) console.error(await main.webContents.executeJavaScript("JSON.stringify({classes:document.getElementById('app').className,busy:modeBusy,focused:document.hasFocus(),drag:window.SlatePull?.isDragging()})").catch(() => 'renderer unavailable'));
    const log = path.join(profile, 'dismiss-debug.log');
    if (fs.existsSync(log)) console.error(fs.readFileSync(log, 'utf8'));
    pointer?.close();
    clearTimeout(timeout);
    app.exit(1);
  }
});

require('../main.js');
