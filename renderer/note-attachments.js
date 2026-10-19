(() => {
  'use strict';
  const MAX_IMAGES = 8, MAX_BYTES = 10 * 1024 * 1024;
  const api = window.slateAPI || {};
  const panels = new Set(), boundHosts = new WeakSet(), operations = new Set();
  let viewer = null, viewerUrl = '', viewerToken = 0, viewerOpener = null;
  const adapter = () => window.SlateNotesImages;
  const target = kind => adapter()?.getTarget(kind) || null;
  const images = value => Array.isArray(value?.attachments) ? value.attachments : [];
  const targetId = value => value ? String(value.id || '') : null;
  const operationKey = (kind, value) => `${kind}:${targetId(value)}`;
  const succeeded = result => result === true || result?.ok === true;
  const failure = (result, fallback) => typeof result?.error === 'string' ? result.error : fallback;

  function message(panel, text = '', error = false) {
    if (!panel?.isConnected) return;
    const status = panel.querySelector('.note-image-status');
    status.textContent = text; status.dataset.error = String(error);
  }
  function revokePanel(panel) {
    panel.paintToken = (panel.paintToken || 0) + 1;
    for (const url of panel.imageUrls || []) URL.revokeObjectURL(url);
    panel.imageUrls = [];
    if (!panel.isConnected) panels.delete(panel);
  }
  function blobUrl(result) {
    if (!result?.ok || !result.data) throw new Error(result?.error || '图片读取失败，请重试');
    return URL.createObjectURL(new Blob([result.data], { type: result.mime || 'image/png' }));
  }
  function currentPanel(kind) { return [...panels].find(panel => panel.isConnected && panel.dataset.noteKind === kind); }
  function setBusy(kind, snapshot, value) {
    const key = operationKey(kind, snapshot);
    if (value) operations.add(key); else operations.delete(key);
    for (const panel of panels) if (panel.dataset.noteKind === kind && targetId(target(kind)) === targetId(snapshot)) updateControls(panel);
  }
  function updateControls(panel) {
    const value = target(panel.dataset.noteKind), busy = operations.has(operationKey(panel.dataset.noteKind, value));
    panel.setAttribute('aria-busy', String(busy));
    for (const button of panel.querySelectorAll('button')) button.disabled = busy;
    panel.querySelector('.note-image-add').disabled = busy || !value || images(value).length >= MAX_IMAGES;
  }
  function unchanged(kind, snapshot) { return targetId(target(kind)) === targetId(snapshot); }
  async function persistAdded(kind, snapshot, additions, panel, importError = '') {
    if (!unchanged(kind, snapshot)) { message(currentPanel(kind), '笔记已切换，请在原笔记重新添加图片', true); return false; }
    const current = target(kind);
    if (!current) { message(panel, '笔记已删除，图片未添加', true); return false; }
    const room = Math.max(0, MAX_IMAGES - images(current).length), selected = additions.slice(0, room);
    if (!selected.length) { message(panel, importError || '每篇笔记最多添加 8 张图片', true); return false; }
    const result = await adapter().add(kind, selected, targetId(snapshot));
    if (!succeeded(result)) { message(currentPanel(kind) || panel, failure(result, '图片未保存，正文与已有图片保留，请重试'), true); return false; }
    mount();
    const active = currentPanel(kind) || panel;
    const warning = [importError, additions.length > room ? '超出 8 张的图片未添加' : ''].filter(Boolean).join('；');
    message(active, warning ? `已添加 ${selected.length} 张；${warning}` : `已添加 ${selected.length} 张图片`, Boolean(warning));
    return true;
  }
  async function chooseImages(kind, panel) {
    const snapshot = target(kind);
    if (!snapshot || operations.has(operationKey(kind, snapshot))) return;
    if (!api.taskAttachmentChoose || !adapter()?.add) { message(panel, '图片功能暂不可用，请重启 Slate', true); return; }
    setBusy(kind, snapshot, true); message(panel, '正在选择图片…');
    try {
      const result = await api.taskAttachmentChoose();
      if (result?.canceled) { message(currentPanel(kind) || panel); return; }
      if (result?.attachments?.length) await persistAdded(kind, snapshot, result.attachments, panel, result.error || '');
      else message(currentPanel(kind) || panel, result?.error || '没有添加图片', !result?.ok);
    } catch (_) { message(currentPanel(kind) || panel, '添加失败，请重试，原有内容保留', true); }
    finally { setBusy(kind, snapshot, false); }
  }
  async function importFiles(kind, input, panel) {
    const snapshot = target(kind);
    if (!snapshot || operations.has(operationKey(kind, snapshot))) return false;
    if (!api.taskAttachmentImport || !adapter()?.add) { message(panel, '图片功能暂不可用，请重启 Slate', true); return false; }
    const files = Array.from(input), remaining = MAX_IMAGES - images(snapshot).length;
    if (remaining <= 0) { message(panel, '每篇笔记最多添加 8 张图片', true); return false; }
    const additions = [], errors = [];
    setBusy(kind, snapshot, true); message(panel, '正在保存图片…');
    try {
      for (const file of files.slice(0, remaining)) {
        if (!file.size || file.size > MAX_BYTES) { errors.push('每张图片需小于 10 MB'); continue; }
        try {
          const result = await api.taskAttachmentImport({ bytes: new Uint8Array(await file.arrayBuffer()), name: file.name || '粘贴的图片.png' });
          if (result?.ok && result.attachment) additions.push(result.attachment);
          else errors.push(result?.error || '图片添加失败');
        } catch (_) { errors.push('有图片读取失败'); }
      }
      if (files.length > remaining) errors.push('每篇笔记最多 8 张图片');
      const warning = [...new Set(errors)].join('；');
      if (additions.length) return await persistAdded(kind, snapshot, additions, panel, warning);
      message(currentPanel(kind) || panel, warning || '请选择图片文件', true); return false;
    } catch (_) { message(currentPanel(kind) || panel, '图片未保存，原有内容保留，请重试', true); return false; }
    finally { setBusy(kind, snapshot, false); }
  }
  async function removeImage(panel, item) {
    const kind = panel.dataset.noteKind, snapshot = target(kind);
    if (!snapshot || operations.has(operationKey(kind, snapshot))) return;
    setBusy(kind, snapshot, true);
    try {
      const result = await adapter()?.remove(kind, item.id, targetId(snapshot));
      if (!succeeded(result)) { message(currentPanel(kind) || panel, failure(result, '移除失败，图片仍保留，请重试'), true); return; }
      mount();
      const active = currentPanel(kind) || panel;
      active.undoImage = { item, id: targetId(target(kind)) };
      active.querySelector('.note-image-undo').hidden = false;
      message(active, '已移除图片');
    } catch (_) { message(currentPanel(kind) || panel, '移除失败，图片仍保留，请重试', true); }
    finally { setBusy(kind, target(kind) || snapshot, false); }
  }
  async function undoRemoval(panel) {
    const undo = panel.undoImage, kind = panel.dataset.noteKind, snapshot = target(kind);
    if (!undo || !snapshot || undo.id !== targetId(snapshot) || operations.has(operationKey(kind, snapshot))) return;
    setBusy(kind, snapshot, true);
    try {
      const result = await adapter().add(kind, [undo.item], undo.id);
      if (!succeeded(result)) { message(panel, failure(result, '恢复失败，请重试'), true); return; }
      panel.undoImage = null; panel.querySelector('.note-image-undo').hidden = true;
      mount(); message(currentPanel(kind), '图片已恢复');
    } catch (_) { message(panel, '恢复失败，请重试', true); }
    finally { setBusy(kind, snapshot, false); }
  }
  function paint(panel) {
    const value = target(panel.dataset.noteKind), items = images(value);
    const signature = JSON.stringify([targetId(value), items]);
    updateControls(panel);
    if (signature === panel.signature) return;
    const targetChanged = panel.noteId !== targetId(value);
    panel.signature = signature; panel.noteId = targetId(value);
    if (targetChanged) {
      panel.undoImage = null; panel.querySelector('.note-image-undo').hidden = true; message(panel);
    }
    revokePanel(panel);
    const token = panel.paintToken, list = panel.querySelector('.note-image-list'); list.replaceChildren();
    panel.classList.toggle('has-images', items.length > 0);
    panel.querySelector('.note-image-count').textContent = items.length ? `${items.length} / ${MAX_IMAGES}` : '';
    for (const item of items) {
      const figure = document.createElement('figure'); figure.className = 'note-image-item';
      const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'note-image-preview';
      preview.setAttribute('aria-label', `放大查看：${item.name}`); preview.title = item.name;
      const loading = document.createElement('span'); loading.textContent = '加载中…'; preview.append(loading);
      preview.addEventListener('click', () => openViewer(item, preview));
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'note-image-remove';
      remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>'; remove.title='移除图片';remove.setAttribute('aria-label', `移除图片：${item.name}`);
      remove.addEventListener('click', () => removeImage(panel, item));
      figure.append(preview, remove); list.append(figure);
      if (!api.taskAttachmentRead) { loading.textContent = '暂不可用'; continue; }
      api.taskAttachmentRead(item, { thumbnail: true }).then(result => {
        if (!panel.isConnected || panel.paintToken !== token) return;
        try {
          const url = blobUrl(result); panel.imageUrls.push(url);
          const image = document.createElement('img'); image.src = url; image.alt = item.name; image.draggable = false;
          image.onerror = () => { if (panel.paintToken === token) { loading.textContent = '点击查看原因'; preview.replaceChildren(loading); } };
          preview.replaceChildren(image);
        } catch (_) { loading.textContent = '点击查看原因'; }
      }).catch(() => { if (panel.isConnected && panel.paintToken === token) loading.textContent = '读取失败'; });
    }
    updateControls(panel);
  }
  function bindHost(host, kind) {
    if (boundHosts.has(host)) return; boundHosts.add(host);
    host.addEventListener('paste', event => {
      const files = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'));
      if (!files.length || !target(kind)) return;
      // If a clipboard item contains both image and text, leave native text
      // insertion intact. A picture must never silently erase pasted wording.
      if (!event.clipboardData?.getData('text/plain')) event.preventDefault();
      event.stopPropagation(); void importFiles(kind, files, currentPanel(kind));
    });
    host.addEventListener('dragover', event => {
      if (!Array.from(event.dataTransfer?.types || []).includes('Files') || !target(kind)) return;
      event.preventDefault(); currentPanel(kind)?.classList.add('is-dragging');
    });
    host.addEventListener('dragleave', event => { if (!host.contains(event.relatedTarget)) currentPanel(kind)?.classList.remove('is-dragging'); });
    host.addEventListener('drop', event => {
      const files = Array.from(event.dataTransfer?.files || []); if (!files.length || !target(kind)) return;
      event.preventDefault(); event.stopPropagation();
      const panel = currentPanel(kind); panel?.classList.remove('is-dragging');
      const selected = files.filter(file => file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name));
      if (!selected.length) { message(panel, '请选择图片文件', true); return; }
      void importFiles(kind, selected, panel);
    });
  }
  function mount() {
    for (const panel of panels) if (!panel.isConnected) revokePanel(panel);
    for (const [kind, host] of [['home', document.querySelector('.home-note')], ['library', document.getElementById('notes-detail')]]) {
      if (!host) continue;
      bindHost(host, kind);
      const value = target(kind);
      if (!value || (kind === 'library' && !host.querySelector('#notes-editor[data-note-id]'))) {
        const obsolete = host.querySelector('.note-images'); if (obsolete) { obsolete.remove(); revokePanel(obsolete); }
        continue;
      }
      let panel = host.querySelector('.note-images');
      if (!panel) {
        panel = document.createElement('section'); panel.className = 'note-images'; panel.dataset.noteKind = kind;
        panel.setAttribute('aria-label', kind === 'home' ? '随手笔记图片' : '笔记图片');
        panel.innerHTML = '<div class="note-image-toolbar"><span class="note-image-count"></span><span class="note-image-hint">可粘贴或拖入图片</span><button type="button" class="note-image-add">添加图片</button></div><div class="note-image-list"></div><div class="note-image-feedback"><span class="note-image-status" role="status" aria-live="polite"></span><button type="button" class="note-image-undo" hidden>撤销移除</button></div>';
        host.append(panel); panels.add(panel);
        panel.querySelector('.note-image-add').addEventListener('click', () => chooseImages(kind, panel));
        panel.querySelector('.note-image-undo').addEventListener('click', () => undoRemoval(panel));
      }
      paint(panel);
    }
  }
  function closeViewer() {
    ++viewerToken;
    if (viewer?.open) viewer.close();
    if (viewerUrl) URL.revokeObjectURL(viewerUrl); viewerUrl = '';
    viewer?.querySelector('img')?.removeAttribute('src');
    if (viewerOpener?.isConnected) viewerOpener.focus({ preventScroll: true }); viewerOpener = null;
  }
  function createViewer() {
    if (viewer) return;
    viewer = document.createElement('dialog'); viewer.className = 'note-image-viewer'; viewer.setAttribute('aria-label', '查看笔记图片');
    viewer.innerHTML = '<div class="note-image-viewer-toolbar"><strong class="note-image-viewer-name"></strong><span class="note-image-viewer-size"></span><button type="button" data-note-image-fit aria-pressed="false">原始尺寸</button><button type="button" data-note-image-close>关闭</button></div><p class="note-image-viewer-status" role="status"></p><div class="note-image-viewer-canvas"><img alt="" /></div>';
    document.body.append(viewer);
    viewer.querySelector('[data-note-image-close]').addEventListener('click', closeViewer);
    viewer.querySelector('[data-note-image-fit]').addEventListener('click', () => {
      const original = viewer.classList.toggle('is-original'), button = viewer.querySelector('[data-note-image-fit]');
      button.textContent = original ? '适应窗口' : '原始尺寸'; button.setAttribute('aria-pressed', String(original));
    });
    viewer.addEventListener('cancel', event => { event.preventDefault(); closeViewer(); });
    viewer.addEventListener('click', event => { if (event.target === viewer) closeViewer(); });
    document.addEventListener('keydown', event => { if (viewer.open && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeViewer(); } }, true);
  }
  async function openViewer(item, opener) {
    createViewer(); closeViewer(); viewerOpener = opener; const token = ++viewerToken;
    viewer.classList.remove('is-original'); viewer.querySelector('[data-note-image-fit]').textContent = '原始尺寸';
    viewer.querySelector('[data-note-image-fit]').setAttribute('aria-pressed', 'false');
    viewer.querySelector('.note-image-viewer-name').textContent = item.name;
    viewer.querySelector('.note-image-viewer-size').textContent = `${item.width} × ${item.height}`;
    const status = viewer.querySelector('.note-image-viewer-status'); status.textContent = '正在加载原图…'; viewer.showModal();
    try {
      const result = await api.taskAttachmentRead(item);
      if (!viewer.open || token !== viewerToken) return;
      viewerUrl = blobUrl(result); const image = viewer.querySelector('img'); image.src = viewerUrl; image.alt = item.name;
      image.onload = () => { if (token === viewerToken) status.textContent = ''; };
      image.onerror = () => { if (token === viewerToken) status.textContent = '图片无法显示，请重新添加'; };
    } catch (_) { if (token === viewerToken) status.textContent = '图片读取失败，请检查原文件或重新添加'; }
  }
  for (const event of ['slate:notes-changed', 'slate:note-selection', 'slate:workspace-reloaded', 'slate:tabchange']) document.addEventListener(event, mount);
  document.addEventListener('slate:modechange', event => { if (event.detail?.expanded === false) closeViewer(); });
  window.addEventListener('beforeunload', () => { for (const panel of panels) revokePanel(panel); closeViewer(); });
  window.SlateNoteAttachments = Object.freeze({ mount, importFiles, closeViewer });
  mount();
})();
