const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
async function main() {
  await app.whenReady();
  const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  const errors = [];
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(`${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
  try {
    await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await window.webContents.executeJavaScript(`
      localStorage.clear();
      localStorage.setItem('slate-recordings', JSON.stringify([{id:'retained-recording',createdAt:1788709776699,durationMs:1558,transcript:'',audioPath:'recordings/retained.webm',mimeType:'audio/webm',title:'Saved recording',category:'未分类'}]));
      document.getElementById('home-note').value = 'Retained note';
      document.getElementById('home-note').dispatchEvent(new Event('input', {bubbles:true}));
    `);
    await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    const state = await window.webContents.executeJavaScript(`({home:!!window.SlateHome,workspace:!!window.SlateWorkspace,note:document.getElementById('home-note').value,recordings:document.querySelectorAll('.recording-item').length})`);
    assert.deepEqual(errors, [], 'Retained profile must initialize without renderer errors');
    assert.deepEqual(state, {home:true,workspace:true,note:'Retained note',recordings:1});
    console.log('Retained workspace renderer checks passed');
  } finally { window.destroy(); }
}
main().then(() => app.quit(), (error) => { console.error(error); app.exit(1); });
