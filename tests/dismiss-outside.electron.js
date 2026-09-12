const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');

app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const timeout = setTimeout(() => {
  console.error('Outside-dismiss production test timed out');
  app.exit(1);
}, 25000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await sleep(30);
  }
  return null;
}

app.whenReady().then(async () => {
  try {
    const windows = await waitFor(() => {
      const all = BrowserWindow.getAllWindows();
      const main = all.find((win) => win.webContents.getURL().endsWith('/renderer/index.html'));
      const hotzone = all.find((win) => win.webContents.getURL().endsWith('/hotzone.html'));
      return main && hotzone ? { main, hotzone } : null;
    });
    assert.ok(windows, 'production main and hotzone windows should be created');
    await waitFor(() => !windows.main.webContents.isLoading());

    windows.main.webContents.send('shortcut:toggle-panel');
    const expanded = await waitFor(() => windows.main.webContents.executeJavaScript(
      "document.getElementById('app').classList.contains('expanded')"
    ));
    assert.equal(expanded, true, 'panel should expand before the outside click');

    const bounds = windows.hotzone.getBounds();
    windows.hotzone.webContents.sendInputEvent({
      type: 'mouseDown',
      x: 8,
      y: Math.max(8, bounds.height - 8),
      button: 'left',
      clickCount: 1,
    });
    windows.hotzone.webContents.sendInputEvent({
      type: 'mouseUp',
      x: 8,
      y: Math.max(8, bounds.height - 8),
      button: 'left',
      clickCount: 1,
    });

    const collapsed = await waitFor(() => windows.main.webContents.executeJavaScript(
      "document.getElementById('app').classList.contains('collapsed')"
    ));
    assert.equal(collapsed, true, 'a stationary first press outside should collapse an unfocused panel');
    console.log('Outside click dismisses the untouched expanded panel');
    clearTimeout(timeout);
    app.quit();
  } catch (error) {
    console.error(error);
    clearTimeout(timeout);
    app.exit(1);
  }
});

require('../main.js');
