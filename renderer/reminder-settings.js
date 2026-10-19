(function () {
  'use strict';
  const api = window.slateAPI;
  const column = document.querySelector('.settings-column-secondary');
  if (!column || !api?.getReminderSettings || !api?.setReminderSettings) return;
  const section = document.createElement('section');
  section.className = 'tile settings-card settings-device-card settings-reminder-card';
  section.id = 'settings-todo-reminders';
  section.innerHTML = `
    <div class="settings-card-heading"><div><strong>待办提醒</strong></div><label class="settings-compact-toggle"><span>开启</span><input id="reminders-enabled" type="checkbox" aria-label="开启待办提醒" /><i aria-hidden="true"></i></label></div>
    <p id="reminders-behavior">设置截止时间后，到点自动提醒；逾期事项合并提示。</p>
    <div class="settings-device-row"><div><span>未完成汇总</span><small id="reminders-summary-description">每天提醒今天未完成和已逾期的事项。</small></div><label class="settings-compact-toggle"><span>开启</span><input id="reminders-summary-enabled" type="checkbox" aria-label="开启未完成事项汇总" /><i aria-hidden="true"></i></label></div>
    <label class="settings-device-row" id="reminders-time-row"><div><span>每天几点提醒</span></div><input id="reminders-summaryTime" type="time" aria-label="汇总提醒时间" /></label>
    <div id="reminders-custom-settings" hidden><p>保留了你之前的自定义提醒设置。</p><div class="settings-actions"><button id="reminders-reset" type="button">恢复推荐设置</button></div></div>
    <p>Slate 在后台运行时才会提醒；休眠期间的提醒会在唤醒后补发。</p><p id="reminders-status" class="settings-inline-note" role="status" aria-live="polite"></p><button id="reminders-retry" type="button" hidden>重新读取设置</button>`;
  column.append(section);
  const $ = id => document.getElementById(id);
  let saved = null;
  let saving = false;
  let activeSummaryMode = 'daily';
  function note(message, error = false) { $('reminders-status').textContent = message; $('reminders-status').classList.toggle('error', error); }
  function render() {
    const disabled = saving || !saved;
    $('reminders-enabled').disabled = disabled;
    $('reminders-enabled').checked = !!saved?.enabled;
    $('reminders-summary-enabled').disabled = disabled || !saved.enabled;
    $('reminders-summary-enabled').checked = !!saved && saved.summaryMode !== 'off';
    $('reminders-summaryTime').disabled = disabled || !saved.enabled;
    $('reminders-reset').disabled = disabled;
    if (!saved) { $('reminders-time-row').style.display = 'none'; return; }
    if (saved.summaryMode !== 'off') activeSummaryMode = saved.summaryMode;
    $('reminders-summaryTime').value = saved.summaryTime;
    const mode = saved.summaryMode;
    const activeMode = mode === 'off' ? activeSummaryMode : mode;
    const names = ['日', '一', '二', '三', '四', '五', '六'];
    $('reminders-summary-description').textContent = activeMode === 'daily' ? '每天提醒今天未完成和已逾期的事项。' : activeMode === 'weekdays' ? '按你之前的设置，仅在工作日汇总。' : activeMode === 'weekly' ? `按你之前的设置，每周${names[saved.summaryWeekday]}汇总。` : `按你之前的设置，每隔 ${saved.intervalMinutes} 分钟汇总。`;
    $('reminders-time-row').style.display = mode !== 'off' && mode !== 'interval' ? '' : 'none';
    $('reminders-time-row').querySelector('span').textContent = activeMode === 'daily' ? '每天几点提醒' : '汇总提醒时间';
    const behavior = [];
    if (saved.deadlines) behavior.push(saved.advanceMinutes ? `截止前 ${saved.advanceMinutes} 分钟和到点提醒` : '到点自动提醒');
    else behavior.push('到点提醒已关闭');
    behavior.push(saved.overdue ? '逾期事项合并提示' : '逾期提醒已关闭');
    $('reminders-behavior').textContent = behavior.join('；') + '。';
    const customized = !saved.deadlines || !saved.followups || !saved.overdue || saved.advanceMinutes !== 0 || !['off', 'daily'].includes(mode);
    $('reminders-custom-settings').hidden = !customized;
    $('reminders-custom-settings').style.display = customized ? '' : 'none';
  }
  async function load() {
    saving = true; render(); note('正在读取…'); $('reminders-retry').hidden = true;
    try { const result = await api.getReminderSettings(); if (!result?.ok) throw new Error(result?.error || '读取失败'); saved = result.settings; note(''); }
    catch (error) { note(`提醒设置读取失败：${error.message}`, true); $('reminders-retry').hidden = false; }
    finally { saving = false; render(); }
  }
  async function update(patch) {
    if (saving || !saved) return;
    saving = true; render(); note('正在保存…');
    try { const result = await api.setReminderSettings(patch); if (!result?.ok) throw new Error(result?.error || '保存失败'); saved = result.settings; note(saved.enabled ? '提醒设置已保存。' : '已关闭待办提醒。'); }
    catch (error) { note(error.message || '设置保存失败，请重试。', true); }
    finally { saving = false; render(); }
  }
  $('reminders-enabled').addEventListener('change', event => update({ enabled: event.target.checked }));
  $('reminders-summary-enabled').addEventListener('change', event => update({ summaryMode: event.target.checked ? activeSummaryMode : 'off' }));
  $('reminders-summaryTime').addEventListener('change', event => {
    if (!event.target.value) { render(); note('请选择有效的提醒时间。', true); return; }
    update({ summaryTime: event.target.value });
  });
  $('reminders-reset').addEventListener('click', () => update({ deadlines: true, followups: true, overdue: true, advanceMinutes: 0, summaryMode: 'daily', summaryTime: '18:00' }));
  $('reminders-retry').addEventListener('click', load);
  render(); load();
}());
