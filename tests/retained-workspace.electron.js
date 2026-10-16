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
      localStorage.setItem('slate-home-order-v3', JSON.stringify(['translation', 'recorder', 'note', 'tasks', 'launcher', 'windows']));
      localStorage.setItem('slate-home-hidden-modules-v1', JSON.stringify(['recorder', 'launcher']));
      document.getElementById('home-note').value = 'Retained note';
      document.getElementById('home-note').dispatchEvent(new Event('input', {bubbles:true}));
    `);
    await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    const state = await window.webContents.executeJavaScript(`new Promise((resolve) => {
      document.getElementById('tab-button-recordings').click();
      setTimeout(() => resolve({home:!!window.SlateHome,workspace:!!window.SlateWorkspace,note:document.getElementById('home-note').value,recordings:document.querySelectorAll('.recording-item').length}), 60);
    })`);
    assert.deepEqual(errors, [], 'Retained profile must initialize without renderer errors');
    assert.deepEqual(state, {home:true,workspace:true,note:'Retained note',recordings:1});
    const migratedHome = await window.webContents.executeJavaScript(`(() => ({
      order: [...document.querySelectorAll('#home-bento > [data-home-module]')]
        .sort((a, b) => Number(a.style.order) - Number(b.style.order)).map(tile => tile.dataset.homeModule),
      hidden: JSON.parse(localStorage.getItem('slate-home-hidden-modules-v1')),
      recorderTile: !!document.querySelector('[data-home-module="recorder"]'),
      launcherHidden: document.querySelector('[data-home-module="launcher"]').hidden,
      recordingControl: !!document.querySelector('.topbar #quick-recorder #record-start'),
    }))()`);
    assert.deepEqual(migratedHome.order, ['translation', 'note', 'tasks', 'launcher', 'windows'], 'upgrade removes the recorder entry while retaining the user order');
    assert.deepEqual(migratedHome.hidden, ['launcher'], 'retired recorder visibility is cleaned without losing the user hidden preference');
    assert.equal(migratedHome.recorderTile, false);
    assert.equal(migratedHome.launcherHidden && migratedHome.recordingControl, true, 'homepage customization does not remove the independent recording controls');
    console.log('Retained workspace renderer checks passed');
  } finally { window.destroy(); }
}
main().then(() => app.quit(), (error) => { console.error(error); app.exit(1); });
