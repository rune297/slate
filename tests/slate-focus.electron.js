const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const isolatedUserData = process.env.TODO_TEST_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'slate-electron-test-'));
app.setPath('userData', isolatedUserData);
function diagnostic(message) {
  console.log(message);
  if (process.env.TODO_TEST_LOG) fs.appendFileSync(process.env.TODO_TEST_LOG, `${message}\n`);
}
process.on('uncaughtException', (error) => { diagnostic(error.stack); app.exit(1); });
// Windows keeps Chromium's files locked until process exit. The parent test runner
// cleans up the isolated profile after the child has exited, never in will-quit.

async function main() {
  diagnostic('Renderer test: waiting for Electron');
  await app.whenReady();
  diagnostic('Renderer test: Electron ready');
  const window = new BrowserWindow({
    width: 200,
    height: 38,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      // 与生产主窗口一致，避免 macOS 将重复运行的测试窗口判为遮挡后暂停 rAF。
      backgroundThrottling: false,
    },
  });

  try {
    await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    diagnostic('Renderer test: page loaded');
    const freshProfileClipboardState = await window.webContents.executeJavaScript(`
      (() => ({
        history: localStorage.getItem('slate-clip-history'),
        favorites: localStorage.getItem('slate-clip-favorites'),
        imageRows: document.querySelectorAll('#clip-list [data-type="image"]').length,
      }))()
    `);
    assert.deepEqual(freshProfileClipboardState, {
      history: null,
      favorites: null,
      imageRows: 0,
    }, '全新用户目录不得预置任何剪贴板文本、收藏或图片记录');

    await window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    window.show();
    window.focus();
    window.webContents.focus();
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    const focusStyle = await window.webContents.executeJavaScript(`
      (async () => {
        const slate = document.getElementById('slate');
        const deadline = performance.now() + 5000;
        let result;
        do {
          const slateStyle = getComputedStyle(slate);
          const dotStyle = getComputedStyle(slate.querySelector('.slate-dot'));
          result = {
            active: document.activeElement === slate,
            focusVisible: slate.matches(':focus-visible'),
            outlineStyle: slateStyle.outlineStyle,
            outlineWidth: slateStyle.outlineWidth,
            dotBoxShadow: dotStyle.boxShadow,
          };
          if (result.active && result.focusVisible) return result;
          await new Promise((resolve) => setTimeout(resolve, 20));
        } while (performance.now() < deadline);
        return result;
      })()
    `);

    assert.equal(focusStyle.active, true, '折叠条应能通过键盘获得焦点');
    assert.equal(focusStyle.focusVisible, true, '键盘焦点应保持可见提示');
    assert.equal(
      focusStyle.outlineStyle,
      'none',
      `折叠外壳不能画焦点描边，当前为 ${focusStyle.outlineWidth} ${focusStyle.outlineStyle}`
    );
    assert.notEqual(focusStyle.dotBoxShadow, 'none', '焦点提示应转移到中间抓握条');

    const collapsedPanelLayers = await window.webContents.executeJavaScript(`
      (() => {
        const panel = document.querySelector('.panel');
        return {
          contentClipPath: getComputedStyle(panel).clipPath,
          shellClipPath: getComputedStyle(panel, '::before').clipPath,
        };
      })()
    `);
    assert.equal(
      collapsedPanelLayers.contentClipPath,
      'none',
      '折叠动效不得裁剪承载全部组件的内容层'
    );
    assert.notEqual(
      collapsedPanelLayers.shellClipPath,
      'none',
      '折叠轮廓应由独立背景外壳承担'
    );

    window.setSize(1240, 616);
    const topbarTools = await window.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const waitForClass = async (name) => {
          const deadline = performance.now() + 5000;
          while (performance.now() < deadline) {
            if (document.getElementById('app').classList.contains(name)) return true;
            await sleep(10);
          }
          return false;
        };
        // 生产默认开启超过四个 Tab，会进入左右分栏并让容器横跨整条顶栏。
        document.getElementById('tabs').classList.add('is-split');
        document.getElementById('slate').click();
        const opened = await waitForClass('expanded');
        document.getElementById('global-search-open').click();
        await sleep(30);
        const searchOpened = !document.getElementById('global-search').hidden;
        document.getElementById('global-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await setMode(false);
        const collapsed = await waitForClass('collapsed');
        return {
          opened,
          searchOpened,
          searchClosed: document.getElementById('global-search').hidden,
          collapsed,
          appClass: document.getElementById('app').className,
          panelAriaHidden: document.querySelector('.panel').getAttribute('aria-hidden'),
        };
      })()
    `);
    assert.equal(topbarTools.opened, true, '折叠岛点击后必须展开');
    assert.equal(topbarTools.searchOpened, true, '顶部中央的搜索按钮必须打开跨模块搜索');
    assert.equal(topbarTools.searchClosed, true, '搜索层必须能用 Escape 收起');
    assert.equal(topbarTools.collapsed, true, '顶栏工具检查后必须恢复折叠态');

    const clipboardSearchAudit = await window.webContents.executeJavaScript(`
      (async () => {
        await addClipEntry({ type: 'text', text: 'Slate release notes' });
        await addClipEntry({ type: 'url', text: 'https://github.com/example/slate' });
        const input = document.getElementById('clip-search');
        input.value = 'github';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 20));
        const visibleText = [...document.querySelectorAll('#clip-list .clip-item')]
          .map((item) => item.textContent.trim());
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          searchValueAfterEscape: input.value,
          matchedCount: visibleText.length,
          matchedGithub: visibleText.some((text) => text.includes('github.com/example/slate')),
          restoredCount: document.querySelectorAll('#clip-list .clip-item').length,
        };
      })()
    `);
    assert.deepEqual(clipboardSearchAudit, {
      searchValueAfterEscape: '',
      matchedCount: 1,
      matchedGithub: true,
      restoredCount: 2,
    }, '剪贴板搜索应即时过滤文字和链接，并可用 Escape 清空查询');

    const topbarTabAndSpaceToggle = await window.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const waitForClass = async (name) => {
          const deadline = performance.now() + 5000;
          while (performance.now() < deadline) {
            if (document.getElementById('app').classList.contains(name)) return true;
            await sleep(10);
          }
          return false;
        };
        document.getElementById('slate').click();
        const opened = await waitForClass('expanded');
        const todoButton = document.getElementById('tab-button-todo');
        const rect = todoButton.getBoundingClientRect();
        const hitTarget = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        hitTarget?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await sleep(30);
        const todoActivated = document.getElementById('tab-todo').classList.contains('active');
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: ' ',
          code: 'Space',
          bubbles: true,
          cancelable: true,
        }));
        const collapsedBySpace = await waitForClass('collapsed');
        return {
          opened,
          todoActivated,
          tabHit: Boolean(hitTarget?.closest('#tab-button-todo')),
          collapsedBySpace,
        };
      })()
    `);
    assert.equal(topbarTabAndSpaceToggle.opened, true);
    assert.equal(topbarTabAndSpaceToggle.tabHit, true, '空白穿透不得破坏真实 Tab 的点击命中');
    assert.equal(topbarTabAndSpaceToggle.todoActivated, true, '真实 Tab 点击必须继续切换页面');
    assert.equal(topbarTabAndSpaceToggle.collapsedBySpace, true, '展开后 Space 必须继续收起');

    window.setSize(1240, 616);
    const settingsSurface = await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const appSurface = document.getElementById('app');
        appSurface.classList.remove('collapsed');
        appSurface.classList.add('expanded');
        document.getElementById('tab-button-settings').click();
        setTimeout(() => {
          const page = document.getElementById('settings-page');
          const panel = document.querySelector('.panel');
          const shellClipPath = getComputedStyle(panel, '::before').clipPath;
          resolve({
            contentClipPath: getComputedStyle(panel).clipPath,
            shellOwnsExpandedOutline: shellClipPath !== 'none' && !shellClipPath.includes('calc'),
            rightmostDirectTab: document.querySelector('#tabs .tab[data-tab]:last-of-type')?.dataset.tab,
            settingsInMoreMenu: Boolean(document.querySelector('#tab-more-menu .tab[data-tab="settings"]')),
            activePanel: document.getElementById('tab-settings')?.classList.contains('active'),
            display: getComputedStyle(page).display,
            columns: getComputedStyle(page).gridTemplateColumns.split(' ').filter(Boolean).length,
            api: Boolean(document.getElementById('settings-api-configure')),
            features: document.querySelectorAll('[data-settings-feature]').length,
            homeModules: document.querySelectorAll('[data-settings-home-module]').length,
            shortcut: Boolean(document.getElementById('settings-shortcut-change')),
            defaultTab: {
              exists: Boolean(document.getElementById('settings-default-tab')),
              value: document.getElementById('settings-default-tab')?.value,
              options: document.getElementById('settings-default-tab')?.options.length,
            },
            workspace: Boolean(document.getElementById('settings-workspace-choose')),
            autoLaunch: Boolean(document.getElementById('settings-auto-launch')),
            clipboardPrivacy: Boolean(document.getElementById('settings-clip-capture')),
            backup: Boolean(document.getElementById('settings-backup-export')),
          });
        }, 80);
      })
    `);

    assert.deepEqual(settingsSurface, {
      contentClipPath: 'none',
      shellOwnsExpandedOutline: true,
      rightmostDirectTab: 'links',
      settingsInMoreMenu: true,
      activePanel: true,
      display: 'grid',
      columns: 2,
      api: true,
      features: 6,
      homeModules: 5,
      shortcut: true,
      defaultTab: { exists: true, value: 'home', options: 8 },
      workspace: true,
      autoLaunch: true,
      clipboardPrivacy: true,
      backup: true,
    });

    const defaultTabOpening = await window.webContents.executeJavaScript(`
      (async () => {
        const appSurface = document.getElementById('app');
        const features = {
          home: true,
          todo: true,
          notes: true,
          links: true,
          recordings: true,
          credentials: true,
          clip: false,
        };
        appSurface.classList.remove('expanded', 'opening', 'closing');
        appSurface.classList.add('collapsed');
        applyFeatureSettings({ features, defaultTab: 'todo' });
        await setMode(true);
        const preferredOpened = document.getElementById('tab-todo').classList.contains('active');
        await setMode(false);

        applyFeatureSettings({ features: { ...features, todo: false }, defaultTab: 'todo' });
        await setMode(true);
        const result = {
          preferredOpened,
          hiddenPreferenceFallsBackHome: document.getElementById('tab-home').classList.contains('active'),
        };
        await setMode(false);
        applyFeatureSettings({ features, defaultTab: 'home' });
        return result;
      })()
    `);
    assert.deepEqual(defaultTabOpening, {
      preferredOpened: true,
      hiddenPreferenceFallsBackHome: true,
    }, '每次展开应进入设置的默认页，不可见的默认页应回退到首页');

    const credentialSelectionAudit = await window.webContents.executeJavaScript(`
      (async () => {
        const originalApi = window.slateAPI;
        const item = {
          id: 'credential-selection-test',
          service: 'Example',
          account: 'me@example.com',
          password: 'secret',
          passwordMask: '**********',
        };
        window.slateAPI = {
          saveCredential: async () => ({ ok: true }),
          listCredentials: async () => ({ items: [item], secureStorage: true }),
          getCredential: async () => ({ ok: true, item }),
          deleteCredentials: async () => ({ ok: true }),
          copyCredential: async () => true,
        };
        document.getElementById('tab-button-credentials').click();
        document.getElementById('credential-service').value = item.service;
        document.getElementById('credential-account').value = item.account;
        document.getElementById('credential-password').value = item.password;
        document.getElementById('credential-save').click();
        const deadline = performance.now() + 2000;
        while (!document.querySelector('.credential-item[data-id="credential-selection-test"]')
          && performance.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        let row = document.querySelector('.credential-item[data-id="credential-selection-test"]');
        row.querySelector('.credential-copy').dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          shiftKey: true,
        }));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const bulkDelete = document.getElementById('credential-bulk-delete');
        const selected = document.querySelector('.credential-item[data-id="credential-selection-test"]');
        const searchRect = document.getElementById('credential-search').getBoundingClientRect();
        const deleteRect = bulkDelete.getBoundingClientRect();
        const selectedState = {
          card: selected.classList.contains('multi-selected'),
          deleteVisible: !bulkDelete.hidden && getComputedStyle(bulkDelete).display !== 'none',
          actionsShareOneRow: Math.abs(
            (searchRect.top + searchRect.bottom) / 2 - (deleteRect.top + deleteRect.bottom) / 2
          ) < 2 && deleteRect.left >= searchRect.right,
        };
        selected.querySelector('.credential-copy').click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        row = document.querySelector('.credential-item[data-id="credential-selection-test"]');
        const clearedState = {
          card: row.classList.contains('multi-selected'),
          deleteHidden: bulkDelete.hidden && getComputedStyle(bulkDelete).display === 'none',
          editing: row.classList.contains('editing'),
        };
        window.slateAPI = originalApi;
        return { selectedState, clearedState };
      })()
    `);
    assert.deepEqual(credentialSelectionAudit, {
      selectedState: { card: true, deleteVisible: true, actionsShareOneRow: true },
      clearedState: { card: false, deleteHidden: true, editing: false },
    }, '密钥批量删除应与搜索框同行，并在取消选中后隐藏');

    const recordingPermissionConcurrency = await window.webContents.executeJavaScript(`
      (async () => {
        const originalApi = window.slateAPI;
        const originalMediaRecorder = window.MediaRecorder;
        const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
        const waitFor = async (predicate, label, timeout = 2000) => {
          const startedAt = Date.now();
          while (!predicate()) {
            if (Date.now() - startedAt > timeout) throw new Error('timeout: ' + label);
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        };
        let releasePermission;
        let permissionRequests = 0;
        let streamRequests = 0;
        let recorderStarts = 0;
        const track = {
          readyState: 'live',
          addEventListener() {},
          stop() {},
        };
        const stream = {
          getAudioTracks: () => [track],
          getTracks: () => [track],
        };
        class FakeMediaRecorder {
          static isTypeSupported() { return true; }
          constructor() { this.mimeType = 'audio/webm'; }
          start() { recorderStarts += 1; }
          pause() {}
          resume() {}
          stop() { queueMicrotask(() => this.onstop?.()); }
        }
        try {
          window.MediaRecorder = FakeMediaRecorder;
          navigator.mediaDevices.getUserMedia = async () => {
            streamRequests += 1;
            return stream;
          };
          window.slateAPI = {
            ...originalApi,
            ensureMicrophone: () => {
              permissionRequests += 1;
              return new Promise((resolve) => { releasePermission = resolve; });
            },
          };
          document.getElementById('tab-button-recordings').click();
          document.getElementById('record-start').dispatchEvent(new MouseEvent('click', { bubbles: true }));
          document.getElementById('recording-new').dispatchEvent(new MouseEvent('click', { bubbles: true }));
          await waitFor(() => (
            permissionRequests === 1
            && document.getElementById('record-start').disabled
            && document.getElementById('recording-new').disabled
            && document.getElementById('home-live-transcript').textContent === '等待确认麦克风权限…'
          ), 'permission pending UI');
          const pending = {
            permissionRequests,
            streamRequests,
            recorderStarts,
            startDisabled: document.getElementById('record-start').disabled,
            newDisabled: document.getElementById('recording-new').disabled,
            feedback: document.getElementById('home-live-transcript').textContent,
            drafts: document.querySelectorAll('.recording-item.is-live').length,
          };
          releasePermission(true);
          await waitFor(() => (
            recorderStarts === 1
            && window.SlateWorkspace.isRecordingActive()
            && document.querySelectorAll('.recording-item.is-live').length === 1
          ), 'recording start');
          const started = {
            permissionRequests,
            streamRequests,
            recorderStarts,
            drafts: document.querySelectorAll('.recording-item.is-live').length,
            active: window.SlateWorkspace.isRecordingActive(),
          };
          document.getElementById('record-stop').click();
          await waitFor(() => (
            !window.SlateWorkspace.isRecordingActive()
            && document.querySelectorAll('.recording-item.is-live').length === 0
          ), 'recording cleanup');
          const cleaned = {
            drafts: document.querySelectorAll('.recording-item.is-live').length,
            active: window.SlateWorkspace.isRecordingActive(),
          };
          return { pending, started, cleaned };
        } finally {
          if (window.SlateWorkspace.isRecordingActive()) {
            document.getElementById('record-stop').click();
            await waitFor(() => !window.SlateWorkspace.isRecordingActive(), 'emergency recording cleanup')
              .catch(() => {});
          }
          window.MediaRecorder = originalMediaRecorder;
          navigator.mediaDevices.getUserMedia = originalGetUserMedia;
          window.slateAPI = originalApi;
        }
      })()
    `);
    assert.deepEqual(recordingPermissionConcurrency, {
      pending: {
        permissionRequests: 1,
        streamRequests: 0,
        recorderStarts: 0,
        startDisabled: true,
        newDisabled: true,
        feedback: '等待确认麦克风权限…',
        drafts: 0,
      },
      started: {
        permissionRequests: 1,
        streamRequests: 1,
        recorderStarts: 1,
        drafts: 1,
        active: true,
      },
      cleaned: {
        drafts: 0,
        active: false,
      },
    }, '权限等待期间的多入口连点只能启动一次录音');

    const todoCalendarNavigation = await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        document.getElementById('tab-button-todo').click();
        const trigger = document.getElementById('todo-quick-deadline');
        trigger.click();
        const previous = document.getElementById('todo-calendar-previous');
        const next = document.getElementById('todo-calendar-next');
        if (!previous || !next) {
          resolve({ controls: false });
          return;
        }
        const base = new Date();
        const popover = document.getElementById('todo-date-popover');
        const previousRect = previous.getBoundingClientRect();
        const nextRect = next.getBoundingClientRect();
        const clicksToJanuary = 12 - base.getMonth();
        for (let index = 0; index < clicksToJanuary; index += 1) next.click();
        const expectedYear = base.getFullYear() + 1;
        const januaryLabel = document.getElementById('todo-editor-month').textContent.trim();
        const day = [...document.querySelectorAll('#todo-calendar-grid [data-day]')]
          .find((button) => button.dataset.day === '2');
        day.click();
        const selected = new Date(trigger.dataset.deadline);
        previous.click();
        resolve({
          controls: true,
          popoverVisible: !popover.hidden && getComputedStyle(popover).display !== 'none',
          controlsUsable: [previousRect.width, previousRect.height, nextRect.width, nextRect.height]
            .every((size) => size >= 18),
          januaryLabel,
          decemberLabel: document.getElementById('todo-editor-month').textContent.trim(),
          selected: [selected.getFullYear(), selected.getMonth(), selected.getDate()],
          expectedYear,
        });
      })
    `);

    assert.deepEqual(todoCalendarNavigation, {
      controls: true,
      popoverVisible: true,
      controlsUsable: true,
      januaryLabel: `${new Date().getFullYear() + 1}年 1月`,
      decemberLabel: `${new Date().getFullYear()}年 12月`,
      selected: [new Date().getFullYear() + 1, 0, 2],
      expectedYear: new Date().getFullYear() + 1,
    });

    const todoDeadlineReset = await window.webContents.executeJavaScript(`
      (async () => {
        const trigger = document.getElementById('todo-quick-deadline');
        const popover = document.getElementById('todo-date-popover');
        const manuallySelected = trigger.dataset.deadline;
        const submit = async (text) => {
          const input = document.getElementById('todo-quick-input');
          input.value = text;
          input.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            bubbles: true,
            cancelable: true,
          }));
          await new Promise((resolve) => setTimeout(resolve, 0));
        };

        await submit('manual-deadline-item');
        const stored = JSON.parse(localStorage.getItem('slate-todo-data'));
        const manual = [].concat(stored.P0, stored.P1, stored.P2, stored.P3)
          .find((item) => item.text === 'manual-deadline-item');
        const manualKept = manual?.deadline === manuallySelected;
        const triggerResetAfterSubmit = !trigger.dataset.deadline;

        await submit('明天 14:30 交周报');
        const after = JSON.parse(localStorage.getItem('slate-todo-data'));
        const parsed = [].concat(after.P0, after.P1, after.P2, after.P3)
          .find((item) => item.text === '交周报');
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(14, 30, 0, 0);

        await submit('inbox-no-date-item');
        const final = JSON.parse(localStorage.getItem('slate-todo-data'));
        const inbox = [].concat(final.P0, final.P1, final.P2, final.P3)
          .find((item) => item.text === 'inbox-no-date-item');
        return {
          manualKept,
          triggerResetAfterSubmit,
          parsedDeadline: parsed?.deadline || '',
          expectedParsedDeadline: tomorrow.toISOString(),
          parsedCategory: parsed ? Object.keys(final).find((key) => (final[key] || []).some((item) => item.id === parsed.id)) : '',
          inboxHasNoDeadline: inbox ? inbox.deadline === '' : false,
          popoverHidden: popover.hidden,
        };
      })()
    `);
    assert.equal(todoDeadlineReset.manualKept, true, '手动选过日期后，下一条应沿用该日期提交');
    assert.equal(todoDeadlineReset.triggerResetAfterSubmit, true, '提交后日期草稿必须重置');
    assert.equal(todoDeadlineReset.parsedDeadline, todoDeadlineReset.expectedParsedDeadline, '「明天 14:30」应解析为明天 14:30');
    assert.notEqual(todoDeadlineReset.parsedCategory, '', '解析出的待办应落在所选分类');
    assert.equal(todoDeadlineReset.inboxHasNoDeadline, true, '无日期词的待办应进收件箱（无截止时间）');
    assert.equal(todoDeadlineReset.popoverHidden, true, '提交后应关闭旧日期选择器');

    await window.webContents.executeJavaScript(`
      window.__measureHomepage = function measureHomepage() {
        const surface = document.getElementById('home-bento').getBoundingClientRect();
        const protectedSelectors = {
          launcher: ['.launcher-grid', '.launcher-add'],
          recorder: ['.recorder-head', '.home-transcript:not([hidden])', '.recorder-controls'],
          windows: ['.tile-head', '.window-list'],
          note: ['.note-toolbar', '.note-body'],
          commands: ['.tile-head', '.command-add', '.command-list'],
        };
        const tiles = [...document.querySelectorAll('#home-bento [data-home-module]')]
          .filter((tile) => !tile.hidden)
          .map((tile) => {
            const rect = tile.getBoundingClientRect();
            const regions = (protectedSelectors[tile.dataset.homeModule] || [])
              .map((selector) => tile.querySelector(selector))
              .filter(Boolean)
              .map((node) => {
                const region = node.getBoundingClientRect();
                return { left: region.left, top: region.top, right: region.right, bottom: region.bottom };
              })
              .filter((region) => region.right > region.left && region.bottom > region.top);
            const outsideControls = [...tile.querySelectorAll('button:not([hidden]), input:not([hidden]), textarea:not([hidden])')]
              .filter((control) => {
                const child = control.getBoundingClientRect();
                return child.width > 0 && child.height > 0 && !(
                  child.left >= rect.left - 1 && child.right <= rect.right + 1
                  && child.top >= rect.top - 1 && child.bottom <= rect.bottom + 1
                );
              })
              .map((control) => {
                const controlRect = control.getBoundingClientRect();
                return {
                  name: control.id || control.className || control.tagName,
                  rect: { left: controlRect.left, top: controlRect.top, right: controlRect.right, bottom: controlRect.bottom },
                };
              });
            return {
              id: tile.dataset.homeModule,
              rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
              controlsInside: outsideControls.length === 0,
              outsideControls,
              variant: tile.dataset.layoutVariant,
              area: Number(tile.dataset.layoutWidth) * Number(tile.dataset.layoutHeight),
              regions,
            };
          });
        return {
          surface: { left: surface.left, top: surface.top, right: surface.right, bottom: surface.bottom },
          tiles,
          sizeControls: [...document.querySelectorAll('#home-bento [data-widget-size-cycle]')].map((control) => ({
            hidden: control.hidden,
            disabled: control.disabled,
            tabIndex: control.tabIndex,
            size: control.dataset.currentSize,
          })),
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
          ghostCount: document.querySelectorAll('.home-layout-ghost').length,
          animations: document.getElementById('home-bento').getAnimations().map((animation) => ({
            name: animation.animationName || '',
            playState: animation.playState,
            target: animation.effect?.target?.className || '',
            duration: animation.effect?.getTiming?.().duration,
          })),
        };
      };
      void 0;
    `);

    function assertHomepageMeasurement(measurement, visibleCount) {
      assert.equal(measurement.tiles.length, visibleCount);
      assert.equal(measurement.tiles.reduce((total, tile) => total + tile.area, 0), 48);
      const outside = measurement.tiles.filter((tile) => !tile.controlsInside)
        .map((tile) => `${tile.id}(${tile.variant}): ${JSON.stringify(tile.outsideControls)} tile=${JSON.stringify(tile.rect)}`);
      assert.deepEqual(outside, [], `组件控件必须保持在各自卡片内：${outside.join('; ')}`);
      assert.equal(measurement.reducedMotion, true);
      assert.equal(measurement.ghostCount, 0, '减弱动态效果时不得创建 Auto Layout ghost');
      assert.ok(
        measurement.animations.every((animation) => Number(animation.duration) <= 0.01),
        `减弱动态效果时不得创建有感布局动画：${JSON.stringify(measurement.animations)}`
      );
      measurement.tiles.forEach((tile) => {
        assert.ok(tile.rect.left >= measurement.surface.left - 1, `${tile.id} 越过首页左边界`);
        assert.ok(tile.rect.right <= measurement.surface.right + 1, `${tile.id} 越过首页右边界`);
        assert.ok(tile.rect.top >= measurement.surface.top - 1, `${tile.id} 越过首页上边界`);
        assert.ok(tile.rect.bottom <= measurement.surface.bottom + 1, `${tile.id} 越过首页下边界`);
        assert.ok(['mini', 'compact', 'wide', 'tall', 'full'].includes(tile.variant));
        for (let left = 0; left < tile.regions.length; left += 1) {
          for (let right = left + 1; right < tile.regions.length; right += 1) {
            const a = tile.regions[left];
            const b = tile.regions[right];
            const overlaps = a.left < b.right - 1 && a.right > b.left + 1
              && a.top < b.bottom - 1 && a.bottom > b.top + 1;
            assert.equal(overlaps, false, `${tile.id}(${tile.variant}) 的关键内容区域发生重叠：${JSON.stringify([a, b])}`);
          }
        }
      });
      for (let left = 0; left < measurement.tiles.length; left += 1) {
        for (let right = left + 1; right < measurement.tiles.length; right += 1) {
          const a = measurement.tiles[left].rect;
          const b = measurement.tiles[right].rect;
          const overlaps = a.left < b.right - 1 && a.right > b.left + 1
            && a.top < b.bottom - 1 && a.bottom > b.top + 1;
          assert.equal(overlaps, false, '首页组件矩形不得重叠');
        }
      }
      if (visibleCount < 5) {
        assert.ok(measurement.sizeControls.every((control) => control.hidden && control.disabled && control.tabIndex === -1));
      } else {
        assert.ok(measurement.sizeControls.every((control) => !control.hidden && !control.disabled && control.tabIndex === 0));
      }
    }

    for (const [width, height] of [[1240, 616], [1000, 576]]) {
      window.setSize(width, height);
      const matrix = await window.webContents.executeJavaScript(`
        (async () => {
          const ids = ['launcher', 'recorder', 'windows', 'note', 'commands'];
          ids.forEach((id) => window.SlateHome.setModuleVisible(id, true));
          const results = [];
          for (let count = 5; count >= 1; count -= 1) {
            document.getElementById('tab-button-home').click();
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            results.push(window.__measureHomepage());
            if (count > 1) {
              document.getElementById('tab-button-settings').click();
              const input = document.querySelector('[data-settings-home-module="' + ids[5 - count] + '"]');
              input.checked = false;
              input.dispatchEvent(new Event('change', { bubbles: true }));
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
          }
          return results;
        })()
      `);
      matrix.forEach((measurement, index) => assertHomepageMeasurement(measurement, 5 - index));

      const finalWidgetGuard = await window.webContents.executeJavaScript(`
        (async () => {
          document.getElementById('tab-button-settings').click();
          const enabled = [...document.querySelectorAll('[data-settings-home-module]')].find((input) => input.checked);
          enabled.checked = false;
          enabled.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 20));
          return {
            checked: enabled.checked,
            visibleCount: window.SlateHome.getVisibility().visibleIds.length,
            storedCount: JSON.parse(localStorage.getItem('slate-home-hidden-modules-v1')).length,
            message: document.getElementById('status-toast-message').textContent,
          };
        })()
      `);
      assert.equal(finalWidgetGuard.checked, true);
      assert.equal(finalWidgetGuard.visibleCount, 1);
      assert.equal(finalWidgetGuard.storedCount, 4);
      assert.match(finalWidgetGuard.message, /至少保留一个/);
    }

    const transactionAudit = await window.webContents.executeJavaScript(`
      (() => {
        const ids = ['launcher', 'recorder', 'windows', 'note', 'commands'];
        ids.forEach((id) => window.SlateHome.setModuleVisible(id, true));
        const first = window.SlateHome.setModuleVisible('recorder', false);
        const second = window.SlateHome.setModuleVisible('note', false);
        const rapidHidden = [...window.SlateHome.getVisibility().hiddenIds];
        ids.forEach((id) => window.SlateHome.setModuleVisible(id, true));
        window.SlateHome.setModuleVisible('commands', false);
        window.SlateHome.setModuleVisible('commands', true);
        window.SlateHome.setModuleVisible('commands', false);
        let eventCount = 0;
        const onChange = () => { eventCount += 1; };
        document.addEventListener('slate:home-modules-changed', onChange);
        const storageBeforeNoop = localStorage.getItem('slate-home-hidden-modules-v1');
        const noop = window.SlateHome.setModuleVisible('commands', false);
        const noOpStorageStable = storageBeforeNoop === localStorage.getItem('slate-home-hidden-modules-v1');
        document.removeEventListener('slate:home-modules-changed', onChange);
        const beforeRollback = {
          hidden: JSON.stringify(window.SlateHome.getVisibility().hiddenIds),
          stored: localStorage.getItem('slate-home-hidden-modules-v1'),
          visible: [...document.querySelectorAll('[data-home-module]')].filter((tile) => !tile.hidden).map((tile) => tile.dataset.homeModule).join(','),
          styles: [...document.querySelectorAll('[data-home-module]')].map((tile) => tile.getAttribute('style')).join('|'),
        };
        const originalResolver = window.SlateDomain.resolveHomeWidgetLayout;
        window.SlateDomain.resolveHomeWidgetLayout = () => null;
        const rollback = window.SlateHome.setModuleVisible('launcher', false);
        window.SlateDomain.resolveHomeWidgetLayout = originalResolver;
        const afterRollback = {
          hidden: JSON.stringify(window.SlateHome.getVisibility().hiddenIds),
          stored: localStorage.getItem('slate-home-hidden-modules-v1'),
          visible: [...document.querySelectorAll('[data-home-module]')].filter((tile) => !tile.hidden).map((tile) => tile.dataset.homeModule).join(','),
          styles: [...document.querySelectorAll('[data-home-module]')].map((tile) => tile.getAttribute('style')).join('|'),
        };
        ids.forEach((id) => window.SlateHome.setModuleVisible(id, true));
        const originalWorkspace = window.SlateWorkspace;
        window.SlateWorkspace = { ...originalWorkspace, isRecordingActive: () => true };
        document.dispatchEvent(new CustomEvent('slate:recording-state-changed', { detail: { active: true } }));
        const recordingGuard = window.SlateHome.setModuleVisible('recorder', false);
        window.SlateWorkspace = originalWorkspace;
        const durations = [];
        for (let index = 0; index < 100; index += 1) {
          const start = performance.now();
          window.SlateHome.setModuleVisible('note', index % 2 === 0 ? false : true);
          durations.push(performance.now() - start);
        }
        durations.sort((a, b) => a - b);
        return {
          first, second, rapidHidden, noop, eventCount,
          noOpStorageStable,
          rollback, rollbackStable: JSON.stringify(beforeRollback) === JSON.stringify(afterRollback),
          recordingGuard,
          p95: durations[Math.floor(durations.length * .95)],
          maximum: durations[durations.length - 1],
          animationCount: document.getElementById('home-bento').getAnimations().length,
        };
      })()
    `);
    assert.equal(transactionAudit.first.ok, true);
    assert.equal(transactionAudit.second.ok, true);
    assert.deepEqual(transactionAudit.rapidHidden, ['recorder', 'note']);
    assert.equal(transactionAudit.noop.changed, false);
    assert.equal(transactionAudit.eventCount, 0);
    assert.equal(transactionAudit.noOpStorageStable, true);
    assert.equal(transactionAudit.rollback.error, 'layout_invalid');
    assert.equal(transactionAudit.rollbackStable, true);
    assert.equal(transactionAudit.recordingGuard.error, 'recording_active');
    assert.ok(transactionAudit.p95 < 16, `显隐事务 p95 ${transactionAudit.p95.toFixed(2)}ms 超过 16ms`);
    assert.ok(transactionAudit.maximum < 50, `显隐事务最长 ${transactionAudit.maximum.toFixed(2)}ms 超过 50ms`);
    assert.ok(transactionAudit.animationCount <= 1);

    const persistenceAndRecorderAudit = await window.webContents.executeJavaScript(`
      (() => {
        const ids = ['launcher', 'recorder', 'windows', 'note', 'commands'];
        ids.forEach((id) => window.SlateHome.setModuleVisible(id, true));
        const originalSetItem = Storage.prototype.setItem;
        const storedBefore = localStorage.getItem('slate-home-hidden-modules-v1');
        Storage.prototype.setItem = function setItem(key, value) {
          if (key === 'slate-home-hidden-modules-v1') throw new Error('simulated quota failure');
          return originalSetItem.call(this, key, value);
        };
        const degraded = window.SlateHome.setModuleVisible('windows', false);
        const degradedState = window.SlateHome.getVisibility();
        const degradedStatus = document.getElementById('settings-home-module-status').textContent;
        const degradedStorageStable = storedBefore === localStorage.getItem('slate-home-hidden-modules-v1');
        ['launcher', 'recorder', 'windows', 'note'].forEach((id) => {
          window.SlateHome.setModuleVisible(id, false);
        });
        const rejectedWhileDirty = window.SlateHome.setModuleVisible('commands', false);
        Storage.prototype.setItem = originalSetItem;
        const recovered = window.SlateHome.setModuleVisible('launcher', true);
        const recoveredState = window.SlateHome.getVisibility();
        const recoveredStored = JSON.parse(localStorage.getItem('slate-home-hidden-modules-v1'));

        ids.forEach((id) => window.SlateHome.setModuleVisible(id, true));
        const recorderHidden = window.SlateHome.setModuleVisible('recorder', false);
        const originalWorkspace = window.SlateWorkspace;
        window.SlateWorkspace = { ...originalWorkspace, isRecordingActive: () => true };
        document.dispatchEvent(new CustomEvent('slate:recording-state-changed', { detail: { active: true } }));
        const recorderSwitch = document.querySelector('[data-settings-home-module="recorder"]');
        const hiddenSwitchEnabled = !recorderSwitch.disabled && !recorderSwitch.checked;
        const recorderRestored = window.SlateHome.setModuleVisible('recorder', true);
        document.dispatchEvent(new CustomEvent('slate:recording-state-changed', { detail: { active: true } }));
        const visibleSwitchLocked = recorderSwitch.disabled && recorderSwitch.checked;
        const recordingsActionAvailable = !document.getElementById('recording-new').disabled;
        window.SlateWorkspace = originalWorkspace;
        document.dispatchEvent(new CustomEvent('slate:recording-state-changed', { detail: { active: false } }));

        const noteInput = document.getElementById('home-note');
        noteInput.focus();
        const noteTile = noteInput.closest('[data-home-module]');
        window.SlateHome.setModuleVisible('note', false);
        const focusReleased = !noteTile.contains(document.activeElement)
          && noteTile.hidden
          && noteTile.querySelector('[data-widget-size-cycle]').tabIndex === -1;
        window.SlateHome.setModuleVisible('note', true);
        return {
          degraded,
          degradedPersisted: degradedState.persisted,
          degradedStorageStable,
          degradedStatus,
          rejectedWhileDirty,
          recovered,
          recoveredPersisted: recoveredState.persisted,
          recoveredStored,
          recorderHidden,
          hiddenSwitchEnabled,
          recorderRestored,
          visibleSwitchLocked,
          recordingsActionAvailable,
          focusReleased,
        };
      })()
    `);
    assert.equal(persistenceAndRecorderAudit.degraded.ok, true);
    assert.equal(persistenceAndRecorderAudit.degraded.persisted, false);
    assert.equal(persistenceAndRecorderAudit.degradedPersisted, false);
    assert.equal(persistenceAndRecorderAudit.degradedStorageStable, true);
    assert.match(persistenceAndRecorderAudit.degradedStatus, /仅当前会话/);
    assert.equal(persistenceAndRecorderAudit.rejectedWhileDirty.ok, false);
    assert.equal(persistenceAndRecorderAudit.rejectedWhileDirty.persisted, false);
    assert.equal(persistenceAndRecorderAudit.recovered.ok, true);
    assert.equal(persistenceAndRecorderAudit.recovered.persisted, true);
    assert.equal(persistenceAndRecorderAudit.recoveredPersisted, true);
    assert.ok(Array.isArray(persistenceAndRecorderAudit.recoveredStored));
    assert.equal(persistenceAndRecorderAudit.recorderHidden.ok, true);
    assert.equal(persistenceAndRecorderAudit.hiddenSwitchEnabled, true);
    assert.equal(persistenceAndRecorderAudit.recorderRestored.ok, true);
    assert.equal(persistenceAndRecorderAudit.visibleSwitchLocked, true);
    assert.equal(persistenceAndRecorderAudit.recordingsActionAvailable, true);
    assert.equal(persistenceAndRecorderAudit.focusReleased, true);

    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
    const panelMotionAudit = await window.webContents.executeJavaScript(`
      (async () => {
        const appSurface = document.getElementById('app');
        appSurface.classList.remove('expanded', 'opening', 'closing');
        appSurface.classList.add('collapsed');
        const waitForClass = async (name) => {
          const deadline = performance.now() + 5000;
          while (performance.now() < deadline) {
            if (appSurface.classList.contains(name)) return true;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          return false;
        };
        document.getElementById('slate').click();
        const opened = await waitForClass('expanded');
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const tileEntranceAnimations = [...document.querySelectorAll('#home-bento [data-home-module]')]
          .flatMap((tile) => tile.getAnimations())
          .filter((animation) => animation.animationName === 'bento-masonry-in').length;
        const contentLayerHasScale = [
          document.querySelector('.panel > .topbar'),
          document.querySelector('.panel > .panels'),
        ].filter(Boolean).some((layer) => layer.getAnimations().some((animation) => (
          animation.effect?.getKeyframes?.().some((frame) => {
            if (!frame.transform || frame.transform === 'none') return false;
            const matrix = new DOMMatrixReadOnly(frame.transform);
            const scaleX = Math.hypot(matrix.a, matrix.b);
            const scaleY = Math.hypot(matrix.c, matrix.d);
            return Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001;
          })
        )));
        const masonryReveal = document.getElementById('home-bento').classList.contains('masonry-reveal');
        document.getElementById('slate').click();
        const collapsed = await waitForClass('collapsed');
        return { opened, collapsed, tileEntranceAnimations, contentLayerHasScale, masonryReveal };
      })()
    `);
    assert.equal(panelMotionAudit.opened, true);
    assert.equal(panelMotionAudit.collapsed, true);
    assert.equal(panelMotionAudit.tileEntranceAnimations, 0, '展开时不得再同时启动六张卡片的错峰缩放入场');
    assert.equal(panelMotionAudit.masonryReveal, false, '首页卡片不应在每次展开时重播入场');
    assert.equal(panelMotionAudit.contentLayerHasScale, false, '展开/收起不应缩放整个大面积内容层');

    const lifecycleAudit = await window.webContents.executeJavaScript(`
      (async () => {
        const ids = ['launcher', 'recorder', 'windows', 'note', 'commands'];
        ids.forEach((id) => window.SlateHome.setModuleVisible(id, true));
        document.getElementById('tab-button-home').click();
        document.getElementById('app').classList.remove('collapsed', 'closing', 'opening');
        document.getElementById('app').classList.add('expanded');
        document.dispatchEvent(new CustomEvent('slate:modechange', { detail: { expanded: true } }));
        let windowScans = 0;
        window.slateAPI = {
          listWindows: async () => { windowScans += 1; return { items: [] }; },
        };
        await new Promise((resolve) => setTimeout(resolve, 30));
        windowScans = 0;
        window.SlateHome.setModuleVisible('windows', false);
        await window.SlateWorkspace.refreshWindows(true);
        await window.SlateWorkspace.refreshWindows(true);
        const scansWhileHidden = windowScans;
        window.SlateHome.setModuleVisible('windows', true);
        await new Promise((resolve) => setTimeout(resolve, 30));
        const scansAfterRestore = windowScans;

        return {
          scansWhileHidden,
          scansAfterRestore,
        };
      })()
    `);
    assert.equal(lifecycleAudit.scansWhileHidden, 0);
    assert.equal(lifecycleAudit.scansAfterRestore, 1);

    const idlePerformanceAudit = await window.webContents.executeJavaScript(`
      (async () => {
        const appSurface = document.getElementById('app');
        document.getElementById('tab-button-home').click();
        appSurface.classList.remove('collapsed');
        appSurface.classList.add('expanded');
        document.dispatchEvent(new CustomEvent('slate:modechange', { detail: { expanded: true } }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const hasInfinitePanelEffect = document.getElementById('panel').getAnimations({ subtree: true })
          .some((animation) => animation.animationName === 'bento-border-breathe'
            && animation.effect?.getTiming?.().iterations === Infinity);
        const panelBackdropFilter = getComputedStyle(document.getElementById('panel'), '::before').backdropFilter;
        appSurface.classList.remove('expanded');
        appSurface.classList.add('collapsed');
        document.dispatchEvent(new CustomEvent('slate:modechange', { detail: { expanded: false } }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        appSurface.classList.remove('collapsed');
        appSurface.classList.add('expanded');
        document.dispatchEvent(new CustomEvent('slate:modechange', { detail: { expanded: true } }));
        return {
          hasInfinitePanelEffect,
          panelBackdropFilter,
        };
      })()
    `);
    assert.equal(idlePerformanceAudit.hasInfinitePanelEffect, false, '展开后不得运行大面积无限边框滤镜动画');
    assert.equal(idlePerformanceAudit.panelBackdropFilter, 'none', '近乎不透明的面板不得使用大面积实时背景模糊');

    const autoLayoutMotionAudit = await window.webContents.executeJavaScript(`
      (async () => {
        const ids = ['launcher', 'recorder', 'windows', 'note', 'commands'];
        ids.forEach((id) => window.SlateHome.setModuleVisible(id, true));
        document.getElementById('tab-button-home').click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const sizeButton = document.querySelector('[data-widget-size-cycle="launcher"]');
        const beforeSize = sizeButton.dataset.currentSize;
        sizeButton.click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const ghosts = [...document.querySelectorAll('.home-layout-ghost')];
        const tileAnimations = [...document.querySelectorAll('#home-bento [data-home-module]:not([hidden])')]
          .flatMap((tile) => tile.getAnimations());
        const tileDurations = tileAnimations
          .map((animation) => Number(animation.effect?.getTiming?.().duration) || 0)
          .filter((duration) => duration > 0);
        const animatedOpacities = tileAnimations.flatMap((animation) => (
          animation.effect?.getKeyframes?.().map((frame) => Number(frame.opacity)).filter(Number.isFinite) || []
        ));
        const minimumTileOpacity = animatedOpacities.length ? Math.min(...animatedOpacities) : 1;
        const realTileHasScale = [...document.querySelectorAll('#home-bento [data-home-module]:not([hidden])')]
          .some((tile) => tile.getAnimations().some((animation) => (
            animation.effect?.getKeyframes?.().some((frame) => /scale/.test(String(frame.transform || '')))
          )));
        const during = {
          beforeSize,
          afterSize: sizeButton.dataset.currentSize,
          ghostCount: ghosts.length,
          tileDurations,
          minimumTileOpacity,
          realTileHasScale,
        };
        await new Promise((resolve) => setTimeout(resolve, 700));
        const ghostsAfter = document.querySelectorAll('.home-layout-ghost').length;
        const tileAnimationsAfter = [...document.querySelectorAll('#home-bento [data-home-module]:not([hidden])')]
          .reduce((count, tile) => count + tile.getAnimations().length, 0);
        sizeButton.click();
        sizeButton.click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const rapidGhostIds = [...document.querySelectorAll('.home-layout-ghost')]
          .map((ghost) => ghost.dataset.homeLayoutGhost);
        const rapidDuplicateGhosts = new Set(rapidGhostIds).size !== rapidGhostIds.length;
        const rapidMaxTileAnimations = Math.max(...[...document.querySelectorAll('#home-bento [data-home-module]:not([hidden])')]
          .map((tile) => tile.getAnimations().length));
        await new Promise((resolve) => setTimeout(resolve, 700));
        return {
          ...during,
          ghostsAfter,
          tileAnimationsAfter,
          rapidDuplicateGhosts,
          rapidMaxTileAnimations,
          rapidGhostsAfter: document.querySelectorAll('.home-layout-ghost').length,
        };
      })()
    `);
    assert.notEqual(autoLayoutMotionAudit.afterSize, autoLayoutMotionAudit.beforeSize);
    assert.equal(autoLayoutMotionAudit.ghostCount, 0, '尺寸切换不得用空外壳遮成黑块');
    assert.ok(
      autoLayoutMotionAudit.tileDurations.length > 0
        && autoLayoutMotionAudit.tileDurations.every((duration) => duration >= 500 && duration <= 650),
      `Auto Layout 应保留过程感，也不得拖沓：${JSON.stringify(autoLayoutMotionAudit.tileDurations)}`
    );
    assert.ok(autoLayoutMotionAudit.minimumTileOpacity >= 0.72, '重排期间真实卡片不得熄灭成黑块');
    assert.equal(autoLayoutMotionAudit.realTileHasScale, true, '真实卡片应恢复连续 FLIP 几何过渡');
    assert.equal(autoLayoutMotionAudit.ghostsAfter, 0, 'Auto Layout ghost 必须在动画后清理');
    assert.equal(autoLayoutMotionAudit.tileAnimationsAfter, 0, '重排动画结束后不得残留组件动画');
    assert.equal(autoLayoutMotionAudit.rapidDuplicateGhosts, false, '连续切换必须先清理上一轮 Auto Layout ghost');
    assert.ok(autoLayoutMotionAudit.rapidMaxTileAnimations <= 1, '连续切换不得叠加多轮组件动画');

    const launcherAudit = await window.webContents.executeJavaScript(`
      (async () => {
        const originalApi = window.slateAPI;
        const grid = document.getElementById('launcher-grid');
        const hint = document.getElementById('launcher-hint');
        const addButton = document.getElementById('launcher-add');
        const toastMessage = document.getElementById('status-toast-message');
        const waitFor = async (predicate, timeout = 2000) => {
          const startedAt = Date.now();
          while (!predicate() && Date.now() - startedAt < timeout) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          return predicate();
        };
        const pickQueue = [];
        const opened = [];
        let openResult = { ok: true, activated: false };
        window.slateAPI = {
          chooseLauncherApp: async () => (pickQueue.length ? pickQueue.shift() : { ok: false, error: 'cancelled' }),
          openLauncherApp: async (appPath) => { opened.push(appPath); return openResult; },
          readLauncherIcon: async () => null,
        };

        const seededEmpty = {
          itemCount: grid.children.length,
          hintVisible: !hint.hidden,
        };

        pickQueue.push({ ok: true, app: { path: 'C:/Tools/alpha.exe', name: 'Alpha', icon: null } });
        addButton.click();
        const added = await waitFor(() => grid.children.length === 1);
        const firstItem = grid.querySelector('.launcher-item');
        const afterAdd = {
          added,
          itemCount: grid.children.length,
          name: firstItem ? firstItem.querySelector('.launcher-name').textContent : null,
          fallbackGlyph: firstItem ? firstItem.querySelector('.launcher-icon').textContent : null,
          title: firstItem ? firstItem.title : null,
          hintHidden: hint.hidden,
        };

        firstItem.click();
        await waitFor(() => opened.length === 1);
        const afterOpen = { opened: opened.slice() };

        openResult = { ok: false, error: 'missing' };
        firstItem.click();
        await waitFor(() => (toastMessage.textContent || '').includes('找不到'));
        const afterMissing = { toast: toastMessage.textContent };

        openResult = { ok: true, activated: true };
        firstItem.click();
        await waitFor(() => (toastMessage.textContent || '').includes('已切到'));
        const afterActivate = { toast: toastMessage.textContent };

        pickQueue.push({ ok: true, app: { path: 'C:/Tools/alpha.exe', name: 'Alpha', icon: null } });
        addButton.click();
        await waitFor(() => (toastMessage.textContent || '').includes('已经在快速启动里'));
        const afterDuplicate = { itemCount: grid.children.length, toast: toastMessage.textContent };

        firstItem.querySelector('.launcher-remove').click();
        await waitFor(() => grid.children.length === 0);
        const afterRemove = {
          itemCount: grid.children.length,
          hintVisible: !hint.hidden,
          toast: toastMessage.textContent,
        };

        window.slateAPI = originalApi;
        return { seededEmpty, afterAdd, afterOpen, afterMissing, afterActivate, afterDuplicate, afterRemove };
      })()
    `);
    assert.deepEqual(launcherAudit.seededEmpty, { itemCount: 0, hintVisible: true }, '快速启动空态应显示引导文案');
    assert.deepEqual(launcherAudit.afterAdd, {
      added: true,
      itemCount: 1,
      name: 'Alpha',
      fallbackGlyph: 'A',
      title: 'C:/Tools/alpha.exe',
      hintHidden: true,
    }, '添加软件后应渲染图标位、名称与路径提示');
    assert.deepEqual(launcherAudit.afterOpen, { opened: ['C:/Tools/alpha.exe'] }, '点击软件应把路径交给主进程打开');
    assert.equal(launcherAudit.afterMissing.toast, '找不到 Alpha，可能已被移动或卸载', '目标丢失时应给出可理解的提示');
    assert.equal(launcherAudit.afterActivate.toast, '已切到 Alpha', '命中已运行实例时应提示切换');
    assert.deepEqual(launcherAudit.afterDuplicate, { itemCount: 1, toast: 'Alpha 已经在快速启动里' }, '重复添加应被拦截且不产生重复项');
    assert.deepEqual(launcherAudit.afterRemove, { itemCount: 0, hintVisible: true, toast: '已移除 Alpha' }, '移除后应回到空态并给出反馈');

    // 速记的 Markdown 预览、格式工具栏与编辑/预览切换此前只有 JS 与 CSS，HTML 从未声明对应元素，
    // 250 行解析器完全不可达。这里锁死三者已接线，并覆盖渲染结果、格式写入与录音波形画布。
    const noteAudit = await window.webContents.executeJavaScript(`
      (async () => {
        const input = document.getElementById('home-note');
        const preview = document.getElementById('home-note-preview');
        const toolbar = document.getElementById('note-format-actions');
        const editButton = document.getElementById('note-edit-btn');
        const strands = document.getElementById('recording-strands');

        // 这些钩子只存在于 JS/CSS，HTML 从未声明过；缺失时先给出明确结论，
        // 否则后面 dereference 会抛 TypeError，看不出是哪一环断了。
        const missingHooks = ['home-note-preview', 'note-format-actions', 'note-edit-btn', 'recording-strands']
          .filter((id) => !document.getElementById(id));
        if (missingHooks.length) return { missingHooks };
        const waitFor = async (predicate, timeout = 2000) => {
          const startedAt = Date.now();
          while (!predicate() && Date.now() - startedAt < timeout) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          return predicate();
        };
        const setValue = (value) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const noteSnapshot = localStorage.getItem('slate-home-note');
        const archiveSnapshot = localStorage.getItem('slate-note-active-archive-v1');

        const formatNames = [...toolbar.querySelectorAll('[data-note-format]')]
          .map((button) => button.dataset.noteFormat);
        const editLabelWhileEditing = editButton.textContent;

        setValue('# 标题\\n\\n**加粗** 与 [链接](https://example.com)\\n\\n- 项目一\\n- [ ] 待办');
        await waitFor(() => preview.children.length > 0);
        editButton.click();
        await waitFor(() => !preview.hidden);
        const heading = preview.querySelector('h1');
        const strong = preview.querySelector('strong');
        const link = preview.querySelector('[data-note-href]');
        const inPreview = {
          textareaHidden: input.hidden,
          previewVisible: !preview.hidden,
          toolbarHidden: toolbar.hidden,
          editLabel: editButton.textContent,
          heading: heading ? heading.textContent : null,
          strong: strong ? strong.textContent : null,
          linkHref: link ? link.dataset.noteHref : null,
          listItems: preview.querySelectorAll('li').length,
          taskBoxes: preview.querySelectorAll('.note-task-box').length,
        };

        editButton.click();
        await waitFor(() => preview.hidden);
        const backToEditing = {
          textareaVisible: !input.hidden,
          toolbarVisible: !toolbar.hidden,
          editLabel: editButton.textContent,
        };

        setValue('hello');
        input.focus();
        input.setSelectionRange(0, 5);
        toolbar.querySelector('[data-note-format="bold"]').click();
        const boldedText = input.value;

        const strandsState = strands
          ? {
              exists: true,
              parentId: strands.parentElement ? strands.parentElement.id : null,
              display: getComputedStyle(strands).display,
            }
          : { exists: false };

        setValue(noteSnapshot || '');
        await new Promise((resolve) => setTimeout(resolve, 450));
        if (noteSnapshot === null) localStorage.removeItem('slate-home-note');
        if (archiveSnapshot === null) localStorage.removeItem('slate-note-active-archive-v1');

        return { missingHooks, formatNames, editLabelWhileEditing, inPreview, backToEditing, boldedText, strandsState };
      })()
    `);
    assert.deepEqual(noteAudit.missingHooks, [], '速记预览层、格式工具栏、编辑切换与录音波形画布的 DOM 必须存在于首页');
    assert.deepEqual(noteAudit.formatNames, [
      'bold', 'italic', 'heading', 'bullet', 'ordered', 'task', 'quote', 'code', 'link',
    ], '速记格式工具栏必须覆盖标题/粗斜体/列表/任务/引用/代码/链接');
    assert.equal(noteAudit.editLabelWhileEditing, '完成', '编辑态下切换按钮应提示“完成”');
    assert.deepEqual(noteAudit.inPreview, {
      textareaHidden: true,
      previewVisible: true,
      toolbarHidden: true,
      editLabel: '编辑',
      heading: '标题',
      strong: '加粗',
      linkHref: 'https://example.com/',
      listItems: 2,
      taskBoxes: 1,
    }, '预览应渲染标题、加粗、链接、列表与任务项，并让出编辑区');
    assert.deepEqual(noteAudit.backToEditing, {
      textareaVisible: true,
      toolbarVisible: true,
      editLabel: '完成',
    }, '切回编辑应恢复文本域与格式工具栏');
    assert.equal(noteAudit.boldedText, '**hello**', '格式按钮应在光标选区上写入 Markdown');
    assert.equal(noteAudit.strandsState.exists, true, '#recording-strands 画布必须回到录音磁贴');
    assert.equal(noteAudit.strandsState.parentId, 'home-recorder', '波形画布必须是录音磁贴的直接子元素');
    assert.notEqual(noteAudit.strandsState.display, 'none', '波形画布不得再被 CSS 永久隐藏');

    // 待办视角化重设计：自然语言日期解析与视图归属（今天/已排期/收件箱/已完成）
    const todoViewAudit = await window.webContents.executeJavaScript(`
      (() => {
        const now = new Date();
        const parsed = window.SlateDomain.parseQuickTodoDate('周五 20:00 交稿', now);
        const date = parsed.deadline ? new Date(parsed.deadline) : null;
        const noDate = window.SlateDomain.parseQuickTodoDate('随手记一条', now);
        const views = {
          inboxItem: { id: 'a', text: 'a', done: false, deadline: '' },
          todayItem: { id: 'b', text: 'b', done: false, deadline: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0).toISOString() },
          overdueItem: { id: 'c', text: 'c', done: false, deadline: new Date(now.getTime() - 3600000).toISOString() },
          upcomingItem: { id: 'd', text: 'd', done: false, deadline: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 9, 0).toISOString() },
          pinnedItem: { id: 'e', text: 'e', done: false, deadline: '', pinnedToday: true },
          doneItem: { id: 'f', text: 'f', done: true },
        };
        const belongs = (item, view) => window.SlateDomain.todoBelongsToView(item, view, now);
        return {
          parsedTextOk: parsed.text === '交稿',
          parsedIsFriday: date ? date.getDay() === 5 : false,
          parsedTimeOk: date ? date.getHours() === 20 && date.getMinutes() === 0 : false,
          noDateEmpty: noDate.deadline === '' && noDate.text === '随手记一条',
          inboxInInbox: belongs(views.inboxItem, 'inbox') && !belongs(views.inboxItem, 'today'),
          todayInToday: belongs(views.todayItem, 'today'),
          overdueInToday: belongs(views.overdueItem, 'today'),
          upcomingInUpcoming: belongs(views.upcomingItem, 'upcoming') && !belongs(views.upcomingItem, 'today'),
          pinnedInToday: belongs(views.pinnedItem, 'today') && belongs(views.pinnedItem, 'inbox') === false,
          doneOnlyInDone: belongs(views.doneItem, 'done') && !belongs(views.doneItem, 'today'),
        };
      })()
    `);
    assert.equal(todoViewAudit.parsedTextOk, true, '「周五 20:00 交稿」应把日期词从正文剥离');
    assert.equal(todoViewAudit.parsedIsFriday, true, '周X 应解析到下一个周五');
    assert.equal(todoViewAudit.parsedTimeOk, true, '20:00 应解析为 20 点 0 分');
    assert.equal(todoViewAudit.noDateEmpty, true, '无日期词时不得虚构截止时间');
    assert.equal(todoViewAudit.inboxInInbox, true, '无日期待办应落在收件箱');
    assert.equal(todoViewAudit.todayInToday, true, '今天到期的应落在今天');
    assert.equal(todoViewAudit.overdueInToday, true, '过期待办应留在今天视图置顶处理');
    assert.equal(todoViewAudit.upcomingInUpcoming, true, '未来日期应落在已排期');
    assert.equal(todoViewAudit.pinnedInToday, true, '手动加入今天的事项应出现在今天视图');
    assert.equal(todoViewAudit.doneOnlyInDone, true, '已完成只出现在已完成视图');
    assert.equal(autoLayoutMotionAudit.rapidGhostsAfter, 0, '连续切换结束后不得残留 Auto Layout ghost');
  } finally {
    if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach();
    window.destroy();
  }
}

main().then(
  () => { diagnostic('Renderer interaction checks passed'); app.quit(); },
  (error) => {
    diagnostic(error.stack);
    app.exit(1);
  }
);
