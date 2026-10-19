(function initWorkspace() {
  const Domain = window.SlateDomain;
  if (!Domain) return;

  const COMMANDS_KEY = 'slate-home-commands';
  const LINKS_KEY = 'slate-link-groups';
  const RECORDINGS_KEY = 'slate-recordings';
  const RECORDING_DELETIONS_KEY = 'slate-recording-deletions';
  const HIDDEN_WINDOWS_KEY = 'slate-hidden-windows';

  const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
  const DELETE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12"/></svg>';
  const ADD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const EDIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10zM13.8 6.7l3.5 3.5"/></svg>';
  const OPEN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8"/><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';

  function uid(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function loadJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key));
      return parsed == null ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function formatClock(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function formatShortDate(timestamp) {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  }

  // ============ 常用指令 ============
  const commandInput = document.getElementById('command-add');
  const commandList = document.getElementById('command-list');
  const commandBulkDelete = document.getElementById('command-bulk-delete');
  let commands = loadJson(COMMANDS_KEY, [])
    .map((item) => Domain.createCommand(item && item.text, item && item.id, item && item.createdAt))
    .filter(Boolean);
  let commandSelection = new Set();
  let commandSelectionAnchor = null;

  function persistCommands() {
    saveJson(COMMANDS_KEY, commands);
  }

  function renderCommands() {
    if (!commandList) return;
    commandList.replaceChildren();
    if (commandBulkDelete) {
      commandBulkDelete.hidden = commandSelection.size === 0;
      commandBulkDelete.textContent = '删除';
      commandBulkDelete.setAttribute('aria-label', commandSelection.size
        ? `删除 ${commandSelection.size} 项`
        : '删除所选');
    }
    if (!commands.length) {
      const empty = document.createElement('button');
      empty.type = 'button';
      empty.className = 'command-empty';
      empty.textContent = '添加第一条常用片段';
      empty.addEventListener('click', () => window.SlateSnippets?.edit ? window.SlateSnippets.edit() : commandInput?.focus({ preventScroll: true }));
      commandList.appendChild(empty);
      return;
    }
    commands.forEach((command) => {
      const row = document.createElement('div');
      row.className = `command-item${commandSelection.has(command.id) ? ' multi-selected' : ''}`;
      row.dataset.id = command.id;

      const textButton = document.createElement('button');
      textButton.className = 'command-text';
      textButton.type = 'button';
      textButton.dataset.action = 'copy-command';
      textButton.title = '点击复制';
      textButton.textContent = command.text;

      const actions = document.createElement('div');
      actions.className = 'command-actions';
      const copy = document.createElement('button');
      copy.className = 'icon-button';
      copy.type = 'button';
      copy.dataset.action = 'copy-command';
      copy.setAttribute('aria-label', '复制片段');
      copy.innerHTML = COPY_ICON;
      const edit = document.createElement('button');
      edit.className = 'icon-button'; edit.type = 'button'; edit.dataset.action = 'edit-command';
      edit.setAttribute('aria-label', '编辑片段');
      edit.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m14 5 5 5M4 20l5-1L20 8a2.1 2.1 0 0 0-5-5L4 15z"/></svg>';
      const remove = document.createElement('button');
      remove.className = 'icon-button danger';
      remove.type = 'button';
      remove.dataset.action = 'delete-command';
      remove.setAttribute('aria-label', '删除片段');
      remove.innerHTML = DELETE_ICON;
      actions.append(edit, copy, remove);
      if(command.text.length>180||command.text.split('\n').length>5){const expand=document.createElement('button');expand.type='button';expand.className='snippet-expand';expand.textContent='展开全文';expand.setAttribute('aria-expanded','false');expand.onclick=()=>{const expanded=row.classList.toggle('snippet-expanded');expand.textContent=expanded?'收起':'展开全文';expand.setAttribute('aria-expanded',String(expanded));};actions.prepend(expand);}
      row.append(textButton, actions);
      commandList.appendChild(row);
    });
  }

  function editCommand(row) {
    const command = commands.find((item) => item.id === row.dataset.id);
    if(command&&window.SlateSnippets?.edit)return window.SlateSnippets.edit(command);
    if (!command || row.querySelector('input')) return;
    const button = row.querySelector('.command-text');
    const input = document.createElement('input');
    input.className = 'command-edit';
    input.value = command.text;
    button.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      const value = input.value.trim();
      if (save && value) command.text = value;
      persistCommands();
      renderCommands();
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) finish(true);
      if (event.key === 'Escape') finish(false);
    });
  }

  if (commandInput) {
    commandInput.addEventListener('keydown', (event) => {
      if(commandInput.tagName==='TEXTAREA')return;
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.repeat) return;
      event.preventDefault();
      const command = Domain.createCommand(commandInput.value, uid('command'), Date.now());
      if (!command) return;
      commands.unshift(command);
      commandInput.value = '';
      persistCommands();
      renderCommands();
    });
  }

  if (commandList) {
    commandList.addEventListener('click', async (event) => {
      const row = event.target.closest('.command-item');
      if (!row) return;
      const command = commands.find((item) => item.id === row.dataset.id);
      if (!command) return;
      if (event.shiftKey) {
        event.preventDefault();
        const result = Domain.updateRangeSelection(
          commands.map((item) => item.id),
          [...commandSelection],
          command.id,
          commandSelectionAnchor,
          true
        );
        commandSelection = new Set(result.selected);
        commandSelectionAnchor = result.anchor;
        renderCommands();
        return;
      }
      commandSelectionAnchor = command.id;
      const action = event.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'edit-command') editCommand(row);
      if (action.dataset.action === 'delete-command') {
        if(!saveJson(COMMANDS_KEY,commands.filter(item=>item.id!==command.id))){showStatusToast('片段删除失败，原内容保留，请重试');return;}
        commands = commands.filter((item) => item.id !== command.id);
        commandSelection.delete(command.id);
        persistCommands();
        renderCommands();
      }
      if (action.dataset.action === 'copy-command' && window.slateAPI) {
        const copied = await window.slateAPI.writeClipboard({ type: 'text', text: command.text });
        if (copied) {
          row.classList.add('copied');
          setTimeout(() => row.classList.remove('copied'), 700);
        }
      }
    });
  }
  commandBulkDelete?.addEventListener('click', () => {
    if (!commandSelection.size) return;
    if(!saveJson(COMMANDS_KEY,commands.filter(command=>!commandSelection.has(command.id)))){showStatusToast('片段删除失败，原内容保留，请重试');return;}
    commands = commands.filter((command) => !commandSelection.has(command.id));
    commandSelection.clear();
    commandSelectionAnchor = null;
    persistCommands();
    renderCommands();
  });

  // ============ 链接收藏夹 ============
  const linkInput = document.getElementById('link-add');
  const linkBulkDelete = document.getElementById('link-bulk-delete');
  const linkGroupsEl = document.getElementById('link-groups');
  let linkGroups = loadJson(LINKS_KEY, []);
  if (!Array.isArray(linkGroups)) linkGroups = [];
  let linkSelection = new Set();
  let linkSelectionAnchor = null;
  let addingLinkGroupId = '';

  function persistLinks() {
    saveJson(LINKS_KEY, linkGroups);
  }

  // 链接操作的反馈统一走全局 toast；此处保留单一入口，便于以后换成内联提示。
  function setLinksStatus(message) {
    if (message && typeof showStatusToast === 'function') showStatusToast(message);
  }

  function allLinks() {
    return linkGroups.flatMap((group) => Array.isArray(group.links) ? group.links : []);
  }

  function updateLinkBulkAction() {
    if (!linkBulkDelete) return;
    linkBulkDelete.hidden = linkSelection.size === 0;
    linkBulkDelete.textContent = '删除';
    linkBulkDelete.setAttribute('aria-label', linkSelection.size
      ? `删除 ${linkSelection.size} 项`
      : '删除所选');
  }

  function linkHostname(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (error) {
      return url;
    }
  }

  function createIconButton(action, label, icon, danger = false) {
    const button = document.createElement('button');
    button.className = `icon-button${danger ? ' danger' : ''}`;
    button.type = 'button';
    button.dataset.action = action;
    button.setAttribute('aria-label', label);
    button.innerHTML = icon;
    return button;
  }

  function renderLinkGroups() {
    if (!linkGroupsEl) return;
    linkGroupsEl.replaceChildren();
    updateLinkBulkAction();
    if (!linkGroups.length) {
      const empty = document.createElement('div');
      empty.className = 'links-empty';
      empty.innerHTML = '<strong>还没有链接</strong><span>粘贴一个网址，Slate 会读取标题并放进合适的分组。</span>';
      linkGroupsEl.appendChild(empty);
      return;
    }

    linkGroups.forEach((group) => {
      const section = document.createElement('section');
      section.className = `link-group${group.collapsed ? ' collapsed' : ''}`;
      section.dataset.groupId = group.id;

      const header = document.createElement('header');
      header.className = 'link-group-head';
      const toggle = document.createElement('button');
      toggle.className = 'group-toggle';
      toggle.type = 'button';
      toggle.dataset.action = 'toggle-group';
      toggle.setAttribute('aria-label', group.collapsed ? '展开分组' : '折叠分组');
      toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>';
      const name = document.createElement('input');
      name.className = 'group-name-input';
      name.value = String(group.name || '未命名分组');
      name.dataset.action = 'rename-group';
      name.setAttribute('aria-label', '分组名称');
      const count = document.createElement('span');
      count.className = 'group-count';
      count.textContent = `${Array.isArray(group.links) ? group.links.length : 0}`;
      header.append(toggle, name, count);
      header.appendChild(createIconButton('add-link-to-group', `在“${group.name || '当前分组'}”中新增链接`, ADD_ICON));
      header.appendChild(createIconButton('delete-group', '删除分组及其中所有链接', DELETE_ICON, true));

      const body = document.createElement('div');
      body.className = 'link-group-body';
      if (addingLinkGroupId === group.id) {
        const addRow = document.createElement('div');
        addRow.className = 'group-link-add';
        addRow.innerHTML = `<input data-group-link-input type="text" placeholder="粘贴网址并回车，添加到此分组" aria-label="添加链接到${String(group.name || '当前分组').replace(/[<>"&]/g, '')}" autocomplete="off" spellcheck="false"><button type="button" data-action="cancel-group-link-add" aria-label="取消">×</button>`;
        body.appendChild(addRow);
      }
      const list = document.createElement('div');
      list.className = 'link-list';
      (group.links || []).forEach((link) => {
        const row = document.createElement('article');
        row.className = `link-item${linkSelection.has(link.id) ? ' multi-selected' : ''}`;
        row.dataset.linkId = link.id;
        row.dataset.groupId = group.id;
        const mark = document.createElement('span');
        mark.className = 'link-favicon';
        if (link.icon && String(link.icon).startsWith('data:image/')) {
          const image = document.createElement('img');
          image.src = link.icon;
          image.alt = '';
          mark.appendChild(image);
        } else {
          mark.textContent = (linkHostname(link.url).charAt(0) || '·').toUpperCase();
        }
        const open = document.createElement('button');
        open.className = 'link-open';
        open.type = 'button';
        open.dataset.action = 'open-link';
        const title = document.createElement('strong');
        title.textContent = link.title || linkHostname(link.url);
        const domain = document.createElement('span');
        domain.textContent = linkHostname(link.url);
        open.append(title, domain);
        const actions = document.createElement('div');
        actions.className = 'link-actions';
        actions.append(
          createIconButton('open-link', '打开链接', OPEN_ICON),
          createIconButton('edit-link', '修改名称', EDIT_ICON),
          createIconButton('delete-link', '删除链接', DELETE_ICON, true)
        );
        row.append(mark, open, actions);
        list.appendChild(row);
      });

      body.append(list);
      section.append(header, body);
      linkGroupsEl.appendChild(section);
    });
  }

  function addLink(rawValue, requestedGroupId = '') {
    const normalized = Domain.normalizeHttpUrl(rawValue);
    if (!normalized) {
      setLinksStatus('请输入有效的公开网址');
      return false;
    }
    if (allLinks().some((link) => link.url === normalized)) {
      setLinksStatus('这个链接已经收藏过了');
      return false;
    }
    const link = { id: uid('link'), url: normalized, title: '未命名', icon: '', createdAt: Date.now() };
    const preferredGroupId = requestedGroupId || Domain.preferredLinkGroupId(linkGroups, normalized);
    const preferredGroup = linkGroups.find((group) => group.id === preferredGroupId);
    if (preferredGroup) {
      linkGroups = linkGroups.map((group) => group.id === preferredGroup.id
        ? { ...group, collapsed: false, links: [...(group.links || []), link] }
        : group);
    } else {
      linkGroups = Domain.addLinkToGroups(linkGroups, link, Domain.classifyLink(normalized, ''));
    }
    persistLinks();
    renderLinkGroups();
    setLinksStatus('链接已保存');

    // 保存动作不等待网络或大模型。标题、图标和分组在后台静默补全。
    Promise.resolve(window.slateAPI?.inspectLink?.(normalized)).then((inspected) => {
      if (!inspected?.ok) return;
      let sourceGroup = null;
      let savedLink = null;
      linkGroups.some((group) => {
        const found = (group.links || []).find((item) => item.id === link.id);
        if (!found) return false;
        sourceGroup = group;
        savedLink = found;
        return true;
      });
      if (!savedLink || !sourceGroup) return;
      savedLink.url = inspected.url || savedLink.url;
      savedLink.title = inspected.title || savedLink.title || '未命名';
      savedLink.icon = inspected.icon || savedLink.icon || '';
      // 手动定向或同站点复用后锁定分组；自动分类只使用可预测的本地规则，
      // 避免模型自由命名生成多个近义分组。
      const lockedGroupId = preferredGroup?.id || Domain.preferredLinkGroupId(
        linkGroups.map((group) => ({
          ...group,
          links: (group.links || []).filter((item) => item.id !== savedLink.id),
        })),
        savedLink.url
      );
      const nextCategory = Domain.classifyLink(savedLink.url, savedLink.title);
      if (!lockedGroupId && nextCategory && nextCategory !== sourceGroup.name) {
        const target = linkGroups.find((group) => group.name === nextCategory);
        if (target) {
          linkGroups = Domain.moveLinkToGroup(linkGroups, savedLink.id, target.id);
        } else {
          sourceGroup.links = sourceGroup.links.filter((item) => item.id !== savedLink.id);
          linkGroups = Domain.addLinkToGroups(linkGroups, savedLink, nextCategory);
        }
      }
      persistLinks();
      renderLinkGroups();
    }).catch(() => {});
    return true;
  }

  if (linkInput) {
    linkInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.repeat) return;
      event.preventDefault();
      const value = linkInput.value;
      if (addLink(value)) linkInput.value = '';
      linkInput.focus();
    });
  }

  function findLink(group, linkId) {
    return group && (group.links || []).find((link) => link.id === linkId);
  }

  if (linkGroupsEl) {
    linkGroupsEl.addEventListener('change', (event) => {
      const groupSection = event.target.closest('[data-group-id]');
      if (!groupSection) return;
      if (event.target.matches('.group-name-input')) {
        linkGroups = Domain.renameGroup(linkGroups, groupSection.dataset.groupId, event.target.value);
        persistLinks();
        renderLinkGroups();
      }
      if (event.target.matches('.link-title-edit')) {
        const row = event.target.closest('[data-link-id]');
        const group = linkGroups.find((item) => item.id === groupSection.dataset.groupId);
        const link = findLink(group, row && row.dataset.linkId);
        const value = event.target.value.trim();
        if (link && value) link.title = value;
        persistLinks();
        renderLinkGroups();
      }
    });

    linkGroupsEl.addEventListener('keydown', async (event) => {
      const groupSection = event.target.closest('[data-group-id]');
      if (!groupSection) return;
      if (event.target.matches('[data-group-link-input]')) {
        if (event.key === 'Escape') {
          addingLinkGroupId = '';
          renderLinkGroups();
        } else if (event.key === 'Enter' && !event.isComposing && !event.repeat) {
          event.preventDefault();
          if (addLink(event.target.value, groupSection.dataset.groupId)) {
            addingLinkGroupId = '';
            renderLinkGroups();
          }
        }
        return;
      }
      if (event.target.matches('.group-name-input') && event.key === 'Enter') {
        event.preventDefault();
        event.target.blur();
      }
      if (event.target.matches('.link-title-edit') && event.key === 'Enter') {
        event.preventDefault();
        event.target.blur();
      }
    });

    linkGroupsEl.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]');
      const groupSection = event.target.closest('[data-group-id]');
      if (!groupSection) return;
      const groupId = groupSection.dataset.groupId;
      const group = linkGroups.find((item) => item.id === groupId);
      const row = event.target.closest('[data-link-id]');
      const link = findLink(group, row && row.dataset.linkId);
      if (event.shiftKey && link) {
        event.preventDefault();
        const result = Domain.updateRangeSelection(
          allLinks().map((item) => item.id),
          [...linkSelection],
          link.id,
          linkSelectionAnchor,
          true
        );
        linkSelection = new Set(result.selected);
        linkSelectionAnchor = result.anchor;
        renderLinkGroups();
        return;
      }
      if (link) linkSelectionAnchor = link.id;
      if (!action) return;
      if (action.dataset.action === 'add-link-to-group') {
        addingLinkGroupId = groupId;
        group.collapsed = false;
        persistLinks();
        renderLinkGroups();
        requestAnimationFrame(() => linkGroupsEl.querySelector(
          `[data-group-id="${CSS.escape(groupId)}"] [data-group-link-input]`
        )?.focus());
      }
      if (action.dataset.action === 'cancel-group-link-add') {
        addingLinkGroupId = '';
        renderLinkGroups();
      }
      if (action.dataset.action === 'toggle-group') {
        group.collapsed = !group.collapsed;
        persistLinks();
        renderLinkGroups();
      }
      if (action.dataset.action === 'delete-group') {
        (group.links || []).forEach((item) => linkSelection.delete(item.id));
        linkGroups = linkGroups.filter((item) => item.id !== groupId);
        persistLinks();
        renderLinkGroups();
      }
      if (action.dataset.action === 'open-link' && link && window.slateAPI) {
        window.slateAPI.openExternal(link.url);
      }
      if (action.dataset.action === 'delete-link' && link) {
        group.links = group.links.filter((item) => item.id !== link.id);
        linkSelection.delete(link.id);
        persistLinks();
        renderLinkGroups();
      }
      if (action.dataset.action === 'edit-link' && link && row) {
        const openButton = row.querySelector('.link-open');
        const input = document.createElement('input');
        input.className = 'link-title-edit';
        input.value = link.title;
        openButton.replaceWith(input);
        input.focus();
        input.select();
      }
    });

    // ============ 链接长按拖拽：组内排序 + 跨组搬运 ============
    // 不用 HTML5 拖拽有两个原因：一是行中间那一大块是 <button class="link-open">，
    // Chromium 里从 button 上按下不会触发祖先的 dragstart，标题区域整块拖不动；
    // 二是原生拖拽一按就走，没法和「点击打开链接」区分。改成指针事件 + 长按门槛。
    const LINK_DRAG_HOLD_MS = 340;
    const LINK_DRAG_MOVE_CANCEL = 8;
    let linkDrag = null;
    let suppressLinkClick = false;

    function clearLinkDropMarks() {
      linkGroupsEl.querySelectorAll('.drop-before, .drop-after, .drop-target').forEach((item) => {
        item.classList.remove('drop-before', 'drop-after', 'drop-target');
      });
    }

    function cancelLinkDrag() {
      if (!linkDrag) return;
      clearTimeout(linkDrag.holdTimer);
      if (linkDrag.active) {
        linkDrag.row.classList.remove('dragging');
        linkGroupsEl.classList.remove('link-dragging');
        clearLinkDropMarks();
      }
      try { linkDrag.row.releasePointerCapture(linkDrag.pointerId); } catch (error) {}
      linkDrag = null;
    }

    // 落点有两种：压在某一行上就按该行中线决定插到它前面还是后面；
    // 压在分组的空白或标题上就追加到该组末尾（index 为 null）。
    function updateLinkDropTarget(clientX, clientY) {
      clearLinkDropMarks();
      linkDrag.target = null;
      const under = document.elementFromPoint(clientX, clientY);
      if (!under || !linkGroupsEl.contains(under)) return;
      const overRow = under.closest('.link-item[data-link-id]');
      // 压在被拖那一行自己身上 = 放回原处，目标留空，松手什么都不做。
      // 少了这一步，长按后原地松手会落到「自己所在的分组」上，被当成追加到组末尾。
      if (overRow === linkDrag.row) return;
      if (overRow) {
        const rect = overRow.getBoundingClientRect();
        const after = clientY > rect.top + rect.height / 2;
        overRow.classList.add(after ? 'drop-after' : 'drop-before');
        const rows = Array.from(overRow.parentElement.children)
          .filter((item) => item.dataset && item.dataset.linkId);
        linkDrag.target = {
          groupId: overRow.dataset.groupId,
          index: rows.indexOf(overRow) + (after ? 1 : 0),
        };
        return;
      }
      const overGroup = under.closest('.link-group[data-group-id]');
      if (!overGroup) return;
      overGroup.classList.add('drop-target');
      linkDrag.target = { groupId: overGroup.dataset.groupId, index: null };
    }

    function linkOrderFingerprint() {
      return linkGroups
        .map((group) => `${group.id}:${(group.links || []).map((link) => link.id).join(',')}`)
        .join('|');
    }

    linkGroupsEl.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const row = event.target.closest('.link-item[data-link-id]');
      // 编辑 / 删除按钮和标题输入框保持原有点击语义，不参与拖拽。
      if (!row || event.target.closest('input, .link-actions')) return;
      // 上一次拖拽后若没有等到那个补发的 click（比如在列表外松手），标志会留着，
      // 否则它会把下一次正常点击吞掉，链接就打不开了。
      suppressLinkClick = false;
      cancelLinkDrag();
      linkDrag = {
        row,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        target: null,
        holdTimer: setTimeout(() => {
          if (!linkDrag) return;
          linkDrag.active = true;
          row.classList.add('dragging');
          linkGroupsEl.classList.add('link-dragging');
          try { row.setPointerCapture(linkDrag.pointerId); } catch (error) {}
          updateLinkDropTarget(linkDrag.startX, linkDrag.startY);
          setLinksStatus('拖到目标位置后松手');
        }, LINK_DRAG_HOLD_MS),
      };
    });

    // 这三个挂在 document 上（与窗口拖拽同一套写法）：长按还没满就快速划出列表时，
    // 挂在 linkGroupsEl 上收不到 move / up，计时器随后仍会启动一次拖拽。
    document.addEventListener('pointermove', (event) => {
      if (!linkDrag || event.pointerId !== linkDrag.pointerId) return;
      if (!linkDrag.active) {
        // 长按还没满就移动，说明用户在滚动或只是手抖，放弃这次拖拽。
        const moved = Math.abs(event.clientX - linkDrag.startX) > LINK_DRAG_MOVE_CANCEL
          || Math.abs(event.clientY - linkDrag.startY) > LINK_DRAG_MOVE_CANCEL;
        if (moved) cancelLinkDrag();
        return;
      }
      event.preventDefault();
      updateLinkDropTarget(event.clientX, event.clientY);
    });

    document.addEventListener('pointerup', (event) => {
      if (!linkDrag || event.pointerId !== linkDrag.pointerId) return;
      const wasActive = linkDrag.active;
      const target = linkDrag.target;
      const linkId = linkDrag.row.dataset.linkId;
      cancelLinkDrag();
      if (!wasActive) return;
      // 拖拽结束后浏览器仍会补一个 click，必须拦掉，否则松手即打开链接。
      suppressLinkClick = true;
      if (!target) return;
      const before = linkOrderFingerprint();
      linkGroups = Domain.moveLinkToPosition(linkGroups, linkId, target.groupId, target.index);
      if (linkOrderFingerprint() === before) return;
      persistLinks();
      renderLinkGroups();
      setLinksStatus('链接顺序已更新');
    });

    document.addEventListener('pointercancel', () => cancelLinkDrag());

    linkGroupsEl.addEventListener('click', (event) => {
      if (!suppressLinkClick) return;
      suppressLinkClick = false;
      event.stopPropagation();
      event.preventDefault();
    }, true);
  }

  linkBulkDelete?.addEventListener('click', () => {
    if (!linkSelection.size) return;
    linkGroups = linkGroups.map((group) => ({
      ...group,
      links: (group.links || []).filter((link) => !linkSelection.has(link.id)),
    }));
    linkSelection.clear();
    linkSelectionAnchor = null;
    persistLinks();
    renderLinkGroups();
    setLinksStatus('已删除所选链接');
  });

  // ============ 录音与转写 ============
  const quickRecorder = document.getElementById('quick-recorder');
  const recordingDot = document.getElementById('home-recording-dot');
  const recordingStateLabel = document.getElementById('home-recording-state');
  const recordingTime = document.getElementById('home-recording-time');
  const recordStart = document.getElementById('record-start');
  const recordPause = document.getElementById('record-pause');
  const recordStop = document.getElementById('record-stop');
  const recordRetry = document.getElementById('record-retry');
  const recordDiscard = document.getElementById('record-discard');
  const recordOpenLibrary = document.getElementById('record-open-library');
  const recordingNew = document.getElementById('recording-new');
  const recordingConfigure = document.getElementById('recording-configure');
  const recordingList = document.getElementById('recording-list');
  const recordingDetail = document.getElementById('recording-detail');
  const recordingCount = document.getElementById('recording-count');
  const recordingBulkDelete = document.getElementById('recording-bulk-delete');
  const transcriptionSettingsBackdrop = document.getElementById('transcription-settings-backdrop');
  const transcriptionSettingsClose = document.getElementById('transcription-settings-close');
  const transcriptionSettingsCancel = document.getElementById('transcription-settings-cancel');
  const transcriptionSettingsSave = document.getElementById('transcription-settings-save');
  const transcriptionApiKey = document.getElementById('transcription-api-key');
  const transcriptionApiStatus = document.getElementById('transcription-api-status');
  const transcriptionApiHelp = document.getElementById('transcription-api-help');
  const transcriptionRegion = document.getElementById('transcription-region');
  const transcriptionWorkspace = document.getElementById('transcription-workspace');
  const llmApiKey = document.getElementById('llm-api-key');
  const llmApiStatus = document.getElementById('llm-api-status');
  const llmApiHelp = document.getElementById('llm-api-help');
  const llmBaseUrl = document.getElementById('llm-base-url');
  const llmModel = document.getElementById('llm-model');
  const transcriptionSettingsNote = document.getElementById('transcription-settings-note');
  const settingsApiConfigure = document.getElementById('settings-api-configure');
  const settingsTranscriptionStatus = document.getElementById('settings-transcription-status');
  const settingsLlmStatus = document.getElementById('settings-llm-status');
  const settingsFeatureList = document.getElementById('settings-feature-list');
  const settingsHomeModuleList = document.getElementById('settings-home-module-list');
  const settingsShortcutValue = document.getElementById('settings-shortcut-value');
  const settingsShortcutChange = document.getElementById('settings-shortcut-change');
  const settingsDefaultTab = document.getElementById('settings-default-tab');
  const settingsWorkspaceKind = document.getElementById('settings-workspace-kind');
  const settingsWorkspacePath = document.getElementById('settings-workspace-path');
  const settingsWorkspaceOpen = document.getElementById('settings-workspace-open');
  const settingsWorkspaceChoose = document.getElementById('settings-workspace-choose');
  const settingsAutoLaunch = document.getElementById('settings-auto-launch');
  const settingsInlineNote = document.getElementById('settings-inline-note');
  const settingsClipCapture = document.getElementById('settings-clip-capture');
  const settingsClipShortcutValue = document.getElementById('settings-clip-shortcut-value');
  const settingsClipShortcutChange = document.getElementById('settings-clip-shortcut-change');
  const settingsClipShortcutClear = document.getElementById('settings-clip-shortcut-clear');
  const settingsClipRetention = document.getElementById('settings-clip-retention');
  const settingsClipIgnoredApps = document.getElementById('settings-clip-ignored-apps');
  const settingsClipPause = document.getElementById('settings-clip-pause');
  const settingsBackupExport = document.getElementById('settings-backup-export');
  const settingsBackupImport = document.getElementById('settings-backup-import');

  let recordings = loadJson(RECORDINGS_KEY, []).map(Domain.createRecording).filter(Boolean);
  let selectedRecordingId = recordings[0] && recordings[0].id;
  let recordingSelection = new Set();
  let recordingSelectionAnchor = selectedRecordingId || null;
  let mediaStream = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let speechRecognition = null;
  let speechRecognitionBlocked = false;
  let speechRecognitionError = '';
  let recordingStatus = 'idle';
  let recordingStartedAt = 0;
  let pausedAt = 0;
  let pausedTotalMs = 0;
  let recordingTranscript = '';
  let interimTranscript = '';
  let recordingTimer = null;
  let recordingStopDurationMs = 0;
  let recordingCaptureIssue = '';
  let recordingOutcome = null;
  let publishedRecordingBusy = false;
  let recordingDraftId = '';
  // A failed save owns its audio until the person retries or explicitly discards it.
  // Keep the file result as well, so a metadata retry never writes a second file.
  let pendingRecordingSave = null;
  let recordingSaveTask = null;
  let recordingDeletions = loadRecordingDeletions();
  const committingRecordingDeletions = new Set();
  let currentAudioUrl = '';
  let transcriptionConfig = {
    configured: false,
    asrNeedsReentry: false,
    region: 'beijing',
    workspaceId: '',
    llmConfigured: false,
    llmNeedsReentry: false,
    llmBaseUrl: 'https://api.deepseek.com',
    llmModel: 'deepseek-v4-flash',
  };
  let settingsAppSettings = null;
  let settingsWorkspace = null;
  let transcriptionStatus = 'idle';
  let transcriptionStartPromise = null;
  let transcriptionAudioContext = null;
  let transcriptionAudioSource = null;
  let transcriptionAudioProcessor = null;
  let transcriptionAudioMute = null;
  let transcriptionPcmQueue = [];
  let transcriptionFinishPromise = null;
  let fileTranscriptionPending = false;
  let recordingTranscriptionMode = 'realtime';
  let transcriptionError = '';
  const recordingStartTask = Domain.createExclusiveAsyncTask(() => updateRecordingUi());

  function loadRecordingDeletions() {
    const saved = loadJson(RECORDING_DELETIONS_KEY, []);
    if (!Array.isArray(saved)) return [];
    return saved.flatMap((entry) => {
      if (!entry || typeof entry.token !== 'string' || !entry.token || !Array.isArray(entry.items)) return [];
      const items = entry.items.flatMap((item) => {
        if (!item?.recording || typeof item.recording.id !== 'string' || !item.recording.id) return [];
        const recording = Domain.createRecording(item.recording);
        return recording ? [{ recording, index: Math.max(0, Number(item.index) || 0) }] : [];
      });
      return items.length ? [{ token: entry.token, items, selectedId: typeof entry.selectedId === 'string' ? entry.selectedId : '' }] : [];
    });
  }

  function isRecordingActive() {
    return ['recording', 'paused', 'saving'].includes(recordingStatus);
  }

  function isRecordingBusy() {
    return recordingStartTask.isPending() || isRecordingActive() || !!pendingRecordingSave;
  }

  function updateTranscriptionConfigUi() {
    const statuses = Domain.apiCredentialStatuses(transcriptionConfig);
    if (transcriptionApiStatus) {
      transcriptionApiStatus.textContent = statuses.transcription.label;
      transcriptionApiStatus.dataset.state = statuses.transcription.state;
    }
    if (llmApiStatus) {
      llmApiStatus.textContent = statuses.llm.label;
      llmApiStatus.dataset.state = statuses.llm.state;
    }
    // Background recording/settings refreshes must not overwrite unsaved fields
    // while the shared API panel is open.
    if (!window.SlateApiSettings?.isOpen()) {
      if (transcriptionRegion) transcriptionRegion.value = transcriptionConfig.region || 'beijing';
      if (transcriptionWorkspace) transcriptionWorkspace.value = transcriptionConfig.workspaceId || '';
      if (llmBaseUrl) llmBaseUrl.value = transcriptionConfig.llmBaseUrl || 'https://api.deepseek.com';
      if (llmModel) llmModel.value = transcriptionConfig.llmModel || 'deepseek-v4-flash';
    }
  }

  function setSettingsNote(message, error = false) {
    if (!settingsInlineNote) return;
    settingsInlineNote.textContent = message || '';
    settingsInlineNote.classList.toggle('error', error);
  }

  function renderSettingsPanel() {
    const summary = Domain.settingsSummary({
      appSettings: settingsAppSettings,
      workspace: settingsWorkspace,
      transcription: transcriptionConfig,
    });
    if (settingsTranscriptionStatus) {
      settingsTranscriptionStatus.textContent = summary.transcription.label;
      settingsTranscriptionStatus.dataset.state = summary.transcription.state;
    }
    if (settingsLlmStatus) {
      settingsLlmStatus.textContent = summary.llm.label;
      settingsLlmStatus.dataset.state = summary.llm.state;
    }
    if (settingsShortcutValue) settingsShortcutValue.textContent = summary.shortcut;
    const clipboardSettings = settingsAppSettings?.clipboard || {};
    if (settingsClipCapture) settingsClipCapture.checked = clipboardSettings.captureEnabled === true;
    if (settingsClipShortcutValue) settingsClipShortcutValue.textContent = settingsAppSettings?.clipShortcut || '未设置';
    if (settingsClipShortcutClear) settingsClipShortcutClear.hidden = !settingsAppSettings?.clipShortcut;
    if (settingsClipRetention) settingsClipRetention.value = String(clipboardSettings.retentionDays || 7);
    if (settingsClipIgnoredApps && document.activeElement !== settingsClipIgnoredApps) {
      settingsClipIgnoredApps.value = Array.isArray(clipboardSettings.ignoredApps) ? clipboardSettings.ignoredApps.join(', ') : '';
    }
    if (settingsClipPause) settingsClipPause.textContent = Number(clipboardSettings.pausedUntil) > Date.now()
      ? '立即恢复记录'
      : '暂停记录 1 小时';
    if (settingsDefaultTab) {
      const visibleTabs = new Set(Domain.visiblePanelTabs(
        ['home', 'todo', 'notes', 'links', 'recordings', 'credentials', 'clip', 'settings'],
        settingsAppSettings?.features
      ));
      Array.from(settingsDefaultTab.options).forEach((option) => {
        const visible = visibleTabs.has(option.value);
        option.hidden = !visible;
        option.disabled = !visible;
      });
      settingsDefaultTab.value = visibleTabs.has(summary.defaultTab) ? summary.defaultTab : 'home';
    }
    if (settingsWorkspaceKind) settingsWorkspaceKind.textContent = summary.workspaceLabel;
    if (settingsWorkspacePath) {
      settingsWorkspacePath.textContent = summary.workspacePath || '默认数据目录';
      settingsWorkspacePath.title = summary.workspacePath || '';
    }
    if (settingsAutoLaunch) settingsAutoLaunch.checked = summary.autoLaunch;
    settingsFeatureList?.querySelectorAll('input[data-settings-feature]').forEach((input) => {
      input.checked = settingsAppSettings?.features?.[input.dataset.settingsFeature] !== false;
    });
    renderHomeModuleSettings();
  }

  function renderHomeModuleSettings() {
    const state = window.SlateHome?.getVisibility?.();
    const hidden = new Set(state?.hiddenIds || []);
    settingsHomeModuleList?.querySelectorAll('input[data-settings-home-module]').forEach((input) => {
      const moduleId = input.dataset.settingsHomeModule;
      const unavailable = state?.unavailableIds?.includes(moduleId) === true;
      input.closest('label').hidden = unavailable;
      input.checked = !hidden.has(moduleId);
      input.disabled = unavailable || state?.readOnly === true;
    });
    const status = document.getElementById('settings-home-module-status');
    if (status) {
      status.textContent = state?.readOnly
        ? '安全模式 · 暂不可修改'
        : state?.persisted === false
          ? '仅当前会话 · 未能保存'
          : '隐藏后自动填充 · 至少保留一个';
      status.dataset.state = state?.readOnly || state?.persisted === false ? 'warning' : 'saved';
    }
  }

  async function refreshSettingsPanel() {
    if (!window.slateAPI) return;
    const [appSettings, workspace, config] = await Promise.all([
      window.slateAPI.getAppSettings?.().catch(() => null),
      window.slateAPI.getWorkspace?.().catch(() => null),
      window.slateAPI.getTranscriptionConfig?.().catch(() => null),
    ]);
    if (appSettings) settingsAppSettings = appSettings;
    if (workspace) settingsWorkspace = workspace;
    if (config) {
      transcriptionConfig = config;
      updateTranscriptionConfigUi();
      updateRecordingUi();
    }
    renderSettingsPanel();
  }

  async function loadTranscriptionConfig() {
    if (!window.slateAPI || typeof window.slateAPI.getTranscriptionConfig !== 'function') return;
    try {
      const config = await window.slateAPI.getTranscriptionConfig();
      if (config) transcriptionConfig = config;
    } catch (error) {}
    updateTranscriptionConfigUi();
    updateRecordingUi();
    renderSettingsPanel();
  }

  function openTranscriptionSettings() {
    return window.SlateApiSettings?.open('asr');
  }

  function closeTranscriptionSettings() {
    window.SlateApiSettings?.close();
  }

  async function saveTranscriptionSettings() {
    return window.SlateApiSettings?.save();
  }

  // The shared API panel edits one capability at a time. Keep this adapter
  // inside the recording closure so public config changes also refresh the
  // existing recorder without ever exposing stored secrets to the renderer.
  window.SlateTranscriptionSettings = Object.freeze({
    async getConfig() {
      await loadTranscriptionConfig();
      return { ...transcriptionConfig };
    },
    async save(capability, payload) {
      if (!window.slateAPI?.setTranscriptionConfig) return { ok: false, error: 'unavailable' };
      const next = {};
      if (capability === 'asr') {
        next.apiKey = payload.apiKey || '';
        next.region = payload.region;
        next.workspaceId = payload.workspaceId;
        if (payload.provider !== undefined) next.asrProvider = payload.provider;
        if (payload.baseURL !== undefined) next.asrBaseUrl = payload.baseURL;
        if (payload.model !== undefined) next.asrModel = payload.model;
        if (payload.clearKey) next.clearApiKey = true;
      } else if (capability === 'llm') {
        next.llmApiKey = payload.apiKey || '';
        next.llmBaseUrl = payload.baseURL;
        next.llmModel = payload.model;
        if (payload.provider !== undefined) next.llmProvider = payload.provider;
        if (payload.clearKey) next.clearLlmApiKey = true;
      } else return { ok: false, error: 'invalid_capability' };
      const result = await window.slateAPI.setTranscriptionConfig(next);
      if (!result?.ok) return result || { ok: false, error: 'save_failed' };
      transcriptionConfig = result;
      updateTranscriptionConfigUi();
      if (capability === 'asr' && transcriptionConfig.configured
        && ['recording', 'paused'].includes(recordingStatus) && !transcriptionStartPromise) {
        stopSpeechRecognition();
        transcriptionStatus = 'idle';
        transcriptionStartPromise = startCloudTranscription();
      }
      updateRecordingUi();
      renderSettingsPanel();
      return { ...result };
    },
  });

  function persistRecordings() {
    return saveJson(RECORDINGS_KEY, recordings.filter((recording) => !recording.isDraft));
  }

  function setRecordingOutcome(state, label, message, durationMs = 0) {
    recordingOutcome = { state, label, message, durationMs };
    if (state === 'error' && typeof showStatusToast === 'function') showStatusToast(message);
  }

  function currentDuration() {
    return Domain.calculateRecordingDuration({
      startedAt: recordingStartedAt,
      status: recordingStatus,
      pausedAt,
      pausedTotalMs,
      now: Date.now(),
    });
  }

  function activeRecordingDraft() {
    return recordingDraftId && recordings.find((recording) => recording.id === recordingDraftId) || null;
  }

  function currentRecordingText() {
    return `${recordingTranscript} ${interimTranscript}`.trim();
  }

  function currentRecordingFeedback() {
    if (recordingStartTask.isPending()) return '等待确认麦克风权限…';
    if (pendingRecordingSave?.discarding) return '正在放弃本次录音…';
    if (recordingCaptureIssue) return recordingCaptureIssue;
    if (recordingStatus === 'saving') return transcriptionStatus === 'finishing' && recordingTranscriptionMode === 'file' ? '音频已保存在本机，正在转写…' : '正在保存录音…';
    if (pendingRecordingSave) return recordingOutcome?.message || '录音尚未保存，内容已保留，请重试保存';
    if (transcriptionConfig.asrNeedsReentry) return '转写密钥已失效 · 请重新配置 API Key';
    if (transcriptionStatus === 'browser-error') return '未配置转写 API · 音频仍在录制';
    if (transcriptionStatus === 'error') return transcriptionError || '转写连接失败 · 音频仍在录制';
    if (transcriptionStatus === 'connecting') return '正在连接转写服务';
    if (recordingStatus === 'paused') return '录音已暂停';
    if (transcriptionConfig.configured && recordingTranscriptionMode === 'file') return '正在本机录音 · 停止后上传转写（最多 10 分钟）';
    if (!transcriptionConfig.configured && !currentRecordingText()) return '未配置转写 API · 音频仍会保存在本机';
    return '正在录音';
  }

  function beginRecordingDraft() {
    recordingDraftId = uid('recording');
    const draft = {
      ...Domain.createRecording({
        id: recordingDraftId,
        createdAt: recordingStartedAt,
        durationMs: 0,
        transcript: '',
      }),
      isDraft: true,
    };
    recordings.unshift(draft);
    selectedRecordingId = draft.id;
    recordingSelectionAnchor = draft.id;
    renderRecordings();
  }

  function discardRecordingDraft() {
    if (!recordingDraftId) return;
    recordings = recordings.filter((recording) => recording.id !== recordingDraftId);
    recordingSelection.delete(recordingDraftId);
    selectedRecordingId = recordings[0]?.id || '';
    recordingSelectionAnchor = selectedRecordingId || null;
    recordingDraftId = '';
    renderRecordings();
  }

  function syncRecordingDraftUi() {
    const draft = activeRecordingDraft();
    if (!draft) return;
    const durationMs = recordingStopDurationMs || currentDuration();
    const text = currentRecordingText();
    draft.durationMs = durationMs;
    draft.transcript = recordingTranscript;
    const row = recordingList?.querySelector(`.recording-item[data-id="${CSS.escape(draft.id)}"]`);
    const preview = row?.querySelector('[data-recording-preview]');
    const meta = row?.querySelector('[data-recording-meta]');
    if (preview) preview.textContent = text || currentRecordingFeedback();
    const draftState = recordingStatus === 'saving' ? '保存中' : pendingRecordingSave ? '未保存' : recordingStatus === 'paused' ? '已暂停' : '录音中';
    if (meta) meta.textContent = `${draftState} · ${formatClock(durationMs)}`;
    if (selectedRecordingId !== draft.id) return;
    const detailState = recordingDetail?.querySelector('[data-recording-live-state]');
    const detailDot = recordingDetail?.querySelector('[data-recording-live-dot]');
    const detailTime = recordingDetail?.querySelector('[data-recording-live-time]');
    const detailTranscript = recordingDetail?.querySelector('[data-recording-live-transcript]');
    const detailFeedback = recordingDetail?.querySelector('[data-recording-live-feedback]');
    const detailConfigure = recordingDetail?.querySelector('[data-action="configure-transcription"]');
    const detailPause = recordingDetail?.querySelector('.recording-live-pause');
    const detailStop = recordingDetail?.querySelector('.recording-live-stop');
    const detailRetry = recordingDetail?.querySelector('.recording-live-retry');
    const detailDiscard = recordingDetail?.querySelector('.recording-live-discard');
    const detailAudioTitle = recordingDetail?.querySelector('[data-recording-live-audio-title]');
    const detailAudioHint = recordingDetail?.querySelector('[data-recording-live-audio-hint]');
    const failedSave = !!pendingRecordingSave && recordingStatus !== 'saving';
    if (detailState) detailState.textContent = recordingStatus === 'saving' ? '正在保存' : failedSave ? '录音未保存' : recordingStatus === 'paused' ? '已暂停' : '正在录音';
    if (detailDot) detailDot.dataset.state = failedSave ? 'error' : recordingStatus;
    if (detailTime) detailTime.textContent = formatClock(durationMs);
    if (detailTranscript && detailTranscript.value !== text) detailTranscript.value = text;
    if (detailFeedback) detailFeedback.textContent = failedSave ? currentRecordingFeedback() : text && recordingTranscriptionMode !== 'file' ? '转写内容会随录音实时更新' : currentRecordingFeedback();
    const cancelTranscription = recordingDetail?.querySelector('.recording-live-cancel-transcription');
    if (cancelTranscription) cancelTranscription.hidden = !(recordingStatus === 'saving' && transcriptionStatus === 'finishing');
    if (detailAudioTitle) detailAudioTitle.textContent = failedSave ? '本次音频已保留，等待保存' : '音频正在本机录制';
    if (detailAudioHint) detailAudioHint.textContent = failedSave ? '请重试保存，或明确放弃本次录音；关闭前请先处理。' : '结束后会自动保存并出现播放器';
    if (detailConfigure) detailConfigure.hidden = transcriptionConfig.configured && !transcriptionConfig.asrNeedsReentry;
    if (detailPause) {
      detailPause.textContent = recordingStatus === 'paused' ? '继续' : '暂停';
      detailPause.disabled = recordingStatus === 'saving';
      detailPause.hidden = failedSave;
    }
    if (detailStop) {
      detailStop.disabled = recordingStatus === 'saving';
      detailStop.hidden = failedSave;
    }
    if (detailRetry) {
      detailRetry.hidden = !failedSave;
      detailRetry.disabled = pendingRecordingSave?.discarding === true;
    }
    if (detailDiscard) {
      detailDiscard.hidden = !failedSave;
      detailDiscard.disabled = pendingRecordingSave?.discarding === true;
    }
  }

  function stopTranscriptionAudioPipeline() {
    if (transcriptionAudioProcessor) {
      transcriptionAudioProcessor.onaudioprocess = null;
      try { transcriptionAudioProcessor.disconnect(); } catch (error) {}
    }
    if (transcriptionAudioSource) {
      try { transcriptionAudioSource.disconnect(); } catch (error) {}
    }
    if (transcriptionAudioMute) {
      try { transcriptionAudioMute.disconnect(); } catch (error) {}
    }
    if (transcriptionAudioContext) transcriptionAudioContext.close().catch(() => {});
    transcriptionAudioContext = null;
    transcriptionAudioSource = null;
    transcriptionAudioProcessor = null;
    transcriptionAudioMute = null;
    transcriptionPcmQueue = [];
  }

  function sendTranscriptionPcm(buffer) {
    if (!buffer || !buffer.byteLength || !window.slateAPI) return;
    if (transcriptionStatus === 'connected') {
      window.slateAPI.sendTranscriptionAudio(buffer);
      return;
    }
    if (transcriptionStatus === 'connecting') {
      transcriptionPcmQueue.push(buffer);
      if (transcriptionPcmQueue.length > 60) transcriptionPcmQueue.shift();
    }
  }

  function startTranscriptionAudioPipeline(stream) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext || !stream) return false;
    try {
      transcriptionAudioContext = new AudioContext({ sampleRate: 16000 });
      transcriptionAudioSource = transcriptionAudioContext.createMediaStreamSource(stream);
      transcriptionAudioProcessor = transcriptionAudioContext.createScriptProcessor(4096, 1, 1);
      transcriptionAudioMute = transcriptionAudioContext.createGain();
      transcriptionAudioMute.gain.value = 0;
      transcriptionAudioProcessor.onaudioprocess = (event) => {
        if (recordingStatus !== 'recording') return;
        const source = event.inputBuffer.getChannelData(0);
        const pcm = Domain.resampleFloat32ToPcm16(source, transcriptionAudioContext.sampleRate, 16000);
        sendTranscriptionPcm(pcm.buffer);
      };
      transcriptionAudioSource.connect(transcriptionAudioProcessor);
      transcriptionAudioProcessor.connect(transcriptionAudioMute);
      transcriptionAudioMute.connect(transcriptionAudioContext.destination);
      return true;
    } catch (error) {
      stopTranscriptionAudioPipeline();
      return false;
    }
  }

  async function startCloudTranscription() {
    if (!transcriptionConfig.configured || !window.slateAPI || !mediaStream) return { ok: false, error: 'not_configured' };
    transcriptionStatus = 'connecting';
    transcriptionError = '';
    recordingTranscriptionMode = transcriptionConfig.asrMode || 'realtime';
    transcriptionPcmQueue = [];
    if (!startTranscriptionAudioPipeline(mediaStream)) { transcriptionStatus = 'error'; transcriptionError = '转写音频准备失败，本地录音仍会保存。'; return { ok: false, error: 'audio_unavailable' }; }
    updateRecordingUi();
    let result;
    try {
      result = await window.slateAPI.startTranscription();
    } catch (error) {
      result = { ok: false, error: 'connection_failed' };
    }
    if (!result || !result.ok) {
      transcriptionStatus = 'error';
      stopTranscriptionAudioPipeline();
      updateRecordingUi();
      return result || { ok: false };
    }
    transcriptionStatus = 'connected';
    const queued = transcriptionPcmQueue;
    transcriptionPcmQueue = [];
    queued.forEach((buffer) => window.slateAPI.sendTranscriptionAudio(buffer));
    updateRecordingUi();
    return result;
  }

  async function finishCloudTranscription() {
    if (!transcriptionStartPromise) return { ok: false, error: 'not_active', transcript: recordingTranscript };
    stopTranscriptionAudioPipeline();
    await transcriptionStartPromise;
    transcriptionStartPromise = null;
    if (transcriptionStatus !== 'connected') { window.slateAPI.cancelTranscription?.().catch(() => {}); return { ok: false, error: 'not_connected', transcript: recordingTranscript }; }
    transcriptionStatus = 'finishing';
    updateRecordingUi();
    let result;
    try {
      result = await window.slateAPI.finishTranscription();
    } catch (error) {
      result = { ok: false, error: 'finish_failed', transcript: recordingTranscript };
    }
    if (result && result.transcript) recordingTranscript = result.transcript;
    transcriptionStatus = result && result.ok ? 'idle' : 'error';
    if (!result?.ok) transcriptionError = String(result?.error || '转写失败，本地录音已保留。');
    interimTranscript = '';
    updateRecordingUi();
    return result;
  }

  if (window.slateAPI && typeof window.slateAPI.onTranscriptionEvent === 'function') {
    window.slateAPI.onTranscriptionEvent((event) => {
      if (!event || !['recording', 'paused', 'saving'].includes(recordingStatus)) return;
      if (event.type === 'transcript') {
        recordingTranscript = String(event.final || '').trim();
        interimTranscript = String(event.interim || '').trim();
      } else if (event.type === 'error') {
        transcriptionStatus = 'error';
        transcriptionError = String(event.message || '转写失败，本地录音仍会保存。');
      }
      updateRecordingUi();
    });
  }

  function updateRecordingUi() {
    const recordingActive = isRecordingActive();
    const recordingBusy = isRecordingBusy();
    const visualState = recordingStartTask.isPending() ? 'requesting'
      : recordingStatus === 'idle' && recordingOutcome ? recordingOutcome.state : recordingStatus;
    const feedback = recordingStartTask.isPending() ? '等待确认麦克风权限…'
      : recordingActive ? currentRecordingFeedback() : recordingOutcome?.message || '开始录音，音频保存在本机';
    if (quickRecorder) {
      quickRecorder.dataset.state = visualState;
      quickRecorder.title = feedback;
    }
    if (recordingDot) recordingDot.dataset.state = visualState;
    if (recordingStateLabel) {
      recordingStateLabel.textContent = recordingStartTask.isPending()
        ? '等待录音权限'
        : recordingStatus === 'recording'
        ? '正在录音'
        : recordingStatus === 'paused'
          ? '已暂停'
          : recordingStatus === 'saving'
            ? '正在保存'
            : recordingOutcome?.label || '快速录音';
      recordingStateLabel.title = feedback;
    }
    if (recordingTime) {
      recordingTime.textContent = formatClock(recordingActive
        ? recordingStopDurationMs || currentDuration()
        : recordingOutcome?.durationMs || 0);
      recordingTime.hidden = !recordingActive && !recordingOutcome?.durationMs;
    }
    if (recordStart) {
      recordStart.disabled = recordingBusy;
      recordStart.hidden = recordingActive || !!pendingRecordingSave;
    }
    if (recordPause) {
      recordPause.hidden = !recordingActive;
      recordPause.disabled = !['recording', 'paused'].includes(recordingStatus);
      const label = recordingStatus === 'paused' ? '继续录音' : '暂停录音';
      recordPause.setAttribute('aria-label', label);
      recordPause.title = label;
      const text = recordPause.querySelector('[data-record-label]');
      const buttonText = recordingStatus === 'paused' ? '继续' : '暂停';
      if (text && text.textContent !== buttonText) text.textContent = buttonText;
      const icon = recordPause.querySelector('svg');
      if (icon && icon.dataset.transport !== buttonText) {
        icon.dataset.transport = buttonText;
        icon.innerHTML = recordingStatus === 'paused'
          ? '<path d="m8 5 11 7-11 7z"/>'
          : '<path d="M8 5v14M16 5v14"/>';
      }
      recordPause.classList.toggle('resume', recordingStatus === 'paused');
    }
    if (recordStop) {
      recordStop.hidden = !recordingActive;
      recordStop.disabled = !['recording', 'paused'].includes(recordingStatus);
      recordStop.setAttribute('aria-label', '停止并保存录音');
      recordStop.title = '停止并保存录音';
    }
    if (recordRetry) {
      recordRetry.hidden = !pendingRecordingSave || recordingStatus === 'saving';
      recordRetry.disabled = recordingStatus === 'saving' || pendingRecordingSave?.discarding === true;
    }
    if (recordDiscard) {
      recordDiscard.hidden = !pendingRecordingSave || recordingStatus === 'saving';
      recordDiscard.disabled = recordingStatus === 'saving' || pendingRecordingSave?.discarding === true;
    }
    if (recordingNew) {
      recordingNew.disabled = recordingBusy;
      recordingNew.textContent = recordingBusy ? '录制' : '录音';
      recordingNew.setAttribute('aria-label', recordingStartTask.isPending()
        ? '正在请求麦克风权限'
        : pendingRecordingSave ? '请先保存或放弃上次录音' : recordingActive ? '录音进行中' : '开始录音');
    }
    syncRecordingDraftUi();
    if (publishedRecordingBusy !== recordingBusy) {
      publishedRecordingBusy = recordingBusy;
      document.dispatchEvent(new CustomEvent('slate:recording-state-changed', {
        detail: { active: recordingBusy },
      }));
    }
  }

  function stopSpeechRecognition() {
    const recognition = speechRecognition;
    speechRecognition = null;
    if (recognition) {
      try { recognition.stop(); } catch (error) {}
    }
    interimTranscript = '';
  }

  function startSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      transcriptionStatus = 'browser-error';
      updateRecordingUi();
      return;
    }
    if (speechRecognitionBlocked || recordingStatus !== 'recording') return;
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      interimTranscript = '';
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const text = String(event.results[index][0] && event.results[index][0].transcript || '').trim();
        if (!text) continue;
        if (event.results[index].isFinal) {
          recordingTranscript = `${recordingTranscript} ${text}`.trim();
        } else {
          interimTranscript = `${interimTranscript} ${text}`.trim();
        }
      }
      updateRecordingUi();
    };
    recognition.onerror = (event) => {
      interimTranscript = '';
      speechRecognitionError = String(event && event.error || 'unknown');
      if (['network', 'not-allowed', 'service-not-allowed', 'audio-capture'].includes(speechRecognitionError)) {
        speechRecognitionBlocked = true;
        transcriptionStatus = 'browser-error';
      }
      updateRecordingUi();
    };
    recognition.onend = () => {
      if (speechRecognition !== recognition) return;
      speechRecognition = null;
      if (recordingStatus === 'recording' && !speechRecognitionBlocked) setTimeout(startSpeechRecognition, 180);
    };
    speechRecognition = recognition;
    try {
      recognition.start();
    } catch (error) {
      speechRecognition = null;
    }
  }

  function stopMediaTracks() {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
  }

  function chooseRecordingMimeType() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    return candidates.find((type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || '';
  }

  async function finalizeRecording(blob, durationMs) {
    // A device can dispatch onstop just after stop() throws. Both recovery paths
    // belong to the same draft and must never write it twice.
    if (!activeRecordingDraft()) return;
    if (pendingRecordingSave) return recordingSaveTask;
    if (!blob || blob.size === 0) {
      recordingStatus = 'idle';
      recordingCaptureIssue = '';
      discardRecordingDraft();
      setRecordingOutcome('error', '未录到声音', '录音为空，请检查麦克风输入后重试');
      audioChunks = [];
      recordingTranscript = '';
      interimTranscript = '';
      updateRecordingUi();
      return;
    }
    pendingRecordingSave = { blob, durationMs, saved: null };
    // The Blob now owns the captured bytes; keeping every MediaRecorder chunk
    // alongside it unnecessarily doubles retained references during recovery.
    audioChunks = [];
    return retryRecordingSave();
  }

  function clearRecordingCapture() {
    fileTranscriptionPending = false;
    transcriptionFinishPromise = null;
    transcriptionStartPromise = null;
    window.slateAPI?.cancelTranscription?.().catch(()=>{});
    recordingStatus = 'idle';
    recordingStartedAt = 0;
    pausedAt = 0;
    pausedTotalMs = 0;
    audioChunks = [];
    recordingTranscript = '';
    interimTranscript = '';
    recordingCaptureIssue = '';
    recordingStopDurationMs = 0;
    pendingRecordingSave = null;
    mediaRecorder = null;
  }

  async function savePendingRecording() {
    const pending = pendingRecordingSave;
    if (!pending) return;
    recordingStatus = 'saving';
    updateRecordingUi();
    if (!pending.saved) {
      try {
        const result = await window.slateAPI?.saveRecording({
          bytes: await pending.blob.arrayBuffer(),
          mimeType: pending.blob.type || 'audio/webm',
        });
        if (result?.ok && result.audioPath) pending.saved = result;
      } catch (error) {}
    }
    if (!pending.saved) {
      recordingStatus = 'idle';
      setRecordingOutcome('error', '保存失败', '录音保存失败，本次音频和转写已保留。请检查本机存储权限后重试保存', pending.durationMs);
      updateRecordingUi();
      return;
    }
    if (fileTranscriptionPending) {
      fileTranscriptionPending = false;
      transcriptionFinishPromise = finishCloudTranscription();
    }
    if (transcriptionFinishPromise) {
      // Persist the actual audio before waiting for a remote file transcription.
      // A failed or cancelled request must never prevent local recording recovery.
      updateRecordingUi();
      await transcriptionFinishPromise;
      transcriptionFinishPromise = null;
    }
    const draft = activeRecordingDraft();
    const recording = Domain.createRecording({
      id: draft?.id || uid('recording'),
      createdAt: draft?.createdAt || Date.now(),
      title: draft?.title,
      durationMs: pending.durationMs,
      transcript: currentRecordingText(),
      audioPath: pending.saved.audioPath,
      mimeType: pending.saved.mimeType || pending.blob.type,
    });
    const next = recordings.filter((item) => item.id !== recording.id && !item.isDraft);
    next.unshift(recording);
    if (!saveJson(RECORDINGS_KEY, next)) {
      recordingStatus = 'idle';
      setRecordingOutcome('error', '列表保存失败', '音频已保存，列表写入失败。本次内容已保留，点击重试保存即可，无需重新录音', pending.durationMs);
      updateRecordingUi();
      return;
    }
    recordings = next;
    recordingDraftId = '';
    selectedRecordingId = recording.id;
    clearRecordingCapture();
    setRecordingOutcome('saved', '已保存', transcriptionError ? `音频已保存；${transcriptionError}` : '录音已保存到本机，点击查看录音', pending.durationMs);
    renderRecordings();
    updateRecordingUi();
    if (recording.transcript && window.slateAPI?.organizeMaterial) {
      window.slateAPI.organizeMaterial({ kind: 'recording', text: recording.transcript }).then((metadata) => {
        const target = recordings.find((item) => item.id === recording.id);
        if (!target || !metadata?.ok) return;
        target.title = metadata.title || target.title;
        target.category = metadata.category || target.category;
        persistRecordings();
        renderRecordings();
      }).catch(() => {});
    }
  }

  function retryRecordingSave() {
    if (!pendingRecordingSave || pendingRecordingSave.discarding || recordingSaveTask) return recordingSaveTask;
    recordingSaveTask = savePendingRecording().finally(() => {
      recordingSaveTask = null;
      updateRecordingUi();
    });
    return recordingSaveTask;
  }

  function requestDiscardRecording() {
    if (!pendingRecordingSave || pendingRecordingSave.discarding || recordingSaveTask || typeof showStatusToast !== 'function') return;
    const pending = pendingRecordingSave;
    showStatusToast('放弃后，本次尚未保存的音频和转写将被清除。', {
      actionLabel: '放弃本次录音',
      duration: 8000,
      onAction: async () => {
        if (pendingRecordingSave !== pending || recordingSaveTask) return;
        pending.discarding = true;
        updateRecordingUi();
        if (pending.saved?.audioPath) {
          const deleted = await window.slateAPI?.deleteRecording(pending.saved.audioPath).catch(() => false);
          if (!deleted) {
            pending.discarding = false;
            setRecordingOutcome('error', '未能放弃', '本次音频文件未能删除，内容仍保留，请重试保存或放弃', pending.durationMs);
            updateRecordingUi();
            return;
          }
        }
        discardRecordingDraft();
        clearRecordingCapture();
        recordingOutcome = null;
        updateRecordingUi();
        showStatusToast('已放弃本次录音');
      },
    });
  }

  async function startRecordingAttempt() {
    if (recordingStatus !== 'idle' || pendingRecordingSave) return;
    recordingOutcome = null;
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      setRecordingOutcome('error', '无法录音', '当前环境无法录音，请重新启动 Slate 后重试');
      return;
    }
    try {
      if (window.slateAPI && !(await window.slateAPI.ensureMicrophone())) {
        setRecordingOutcome('error', '麦克风未授权', '无法访问麦克风，请在系统设置中授权后重试');
        return;
      }
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      const audioTrack = mediaStream.getAudioTracks()[0];
      if (!audioTrack || audioTrack.readyState !== 'live') throw new Error('audio_track_unavailable');
      recordingCaptureIssue = '';
      audioTrack.addEventListener('mute', () => {
        if (!['recording', 'paused'].includes(recordingStatus)) return;
        recordingCaptureIssue = '麦克风无输入 · 请检查系统音源';
        updateRecordingUi();
      });
      audioTrack.addEventListener('unmute', () => {
        recordingCaptureIssue = '';
        updateRecordingUi();
      });
      const mimeType = chooseRecordingMimeType();
      const recorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
      mediaRecorder = recorder;
      audioChunks = [];
      recordingTranscript = '';
      interimTranscript = '';
      speechRecognitionBlocked = false;
      speechRecognitionError = '';
      recordingStartedAt = Date.now();
      recordingStopDurationMs = 0;
      pausedTotalMs = 0;
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size) audioChunks.push(event.data);
      };
      mediaRecorder.onerror = () => {
        recordingCaptureIssue = '录音中断 · 请重新开始';
        updateRecordingUi();
      };
      mediaRecorder.onstop = async () => {
        const durationMs = recordingStopDurationMs || currentDuration();
        const blob = new Blob(audioChunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
        stopMediaTracks();
        finalizeRecording(blob, durationMs);
      };
      mediaRecorder.start(1000);
      recordingStatus = 'recording';
      transcriptionStatus = 'idle';
      transcriptionError = '';
      recordingTranscriptionMode = transcriptionConfig.asrMode || 'realtime';
      transcriptionStartPromise = null;
      transcriptionFinishPromise = null;
      beginRecordingDraft();
      if (transcriptionConfig.configured) {
        transcriptionStartPromise = startCloudTranscription();
      }
      clearInterval(recordingTimer);
      recordingTimer = setInterval(updateRecordingUi, 500);
      updateRecordingUi();
    } catch (error) {
      stopMediaTracks();
      recordingStatus = 'idle';
      recordingCaptureIssue = '';
      discardRecordingDraft();
      setRecordingOutcome('error', '无法开始录音', '无法开始录音，请检查麦克风权限和设备连接');
      updateRecordingUi();
    }
  }

  function startRecording() {
    return recordingStartTask.run(startRecordingAttempt);
  }

  function togglePauseRecording() {
    if (!mediaRecorder) return;
    if (recordingStatus === 'recording') {
      mediaRecorder.pause();
      pausedAt = Date.now();
      recordingStatus = 'paused';
      if (!transcriptionConfig.configured) stopSpeechRecognition();
    } else if (recordingStatus === 'paused') {
      pausedTotalMs += Date.now() - pausedAt;
      pausedAt = 0;
      mediaRecorder.resume();
      recordingStatus = 'recording';
    }
    updateRecordingUi();
  }

  function stopRecording() {
    if (!mediaRecorder || !['recording', 'paused'].includes(recordingStatus)) return;
    recordingStopDurationMs = currentDuration();
    recordingStatus = 'saving';
    stopSpeechRecognition();
    fileTranscriptionPending = recordingTranscriptionMode === 'file' && !!transcriptionStartPromise;
    if (fileTranscriptionPending) stopTranscriptionAudioPipeline();
    transcriptionFinishPromise = fileTranscriptionPending ? null : transcriptionStartPromise
      ? finishCloudTranscription()
      : Promise.resolve({ ok: false, error: 'not_active', transcript: recordingTranscript });
    clearInterval(recordingTimer);
    recordingTimer = null;
    updateRecordingUi();
    try {
      mediaRecorder.stop();
    } catch (error) {
      stopMediaTracks();
      // Some devices stop the recorder before Chromium receives our stop call.
      // Recover chunks that already arrived rather than throwing that audio away.
      finalizeRecording(new Blob(audioChunks, { type: mediaRecorder?.mimeType || 'audio/webm' }), recordingStopDurationMs);
    }
  }

  if (recordStart) recordStart.addEventListener('click', startRecording);
  if (recordPause) recordPause.addEventListener('click', togglePauseRecording);
  if (recordStop) recordStop.addEventListener('click', stopRecording);
  if (recordRetry) recordRetry.addEventListener('click', retryRecordingSave);
  if (recordDiscard) recordDiscard.addEventListener('click', requestDiscardRecording);
  if (recordOpenLibrary) recordOpenLibrary.addEventListener('click', async () => {
    recordOpenLibrary.disabled = true;
    try {
      if (document.getElementById('tab-button-recordings')?.hidden) {
        const result = await window.slateAPI?.setFeature?.('recordings', true);
        if (!result?.ok || !result.settings) {
          if (typeof showStatusToast === 'function') showStatusToast('录音资料库打开失败，请重试');
          return;
        }
        settingsAppSettings = result.settings;
        if (typeof applyFeatureSettings === 'function') applyFeatureSettings(result.settings);
      }
      if (typeof setActiveTab === 'function') await setActiveTab('recordings');
    } catch (error) {
      if (typeof showStatusToast === 'function') showStatusToast('录音资料库打开失败，请重试');
    } finally {
      recordOpenLibrary.disabled = false;
    }
  });
  if (recordingNew) recordingNew.addEventListener('click', startRecording);
  if (recordingConfigure) recordingConfigure.addEventListener('click', openTranscriptionSettings);
  if (settingsApiConfigure) settingsApiConfigure.addEventListener('click', openTranscriptionSettings);
  if (transcriptionSettingsClose) transcriptionSettingsClose.addEventListener('click', closeTranscriptionSettings);
  if (transcriptionSettingsCancel) transcriptionSettingsCancel.addEventListener('click', closeTranscriptionSettings);
  if (transcriptionSettingsSave) transcriptionSettingsSave.addEventListener('click', saveTranscriptionSettings);
  if (transcriptionApiHelp) {
    transcriptionApiHelp.addEventListener('click', () => {
      window.slateAPI?.openExternal('https://bailian.console.aliyun.com/cn-beijing/?tab=app#/api-key');
    });
  }
  if (llmApiHelp) {
    llmApiHelp.addEventListener('click', () => {
      window.slateAPI?.openExternal('https://platform.deepseek.com/api_keys');
    });
  }
  if (transcriptionSettingsBackdrop) {
    transcriptionSettingsBackdrop.addEventListener('click', (event) => {
      if (event.target === transcriptionSettingsBackdrop) closeTranscriptionSettings();
    });
  }
  if (window.slateAPI && typeof window.slateAPI.onOpenApiSettings === 'function') {
    window.slateAPI.onOpenApiSettings(async () => {
      if (!document.getElementById('app')?.classList.contains('expanded')) await setMode(true);
      openTranscriptionSettings();
    });
  }
  settingsFeatureList?.addEventListener('change', async (event) => {
    const input = event.target.closest('input[data-settings-feature]');
    if (!input || !window.slateAPI?.setFeature) return;
    input.disabled = true;
    const result = await window.slateAPI.setFeature(input.dataset.settingsFeature, input.checked)
      .catch(() => ({ ok: false }));
    input.disabled = false;
    if (!result?.ok) {
      input.checked = !input.checked;
      setSettingsNote('功能显示设置保存失败，请重试。', true);
      return;
    }
    settingsAppSettings = result.settings || settingsAppSettings;
    renderSettingsPanel();
    setSettingsNote('显示功能已更新。');
  });
  settingsHomeModuleList?.addEventListener('change', async (event) => {
    const input = event.target.closest('input[data-settings-home-module]');
    if (!input || !window.SlateHome?.setModuleVisible) return;
    input.disabled = true;
    const result = await window.SlateHome.setModuleVisible(
      input.dataset.settingsHomeModule,
      input.checked
    );
    renderHomeModuleSettings();
    if (!result?.ok) {
      const message = result?.error === 'at_least_one_required'
        ? '首页至少保留一个组件'
        : result?.error === 'layout_read_only'
            ? '首页布局已进入安全模式，本次会话不能修改组件'
            : result?.error === 'layout_invalid'
              ? '新布局校验失败，原布局已保留'
              : result?.error === 'dom_apply_failed'
                ? '布局应用失败，原布局已恢复'
                : '首页组件设置未更新';
      if (typeof showStatusToast === 'function') showStatusToast(message);
      return;
    }
    if (result.changed === false) return;
    const message = result.persisted === false
      ? '布局已更新，仅当前会话生效，设置未能保存'
      : input.checked ? '首页组件已恢复' : '首页组件已隐藏';
    if (typeof showStatusToast === 'function') showStatusToast(message);
  });
  settingsShortcutChange?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('slate:record-shortcut'));
  });
  settingsClipShortcutChange?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('slate:record-clip-shortcut'));
  });
  settingsClipShortcutClear?.addEventListener('click', async () => {
    const result = await window.slateAPI?.setClipShortcut?.('').catch(() => ({ ok: false }));
    if (!result?.ok) return setSettingsNote('剪贴板快捷键清除失败。', true);
    settingsAppSettings = result.settings || settingsAppSettings;
    renderSettingsPanel();
    setSettingsNote('剪贴板快捷键已清除。');
  });
  async function saveClipboardSettings(patch, successMessage) {
    const result = await window.slateAPI?.setClipboardPreferences?.(patch).catch(() => ({ ok: false }));
    if (!result?.ok) {
      renderSettingsPanel();
      setSettingsNote('剪贴板设置保存失败。', true);
      return false;
    }
    settingsAppSettings = result.settings || settingsAppSettings;
    renderSettingsPanel();
    setSettingsNote(successMessage);
    return true;
  }
  settingsClipCapture?.addEventListener('change', () => {
    saveClipboardSettings({ captureEnabled: settingsClipCapture.checked, pausedUntil: 0 }, settingsClipCapture.checked ? '已开始记录新的剪贴内容。' : '已停止记录，已有历史仍保留。');
  });
  settingsClipRetention?.addEventListener('change', () => {
    saveClipboardSettings({ retentionDays: Number(settingsClipRetention.value) }, '剪贴板保留期限已更新。');
  });
  settingsClipIgnoredApps?.addEventListener('change', () => {
    saveClipboardSettings({ ignoredApps: settingsClipIgnoredApps.value }, '忽略应用列表已更新。');
  });
  settingsClipPause?.addEventListener('click', () => {
    const paused = Number(settingsAppSettings?.clipboard?.pausedUntil) > Date.now();
    saveClipboardSettings({ pausedUntil: paused ? 0 : Date.now() + 60 * 60 * 1000 }, paused ? '剪贴板记录已恢复。' : '剪贴板记录已暂停 1 小时。');
  });
  settingsBackupExport?.addEventListener('click', async () => {
    settingsBackupExport.disabled = true;
    const result = await window.slateAPI?.exportBackup?.(collectLocalStorageSnapshot()).catch(() => ({ ok: false }));
    settingsBackupExport.disabled = false;
    if (result?.ok) setSettingsNote('备份已导出。');
      else if (result?.error !== 'cancelled') setSettingsNote(result?.error || '备份导出失败。', true);
  });
  settingsBackupImport?.addEventListener('click', async () => {
    settingsBackupImport.disabled = true;
    const result = await window.slateAPI?.importBackup?.().catch(() => ({ ok: false }));
    settingsBackupImport.disabled = false;
    if (!result?.ok) {
        if (result?.error !== 'cancelled') setSettingsNote(result?.error || '备份文件无效或无法读取。', true);
      return;
    }
    const backupKeys = [
        'slate-todo-data', 'slate-todo-category-names-v1', 'slate-todo-categories-v2',
        'slate-recurring-tasks-v1','slate-reports-v1','slate-report-template-v1','slate-report-template-mode-v1','slate-report-profiles-v2','slate-report-draft-v1','slate-prompt-draft-v1','slate-home-language-tool-v1',
      'slate-home-note', 'slate-note-archive-v1', 'slate-note-active-archive-v1', 'slate-note-library-active-v1',
      'slate-home-order-v3', 'slate-home-widget-sizes-v2', 'slate-home-hidden-modules-v1',
      'slate-home-commands', 'slate-link-groups', 'slate-launcher-apps-v1', 'slate-appearance',
    ];
    // 不让旧页面的自动保存或 beforeunload 覆盖刚导入的数据。
      const previous=Object.fromEntries(backupKeys.map(key=>[key,localStorage.getItem(key)]));
      workspaceReloadPending = true;
      try {
        backupKeys.forEach((key) => localStorage.removeItem(key));
        Object.entries(result.storage || {}).forEach(([key, value]) => {if(typeof value==='string')localStorage.setItem(key,value);});
        const saved=await window.slateAPI?.saveWorkspaceData?.(collectLocalStorageSnapshot());
        if(saved===false)throw new Error('workspace save failed');
        location.reload();
      } catch(error) {
        backupKeys.forEach(key=>{if(previous[key]===null)localStorage.removeItem(key);else localStorage.setItem(key,previous[key]);});
        workspaceReloadPending=false;setSettingsNote('导入没有完成，已恢复原数据。请检查存储空间后重试。',true);
      }
  });
  settingsDefaultTab?.addEventListener('change', async () => {
    if (!window.slateAPI?.setDefaultTab) return;
    const previous = settingsAppSettings?.defaultTab || 'home';
    settingsDefaultTab.disabled = true;
    const result = await window.slateAPI.setDefaultTab(settingsDefaultTab.value).catch(() => ({ ok: false }));
    settingsDefaultTab.disabled = false;
    if (!result?.ok) {
      settingsDefaultTab.value = previous;
      setSettingsNote('默认展开页保存失败，请重试。', true);
      return;
    }
    settingsAppSettings = result.settings || settingsAppSettings;
    renderSettingsPanel();
    setSettingsNote(`下次唤出将默认显示${settingsDefaultTab.selectedOptions[0]?.textContent || '所选页面'}。`);
  });

  // ============ 外观主题（浅色 / 深灰 / 跟随系统）============
  const settingsAppearance = document.getElementById('settings-appearance');
  const applyAppearance = (pref) => {
    const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
  };
  if (settingsAppearance) {
    settingsAppearance.value = localStorage.getItem('slate-appearance') || 'light';
    settingsAppearance.addEventListener('change', () => {
      const pref = settingsAppearance.value || 'light';
      localStorage.setItem('slate-appearance', pref);
      applyAppearance(pref);
      setSettingsNote(`外观已切换为${settingsAppearance.selectedOptions[0]?.textContent || '所选主题'}。`);
    });
    // 跟随系统时，系统配色变化实时生效
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((localStorage.getItem('slate-appearance') || 'light') === 'auto') applyAppearance('auto');
    });
  }
  settingsWorkspaceOpen?.addEventListener('click', () => {
    window.slateAPI?.openWorkspace?.().catch(() => setSettingsNote('无法打开数据文件夹。', true));
  });
  settingsWorkspaceChoose?.addEventListener('click', async () => {
    const changed = await window.slateAPI?.chooseWorkspace?.().catch(() => false);
    if (!changed) return;
    settingsWorkspace = await window.slateAPI?.getWorkspace?.().catch(() => settingsWorkspace);
    renderSettingsPanel();
    setSettingsNote('数据文件夹已更新。');
  });
  settingsAutoLaunch?.addEventListener('change', async () => {
    if (!window.slateAPI?.setAutoLaunch) return;
    settingsAutoLaunch.disabled = true;
    const result = await window.slateAPI.setAutoLaunch(settingsAutoLaunch.checked).catch(() => ({ ok: false }));
    settingsAutoLaunch.disabled = false;
    if (!result?.ok) {
      settingsAutoLaunch.checked = !settingsAutoLaunch.checked;
      setSettingsNote('开机启动设置失败。', true);
      return;
    }
    settingsAutoLaunch.checked = result.autoLaunch === true;
    if (settingsAppSettings) settingsAppSettings.autoLaunch = result.autoLaunch === true;
    setSettingsNote(result.autoLaunch ? '已开启开机自动启动。' : '已关闭开机自动启动。');
  });
  window.slateAPI?.onAppSettingsChanged?.((settings) => {
    settingsAppSettings = settings;
    renderSettingsPanel();
  });
  window.slateAPI?.onWorkspaceChanged?.(() => refreshSettingsPanel());

  async function loadRecordingAudio(recording, container) {
    if (!window.slateAPI || !recording.audioPath) return;
    const result = await window.slateAPI.readRecording(recording.audioPath);
    if (!result || selectedRecordingId !== recording.id || !container.isConnected) {
      container.textContent = '音频文件不可用';
      return;
    }
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = URL.createObjectURL(new Blob([result.bytes], { type: result.mimeType }));
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = currentAudioUrl;
    container.replaceChildren(audio);
  }

  function renderRecordingDetail() {
    if (!recordingDetail) return;
    const recording = recordings.find((item) => item.id === selectedRecordingId);
    recordingDetail.replaceChildren();
    if (!recording) {
      const empty = document.createElement('div');
      empty.className = 'recording-detail-empty';
      empty.textContent = '完成一次录音后，音频和转写文本会保存在这里。';
      recordingDetail.appendChild(empty);
      return;
    }
    if (recording.isDraft) {
      const liveHeader = document.createElement('header');
      liveHeader.className = 'recording-live-head';
      const liveState = document.createElement('div');
      liveState.className = 'recording-live-state';
      const liveDot = document.createElement('span');
      liveDot.className = 'recording-state-dot';
      liveDot.dataset.recordingLiveDot = '';
      liveDot.dataset.state = recordingStatus;
      const liveLabel = document.createElement('strong');
      liveLabel.dataset.recordingLiveState = '';
      const liveTime = document.createElement('time');
      liveTime.dataset.recordingLiveTime = '';
      liveState.append(liveDot, liveLabel);
      liveHeader.append(liveState, liveTime);

      const liveAudio = document.createElement('div');
      liveAudio.className = 'recording-live-audio';
      const liveAudioTitle = document.createElement('strong');
      liveAudioTitle.dataset.recordingLiveAudioTitle = '';
      liveAudioTitle.textContent = '音频正在本机录制';
      const liveAudioHint = document.createElement('span');
      liveAudioHint.dataset.recordingLiveAudioHint = '';
      liveAudioHint.textContent = '结束后会自动保存并出现播放器';
      const liveControls = document.createElement('div');
      liveControls.className = 'recording-live-controls';
      const pause = document.createElement('button');
      pause.type = 'button';
      pause.className = 'workspace-button compact recording-live-pause';
      pause.textContent = recordingStatus === 'paused' ? '继续' : '暂停';
      pause.addEventListener('click', togglePauseRecording);
      const stop = document.createElement('button');
      stop.type = 'button';
      stop.className = 'workspace-button compact primary recording-live-stop';
      stop.textContent = '结束并保存';
      stop.addEventListener('click', stopRecording);
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'workspace-button compact primary recording-live-retry';
      retry.textContent = '重试保存';
      retry.hidden = true;
      retry.addEventListener('click', retryRecordingSave);
      const discard = document.createElement('button');
      discard.type = 'button';
      discard.className = 'workspace-button compact recording-live-discard';
      discard.textContent = '放弃';
      discard.hidden = true;
      discard.addEventListener('click', requestDiscardRecording);
      const cancelTranscription = document.createElement('button');
      cancelTranscription.type = 'button'; cancelTranscription.className = 'workspace-button compact recording-live-cancel-transcription';
      cancelTranscription.textContent = '取消转写'; cancelTranscription.hidden = true;
      cancelTranscription.addEventListener('click', () => window.slateAPI?.cancelTranscription?.());
      liveControls.append(pause, stop, cancelTranscription, retry, discard);
      liveAudio.append(liveAudioTitle, liveAudioHint, liveControls);

      const transcriptHead = document.createElement('div');
      transcriptHead.className = 'recording-transcript-head';
      const transcriptLabel = document.createElement('span');
      transcriptLabel.className = 'tile-label';
      transcriptLabel.textContent = recordingTranscriptionMode === 'file' ? '录音后转写' : '实时转写';
      const configure = document.createElement('button');
      configure.type = 'button';
      configure.className = 'workspace-button compact recording-live-configure';
      configure.dataset.action = 'configure-transcription';
      configure.textContent = '配置 API';
      configure.addEventListener('click', openTranscriptionSettings);
      transcriptHead.append(transcriptLabel, configure);

      const transcript = document.createElement('textarea');
      transcript.className = 'recording-transcript-editor recording-live-transcript';
      transcript.readOnly = true;
      transcript.dataset.recordingLiveTranscript = '';
      transcript.placeholder = '开始说话后，转写内容会出现在这里。';
      transcript.setAttribute('aria-label', '实时转写文本');
      const feedback = document.createElement('p');
      feedback.className = 'recording-live-feedback';
      feedback.dataset.recordingLiveFeedback = '';
      feedback.setAttribute('aria-live', 'polite');
      recordingDetail.append(liveHeader, liveAudio, transcriptHead, transcript, feedback);
      syncRecordingDraftUi();
      return;
    }
    const header = document.createElement('header');
    header.className = 'recording-detail-head';
    const title = document.createElement('input');
    title.className = 'recording-title-input';
    title.value = recording.title;
    title.setAttribute('aria-label', '录音名称');
    const meta = document.createElement('span');
    meta.textContent = `${recording.category || '未分类'} · ${formatShortDate(recording.createdAt)} · ${formatClock(recording.durationMs)}`;
    header.append(title, meta);

    const audioWrap = document.createElement('div');
    audioWrap.className = 'recording-audio';
    audioWrap.textContent = '正在读取音频…';

    const transcriptHead = document.createElement('div');
    transcriptHead.className = 'recording-transcript-head';
    const label = document.createElement('span');
    label.className = 'tile-label';
    label.textContent = '转写文本';
    const actions = document.createElement('div');
    actions.append(
      createIconButton('copy-recording', '复制转写文本', COPY_ICON),
      createIconButton('reveal-recording', '在文件夹中显示', OPEN_ICON),
      createIconButton('delete-recording', '删除录音', DELETE_ICON, true)
    );
    transcriptHead.append(label, actions);

    const transcript = document.createElement('textarea');
    transcript.className = 'recording-transcript-editor';
    transcript.value = recording.transcript;
    transcript.placeholder = '当前环境没有生成实时转写。你仍可播放音频，或在这里补充文字。';
    transcript.setAttribute('aria-label', '录音转写文本');
    recordingDetail.append(header, audioWrap, transcriptHead, transcript);

    title.addEventListener('change', () => {
      if (title.value.trim()) recording.title = title.value.trim();
      title.value = recording.title;
      persistRecordings();
      renderRecordingList();
    });
    transcript.addEventListener('input', () => {
      recording.transcript = transcript.value;
      persistRecordings();
    });
    actions.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'copy-recording' && window.slateAPI && recording.transcript) {
        await window.slateAPI.writeClipboard({ type: 'text', text: recording.transcript });
      }
      if (action.dataset.action === 'reveal-recording' && window.slateAPI && recording.audioPath) {
        await window.slateAPI.revealRecording(recording.audioPath);
      }
      if (action.dataset.action === 'delete-recording') {
        await deleteSingleRecording(recording.id);
      }
    });
    loadRecordingAudio(recording, audioWrap);
  }

  function recordingsWithRestoredItems(items) {
    const next = [...recordings];
    [...items].sort((a, b) => a.index - b.index).forEach(({ recording, index }) => {
      if (recording && !next.some((item) => item.id === recording.id)) {
        next.splice(Math.max(0, Math.min(index, next.length)), 0, recording);
      }
    });
    return next;
  }

  async function commitRecordingDeletion(token) {
    const entry = recordingDeletions.find((item) => item.token === token);
    if (!entry || committingRecordingDeletions.has(token)) return;
    committingRecordingDeletions.add(token);
    const failed = [];
    for (const item of entry.items) {
      const recording = item.recording;
      // Undo writes the restored list before dropping the journal. If closing
      // interrupts that second write, a restored row must never be deleted.
      if (!recording || recordings.some((row) => row.id === recording.id)) continue;
      const deleted = !recording.audioPath || await window.slateAPI?.deleteRecording(recording.audioPath).catch(() => false);
      if (!deleted) failed.push(item);
    }
    if (failed.length) {
      const next = recordingsWithRestoredItems(failed);
      if (saveJson(RECORDINGS_KEY, next.filter((item) => !item.isDraft))) {
        recordings = next;
        selectedRecordingId ||= failed[0].recording.id;
        renderRecordings();
        recordingDeletions = recordingDeletions.filter((item) => item.token !== token);
      } else {
        // Keep recovery metadata on disk if even restoring the list failed.
        entry.items = failed;
      }
      if (typeof showStatusToast === 'function') showStatusToast('音频删除失败，录音已保留，请稍后重试');
    } else recordingDeletions = recordingDeletions.filter((item) => item.token !== token);
    saveJson(RECORDING_DELETIONS_KEY, recordingDeletions);
    committingRecordingDeletions.delete(token);
  }

  function undoRecordingDeletion(token) {
    const entry = recordingDeletions.find((item) => item.token === token);
    if (!entry || committingRecordingDeletions.has(token)) return;
    const next = recordingsWithRestoredItems(entry.items);
    if (!saveJson(RECORDINGS_KEY, next.filter((item) => !item.isDraft))) {
      if (typeof showStatusToast === 'function') showStatusToast('未能撤销删除，录音恢复信息仍保留，请检查本机存储');
      return;
    }
    recordings = next;
    selectedRecordingId = entry.selectedId || entry.items[0]?.recording.id || recordings[0]?.id;
    recordingSelectionAnchor = selectedRecordingId || null;
    recordingDeletions = recordingDeletions.filter((item) => item.token !== token);
    saveJson(RECORDING_DELETIONS_KEY, recordingDeletions);
    renderRecordings();
    if (typeof showStatusToast === 'function') showStatusToast('已撤销删除录音');
  }

  function deleteRecordings(recordingIds) {
    const ids = new Set(recordingIds);
    const items = recordings.flatMap((recording, index) => !recording.isDraft && ids.has(recording.id) ? [{ recording, index }] : []);
    if (!items.length) return;
    const entry = { token: uid('recording-delete'), items, selectedId: selectedRecordingId };
    const journal = [...recordingDeletions, entry];
    if (!saveJson(RECORDING_DELETIONS_KEY, journal)) {
      if (typeof showStatusToast === 'function') showStatusToast('删除未保存，录音仍保留，请检查本机存储');
      return;
    }
    const next = recordings.filter((item) => !ids.has(item.id));
    if (!saveJson(RECORDINGS_KEY, next.filter((item) => !item.isDraft))) {
      saveJson(RECORDING_DELETIONS_KEY, recordingDeletions);
      if (typeof showStatusToast === 'function') showStatusToast('删除未保存，录音仍保留，请检查本机存储');
      return;
    }
    recordingDeletions = journal;
    recordings = next;
    recordingSelection = new Set([...recordingSelection].filter((id) => !ids.has(id)));
    if (ids.has(selectedRecordingId)) selectedRecordingId = recordings[0]?.id || '';
    recordingSelectionAnchor = selectedRecordingId || null;
    renderRecordings();
    if (typeof showStatusToast === 'function') {
      showStatusToast(items.length === 1 ? '已删除录音' : `已删除 ${items.length} 条录音`, {
        actionLabel: '撤销', duration: 6000,
        onAction: () => undoRecordingDeletion(entry.token),
        onExpire: () => commitRecordingDeletion(entry.token),
      });
    } else commitRecordingDeletion(entry.token);
  }

  function deleteSingleRecording(recordingId) {
    deleteRecordings([recordingId]);
  }

  function renderRecordingList() {
    if (!recordingList) return;
    recordingList.replaceChildren();
    if (recordingBulkDelete) {
      recordingBulkDelete.hidden = recordingSelection.size === 0;
      recordingBulkDelete.textContent = '删除';
      recordingBulkDelete.setAttribute('aria-label', recordingSelection.size
        ? `删除 ${recordingSelection.size} 项`
        : '删除所选');
    }
    if (!recordings.length) {
      const empty = document.createElement('div');
      empty.className = 'recording-list-empty';
      empty.textContent = '还没有录音';
      recordingList.appendChild(empty);
      return;
    }
    recordings.forEach((recording) => {
      const row = document.createElement('div');
      row.className = `recording-item${recording.id === selectedRecordingId ? ' active' : ''}${recordingSelection.has(recording.id) ? ' multi-selected' : ''}${recording.isDraft ? ' is-live' : ''}`;
      row.dataset.id = recording.id;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'recording-item-main';
      button.setAttribute('aria-label', `打开录音：${recording.title}`);
      const title = document.createElement('strong');
      title.textContent = recording.title;
      const preview = document.createElement('span');
      preview.dataset.recordingPreview = '';
      preview.textContent = recording.isDraft ? (currentRecordingText() || currentRecordingFeedback()) : (recording.transcript || '仅音频 · 暂无转写');
      const meta = document.createElement('time');
      meta.dataset.recordingMeta = '';
      meta.textContent = recording.isDraft
        ? `${recordingStatus === 'saving' ? '保存中' : pendingRecordingSave ? '未保存' : recordingStatus === 'paused' ? '已暂停' : '录音中'} · ${formatClock(recording.durationMs)}`
        : `${formatShortDate(recording.createdAt)} · ${formatClock(recording.durationMs)}`;
      button.append(title, preview, meta);
      row.append(button);
      if (!recording.isDraft) {
        const remove = createIconButton('delete-recording-item', `删除录音：${recording.title}`, DELETE_ICON, true);
        remove.classList.add('recording-item-delete');
        row.append(remove);
      }
      recordingList.appendChild(row);
    });
  }

  function renderRecordings() {
    if (recordingCount) recordingCount.textContent = `${recordings.length} 条`;
    renderRecordingList();
    renderRecordingDetail();
  }

  if (recordingList) {
    recordingList.addEventListener('click', async (event) => {
      const remove = event.target.closest('[data-action="delete-recording-item"]');
      if (remove) {
        event.preventDefault();
        event.stopPropagation();
        const row = remove.closest('.recording-item[data-id]');
        if (row) await deleteSingleRecording(row.dataset.id);
        return;
      }
      const item = event.target.closest('.recording-item[data-id]');
      if (!item) return;
      const targetRecording = recordings.find((recording) => recording.id === item.dataset.id);
      if (event.shiftKey && targetRecording && !targetRecording.isDraft) {
        event.preventDefault();
        const result = Domain.updateRangeSelection(
          recordings.filter((recording) => !recording.isDraft).map((recording) => recording.id),
          [...recordingSelection],
          item.dataset.id,
          recordingSelectionAnchor,
          true
        );
        recordingSelection = new Set(result.selected);
        recordingSelectionAnchor = result.anchor;
        renderRecordingList();
        return;
      }
      selectedRecordingId = item.dataset.id;
      recordingSelectionAnchor = selectedRecordingId;
      renderRecordings();
    });
  }

  recordingBulkDelete?.addEventListener('click', async () => {
    if (!recordingSelection.size) return;
    deleteRecordings([...recordingSelection]);
  });

  // ============ 当前窗口 ============
  const windowsRefresh = document.getElementById('windows-refresh');
  const windowsHidden = document.getElementById('windows-hidden');
  const windowList = document.getElementById('window-list');
  let windows = [];
  let hiddenWindows = new Set(loadJson(HIDDEN_WINDOWS_KEY, []).filter((item) => typeof item === 'string'));
  let windowsLoading = false;
  let workspaceTab = document.querySelector('.tab.active')?.dataset.tab || 'home';
  let workspaceExpanded = document.getElementById('app')?.classList.contains('expanded') || false;
  let homeWindowsVisible = window.SlateHome?.isVisible?.('windows') !== false;
  let windowDrag = null;
  let suppressWindowClickUntil = 0;

  function windowHideKey(windowInfo) {
    return `${String(windowInfo.appName || '').trim()}\u0000${String(windowInfo.title || '').trim()}`;
  }

  function persistHiddenWindows() {
    saveJson(HIDDEN_WINDOWS_KEY, [...hiddenWindows]);
  }

  function clearWindowDragVisuals() {
    const drag = windowDrag;
    windowDrag = null;
    if (drag) {
      clearTimeout(drag.timer);
      try {
        if (drag.item.hasPointerCapture?.(drag.pointerId)) drag.item.releasePointerCapture(drag.pointerId);
      } catch (error) {}
      drag.item.classList.remove('dragging', 'remove-ready');
      drag.item.style.removeProperty('--window-drag-x');
      drag.item.style.removeProperty('--window-drag-y');
    }
    document.querySelectorAll('.home-windows.drag-active').forEach((card) => {
      card.classList.remove('drag-active');
    });
    return drag;
  }

  function renderWindows(error = '') {
    if (!windowList) return;
    // 轮询可能在长按过程中重建列表；先清理捕获与卡片移除态，避免红色区域残留。
    clearWindowDragVisuals();
    windowList.replaceChildren();
    if (error) {
      const empty = document.createElement('div');
      empty.className = 'window-empty permission';
      // 两种权限的现象完全一样（列表空），但要开的开关不同，必须分开说：
      // 「屏幕录制」决定能不能读到窗口标题，「辅助功能」决定能不能枚举和聚焦窗口。
      // 缺屏幕录制时系统既不报错也不弹提示，所以只能由这里告诉用户。
      const screenRecording = error === 'screen_recording_permission_required';
      const title = screenRecording ? '需要“屏幕录制”权限' : '需要“辅助功能”权限';
      const pane = screenRecording ? '屏幕录制与系统录音' : '辅助功能';
      const heading = document.createElement('strong');
      heading.textContent = title;
      const hint = document.createElement('span');
      hint.textContent = `系统设置 → 隐私与安全性 → ${pane}，允许 Slate 后重试。`;
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'window-permission-open';
      action.textContent = '打开系统设置';
      action.addEventListener('click', () => {
        if (window.slateAPI && typeof window.slateAPI.openPrivacySettings === 'function') {
          window.slateAPI.openPrivacySettings(screenRecording ? 'screen-recording' : 'accessibility');
        }
      });
      empty.append(heading, hint, action);
      windowList.appendChild(empty);
      return;
    }
    const visibleWindows = Domain.numberWindowLabels(
      windows.filter((item) => !hiddenWindows.has(windowHideKey(item)))
    );
    if (windowsHidden) {
      windowsHidden.hidden = hiddenWindows.size === 0;
      windowsHidden.textContent = '隐藏';
      windowsHidden.setAttribute('aria-label', `恢复已隐藏的 ${hiddenWindows.size} 个窗口`);
    }
    if (!visibleWindows.length) {
      const empty = document.createElement('div');
      empty.className = 'window-empty';
      empty.textContent = windowsLoading
        ? '正在读取当前窗口…'
        : hiddenWindows.size
          ? '窗口均已隐藏 · 点击上方恢复'
          : '没有读取到可切换窗口';
      windowList.appendChild(empty);
      return;
    }
    visibleWindows.slice(0, 15).forEach((windowInfo) => {
      const button = document.createElement('button');
      button.className = 'window-item';
      button.type = 'button';
      button.dataset.id = windowInfo.id;
      button.title = `${windowInfo.displayName}\n${windowInfo.title}\n长按后拖出卡片可隐藏`;
      const mark = document.createElement('span');
      mark.className = 'window-app-mark';
      if (windowInfo.icon) {
        const icon = document.createElement('img');
        icon.src = windowInfo.icon;
        icon.alt = '';
        icon.draggable = false;
        mark.appendChild(icon);
      } else {
        mark.textContent = (windowInfo.appName.charAt(0) || '·').toUpperCase();
      }
      const appName = document.createElement('strong');
      appName.textContent = windowInfo.displayName;
      button.append(mark, appName);
      windowList.appendChild(button);
    });
  }

  async function refreshWindows(force = false) {
    if (!window.SlateHome?.isVisible?.('windows')) return;
    if (windowsLoading || !window.slateAPI || (!force && (!workspaceExpanded || workspaceTab !== 'home'))) return;
    windowsLoading = true;
    renderWindows();
    let result;
    try {
      result = await window.slateAPI.listWindows();
    } catch (error) {
      result = { items: [], error: 'accessibility_permission_required' };
    }
    windowsLoading = false;
    windows = result && Array.isArray(result.items) ? result.items : [];
    renderWindows(result && result.error);
  }

  if (windowsRefresh) windowsRefresh.addEventListener('click', () => refreshWindows(true));
  if (windowsHidden) {
    windowsHidden.addEventListener('click', () => {
      hiddenWindows.clear();
      persistHiddenWindows();
      renderWindows();
    });
  }
  if (windowList) {
    windowList.addEventListener('click', (event) => {
      if (Date.now() < suppressWindowClickUntil) return;
      const item = event.target.closest('.window-item[data-id]');
      if (item && window.slateAPI) window.slateAPI.focusWindow(item.dataset.id);
    });
    windowList.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || windowDrag) return;
      const item = event.target.closest('.window-item[data-id]');
      if (!item) return;
      windowDrag = {
        item,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        removeReady: false,
        timer: setTimeout(() => {
          if (!windowDrag || windowDrag.item !== item) return;
          windowDrag.active = true;
          item.classList.add('dragging');
          try { item.setPointerCapture(event.pointerId); } catch (error) {}
          item.closest('.home-windows')?.classList.add('drag-active');
        }, 460),
      };
    });
    document.addEventListener('pointermove', (event) => {
      if (!windowDrag || windowDrag.pointerId !== event.pointerId) return;
      const dx = event.clientX - windowDrag.startX;
      const dy = event.clientY - windowDrag.startY;
      if (!windowDrag.active) {
        if (Math.hypot(dx, dy) > 8) {
          clearTimeout(windowDrag.timer);
          windowDrag = null;
        }
        return;
      }
      event.preventDefault();
      windowDrag.item.style.setProperty('--window-drag-x', `${dx}px`);
      windowDrag.item.style.setProperty('--window-drag-y', `${dy}px`);
      const bounds = windowList.closest('.home-windows').getBoundingClientRect();
      windowDrag.removeReady = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
      windowDrag.item.classList.toggle('remove-ready', windowDrag.removeReady);
    });
    const finishWindowDrag = (event) => {
      if (!windowDrag || (event.pointerId != null && windowDrag.pointerId !== event.pointerId)) return;
      const drag = clearWindowDragVisuals();
      if (!drag) return;
      if (!drag.active) return;
      suppressWindowClickUntil = Date.now() + 450;
      if (drag.removeReady) {
        const windowInfo = windows.find((item) => item.id === drag.item.dataset.id);
        if (windowInfo) {
          hiddenWindows.add(windowHideKey(windowInfo));
          persistHiddenWindows();
          renderWindows();
        }
      }
    };
    document.addEventListener('pointerup', finishWindowDrag);
    document.addEventListener('pointercancel', finishWindowDrag);
    windowList.addEventListener('lostpointercapture', () => clearWindowDragVisuals(), true);
    window.addEventListener('blur', clearWindowDragVisuals);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearWindowDragVisuals();
    });
  }

  document.addEventListener('slate:tabchange', (event) => {
    clearWindowDragVisuals();
    workspaceTab = event.detail && event.detail.tab || 'home';
    if (workspaceTab === 'home') refreshWindows();
    if (workspaceTab === 'settings') refreshSettingsPanel();
    if (workspaceTab === 'recordings') {
      loadTranscriptionConfig();
      renderRecordings();
    }
    if (workspaceTab === 'credentials') loadCredentials();
  });
  document.addEventListener('slate:modechange', (event) => {
    clearWindowDragVisuals();
    workspaceExpanded = !!(event.detail && event.detail.expanded);
    if (workspaceExpanded && workspaceTab === 'home') refreshWindows();
  });
  document.addEventListener('slate:home-modules-changed', (event) => {
    const nextVisible = Array.isArray(event.detail?.visibleIds)
      ? event.detail.visibleIds.includes('windows')
      : window.SlateHome?.isVisible?.('windows') !== false;
    const restored = !homeWindowsVisible && nextVisible;
    homeWindowsVisible = nextVisible;
    renderHomeModuleSettings();
    if (restored && workspaceExpanded && workspaceTab === 'home') refreshWindows(true);
  });

  // ============ 首页 · 快速启动 ============
  // 自定义常用软件：点图标直接打开；已在运行的实例会被带回前台。
  const LAUNCHER_APPS_KEY = 'slate-launcher-apps-v1';
  const launcherGrid = document.getElementById('launcher-grid');
  const launcherHint = document.getElementById('launcher-hint');
  const launcherAdd = document.getElementById('launcher-add');
  let launcherApps = loadJson(LAUNCHER_APPS_KEY, [])
    .filter((item) => item && typeof item === 'object' && typeof item.path === 'string' && item.path.trim())
    .map((item) => ({
      path: item.path,
      name: typeof item.name === 'string' && item.name.trim() ? item.name : '未命名',
      icon: typeof item.icon === 'string' && item.icon ? item.icon : null,
    }));
  let launcherBusy = false;

  function persistLauncherApps() {
    saveJson(LAUNCHER_APPS_KEY, launcherApps);
  }

  function notifyLauncher(message) {
    if (typeof showStatusToast === 'function') showStatusToast(message);
  }

  function renderLauncher() {
    if (!launcherGrid) return;
    launcherGrid.replaceChildren();
    if (launcherHint) launcherHint.hidden = launcherApps.length > 0;
    launcherApps.forEach((app, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'launcher-item';
      item.dataset.launcherIndex = String(index);
      item.title = app.path;
      item.setAttribute('aria-label', `打开 ${app.name}`);

      const icon = document.createElement('span');
      icon.className = 'launcher-icon';
      if (app.icon) {
        const image = document.createElement('img');
        image.src = app.icon;
        image.alt = '';
        image.draggable = false;
        icon.appendChild(image);
      } else {
        icon.textContent = (app.name || '?').trim().slice(0, 1).toUpperCase() || '?';
      }

      const label = document.createElement('span');
      label.className = 'launcher-name';
      label.textContent = app.name;

      const remove = document.createElement('span');
      remove.className = 'launcher-remove';
      remove.dataset.launcherRemove = String(index);
      remove.setAttribute('role', 'button');
      remove.setAttribute('aria-label', `移除 ${app.name}`);
      remove.textContent = '×';

      item.append(icon, label, remove);
      launcherGrid.appendChild(item);
    });
  }

  launcherGrid?.addEventListener('click', async (event) => {
    const removeButton = event.target.closest('[data-launcher-remove]');
    if (removeButton) {
      event.stopPropagation();
      event.preventDefault();
      const index = Number(removeButton.dataset.launcherRemove);
      const removed = launcherApps[index];
      launcherApps = launcherApps.filter((item, position) => position !== index);
      persistLauncherApps();
      renderLauncher();
      if (removed) notifyLauncher(`已移除 ${removed.name}`);
      return;
    }

    const item = event.target.closest('[data-launcher-index]');
    if (item) await launchLauncher(Number(item.dataset.launcherIndex));
  });

  async function launchLauncher(index) {
    if (!Number.isInteger(index) || launcherBusy) return false;
    const app = launcherApps[index];
    if (!app || typeof window.slateAPI?.openLauncherApp !== 'function') return false;
    const item = launcherGrid?.querySelector(`[data-launcher-index="${index}"]`);
    launcherBusy = true;
    item?.classList.add('launcher-opening');
    let result = null;
    try {
      result = await window.slateAPI.openLauncherApp(app.path);
    } catch (error) {
      result = null;
    }
    launcherBusy = false;
    item?.classList.remove('launcher-opening');
    if (!result || !result.ok) {
      notifyLauncher(result && result.error === 'missing'
        ? `找不到 ${app.name}，可能已被移动或卸载`
        : `无法打开 ${app.name}`);
      return false;
    }
    if (result.activated) notifyLauncher(`已切到 ${app.name}`);
    return true;
  }

  launcherAdd?.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (typeof window.slateAPI?.chooseLauncherApp !== 'function') return;
    let result = null;
    try {
      result = await window.slateAPI.chooseLauncherApp();
    } catch (error) {
      result = null;
    }
    if (!result || !result.ok || !result.app) return;
    const picked = result.app;
    if (launcherApps.some((item) => item.path === picked.path)) {
      notifyLauncher(`${picked.name} 已经在快速启动里`);
      return;
    }
    launcherApps = [...launcherApps, { path: picked.path, name: picked.name, icon: picked.icon || null }];
    persistLauncherApps();
    renderLauncher();
  });
  launcherHint?.addEventListener('click', () => launcherAdd?.click());

  renderLauncher();

  // 旧记录或首次读取失败时，补一次系统图标。
  if (launcherApps.some((app) => !app.icon) && typeof window.slateAPI?.readLauncherIcon === 'function') {
    (async () => {
      let changed = false;
      for (const app of launcherApps) {
        if (app.icon) continue;
        let icon = null;
        try {
          icon = await window.slateAPI.readLauncherIcon(app.path);
        } catch (error) {
          icon = null;
        }
        if (icon) {
          app.icon = icon;
          changed = true;
        }
      }
      if (changed) {
        persistLauncherApps();
        renderLauncher();
      }
    })();
  }

  // ============ 本机加密密钥库 ============
  const credentialService = document.getElementById('credential-service');
  const credentialAccount = document.getElementById('credential-account');
  const credentialPassword = document.getElementById('credential-password');
  const credentialSave = document.getElementById('credential-save');
  const credentialList = document.getElementById('credential-list');
  const credentialCount = document.getElementById('credential-count');
  const credentialSearch = document.getElementById('credential-search');
  const credentialBulkDelete = document.getElementById('credential-bulk-delete');
  const credentialsNote = document.getElementById('credentials-note');
  let credentials = [];
  let credentialSelection = new Set();
  let credentialAnchor = null;
  let editingCredentialId = '';
  let editingCredential = null;

  function updateCredentialBulkAction() {
    if (!credentialBulkDelete) return;
    credentialBulkDelete.hidden = credentialSelection.size === 0;
    credentialBulkDelete.textContent = '删除';
    credentialBulkDelete.setAttribute('aria-label', credentialSelection.size
      ? `删除 ${credentialSelection.size} 项`
      : '删除所选');
  }

  function animateCredentialExpansion(originRect) {
    const row = credentialList?.querySelector(`.credential-item.editing[data-id="${CSS.escape(editingCredentialId)}"]`);
    if (!row || !originRect || typeof row.animate !== 'function') return;
    requestAnimationFrame(() => {
      const targetRect = row.getBoundingClientRect();
      const scaleX = Math.max(0.2, originRect.width / Math.max(1, targetRect.width));
      const scaleY = Math.max(0.2, originRect.height / Math.max(1, targetRect.height));
      row.animate([
        {
          opacity: .72,
          transform: `translate(${originRect.left - targetRect.left}px, ${originRect.top - targetRect.top}px) scale(${scaleX}, ${scaleY})`,
          transformOrigin: 'top left',
        },
        { opacity: 1, transform: 'translate(0, 0) scale(1)', transformOrigin: 'top left' },
      ], { duration: 360, easing: 'cubic-bezier(.2,.9,.2,1)', fill: 'both' });
    });
  }

  function renderCredentials() {
    const visibleCredentials = Domain.filterCredentials(credentials, credentialSearch?.value || '');
    if (credentialCount) credentialCount.textContent = credentialSearch?.value.trim()
      ? `${visibleCredentials.length} / ${credentials.length} 项`
      : `${credentials.length} 项`;
    if (!credentialList) return;
    credentialList.replaceChildren();
    if (!visibleCredentials.length) {
      const empty = document.createElement('div');
      empty.className = 'credential-empty';
      empty.innerHTML = credentials.length
        ? '<strong>没有匹配的密钥</strong><span>可按名称或账号继续检索</span>'
        : '<strong>还没有保存密钥</strong><span>账号与密码会加密保存在本机</span>';
      credentialList.appendChild(empty);
      updateCredentialBulkAction();
      return;
    }
    visibleCredentials.forEach((credential) => {
      if (editingCredentialId === credential.id && editingCredential) {
        const form = document.createElement('form');
        form.className = 'credential-item editing';
        form.dataset.id = credential.id;
        form.innerHTML = `
          <div class="credential-edit-head"><strong>修改密钥</strong><span>回车保存</span></div>
          <label><span>服务</span><input name="service" maxlength="80" autocomplete="off" /></label>
          <label><span>账号</span><input name="account" maxlength="320" autocomplete="off" /></label>
          <label><span>密码</span><input name="password" type="text" maxlength="4096" autocomplete="off" spellcheck="false" /></label>
          <div class="credential-edit-actions"><button type="button" data-credential-cancel>取消</button><button type="submit">保存</button></div>
        `;
        form.elements.service.value = editingCredential.service || '';
        form.elements.account.value = editingCredential.account || '';
        form.elements.password.value = editingCredential.password || '';
        credentialList.appendChild(form);
        return;
      }
      const row = document.createElement('article');
      row.className = `credential-item${credentialSelection.has(credential.id) ? ' multi-selected' : ''}`;
      row.dataset.id = credential.id;
      row.tabIndex = 0;
      const copy = document.createElement('div');
      copy.className = 'credential-copy';
      const service = document.createElement('strong');
      service.textContent = credential.service;
      const account = document.createElement('span');
      account.textContent = credential.account;
      const password = document.createElement('code');
      password.textContent = credential.passwordMask || '**********';
      copy.append(service, account, password);
      const actions = document.createElement('div');
      actions.className = 'credential-actions';
      const accountCopy = document.createElement('button');
      accountCopy.type = 'button';
      accountCopy.dataset.credentialCopy = 'account';
      accountCopy.textContent = '账号';
      accountCopy.setAttribute('aria-label', '复制账号');
      const passwordCopy = document.createElement('button');
      passwordCopy.type = 'button';
      passwordCopy.dataset.credentialCopy = 'password';
      passwordCopy.textContent = '密码';
      passwordCopy.setAttribute('aria-label', '复制密码');
      const deleteAction = Domain.credentialRowAction({ requestedAction: 'delete' });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.credentialDelete = 'true';
      remove.textContent = deleteAction.label;
      remove.setAttribute('aria-label', deleteAction.ariaLabel);
      actions.append(accountCopy, passwordCopy, remove);
      row.append(copy, actions);
      credentialList.appendChild(row);
    });
    updateCredentialBulkAction();
  }

  async function loadCredentials() {
    if (!window.slateAPI || typeof window.slateAPI.listCredentials !== 'function') return;
    let result;
    try { result = await window.slateAPI.listCredentials(); } catch (error) { result = null; }
    credentials = result && Array.isArray(result.items) ? result.items : [];
    if (credentialsNote && result && !result.secureStorage) {
      credentialsNote.textContent = '当前系统安全存储不可用，暂时无法保存密码。';
      credentialsNote.classList.add('error');
    }
    renderCredentials();
  }

  async function saveCredential() {
    if (!credentialSave || !window.slateAPI) return;
    const payload = {
      service: credentialService?.value || '',
      account: credentialAccount?.value || '',
      password: credentialPassword?.value || '',
    };
    if (!payload.service.trim() || !payload.account.trim() || !payload.password) {
      if (credentialsNote) {
        credentialsNote.textContent = '请完整填写软件、账号和密码。';
        credentialsNote.classList.add('error');
      }
      return;
    }
    credentialSave.disabled = true;
    const result = await window.slateAPI.saveCredential(payload).catch(() => ({ ok: false }));
    credentialSave.disabled = false;
    if (!result || !result.ok) {
      if (credentialsNote) {
        credentialsNote.textContent = '加密保存失败，请确认系统钥匙串可用。';
        credentialsNote.classList.add('error');
      }
      return;
    }
    if (credentialService) credentialService.value = '';
    if (credentialAccount) credentialAccount.value = '';
    if (credentialPassword) {
      credentialPassword.value = '';
      credentialPassword.placeholder = '保存后才会加密';
    }
    if (credentialsNote) {
      credentialsNote.textContent = '已使用系统安全存储加密保存。';
      credentialsNote.classList.remove('error');
    }
    await loadCredentials();
    credentialService?.focus();
  }

  credentialSave?.addEventListener('click', saveCredential);
  credentialSearch?.addEventListener('input', renderCredentials);
  [credentialService, credentialAccount, credentialPassword].forEach((input) => {
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        saveCredential();
      }
    });
  });
  credentialList?.addEventListener('click', async (event) => {
    const row = event.target.closest('.credential-item[data-id]');
    if (!row) return;
    if (event.target.closest('[data-credential-cancel]')) {
      editingCredentialId = '';
      editingCredential = null;
      renderCredentials();
      return;
    }
    if (row.classList.contains('editing')) return;
    const copyField = event.target.closest('[data-credential-copy]')?.dataset.credentialCopy;
    const action = Domain.credentialRowAction({
      requestedAction: event.target.closest('[data-credential-delete]') ? 'delete' : '',
      copyField,
      rowBody: Boolean(event.target.closest('.credential-copy')),
      shiftKey: event.shiftKey,
      selected: credentialSelection.has(row.dataset.id),
    });
    if (action.type === 'delete') {
      const deleteButton = event.target.closest('[data-credential-delete]');
      if (deleteButton) deleteButton.disabled = true;
      const result = await window.slateAPI.deleteCredentials([row.dataset.id]).catch(() => ({ ok: false }));
      if (!result?.ok) {
        if (deleteButton) deleteButton.disabled = false;
        if (credentialsNote) {
          credentialsNote.textContent = '删除失败，请稍后重试。';
          credentialsNote.classList.add('error');
        }
        return;
      }
      credentialSelection.delete(row.dataset.id);
      if (editingCredentialId === row.dataset.id) {
        editingCredentialId = '';
        editingCredential = null;
      }
      await loadCredentials();
      if (credentialsNote) {
        credentialsNote.textContent = '密钥已删除。';
        credentialsNote.classList.remove('error');
      }
      return;
    }
    if (action.type === 'copy') {
      const copied = await window.slateAPI.copyCredential(row.dataset.id, action.field).catch(() => false);
      if (credentialsNote) credentialsNote.textContent = copied ? `${copyField === 'password' ? '密码' : '账号'}已复制` : '复制失败';
      return;
    }
    if (action.type === 'edit') {
      const originRect = row.getBoundingClientRect();
      const result = await window.slateAPI.getCredential(row.dataset.id).catch(() => ({ ok: false }));
      if (!result || !result.ok || !result.item) return;
      editingCredentialId = result.item.id;
      editingCredential = result.item;
      renderCredentials();
      animateCredentialExpansion(originRect);
      if (credentialsNote) {
        credentialsNote.textContent = '已展开当前密钥，回车即可保存。';
        credentialsNote.classList.remove('error');
      }
      credentialList.querySelector('.credential-item.editing input[name="service"]')?.focus();
      return;
    }
    const result = window.SlateDomain.updateRangeSelection(
      Domain.filterCredentials(credentials, credentialSearch?.value || '').map((item) => item.id),
      [...credentialSelection],
      row.dataset.id,
      credentialAnchor,
      event.shiftKey,
      true
    );
    credentialSelection = new Set(result.selected);
    credentialAnchor = result.anchor;
    renderCredentials();
  });
  credentialList?.addEventListener('submit', async (event) => {
    const form = event.target.closest('.credential-item.editing[data-id]');
    if (!form) return;
    event.preventDefault();
    if (!editingCredentialId || !window.slateAPI) return;
    const payload = {
      id: editingCredentialId,
      service: form.elements.service?.value || '',
      account: form.elements.account?.value || '',
      password: form.elements.password?.value || '',
    };
    if (!payload.service.trim() || !payload.account.trim()) return;
    const saveButton = form.querySelector('button[type="submit"]');
    if (saveButton) saveButton.disabled = true;
    const result = await window.slateAPI.saveCredential(payload).catch(() => ({ ok: false }));
    if (saveButton) saveButton.disabled = false;
    if (!result?.ok) return;
    editingCredentialId = '';
    editingCredential = null;
    await loadCredentials();
  });
  credentialBulkDelete?.addEventListener('click', async () => {
    if (!credentialSelection.size || !window.slateAPI) return;
    const result = await window.slateAPI.deleteCredentials([...credentialSelection]).catch(() => ({ ok: false }));
    if (!result || !result.ok) return;
    credentialSelection.clear();
    credentialAnchor = null;
    await loadCredentials();
  });

  document.addEventListener('slate:clear-selection', () => {
    commandSelection.clear();
    commandSelectionAnchor = null;
    linkSelection.clear();
    linkSelectionAnchor = null;
    recordingSelection.clear();
    recordingSelectionAnchor = selectedRecordingId || null;
    credentialSelection.clear();
    credentialAnchor = null;
    renderCommands();
    renderLinkGroups();
    renderRecordingList();
    renderCredentials();
  });

  setInterval(() => refreshWindows(), 6000);

  window.addEventListener('beforeunload', (event) => {
    if (pendingRecordingSave || recordingStatus === 'saving') {
      event.preventDefault();
      event.returnValue = false;
      if (typeof showStatusToast === 'function') showStatusToast('录音尚未保存，请先重试保存或明确放弃本次录音');
      return;
    }
    stopSpeechRecognition();
    stopTranscriptionAudioPipeline();
    if (transcriptionStartPromise && window.slateAPI) window.slateAPI.finishTranscription().catch(() => {});
    stopMediaTracks();
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
  });

  renderCommands();
  renderLinkGroups();
  renderWindows();
  updateRecordingUi();
  loadTranscriptionConfig();

  // An unload can interrupt asynchronous file deletion. Its persistent journal
  // lets the next launch finish the work instead of leaking orphan audio files.
  function resumeRecordingDeletions() {
    if (typeof workspaceHydrating !== 'undefined' && workspaceHydrating) {
      setTimeout(resumeRecordingDeletions, 50);
      return;
    }
    if (typeof workspaceReloadPending !== 'undefined' && workspaceReloadPending) return;
    recordingDeletions.forEach((entry) => commitRecordingDeletion(entry.token));
  }
  resumeRecordingDeletions();

  window.SlateWorkspace = {
    saveSnippet(text,id){
      const value=String(text||'').trim();if(!value||value.length>16000)return {ok:false,error:'片段需为 1–16,000 字'};
      const current=id?commands.find(item=>item.id===id):null;if(id&&!current)return {ok:false,error:'原片段已删除，请另存为新片段'};
      const record=Domain.createCommand(value,current?.id||uid('command'),current?.createdAt||Date.now());
      const next=current?commands.map(item=>item.id===id?record:item):[record,...commands];
      if(!saveJson(COMMANDS_KEY,next))return {ok:false,error:'保存失败，文字已保留，请重试'};
      commands=next;renderCommands();return {ok:true,id:record.id};
    },
    refreshWindows,
    startRecording,
    isRecordingActive: isRecordingBusy,
    launchLauncher,
  };
})();
