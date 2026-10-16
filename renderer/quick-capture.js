(() => {
  const api = window.quickCaptureAPI;
  const $ = id => document.getElementById(`quick-${id}`);
  const text = $('text');
  let busy = '', original = '', ready = false, rereadArmed = false;
  const saved = new Map();
  function feedback(value) { $('feedback').textContent = value; }
  function update() {
    $('count').textContent = `${text.value.length.toLocaleString()} / 6,000`;
    text.readOnly = Boolean(busy);
    text.disabled = !ready;
    for (const action of ['translate', 'note', 'todo']) {
      $(action).disabled = !ready || Boolean(busy) || !text.value.trim() || saved.get(action) === text.value;
    }
    $('reread').disabled = Boolean(busy);
    $('close').disabled = ['note', 'todo', 'setup'].includes(busy);
    $('setup').disabled = Boolean(busy);
    $('copy').disabled = Boolean(busy) || !$('result').value;
    $('cancel').hidden = busy !== 'translate';
  }
  function accept(value) {
    text.value = typeof value === 'string' ? value : '';
    original = text.value;
    saved.clear();
    rereadArmed = false;
    $('result').value = '';
    $('result-section').hidden = true;
    $('setup').hidden = true;
    feedback(text.value.length > 6000 ? '原文已完整保留；每次最多处理 6000 字符，请缩短后再试。' : text.value.trim() ? '选择一种处理方式；系统剪贴板保持原样。' : '剪贴板没有文字，也可以直接在上方输入。');
    update();
  }
  async function read(initial = false) {
    if (busy) return;
    if (!initial && (text.value !== original || $('result').value) && !rereadArmed) {
      rereadArmed = true;
      feedback('再次点击「重新读取剪贴板」将替换当前文字和译文。');
      return;
    }
    busy = 'read'; update();
    try {
      const result = await api.read();
      if (!result.ok) throw new Error(result.error);
      document.documentElement.dataset.theme = result.theme === 'dark' ? 'dark' : 'light';
      $('shortcut').textContent = result.shortcut ? result.shortcut.replace(/Control/g, 'Ctrl').replace(/Command/g, '⌘') : '托盘 → 处理剪贴板';
      ready = true;
      accept(result.text);
      if (result.shortcut && !result.registered) feedback('全局快捷键被占用，可在设置中更换；仍可直接处理当前文字。');
    } catch (error) { ready = true; feedback('无法读取剪贴板，请重试或直接输入文字。'); }
    finally { busy = ''; update(); text.focus(); }
  }
  async function perform(action) {
    if (busy || !text.value.trim() || saved.get(action) === text.value) return;
    if (text.value.length > 6000) return feedback('每次最多处理 6000 字符，原文未截断，请缩短后再试。');
    const source = text.value;
    busy = action; rereadArmed = false; update();
    feedback(action === 'translate' ? '正在本地翻译，首次加载模型可能较慢…' : '正在保存…');
    try {
      if (action === 'translate') {
        const state = await api.status();
        if (!state.ok) throw new Error(state.error);
        if (!state.installed) { $('setup').hidden = false; throw new Error('首次需准备离线模型；准备后即可在本机翻译。'); }
        if (state.busy) throw new Error('已有翻译任务正在运行，请稍后再试。');
        $('setup').hidden = true;
      }
      const result = await api.perform({ action, text: source, source: 'auto' });
      if (!result.ok) throw new Error(result.error || '处理未完成，请重试。');
      if (action === 'translate') {
        $('result').value = result.text || '';
        $('result-section').hidden = false;
        feedback('翻译完成 · 文字仅在本机处理');
      } else {
        saved.set(action, source);
        feedback(action === 'note' ? '已存入笔记库，完整原文已保留。' : '已加入今日待办，完整原文保存在任务详情。');
      }
    } catch (error) { feedback(error.message || '处理未完成，原文仍在，请重试。'); }
    finally { busy = ''; update(); }
  }
  function close() {
    if (['note', 'todo', 'setup'].includes(busy)) return feedback('正在等待保存确认，请稍候…');
    api.close().catch(() => feedback('关闭失败，请重试。'));
  }
  text.addEventListener('input', () => {
    saved.clear(); rereadArmed = false;
    $('result').value = ''; $('result-section').hidden = true;
    feedback(text.value.length > 6000 ? '每次最多处理 6000 字符，原文已完整保留。' : '');
    update();
  });
  for (const action of ['translate', 'note', 'todo']) $(action).addEventListener('click', () => perform(action));
  $('reread').addEventListener('click', () => read());
  $('close').addEventListener('click', close);
  $('copy').addEventListener('click', async () => {
    try { const result = await api.copy($('result').value); feedback(result.ok ? '已复制译文。' : '复制失败，请重试。'); }
    catch (error) { feedback('复制失败，请重试。'); }
  });
  $('cancel').addEventListener('click', async () => {
    try { const result = await api.cancel(); if (!result.ok) feedback(result.error); }
    catch (error) { feedback('取消未完成，请重试。'); }
  });
  $('setup').addEventListener('click', async () => {
    if (busy) return;
    if (text.value.length > 6000) return feedback('请先将原文缩短到 6000 字符以内，再准备翻译。');
    busy = 'setup'; update();
    try { const result = await api.openSettings(text.value); if (!result.ok) throw new Error(result.error); }
    catch (error) { feedback(error.message || '无法打开设置，原文仍在。'); }
    finally { busy = ''; update(); }
  });
  api.onEscape(close);
  api.onClipboard(payload => {
    if (busy || text.value !== original || $('result').value || saved.size) {
      feedback('当前文字已保留；要处理新内容，请点击「重新读取剪贴板」。');
    } else accept(payload?.text);
  });
  api.onEvent(event => {
    if (busy !== 'translate') return;
    if (event.type === 'segment') feedback(`正在本地翻译 ${event.completed}/${event.total} 段…`);
    else if (event.type === 'progress') feedback('正在本地加载模型…');
  });
  update();
  void read(true);
})();
