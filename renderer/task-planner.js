(() => {
  'use strict';
  const KEY = 'slate-recurring-tasks-v1', engine = window.SlateRecurrence;
  let busy = false, editingId = '', dialog, rulesReadError = false, lastStorageErrorAt = 0, draftAttachments = [];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  function load() {
    try {
      const rows = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (!Array.isArray(rows)) throw Error('invalid rules');
      const normalized = rows.map(engine.normalizeRule);
      if (normalized.some(row => !row)) throw Error('invalid rule');
      rulesReadError = false;
      return normalized;
    } catch {
      rulesReadError = true;
      message('重复规则无法读取，已保留原数据。请先导出备份并恢复数据。');
      return [];
    }
  }
  function persist(rows) {
    if (rulesReadError) { message('重复规则无法读取，已保留原数据，请先备份恢复。'); return false; }
    try { localStorage.setItem(KEY, JSON.stringify(rows)); return true; }
    catch { message('存储空间不足，重复规则没有保存'); return false; }
  }
  function message(text) {
    if (dialog) dialog.querySelector('.repeat-message').textContent = text;
    if (!dialog?.open && /不足|无法|失败/.test(text) && Date.now() - lastStorageErrorAt > 60000) {
      lastStorageErrorAt = Date.now();
      if (typeof showStatusToast === 'function') showStatusToast(text);
    }
  }
  function generate() {
    if (busy || !window.SlateTasks?.isReady()) return;
    busy = true;
    try {
      const rows = load(); let changed = false;
      const today = engine.key(new Date());
      for (const rule of rows) {
        const day = engine.latestOccurrence(rule, today);
        if (!day) continue;
        const task = engine.taskForDate(rule, day);
        if (window.SlateTasks.addScheduled(task, rule.bucket)) { rule.lastGeneratedDate = day; changed = true; }
      }
      if (changed) persist(rows);
    } finally { busy = false; }
  }
  function host() {
    let element = document.getElementById('todo-v15-actions');
    if (!element) { element = document.createElement('div'); element.id = 'todo-v15-actions'; document.querySelector('#tab-todo .todo-toolbar')?.append(element); }
    return element;
  }
  function open(source) {
    ensure(); editingId = ''; draftAttachments = Array.isArray(source?.attachments) ? source.attachments.slice(0, 8) : [];
    const form = dialog.querySelector('form'); form.reset();
    const start = new Date(); if (source) start.setDate(start.getDate() + 1);
    dialog.querySelector('[name=startDate]').value = engine.key(start);
    dialog.querySelector('[name=endDate]').value = '';
    dialog.querySelector('[name=title]').value = source?.text || '';
    dialog.querySelector('[name=notes]').value = source?.notes || '';
    dialog.querySelector('[name=bucket]').innerHTML = window.SlateTasks.categories().map(row => `<option value="${escape(row.id)}">${escape(row.name)}</option>`).join('');
    dialog.querySelector('[name=bucket]').value = source?.bucket || (window.SlateTasks.categories().some(row => row.id === 'P3') ? 'P3' : window.SlateTasks.categories()[0]?.id || '');
    dialog.querySelector('[name=frequency]').value = 'daily';
    dialog.querySelector('[name=deadlineTime]').value = '18:00';
    dialog.querySelector('[name=monthDay]').value = start.getDate();
    dialog.querySelectorAll('[name=weekday]').forEach(element => { element.checked = Number(element.value) === start.getDay(); });
    dialog.querySelector('.repeat-more').open = false;
    dialog.querySelector('.repeat-editor-scroll').scrollTop = 0;
    render(); fields(); editingState();
    if (!dialog.open) dialog.showModal();
    message(rulesReadError ? '重复规则无法读取，已停止覆盖。请先备份恢复。' : source ? `从开始日新建重复事项，原待办保留${draftAttachments.length ? '，并保留 ' + draftAttachments.length + ' 张图片' : ''}。` : '');
    dialog.querySelector('[name=title]').focus();
  }
  function editingState() {
    dialog.querySelector('[data-reset]').hidden = !editingId;
    dialog.querySelector('[type=submit]').textContent = editingId ? '保存修改' : '添加重复事项';
  }
  function fields() {
    const frequency = dialog.querySelector('[name=frequency]').value;
    dialog.querySelector('.repeat-weekdays').hidden = frequency !== 'weekly';
    dialog.querySelector('.repeat-monthday').hidden = frequency !== 'monthly';
    dialog.querySelector('.repeat-end').hidden = frequency === 'once';
  }
  function render() {
    const rows = load();
    dialog.querySelector('.repeat-rule-count').textContent = rows.length ? String(rows.length) : '';
    dialog.querySelector('.repeat-rules').innerHTML = rows.map(rule => {
      const ended = rule.endDate && rule.endDate < engine.key(new Date());
      const cadence = { daily: '每天', weekly: '每周' + rule.weekdays.map(day => ['日', '一', '二', '三', '四', '五', '六'][day]).join('、'), monthly: '每月 ' + rule.monthDay + ' 日', once: '指定日期' }[rule.frequency];
      return `<article class="repeat-rule" data-rule="${escape(rule.id)}"><div><strong>${escape(rule.title)}</strong><span>${cadence}${rule.deadlineTime ? ' · ' + rule.deadlineTime : ''}${rule.enabled ? ended ? ' · 已结束' : '' : ' · 已暂停'}</span><small>${rule.startDate}${rule.endDate ? ' 至 ' + rule.endDate : ' 起'}</small></div><section class="repeat-rule-actions"><button type="button" data-repeat="edit">编辑</button><button type="button" data-repeat="toggle">${rule.enabled ? '暂停' : '恢复'}</button><button type="button" data-repeat="delete" aria-label="删除规则：${escape(rule.title)}">删除</button></section></article>`;
    }).join('') || '<p class="repeat-empty">还没有重复事项。<br>添加一次，到日子自动出现在待办里。</p>';
  }
  function ensure() {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.className = 'v15-dialog'; dialog.id = 'repeat-dialog'; dialog.setAttribute('aria-labelledby', 'repeat-heading');
    dialog.innerHTML = `
      <header><div><h2 id="repeat-heading">重复事项</h2><p>设置一次，按日期自动加入待办。</p></div><button type="button" data-close aria-label="关闭重复事项">关闭</button></header>
      <div class="repeat-workspace">
        <div class="repeat-editor-scroll"><form id="repeat-rule-form" class="repeat-editor"><div class="repeat-form">
          <label class="full">事项<input name="title" maxlength="600" required placeholder="例如：整理项目周报"></label>
          <label>重复方式<select name="frequency"><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="once">指定日期，仅一次</option></select></label>
          <label>开始日期<input name="startDate" type="date" required></label>
          <div class="repeat-weekdays full" hidden><span>每周哪几天</span><div>${[1, 2, 3, 4, 5, 6, 0].map(day => `<label><input type="checkbox" name="weekday" value="${day}">${['日', '一', '二', '三', '四', '五', '六'][day]}</label>`).join('')}</div></div>
          <label class="repeat-monthday" hidden>每月几号<input name="monthDay" type="number" min="1" max="31"><small>当月没有该日时，在月末生成。</small></label>
          <label>提醒时间<input name="deadlineTime" type="time"><small>可留空，仅按日期加入待办。</small></label>
        </div><details class="repeat-more"><summary>更多选项</summary><div class="repeat-form">
          <label>分类<select name="bucket"></select></label>
          <label class="repeat-end">结束日期<input name="endDate" type="date"><small>不填则持续生成。</small></label>
          <label class="check full"><input name="important" type="checkbox">设为当日重点</label>
          <label class="full">说明<textarea name="notes" maxlength="6000" placeholder="补充信息，选填"></textarea></label>
        </div></details></form></div>
        <section class="repeat-list" aria-label="已有重复事项"><h3>已设置 <span class="repeat-rule-count"></span></h3><div class="repeat-rules"></div></section>
      </div>
      <footer><span class="repeat-message" role="status" aria-live="polite"></span><div class="repeat-footer-actions"><button type="button" data-reset hidden>新建事项</button><button class="primary" type="submit" form="repeat-rule-form">添加重复事项</button></div></footer>
      <p class="repeat-footnote">暂停只影响之后的生成；Slate 关闭时，下次启动仅补最近一次。</p>`;
    document.body.append(dialog);
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    dialog.querySelector('[data-reset]').onclick = () => open();
    dialog.querySelector('[name=frequency]').onchange = fields;
    dialog.querySelector('form').onsubmit = event => {
      event.preventDefault();
      if (!window.SlateTasks.isReady()) { message('工作区正在加载，请稍后重试'); return; }
      const form = new FormData(event.currentTarget), rows = load(), old = rows.find(rule => rule.id === editingId), frequency = form.get('frequency');
      if (frequency === 'weekly' && !form.getAll('weekday').length) { message('请选择至少一个星期'); return; }
      const rule = engine.normalizeRule({ ...old, id: editingId || crypto.randomUUID(), title: form.get('title'), notes: form.get('notes'), bucket: form.get('bucket'), frequency, startDate: form.get('startDate'), endDate: frequency === 'once' ? '' : form.get('endDate'), deadlineTime: form.get('deadlineTime'), weekdays: form.getAll('weekday').map(Number), monthDay: Number(form.get('monthDay')), important: form.has('important'), attachments: old?.attachments || draftAttachments, updatedAt: Date.now() });
      if (!rule) { message('请填写事项，并检查开始和结束日期'); return; }
      const index = rows.findIndex(row => row.id === rule.id); if (index < 0) rows.push(rule); else rows[index] = rule;
      if (persist(rows)) { editingId = rule.id; generate(); render(); editingState(); message('已保存，到日子会自动加入待办。'); }
    };
    dialog.querySelector('.repeat-rules').onclick = event => {
      const button = event.target.closest('[data-repeat]'), id = button?.closest('[data-rule]')?.dataset.rule;
      if (!id) return;
      const rows = load(), rule = rows.find(row => row.id === id);
      if (!rule) return;
      if (button.dataset.repeat === 'edit') {
        editingId = id; draftAttachments = rule.attachments.slice();
        for (const name of ['title', 'notes', 'bucket', 'frequency', 'startDate', 'endDate', 'deadlineTime', 'monthDay']) dialog.querySelector(`[name=${name}]`).value = rule[name] || '';
        dialog.querySelector('[name=important]').checked = rule.important;
        dialog.querySelectorAll('[name=weekday]').forEach(element => { element.checked = rule.weekdays.includes(Number(element.value)); });
        dialog.querySelector('.repeat-more').open = false;
        dialog.querySelector('.repeat-editor-scroll').scrollTop = 0;
        fields(); editingState(); message('正在编辑：' + rule.title);
        return;
      }
      if (button.dataset.repeat === 'delete') {
        if (!confirm('删除此重复规则？已生成的待办会保留。')) return;
        if (persist(rows.filter(row => row.id !== id))) { render(); if (editingId === id) open(); }
        return;
      }
      rule.enabled = !rule.enabled;
      if (rule.enabled) { const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); rule.lastGeneratedDate = engine.key(yesterday); }
      rule.updatedAt = Date.now();
      if (persist(rows)) { generate(); render(); message(rule.enabled ? '已恢复，之后按日期生成。' : '已暂停，已生成的待办保留。'); }
    };
  }
  function mount() {
    const element = host();
    if (element && !element.querySelector('[data-recurring-open]')) { const button = document.createElement('button'); button.type = 'button'; button.dataset.recurringOpen = ''; button.textContent = '重复事项'; button.onclick = () => open(); element.append(button); }
    document.querySelectorAll('#todo-list .todo-work-details').forEach(details => {
      if (details.querySelector('.repeat-task-action')) return;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'repeat-task-action'; button.textContent = '设为重复事项';
      button.onclick = () => { const id = details.closest('[data-id]').dataset.id; open(window.SlateTasks.getAll().find(task => task.id === id)); };
      (details.querySelector('.todo-extra-fields') || details).append(button);
    });
  }
  document.addEventListener('slate:tasks-rendered', mount);
  document.addEventListener('slate:tasks-changed', generate);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) generate(); });
  window.addEventListener('focus', generate);
  mount(); setInterval(generate, 60000); setTimeout(generate, 1500);
  window.slateAPI?.onSystemResume?.(generate);
  window.SlateRecurring = Object.freeze({ open, generate, getRules: load });
})();
