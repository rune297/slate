(() => {
  const panel = document.getElementById('global-capture');
  const text = document.getElementById('capture-text');
  const feedback = document.getElementById('capture-feedback');
  const trigger = document.getElementById('global-capture-open');
  const buttons = ['task', 'note', 'translate'].map(kind => document.getElementById(`capture-${kind}`));
  if (!panel || !text || !feedback) return;
  let busy = false;
  let generation = 0;
  const saved = new Map();
  function updateButtons() {
    buttons.forEach((button, index) => {
      button.disabled = busy || !text.value.trim() || saved.get(index) === text.value;
    });
  }
  function close(focus = true) {
    if (busy) return;
    generation += 1;
    panel.hidden = true;
    text.readOnly = false;
    if (focus) trigger?.focus();
  }
  async function open(value) {
    if (busy) return false;
    openGlobalSearch();
    const current = ++generation;
    panel.hidden = false;
    text.value = '';
    text.readOnly = true;
    saved.clear();
    feedback.textContent = '正在读取文字…';
    updateButtons();
    try {
      const original = value === undefined ? await window.slateAPI.translationClipboard() : String(value);
      if (current !== generation) return false;
      if (original.length > 6000) {
        feedback.textContent = '文字超过 6000 字符，请复制较短的一段再处理；原文未被截断或保存。';
        return false;
      }
      text.value = original;
      feedback.textContent = original.trim() ? '只在你选择后处理，不会修改系统剪贴板。' : '剪贴板没有文字，可以直接在上方输入。';
      updateButtons();
      text.focus();
      return true;
    } catch (error) {
      feedback.textContent = '未能读取剪贴板，请重试或直接输入文字。';
      return false;
    } finally { if (current === generation) text.readOnly = false; }
  }
  async function act(kind, index) {
    if (busy || !text.value.trim()) return;
    const original = text.value;
    if (original.length > 6000) { feedback.textContent = '最多处理 6000 字符，请缩短后再试。'; return; }
    busy = true;
    text.readOnly = true;
    updateButtons();
    try {
      let ok = false;
      if (kind === 'task') {
        const firstLine = original.split(/\r?\n/).find(line => line.trim()) || original;
        const title = Array.from(firstLine.trim()).slice(0, 80).join('');
        ok = window.SlateTasks.add(title, { period: 'day', notes: original });
      } else if (kind === 'note') {
        ok = window.SlateWorkNotes.capture(original);
      } else {
        ok = await window.SlateTranslation.capture(original);
      }
      if (!ok) {
        feedback.textContent = kind === 'translate' ? '未能接入翻译；如已有翻译正在进行，请等待完成或取消后重试。' : '未能保存，原文仍在。请检查存储空间后重试。';
        return;
      }
      if (kind === 'translate') {
        busy = false;
        closeGlobalSearch();
        return;
      }
      saved.set(index, original);
      feedback.textContent = kind === 'task' ? '已加入待办，完整原文保存在任务详情。' : '已存入笔记库，首页正在写的笔记保持原样。';
    } catch (error) { feedback.textContent = '处理未完成，原文仍在，请重试。'; }
    finally { busy = false; text.readOnly = false; updateButtons(); }
  }
  trigger?.addEventListener('click', () => open());
  document.getElementById('capture-close')?.addEventListener('click', () => close());
  text.addEventListener('input', () => { feedback.textContent = ''; updateButtons(); });
  buttons.forEach((button, index) => button?.addEventListener('click', () => act(['task', 'note', 'translate'][index], index)));
  panel.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const items = [...panel.querySelectorAll('button:not(:disabled),textarea')].filter(element => !element.hidden);
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  window.SlateCapture = { open, close };
  updateButtons();
})();

// All writes from the temporary window go through the existing, hydrated
// workspace. They do not switch tabs, replace a note draft, or expand Slate.
window.slateAPI?.onQuickCaptureRequest?.(async request => {
  if (!request || typeof request.id !== 'string') return;
  let result = { ok: false, error: '不支持的文字操作' };
  try {
    if (request.action === 'context') {
      result = { ok: true, theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light' };
    } else if (workspaceHydrating || workspaceReloadPending) {
      result = { ok: false, error: '数据正在恢复，请稍后重试，原文仍在小窗。' };
    } else if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 6000) {
      result = { ok: false, error: '请输入 1–6000 个字符，原文未截断。' };
    } else if (request.action === 'prepare') {
      result = await window.SlateTranslation.stage(request.text);
    } else if (request.action === 'note' || request.action === 'todo') {
      const original = request.text;
      const firstLine = original.split(/\r?\n/).find(line => line.trim()) || original;
      const ok = request.action === 'note'
        ? window.SlateWorkNotes.capture(original)
        : window.SlateTasks.add(Array.from(firstLine.trim()).slice(0, 80).join(''), { period: 'day', notes: original, preserveDrafts: true });
      result = { ok: Boolean(ok), ...(!ok ? { error: '未能保存，请检查存储空间后重试；原文仍在小窗。' } : {}) };
    }
  } catch (error) { result = { ok: false, error: '处理未完成，原文仍在小窗，请重试。' }; }
  window.slateAPI.replyQuickCapture({ id: request.id, ...result });
});

window.slateAPI?.onOpenTranslationSettings?.(async () => {
  if (!isExpanded) await setMode(true);
  await setActiveTab('settings');
  window.SlateSettingsNavigation?.activate('translation');
  const setup = document.getElementById('translation-setup');
  setup?.scrollIntoView({ block: 'center' });
  document.getElementById('translation-install')?.focus({ preventScroll: true });
});

(() => {
  const api = window.slateAPI;
  function render(settings) {
    const value = document.getElementById('settings-capture-shortcut-value');
    const status = document.getElementById('settings-capture-shortcut-status');
    if (value) value.textContent = settings.captureShortcut || '未设置';
    if (status) status.textContent = settings.captureShortcut && !settings.captureShortcutRegistered
      ? '快捷键被占用，请重新设置；仍可从托盘打开'
      : '复制文字后呼出小窗：翻译、笔记、待办';
  }
  api?.getAppSettings?.().then(render).catch(() => {});
  api?.onAppSettingsChanged?.(render);
  document.getElementById('settings-capture-shortcut-change')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('slate:record-shortcut', { detail: { target: 'capture' } }));
  });
  document.getElementById('settings-capture-shortcut-clear')?.addEventListener('click', async () => {
    try {
      const result = await api.setCaptureShortcut('');
      showStatusToast(result.ok ? '已清除文字处理快捷键，仍可从托盘打开' : '未能清除快捷键，请重试');
    } catch (error) { showStatusToast('未能清除快捷键，请重试'); }
  });
})();
