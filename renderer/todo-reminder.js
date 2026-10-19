(function () {
  'use strict';
  const api = window.todoReminderAPI;
  const $ = id => document.getElementById(id);
  let entries = [];
  let currentId = '';
  let busy = false;
  let failure = '';
  const controls = ['reminder-close', 'reminder-view', 'reminder-edit', 'reminder-complete', 'reminder-reschedule', 'reminder-acknowledge', 'reminder-prev', 'reminder-next', 'reminder-deadline', 'reminder-confirm'];
  let resizeFrame = 0, requestedHeight = 0;
  function fitWindow() {
    if (resizeFrame || !api.resize) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      const height = Math.ceil(document.querySelector('header').offsetHeight + document.querySelector('main').scrollHeight + 1);
      if (height === requestedHeight) return;
      requestedHeight = height;
      api.resize(height).catch(() => { requestedHeight = 0; });
    });
  }
  const label = { upcoming: '即将到期', deadline: '到了截止时间', overdue: '已逾期，仍未完成', followup: '到了跟进时间', summary: '未完成事项汇总' };
  function selected() { return entries.find(entry => entry.id === currentId) || entries[0]; }
  function dateText(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : ''; }
  function localInput(value) { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; }
  function render() {
    const item = selected();
    currentId = item?.id || '';
    controls.forEach(id => { $(id).disabled = busy || !item; });
    $('reminder-close').disabled = busy;
    $('reminder-task').textContent = item?.text || '当前没有待提醒的任务';
    $('reminder-kind').textContent = item ? label[item.kind] || '待办提醒' : '已处理';
    const index = entries.findIndex(entry => entry.id === currentId);
    $('reminder-count').textContent = entries.length ? `${index + 1} / ${entries.length}` : '';
    $('reminder-count').hidden = entries.length < 2;
    $('reminder-prev').hidden = entries.length < 2;
    $('reminder-next').hidden = entries.length < 2;
    document.querySelector('.pagination').classList.toggle('single', entries.length < 2);
    $('reminder-prev').disabled = busy || index <= 0;
    $('reminder-next').disabled = busy || index >= entries.length - 1;
    $('reminder-time').textContent = item?.kind === 'followup' ? `跟进时间：${dateText(item.followupAt)}` : item?.deadline ? `截止时间：${dateText(item.deadline)}` : item?.planDate ? `计划日期：${item.planDate}` : item?.planWeek ? `计划周：${item.planWeek} 起` : '';
    $('reminder-feedback').textContent = busy ? '正在保存，请稍候…' : failure;
    $('reminder-reschedule').setAttribute('aria-expanded', String(!$('reminder-reschedule-fields').hidden));
    fitWindow();
  }
  function update(data) {
    if (!data) return;
    document.documentElement.dataset.theme = data.theme === 'dark' ? 'dark' : 'light';
    entries = Array.isArray(data.entries) ? data.entries : [];
    if (data.error) failure = data.error;
    render();
    document.body.classList.add('ready');
  }
  async function act(action, extra = {}) {
    const item = selected();
    if (busy || !item) return;
    busy = true; failure = ''; render();
    try {
      const result = await api.action({ action, id: item.id, ...extra });
      if (!result?.ok) failure = result?.error || '操作未完成，请重试。';
      else if (action !== 'view') {
        entries = entries.filter(entry => entry.id !== item.id);
        $('reminder-reschedule-fields').hidden = true;
        failure = action === 'acknowledge' ? '这次提醒已确认，任务仍保留在待办中。' : '';
      }
    } catch (error) { failure = error.message || '操作失败，请重试。'; }
    finally { busy = false; render(); }
  }
  $('reminder-complete').addEventListener('click', () => act('complete'));
  $('reminder-acknowledge').addEventListener('click', () => act('acknowledge'));
  $('reminder-view').addEventListener('click', () => act('view'));
  $('reminder-edit').addEventListener('click', () => act('view'));
  $('reminder-reschedule').addEventListener('click', () => {
    const fields = $('reminder-reschedule-fields');
    fields.hidden = !fields.hidden;
    if (!fields.hidden) {
      const suggested = new Date(Math.max(Date.now() + 60 * 60 * 1000, Date.parse(selected()?.deadline) + 24 * 60 * 60 * 1000 || 0));
      $('reminder-deadline').value = localInput(suggested);
      $('reminder-deadline').min = localInput(Date.now() + 60000);
      $('reminder-deadline').focus();
    }
    $('reminder-reschedule').setAttribute('aria-expanded', String(!fields.hidden));
    fitWindow();
  });
  $('reminder-confirm').addEventListener('click', () => {
    const deadline = new Date($('reminder-deadline').value);
    if (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= Date.now()) { failure = '请选择当前时间之后的日期与时间。'; render(); return; }
    act('reschedule', { deadline: deadline.toISOString() });
  });
  for (const [id, direction] of [['reminder-prev', -1], ['reminder-next', 1]]) $(id).addEventListener('click', () => { const index = entries.findIndex(entry => entry.id === currentId); currentId = entries[index + direction]?.id || currentId; failure = ''; $('reminder-reschedule-fields').hidden = true; render(); });
  $('reminder-close').addEventListener('click', () => { if (!busy) api.close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !busy) api.close(); });
  api.onData(update);
  new ResizeObserver(fitWindow).observe(document.querySelector('main'));
  api.ready().then(update).catch(error => { failure = `无法读取提醒：${error.message || '请关闭后重试'}`; render(); document.body.classList.add('ready'); });
}());
