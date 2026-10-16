const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

// Exercise production bootstrap with a disposable profile, never the user's tasks.
const profile = process.env.TODO_TEST_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'slate-newcomer-test-'));
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
const now = new Date();
const oldDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 35, 12);
const dateKey = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'workspace.json'), JSON.stringify({ version: 1, localStorage: {
  'slate-todo-data': JSON.stringify({ P0: [], P1: [], P2: [], P3: [{
    id: 'outside-period-completion', text: '上月已完成，不属于本期', done: true,
    createdAt: oldDate.getTime() - 3600000, completedAt: oldDate.getTime(), deadline: '',
    planKind: 'day', planDate: dateKey(oldDate), planAddedAt: oldDate.getTime() - 3600000,
  }] }),
} }));
fs.writeFileSync(path.join(profile, 'app-settings.json'), JSON.stringify({
  shortcut: 'Control+Alt+S', defaultTab: 'home',
  features: { home: true, todo: true, notes: true, links: true, recordings: true, credentials: false, clip: true },
  clipboard: { captureEnabled: false, retentionDays: 7, ignoredApps: [], pausedUntil: 0 },
}));

const errors = [];
function diagnostic(message) {
  console.log(message);
  if (process.env.TODO_TEST_LOG) fs.appendFileSync(process.env.TODO_TEST_LOG, `${message}\n`);
}
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(`${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
});
const timeout = setTimeout(() => { diagnostic(`Newcomer workflow timed out: ${JSON.stringify(errors)}`); app.exit(1); }, 90000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, description, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await sleep(30);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

app.whenReady().then(async () => {
  try {
    const main = await waitFor(() => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/renderer/index.html')), 'production main window');
    const evaluate = (script) => main.webContents.executeJavaScript(script).catch((error) => {
      throw new Error(`Renderer action failed: ${script.slice(0, 350)}\n${errors.join('\n')}\n${error.message}`, { cause: error });
    });
    const click = (selector) => evaluate(`(() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!target || target.disabled) throw new Error('Missing or disabled control: ' + ${JSON.stringify(selector)});
      target.click(); return target.textContent.trim();
    })()`);
    const fill = (selector, value) => evaluate(`(() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!target) throw new Error('Missing input: ' + ${JSON.stringify(selector)});
      target.value = ${JSON.stringify(value)};
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    const tasks = () => evaluate("Object.values(JSON.parse(localStorage.getItem('slate-todo-data') || '{}')).flat()");
    const ids = (selector = '#home-focus-list') => evaluate(`[...document.querySelectorAll(${JSON.stringify(`${selector} [data-id]`)})].map(row => row.dataset.id)`);
    const homeRow = (id) => `#home-focus-list [data-id="${id}"]`;
    const todoRow = (id) => `#todo-list [data-id="${id}"]`;
    const summary = (selector = '#home-focus-summary') => evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
    const assertProgress = async (completed, total, selector) => assert.match(await summary(selector),
      new RegExp(`已完成\\s*${completed}\\s*/\\s*${total}(?!\\d)`), `progress should describe current selected plan: ${completed}/${total}`);
    const homePeriod = async (period) => {
      await click(`[data-home-period="${period}"]`);
      await waitFor(() => evaluate(`document.querySelector('[data-home-period="${period}"]').getAttribute('aria-pressed') === 'true' || document.querySelector('[data-home-period="${period}"]').classList.contains('is-active')`), `${period} period`);
    };
    const tab = async (name) => {
      await click(`#tab-button-${name}`);
      await waitFor(() => evaluate(`document.getElementById('tab-${name}').classList.contains('active')`), `${name} tab`);
    };
    const add = async (text) => {
      await fill('#home-task-input', text);
      await click('#home-task-add');
      const item = await waitFor(async () => (await tasks()).find((task) => task.text === text), `new task ${text}`);
      assert.equal(await evaluate("document.getElementById('home-task-input').value"), '', 'explicit Add clears the captured text');
      assert.equal((await tasks()).filter((task) => task.text === text).length, 1, 'one click creates one task');
      return item;
    };
    const layoutReady = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const hitTest = (selector) => evaluate(`(() => {
      const target = document.querySelector(${JSON.stringify(selector)}), rect = target.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y), tile = target.closest('[data-home-module]').getBoundingClientRect();
      const style = getComputedStyle(target);
      return { visible: rect.width > 2 && rect.height > 2 && style.display !== 'none' && style.visibility !== 'hidden',
        inside: rect.left >= tile.left && rect.right <= tile.right && rect.top >= tile.top && rect.bottom <= tile.bottom,
        accessible: hit === target || target.contains(hit), x: Math.round(x), y: Math.round(y),
        hit: hit?.id || hit?.className || '', height: rect.height,
        variant: target.closest('[data-home-module]').dataset.layoutVariant };
    })()`);

    await waitFor(() => evaluate("!!window.SlateTasks && !!window.SlateHome && typeof workspaceHydrating !== 'undefined' && !workspaceHydrating && !!document.getElementById('home-task-add')").catch(() => false), 'production planning controls');
    assert.equal(path.resolve(app.getPath('userData')), path.resolve(profile), 'test bootstrap stays in its isolated profile');
    await main.webContents.debugger.attach('1.3');
    await main.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await evaluate('setMode(true)');
    main.show(); main.focus(); main.webContents.focus();
    await tab('home');

    diagnostic('Newcomer: empty plan has direct input and Add in every supported homepage arrangement');
    assert.equal(await evaluate("document.querySelectorAll('#home-bento > [data-home-module]').length"), 5, 'recorder is no longer a homepage module');
    const defaultHome = await evaluate(`(() => {
      const tiles = [...document.querySelectorAll('#home-bento > [data-home-module]')]
        .filter(tile => !tile.hidden).sort((a, b) => Number(a.style.order) - Number(b.style.order));
      return { ids: tiles.map(tile => tile.dataset.homeModule),
        noRecorder: !document.querySelector('[data-home-module="recorder"]'),
        quickRecorder: !!document.querySelector('.topbar #quick-recorder') };
    })()`);
    assert.deepEqual(defaultHome.ids, ['tasks', 'note', 'translation', 'launcher'], 'fresh Windows homepage defaults to the four requested tiles in reading order');
    assert.equal(defaultHome.noRecorder && defaultHome.quickRecorder, true);
    assert.deepEqual(await ids(), [], 'earlier completed tasks do not pollute an empty today plan');
    await assertProgress(0, 0);
    assert.match(await evaluate("document.getElementById('home-task-add').textContent"), /添加|新增|保存/, 'button uses an actionable label');
    for (const [width, height] of [[1240, 616], [1000, 576]]) {
      main.setSize(width, height);
      await evaluate("['launcher','windows','tasks','note','translation'].forEach(id => window.SlateHome.setModuleVisible(id,true))");
      const visibleModules = await evaluate("window.SlateHome.getVisibility().visibleIds");
      const otherModules = visibleModules.filter((id) => id !== 'tasks');
      for (let count = visibleModules.length; count >= 1; count -= 1) {
        await layoutReady();
        const noteVisible = await evaluate("window.SlateHome.isVisible('note')");
        const selectors = ['#home-task-input', '#home-task-add', '#home-focus-summary'];
        if (noteVisible) selectors.push('#home-note');
        for (const selector of selectors) {
          const result = await hitTest(selector);
          assert.equal(result.visible, true, `${selector} must remain visible at ${width}x${height} with ${count} modules: ${JSON.stringify(result)}`);
          assert.equal(result.inside, true, `${selector} must stay inside its tile: ${JSON.stringify(result)}`);
          assert.equal(result.accessible, true, `${selector} cannot be covered by another element: ${JSON.stringify(result)}`);
        }
        if (noteVisible) assert.equal(await evaluate("document.getElementById('home-note').readOnly || document.getElementById('home-note').disabled"), false, 'note capture always opens in edit mode');
        if (count > 1) await evaluate(`window.SlateHome.setModuleVisible(${JSON.stringify(otherModules[visibleModules.length - count])},false)`);
      }
    }
    main.setSize(1240, 616);
    await evaluate("['launcher','windows','note','translation'].forEach(id => window.SlateHome.setModuleVisible(id,false))");
    await layoutReady();

    const inputHit = await hitTest('#home-task-input');
    main.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: inputHit.x, y: inputHit.y });
    main.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: inputHit.x, y: inputHit.y });
    await waitFor(() => evaluate("document.activeElement.id === 'home-task-input'"), 'visible homepage input receives a real mouse click');
    await main.webContents.insertText('今天交付方案');
    const addHit = await hitTest('#home-task-add');
    main.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: addHit.x, y: addHit.y });
    main.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: addHit.x, y: addHit.y });
    const first = await waitFor(async () => (await tasks()).find((item) => item.text === '交付方案'), 'mouse-click Add captures first task and recognizes its date');
    assert.equal(first.planKind, 'day');
    assert.equal(first.planDate, dateKey(now));
    assert.equal(first.focusDate, '', 'a captured task is ordinary until the user explicitly makes it a focus');
    await assertProgress(0, 1);

    diagnostic('Newcomer: the default homepage shows today progress and a directly clickable task beside an editable note');
    await evaluate("['launcher','windows','tasks','note','translation'].forEach(id => window.SlateHome.setModuleVisible(id,true))");
    await layoutReady();
    for (const selector of ['#home-focus-summary', '#home-task-progress', `${homeRow(first.id)} [data-work-action="toggle"]`, '#home-note']) {
      const result = await hitTest(selector);
      assert.equal(result.visible && result.inside && result.accessible, true, `default homepage must expose ${selector}: ${JSON.stringify(result)}`);
    }
    const toggleHit = await hitTest(`${homeRow(first.id)} [data-work-action="toggle"]`);
    main.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: toggleHit.x, y: toggleHit.y });
    main.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: toggleHit.x, y: toggleHit.y });
    await waitFor(async () => (await tasks()).find((item) => item.id === first.id)?.done, 'today task completes directly from the homepage');
    await evaluate("['launcher','windows','note','translation'].forEach(id => window.SlateHome.setModuleVisible(id,false))");
    await layoutReady();

    diagnostic('Newcomer: completions stay visible, new work grows the current plan, and reopening updates progress');
    await assertProgress(1, 1);
    assert.ok(!(await ids()).includes(first.id), 'completed task leaves pending list');
    await click('#home-completed-toggle');
    assert.ok((await ids('#home-completed-list')).includes(first.id), 'completed item is still available under the completed fold');
    assert.ok(!(await ids('#home-completed-list')).includes('outside-period-completion'), 'past-period completion is excluded');
    const second = await add('中途加进来的客户确认');
    await assertProgress(1, 2);
    assert.match(await evaluate("document.getElementById('home-focus-summary').title"), /期间新增/, 'detailed progress identifies additions without crowding the homepage');
    assert.ok((await ids('#home-completed-list')).includes(first.id), 'adding a task does not remove earlier completed work');
    await click(`#home-completed-list [data-id="${first.id}"] [data-work-action="toggle"]`);
    await assertProgress(0, 2);
    assert.equal((await tasks()).find((item) => item.id === first.id).completedAt, 0, 'reopening clears the old completion time');
    await click(`${homeRow(first.id)} [data-work-action="toggle"]`);
    await click(`${homeRow(second.id)} [data-work-action="details"]`);
    await waitFor(() => evaluate("document.getElementById('tab-todo').classList.contains('active')"), 'ordinary homepage task opens its existing details');
    await fill(`${todoRow(second.id)} [data-detail="status"]`, 'waiting');
    await click(`${todoRow(second.id)} [data-action="save-details"]`);
    await assertProgress(1, 2, '#todo-period-summary');
    assert.match(await summary('#todo-period-summary'), /等待反馈\s*1/);
    await tab('home');
    await assertProgress(1, 2);
    assert.match(await summary(homeRow(second.id)), /等待反馈/, 'waiting state remains visible on the corresponding task rather than a duplicated toolbar counter');

    diagnostic('Newcomer: This Week and Later preserve independent plans and matching progress');
    await homePeriod('week');
    await assertProgress(1, 2);
    const weekly = await add('本周梳理下季度安排');
    assert.equal(weekly.planKind, 'week', 'This Week capture creates a weekly plan');
    assert.equal(weekly.focusDate, '', 'weekly capture does not force the task into today');
    await assertProgress(1, 3);
    await click(`${homeRow(weekly.id)} [data-work-action="toggle"]`);
    await assertProgress(2, 3);
    await homePeriod('day');
    await assertProgress(1, 2);
    assert.ok(!(await ids('#home-completed-list')).includes(weekly.id), 'weekly-only completion does not enter Today');
    await homePeriod('later');
    await assertProgress(0, 0);
    const later = await add('以后再整理归档规范');
    assert.equal(later.planKind, 'later');
    assert.equal(later.planDate, '');
    assert.equal(later.focusDate, '');
    await assertProgress(0, 1);
    await click(`${homeRow(later.id)} [data-work-action="toggle"]`);
    await assertProgress(1, 1);
    await homePeriod('week');
    await assertProgress(2, 3);
    await homePeriod('day');
    const future = await add('改到下个月的资料整理');
    await click(`${homeRow(future.id)} [data-work-action="reschedule"]`);
    await click('#todo-calendar-next');
    await click('#todo-calendar-grid [data-day="20"]');
    await evaluate("document.getElementById('home-task-input').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}))");
    const futureSaved = (await tasks()).find((item) => item.id === future.id);
    assert.ok(futureSaved.planDate > dateKey(now), 'reschedule stores the actual future plan date');
    await assertProgress(1, 2);
    await homePeriod('later');
    await assertProgress(1, 2);
    assert.ok((await ids()).includes(future.id), 'dated work beyond this week remains visible in Later');

    diagnostic('Newcomer: full task views explain the same periods, including future work');
    await tab('todo');
    const labels = await evaluate("Object.fromEntries([...document.querySelectorAll('.todo-view')].map(button => [button.dataset.view,button.textContent.trim()]))");
    assert.match(labels.today, /今天/); assert.match(labels.upcoming, /本周/); assert.match(labels.inbox, /以后/);
    await click('.todo-view[data-view="today"]');
    await assertProgress(1, 2, '#todo-period-summary');
    await click('.todo-view[data-view="upcoming"]');
    await assertProgress(2, 3, '#todo-period-summary');
    await click('.todo-view[data-view="inbox"]');
    await assertProgress(1, 2, '#todo-period-summary');
    assert.ok(await evaluate(`!!document.querySelector(${JSON.stringify(todoRow(future.id))})`), 'Later detail view retains a future dated task');
    await main.webContents.reload();
    await waitFor(() => evaluate("!!window.SlateTasks && !workspaceHydrating").catch(() => false), 'reloaded workspace');
    await evaluate('setMode(true)');
    await tab('home');
    await homePeriod('week');
    await assertProgress(2, 3);
    assert.equal((await tasks()).find((item) => item.id === weekly.id).planKind, 'week', 'weekly plan survives reload');
    assert.deepEqual(errors, [], 'newcomer interactions run without renderer console errors');
    diagnostic('Production newcomer planning checks passed');
    clearTimeout(timeout);
    app.quit();
  } catch (error) {
    diagnostic(error.stack || String(error));
    clearTimeout(timeout);
    app.exit(1);
  }
});

require('../main.js');
