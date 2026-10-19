(function (root, factory) {
  const logic = factory();
  if (typeof module === 'object' && module.exports) module.exports = logic;
  else { root.SlateReportsLogic = logic; }
}(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const DEFAULT_TEMPLATE = '只输出可直接粘贴的纯文本工作报告，禁止 Markdown 标题、加粗、代码块和表格。保留真实时间范围、总事项和各状态数量，不虚构成果、原因、时间或协助需求。按提供的排版模板组织文字；空段写暂无。';
  const DEFAULT_TEMPLATES={day:DEFAULT_TEMPLATE+'日报突出今天的完成结果、未完成事项、顺延遗留与明日计划。',week:DEFAULT_TEMPLATE+'周报概括本周交付、未完成与遗留，并列出已安排的下周重点。',month:DEFAULT_TEMPLATE+'月报突出本月完成、未完成与遗留、已记录的问题卡点及所需资源或协助，以及已有的下月安排。未记录协助内容时如实写未记录，不推测依赖或责任人。'};
  const META='{{标题}}\n时间范围：{{时间范围}}\n总事项 {{总事项}} 项：已完成 {{已完成数量}} 项，未完成 {{未完成数量}} 项，顺延与遗留 {{遗留数量}} 项。\n\n';
  const DEFAULT_FORMATS={
    day:META+'一、今日完成（{{已完成数量}} 项）\n{{已完成}}\n\n二、今日未完成（{{未完成数量}} 项）\n{{未完成}}\n\n三、顺延与遗留（{{遗留数量}} 项）\n{{顺延遗留}}\n\n四、明日计划\n{{后续计划}}',
    week:META+'一、本周完成（{{已完成数量}} 项）\n{{已完成}}\n\n二、本周未完成（{{未完成数量}} 项）\n{{未完成}}\n\n三、顺延与遗留（{{遗留数量}} 项）\n{{顺延遗留}}\n\n四、下周重点\n{{后续计划}}',
    month:META+'一、本月完成（{{已完成数量}} 项）\n{{已完成}}\n\n二、未完成与遗留\n未完成（{{未完成数量}} 项）\n{{未完成}}\n顺延与遗留（{{遗留数量}} 项）\n{{顺延遗留}}\n\n三、问题与需要支持\n{{问题与协助}}\n\n四、下月安排\n{{后续计划}}'
  };
  const PROFILES_KEY='slate-report-profiles-v2';
  const HISTORY_KEY = 'slate-reports-v1';
  const TEMPLATE_KEY = 'slate-report-template-v1';
  const DRAFT_KEY = 'slate-report-draft-v1';
  function dateKey(value = new Date()) {
    const d = value instanceof Date ? value : new Date(value);
    return Number.isFinite(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
  }
  function localDate(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
    const [year, month, day] = key.split('-').map(Number);
    const d = new Date(0); d.setFullYear(year, month - 1, day); d.setHours(0, 0, 0, 0);
    return dateKey(d) === key ? d : null;
  }
  function periodRange(period = 'day', key = dateKey()) {
    if (!['day', 'week', 'month'].includes(period)) throw new TypeError('报告周期无效');
    const start = localDate(key);
    if (!start) throw new TypeError('报告日期无效');
    if (period === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    if (period === 'month') start.setDate(1);
    const end = new Date(start);
    if (period === 'month') end.setMonth(end.getMonth() + 1);
    else end.setDate(end.getDate() + (period === 'week' ? 7 : 1));
    const last = new Date(end); last.setDate(last.getDate() - 1);
    return { start: start.getTime(), end: end.getTime(), startDate: dateKey(start), endDate: dateKey(last) };
  }
  function dateTime(value) {
    const n = typeof value === 'number' ? value : Date.parse(value);
    if (!Number.isFinite(n) || n <= 0) return '';
    const d = new Date(n);
    return `${dateKey(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function planSpan(kind, day, week) {
    if (kind === 'day' && localDate(day)) return { start: day, end: day };
    if (kind === 'week' && localDate(week)) {
      const range = periodRange('week', week);
      return { start: range.startDate, end: range.endDate };
    }
    return null;
  }
  function overlaps(span, range) { return Boolean(span && span.start <= range.endDate && span.end >= range.startDate); }
  function classifyTask(task, range, period) {
    const completedAt = Number(task.completedAt) || 0;
    if (task.done === true && completedAt > 0 && completedAt >= range.start && completedAt < range.end) return 'completed';
    if (task.done === true && (!completedAt || completedAt < range.start)) return '';
    const plan = planSpan(task.planKind, task.planDate, task.planWeek);
    const focus = localDate(task.focusDate) ? { start: task.focusDate, end: task.focusDate } : null;
    const deadline = localDate(String(task.deadline || '').slice(0, 10)) ? String(task.deadline).slice(0, 10) : '';
    const history = Array.isArray(task.planHistory) ? task.planHistory : [];
    const plannedInPeriod = overlaps(plan, range) && (period !== 'day' || task.planKind === 'day');
    // Returning a postponed task to this period makes it unfinished again.
    // A week-only plan is not silently assigned to every daily report.
    if (plannedInPeriod) return 'incomplete';
    const movedOut = history.some(entry => {
      if (!entry || !(Number(entry.changedAt) > 0)) return false;
      const from = planSpan(entry.fromKind, entry.fromDate, entry.fromWeek);
      const to = planSpan(entry.toKind, entry.toDate, entry.toWeek);
      return overlaps(from, range) && (period !== 'day' || entry.fromKind === 'day') && (!to || to.start > range.endDate);
    });
    if (movedOut) return 'carried';
    if (overlaps(focus, range) || (deadline >= range.startDate && deadline <= range.endDate)) return 'incomplete';
    if ((plan && plan.end < range.startDate) || (deadline && deadline < range.startDate)) return 'carried';
    const createdAt = Number(task.createdAt) || 0;
    if ((!plan && !deadline) && createdAt >= range.start && createdAt < range.end) return 'incomplete';
    return '';
  }
  function safeText(value, limit) {
    let text = String(value || '').slice(0, limit);
    if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
    return text;
  }
  function buildSnapshot(tasks, period = 'day', key = dateKey()) {
    const range = periodRange(period, key);
    const groups = { completed: [], incomplete: [], carried: [] };
    const counts = { completed: 0, incomplete: 0, carried: 0, total: 0 };
    const warnings = [];
    let missingCompletionTime = 0, omittedDetails = 0, shortenedNotes = 0, used = 0;
    for (const task of tasks) {
      if (!task || typeof task !== 'object') continue;
      if (task.done === true && !(Number(task.completedAt) > 0)) missingCompletionTime++;
      const group = classifyTask(task, range, period);
      if (!group) continue;
      counts[group]++; counts.total++;
      // A fixed allowlist excludes image attachments, external URLs, API keys,
      // unrelated note archives, and all renderer-only implementation fields.
      const row = { title: safeText(task.text, 240), notes: safeText(task.notes, 1200),support:safeText(task.support,1200),
        day:group==='completed'?dateKey(Number(task.completedAt)):localDate(task.planDate)?task.planDate:dateKey(task.createdAt),
        plan: task.planKind === 'day' && localDate(task.planDate) ? task.planDate : task.planKind === 'week' && localDate(task.planWeek) ? `${task.planWeek} 当周` : '未安排日期',
        deadline: dateTime(task.deadline) || '未设置', completed: task.done === true ? dateTime(task.completedAt) || '未记录' : '未完成',
        status: group==='completed' ? '已完成' : { waiting: '等待反馈', followup: '持续跟进', active: '待处理' }[task.status] || '待处理' };
      const size = JSON.stringify(row).length;
      if (used + size > 40000 || groups.completed.length + groups.incomplete.length + groups.carried.length >= 200) { omittedDetails++; continue; }
      if (String(task.notes || '').length > 1200) shortenedNotes++;
      used += size;
      groups[group].push(row);
    }
    if (missingCompletionTime) warnings.push(`${missingCompletionTime} 条旧已完成任务缺少完成时间，未计入本期成果。`);
    if (omittedDetails) warnings.push(`${omittedDetails} 条任务仅计入总数，因上下文长度未发送逐条详情。`);
    if (shortenedNotes) warnings.push(`${shortenedNotes} 条较长任务说明仅发送前 1200 字，原待办内容保留。`);
    const label = { day: '日报', week: '周报', month: '月报' }[period];
    const following=periodRange(period,dateKey(range.end)),nextPlans=[];
    for(const task of tasks){
      if(!task||task.done||!overlaps(planSpan(task.planKind,task.planDate,task.planWeek),following))continue;
      const row={title:safeText(task.text,240),plan:task.planDate||task.planWeek||'',deadline:dateTime(task.deadline)};
      const size=JSON.stringify(row).length;if(used+size>40000||nextPlans.length>=40){if(!warnings.some(w=>w.startsWith('后续计划详情')))warnings.push('后续计划详情超过上下文限制，仅列出可容纳的事项。');continue;}used+=size;nextPlans.push(row);
    }
    return { period, title: `${range.startDate}${range.startDate !== range.endDate ? ` 至 ${range.endDate}` : ''} ${label}`,
      range: { start: range.startDate, end: range.endDate }, counts, groups, warnings,nextPlans,
      countingRule: '已完成以真实完成时间为准；未完成为本期安排和本期新建未安排事项；顺延遗留包含明确移出本期的安排，以及此前尚未完成的过期安排。未记录的完成时间与顺延原因不推测；报告基于当前待办和已记录历史整理，无法还原未记录的历史状态。' };
  }
  function toPlainText(text){return String(text||'').replace(/^```[^\n]*\n|\n```\s*$/g,'').replace(/^\s{0,3}#{1,6}\s+/gm,'').replace(/\*\*([^*\n]+)\*\*/g,'$1').replace(/^\s*[-*]\s+/gm,'○ ').trim();}
  function taskBlock(rows,total=rows.length){
    if(!rows.length)return total?'详情未列出':'暂无';let result='',previous='';
    for(const row of [...rows].sort((a,b)=>String(a.day||'').localeCompare(String(b.day||'')))){
      const date=localDate(row.day),heading=date?`${row.day.slice(5)} 周${'日一二三四五六'[date.getDay()]}`:'未安排日期';
      if(heading!==previous){result+=(result?'\n':'')+heading+'\n';previous=heading;}
      const done=row.status==='已完成';result+=`${done?'✓':'○'} ${row.title.replace(/\n/g,'\n  ')}${done?'（'+row.completed+' 完成）':row.deadline&&row.deadline!=='未设置'?'（截止 '+row.deadline+'）':''}\n`;
      if(!done&&row.status!=='待处理')result+='  状态：'+row.status+'\n';
      if(row.notes)result+='  说明：'+row.notes.replace(/\n/g,'\n  ')+'\n';
    }if(total>rows.length)result+=`另有 ${total-rows.length} 项仅计入数量，详情未列出。\n`;return result.trimEnd();
  }
  function makeDraft(snapshot,format=DEFAULT_FORMATS[snapshot.period]||DEFAULT_FORMATS.day){
    const needs=Object.values(snapshot.groups).flat().filter(row=>row.support);
    const tokens={'标题':snapshot.title,'时间范围':snapshot.range.start+' 至 '+snapshot.range.end,'总事项':snapshot.counts.total,'已完成数量':snapshot.counts.completed,'未完成数量':snapshot.counts.incomplete,'遗留数量':snapshot.counts.carried,
      '已完成':taskBlock(snapshot.groups.completed,snapshot.counts.completed),'未完成':taskBlock(snapshot.groups.incomplete,snapshot.counts.incomplete),'顺延遗留':taskBlock(snapshot.groups.carried,snapshot.counts.carried),
      '问题与协助':needs.length?needs.map(row=>'○ '+row.title+'\n  '+row.support.replace(/\n/g,'\n  ')).join('\n'):'暂无已记录的协助需求。',
      '后续计划':snapshot.nextPlans?.length?snapshot.nextPlans.map(row=>'○ '+row.title+'（安排 '+row.plan+'）').join('\n'):'暂无已安排的后续事项。'};
    let result=String(format).replace(/{{([^{}]+)}}/g,(all,key)=>Object.hasOwn(tokens,key)?String(tokens[key]):all);
    if(snapshot.warnings.length)result+='\n\n记录说明：\n'+snapshot.warnings.join('\n');return toPlainText(result);
  }
  function readProfiles(storage){
    const raw=storage.getItem(PROFILES_KEY);if(raw!==null){const value=JSON.parse(raw);if(!value||value.version!==2||!value.profiles||typeof value.profiles!=='object')throw Error('报告模板无法读取，请先备份，原数据已保留');return value.profiles;}
    const prompt=storage.getItem(TEMPLATE_KEY)||'',mode=storage.getItem('slate-report-template-mode-v1')||((prompt&&prompt!==DEFAULT_TEMPLATE)?'custom':'builtin');
    return Object.fromEntries(['day','week','month'].map(period=>[period,{mode:mode==='custom'?'custom':'builtin',prompt,format:DEFAULT_FORMATS[period]}]));
  }
  function normalizeHistory(value) {
    if (!Array.isArray(value)) throw new TypeError('报告历史格式无效');
    const ids = new Set();
    return value.map(item => {
      if (!item || typeof item.id !== 'string' || !item.id || typeof item.content !== 'string') throw new TypeError('报告历史存在无法识别的记录');
      if (ids.has(item.id)) throw new TypeError('报告历史存在重复记录');
      ids.add(item.id);
      return { ...item, title: String(item.title || '未命名报告'), period: ['day', 'week', 'month'].includes(item.period) ? item.period : 'day',
        createdAt: Number(item.createdAt) || 0, updatedAt: Number(item.updatedAt) || 0 };
    });
  }
  function normalizeDraft(value) {
    if (value == null) return { title: '', content: '', period: 'day', source: 'manual', updatedAt: 0 };
    if (typeof value !== 'object' || typeof value.content !== 'string' || typeof value.title !== 'string') throw new TypeError('报告草稿格式无效');
    return { title: value.title, content: value.content, period: ['day', 'week', 'month'].includes(value.period) ? value.period : 'day',
      range: value.range || null, counts: value.counts || null, source: ['tasks', 'ai'].includes(value.source) ? value.source : 'manual', updatedAt: Number(value.updatedAt) || 0 };
  }
  function reportConfigReady(config) {
    return config?.ok !== false && config?.hasKey === true && typeof config.baseURL === 'string' && !!config.baseURL.trim() && typeof config.model === 'string' && !!config.model.trim();
  }
  return { DEFAULT_TEMPLATE,DEFAULT_TEMPLATES,DEFAULT_FORMATS,PROFILES_KEY,readProfiles,toPlainText, HISTORY_KEY, TEMPLATE_KEY, DRAFT_KEY, dateKey, periodRange, buildSnapshot, makeDraft, normalizeHistory, normalizeDraft, reportConfigReady };
}));

if (typeof window === 'object' && typeof document === 'object') (function () {
  'use strict';
  const L = window.SlateReportsLogic, api = window.slateAPI;
  const taskPage = document.getElementById('tab-todo');
  if (!taskPage || !api?.reportGenerate) return;
  const id = name => document.getElementById(name);
  const settingsIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M9.7 3.6 10.5 2h3l.8 1.6 2 .8 1.7-.5 2.1 2.1-.5 1.7.8 2 1.6.8v3l-1.6.8-.8 2 .5 1.7-2.1 2.1-1.7-.5-2 .8-.8 1.6h-3l-.8-1.6-2-.8-1.7.5L4 18.6l.5-1.7-.8-2-1.6-.8v-3l1.6-.8.8-2L4 6.5l2.1-2.1 1.7.5z"/><circle cx="12" cy="12" r="3"/></svg>';
  let history = [], draft = L.normalizeDraft(null), activeEdit = null, selectedId = '';
  let initialized = false, historyReadOnly = false, draftReadOnly = false, draftDirty = false, activeDirty = false;
  let saveTimer = null, saveError = '', undoDeletion = null, opener = null;
  let editRevision = 0, requestSequence = 0, generating = null, candidate = null;
  const checkedReports = new Set();

  let actions = id('todo-v15-actions');
  if (!actions) {
    actions = document.createElement('div'); actions.id = 'todo-v15-actions';
    (taskPage.querySelector('.todo-view-head') || taskPage.querySelector('.todo-main')).append(actions);
  }
  const trigger = document.createElement('button');
  trigger.type = 'button'; trigger.id = 'reports-open'; trigger.textContent = '工作报告'; actions.append(trigger);
  const panel = document.createElement('section');
  panel.id = 'report-panel'; panel.className = 'reports-panel tile'; panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'reports-title');
  panel.innerHTML = `
    <header class="reports-head"><div><h2 id="reports-title">工作报告</h2><p>先生成草稿，确认后保存到历史。</p></div><div class="reports-head-actions"><button id="report-configure" type="button">${settingsIcon}<span>API 设置</span></button><button id="reports-close" type="button">返回待办</button></div></header>
    <div class="reports-controls"><label>周期<select id="report-period"><option value="day">日报</option><option value="week">周报</option><option value="month">月报</option></select></label><label>日期<input id="report-date" type="date" aria-label="报告所在日期" /></label><label>写作方式<select id="report-prompt-mode"><option value="builtin">内置写作规范</option><option value="custom">自定义提示词</option></select></label><button id="report-generate" class="reports-primary" type="button">AI 生成草稿</button><button id="report-cancel" type="button" hidden>取消生成</button><button id="report-draft" type="button" title="仅在本机整理待办，不调用 AI，不自动存入历史">仅整理任务</button><button id="report-prompt-settings" class="reports-quiet" type="button">提示词设置</button></div>
    <p id="report-summary" class="reports-summary"></p>
    <div id="report-notice" class="reports-notice" hidden><p id="report-feedback" role="status" aria-live="polite"></p><button id="report-guide" type="button" hidden>配置 API</button><button id="report-undo" type="button" hidden>撤销删除</button></div>
    <div id="report-candidate" class="reports-candidate" hidden><p>AI 结果已就绪，你的原稿保持不变。</p><button id="report-candidate-apply" type="button">使用 AI 结果</button><button id="report-candidate-copy" type="button">复制 AI 结果</button><button id="report-candidate-dismiss" class="reports-quiet" type="button">忽略</button></div>
    <div class="reports-body"><aside class="reports-history"><button id="report-current-draft" class="reports-current-draft" type="button" aria-pressed="true"><strong>当前草稿</strong><span>未存入历史</span></button><div class="reports-history-head"><strong>历史报告</strong><button id="report-delete" type="button" disabled>删除</button></div><input id="report-search" type="search" placeholder="搜索标题或正文" aria-label="搜索历史报告" /><div id="report-history-list" class="reports-history-list"></div></aside><div class="reports-document"><input id="report-title" type="text" maxlength="160" aria-label="报告标题" placeholder="报告标题" /><textarea id="report-editor" aria-label="报告正文，可直接修改" placeholder="可以直接写，也可以先整理任务或用 AI 生成草稿。"></textarea><footer><span id="report-save-status" role="status">草稿 · 未存入历史</span><button id="report-save" type="button" hidden>重试保存</button><button id="report-save-history" class="reports-primary" type="button" disabled>保存到历史</button><button id="report-copy" type="button" disabled>复制全文</button></footer></div></div>`;
  taskPage.append(panel);
  const trashIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 10v7M14 10v7"/></svg>';
  id('report-delete').innerHTML=trashIcon; id('report-delete').title='删除当前报告或勾选的报告'; id('report-delete').setAttribute('aria-label','删除报告');
  const bulk=document.createElement('div'); bulk.className='reports-bulk';
  bulk.innerHTML='<label title="全选搜索结果"><input id="report-select-all" type="checkbox" aria-label="全选搜索结果">历史</label><span id="report-selected-count"></span><button id="report-clear" type="button" title="清空所有历史报告" aria-label="清空所有历史报告">'+trashIcon+'</button>';
  panel.querySelector('.reports-history-head strong').replaceWith(bulk);
  id('report-clear').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11l4 5M14 11l-4 5"/></svg>';
  const confirmation=document.createElement('div'); confirmation.id='report-clear-confirm';confirmation.className='reports-clear-confirm';confirmation.hidden=true;
  confirmation.innerHTML='<p>清空所有历史报告？当前草稿保留。</p><button id="report-clear-confirmed" type="button">确认清空</button><button id="report-clear-cancel" type="button">取消</button>';id('report-search').after(confirmation);
  id('report-date').value = L.dateKey();

  function workspaceReady() {
    return !(typeof workspaceHydrating !== 'undefined' && workspaceHydrating) && !(typeof workspaceReloadPending !== 'undefined' && workspaceReloadPending);
  }
  function message(text, error = false, guide = '') {
    id('report-feedback').textContent = text;
    id('report-notice').dataset.state = error ? 'error' : 'ok';
    id('report-guide').hidden = !guide; id('report-guide').dataset.target = guide;
    id('report-guide').textContent = guide === 'prompt' ? '设置提示词' : '配置 API';
    id('report-undo').hidden = !undoDeletion;
    id('report-notice').hidden = !text && !undoDeletion;
  }
  function current() { return selectedId ? activeEdit : draft; }
  function status() {
    const doc = current();
    id('report-copy').disabled = !doc?.content.trim();
    id('report-save-history').disabled = !!selectedId || !draft.content.trim() || historyReadOnly;
    id('report-save-history').textContent = selectedId ? '已存入历史' : '保存到历史';
    id('report-delete').disabled = (!selectedId && !checkedReports.size) || historyReadOnly;
    id('report-clear').disabled = !history.length || historyReadOnly;
    id('report-selected-count').textContent=checkedReports.size?`已选 ${checkedReports.size}`:'';
    id('report-save').hidden = !saveError;
    id('report-save-status').dataset.state = saveError ? 'error' : '';
    id('report-save-status').textContent = saveError || (selectedId ? activeDirty ? '正在保存修改…' : '已保存到历史，修改会自动保存' : '草稿 · 未存入历史');
  }
  function loadState() {
    if (initialized) return true;
    if (!workspaceReady()) { message('正在恢复本机数据，请稍后重试', true); return false; }
    try { history = L.normalizeHistory(JSON.parse(localStorage.getItem(L.HISTORY_KEY) || '[]')); }
    catch (_) { historyReadOnly = true; message('历史报告无法读取，已停止覆盖。请先备份并恢复数据。', true); }
    try { draft = L.normalizeDraft(JSON.parse(localStorage.getItem(L.DRAFT_KEY) || 'null')); }
    catch (_) { draftReadOnly = true; message('本机草稿无法读取，原数据已保留。请先备份；仍可编辑和复制当前文字。', true); }
    initialized = true; return true;
  }
  function writeHistory(next) {
    if (historyReadOnly || !workspaceReady()) throw new Error('历史报告当前不可写入，请先备份并恢复数据');
    localStorage.setItem(L.HISTORY_KEY, JSON.stringify(next));
    // Commit in memory only after the actual storage write succeeds.
    history = next;
  }
  function flush() {
    clearTimeout(saveTimer); saveTimer = null;
    if (!workspaceReady()) return false;
    if (!initialized) return true;
    try {
      if (draftDirty) {
        if (draftReadOnly) throw new Error('旧草稿数据无法读取，已停止覆盖，请先复制当前正文');
        localStorage.setItem(L.DRAFT_KEY, JSON.stringify(draft)); draftDirty = false;
      }
      if (activeDirty && selectedId && activeEdit) {
        if (!history.some(row => row.id === selectedId)) throw new Error('原报告已不存在，修改仍保留在编辑器');
        writeHistory(history.map(row => row.id === selectedId ? { ...activeEdit } : row)); activeDirty = false; renderHistory();
      }
      saveError = ''; status(); return true;
    } catch (_) {
      saveError = '保存失败，正文已保留，请复制或重试'; status(); return false;
    }
  }
  function queueSave() {
    saveError = ''; status(); clearTimeout(saveTimer); saveTimer = setTimeout(flush, 300);
  }
  function showEditor() {
    const doc = current();
    id('report-title').value = doc?.title || ''; id('report-editor').value = doc?.content || '';
    id('report-editor').setSelectionRange(0, 0); id('report-editor').scrollTop = 0; status();
  }
  function selectHistory(key) {
    if (!flush()) { message('修改尚未保存，请先复制或重试保存后再切换', true); return; }
    const found = history.find(row => row.id === key); if (key && !found) return;
    selectedId = key; activeEdit = found ? { ...found } : null; editRevision++;
    showEditor(); renderHistory();
  }
  function renderHistory() {
    id('report-current-draft').setAttribute('aria-pressed', String(!selectedId));
    const list = id('report-history-list'); list.replaceChildren();
    const query = id('report-search').value.trim().toLocaleLowerCase();
    const rows = [...history].sort((a, b) => b.createdAt - a.createdAt).filter(item => !query || `${item.title}\n${item.content}`.toLocaleLowerCase().includes(query));
    for(const key of checkedReports)if(!history.some(item=>item.id===key))checkedReports.delete(key);
    const all=id('report-select-all');all.disabled=!rows.length||historyReadOnly;all.checked=!!rows.length&&rows.every(item=>checkedReports.has(item.id));all.indeterminate=rows.some(item=>checkedReports.has(item.id))&&!all.checked;
    status();
    if (!rows.length) {
      const text = document.createElement('p'); text.className = 'reports-history-empty';
      text.textContent = query ? '没有匹配的报告' : '点击「保存到历史」后出现在这里'; list.append(text); return;
    }
    for (const item of rows) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'reports-history-item'; button.dataset.id = item.id;
      button.setAttribute('aria-pressed', String(item.id === selectedId));
      const title = document.createElement('strong'); title.textContent = item.title || '未命名报告';
      const date = document.createElement('span'); date.textContent = `${item.createdAt ? L.dateKey(item.createdAt) : '日期未记录'} · ${{ day: '日报', week: '周报', month: '月报' }[item.period]}`;
      button.append(title, date); button.addEventListener('click', () => selectHistory(item.id));
      const row=document.createElement('div');row.className='reports-history-row';
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=checkedReports.has(item.id);checkbox.disabled=historyReadOnly;checkbox.setAttribute('aria-label',`选择报告：${item.title}`);checkbox.dataset.reportId=item.id;
      checkbox.onchange=()=>{if(checkbox.checked)checkedReports.add(item.id);else checkedReports.delete(item.id);renderHistory();};row.append(checkbox,button);list.append(row);
    }
  }
  function snapshot() { return L.buildSnapshot(window.SlateTasks?.getAll() || [], id('report-period').value, id('report-date').value); }
  function updateSummary() {
    try { const s = snapshot(); id('report-summary').textContent = `${s.range.start} 至 ${s.range.end} · 共 ${s.counts.total} 项 · 已完成 ${s.counts.completed} · 未完成 ${s.counts.incomplete} · 顺延与遗留 ${s.counts.carried}`; }
    catch (_) { id('report-summary').textContent = '请选择有效的报告日期'; }
  }
  function makeWorkingDraft(s, text, source) {
    return L.normalizeDraft({ title: s.title, content: text, period: s.period, range: s.range, counts: s.counts, source, updatedAt: Date.now() });
  }
  function replaceDraft(next) {
    if (!flush()) return false;
    draft = next; draftDirty = true; selectedId = ''; activeEdit = null; editRevision++;
    showEditor(); renderHistory(); flush(); return true;
  }
  function setBusy(busy) {
    id('report-generate').disabled = busy; id('report-draft').disabled = busy; id('report-cancel').hidden = !busy;
    id('report-generate').textContent = busy ? '正在生成…' : 'AI 生成草稿';
  }
  function renderCandidate() { id('report-candidate').hidden = !candidate; }
  async function getReportSettings() { return api.reportGetConfig ? api.reportGetConfig() : null; }
  async function generate(ai) {
    if (!loadState() || generating) return;
    if (!ai) {
      try {
        const s = snapshot();
        if (replaceDraft(makeWorkingDraft(s, L.makeDraft(s,window.SlateReportPrompt?.getFormat?.(s.period)), 'tasks'))) {
          candidate = null; renderCandidate(); message('任务已整理到草稿，可直接编辑或复制；确认后再保存到历史。'); id('report-editor').focus();
        }
      } catch (error) { message(error.message || '整理失败，原稿保持不变', true); }
      return;
    }
    const request = { token: ++requestSequence, revision: editRevision, sent: false };
    generating = request; setBusy(true);
    try {
      // Read real settings on every explicit generation. No draft/history is
      // created, selected, cleared or written before configuration and success.
      const settings = await getReportSettings();
      if (request.token !== requestSequence) return;
      if (!L.reportConfigReady(settings)) { message('AI 尚未配置。请先填写工作报告的 API 地址、模型和密钥；也可以仅整理任务。', true, 'api'); return; }
      const mode = id('report-prompt-mode').value;
      const period=id('report-period').value;
      const template = window.SlateReportPrompt?.getTemplate(mode,period) ?? (mode === 'builtin' ? L.DEFAULT_TEMPLATES[period] : localStorage.getItem(L.TEMPLATE_KEY) || '');
      if (typeof template !== 'string' || !template.trim()) { message('还没有自定义提示词。请先到 AI 设置填写，或切换到内置写作规范。', true, 'prompt'); return; }
      const s = snapshot(), tasks = window.SlateTasks?.getAll() || [];
      request.sent = true;
      message('正在生成草稿；可以继续编辑，新的修改不会被覆盖。');
      const result = await api.reportGenerate({ tasks, period: s.period, date: id('report-date').value, template, format:window.SlateReportPrompt?.getFormat?.(period)||L.DEFAULT_FORMATS[period] });
      if (request.token !== requestSequence) return;
      if (!result?.ok || typeof result.text !== 'string' || !result.text.trim()) {
        message(result?.error || '生成失败，原稿和历史保持不变。', true, result?.code === 'not_configured' ? 'api' : ''); return;
      }
      const next = makeWorkingDraft(s, L.toPlainText(result.text), 'ai');
      if (editRevision !== request.revision || !replaceDraft(next)) {
        candidate = next; renderCandidate(); message('AI 已生成；你的原稿保持不变，可复制结果或明确选择使用。'); return;
      }
      candidate = null; renderCandidate(); message('AI 草稿已生成，请核对并修改；点击「保存到历史」才会归档。'); id('report-editor').focus();
    } catch (error) {
      if (request.token === requestSequence) message(error.message || '生成失败，原稿和历史保持不变。', true);
    } finally {
      if (generating === request) { generating = null; setBusy(false); }
    }
  }
  function saveToHistory() {
    if (!loadState() || selectedId || !draft.content.trim()) return;
    if (!flush()) { message('本机保存失败，草稿保持不变，请复制或重试。', true); return; }
    const now = Date.now();
    const entry = { ...draft, id: crypto.randomUUID(), title: draft.title.trim() || '未命名报告', createdAt: now, updatedAt: now };
    try {
      writeHistory([entry, ...history]);
      selectedId = entry.id; activeEdit = { ...entry }; draft = L.normalizeDraft(null); draftDirty = true;
      editRevision++; renderHistory(); showEditor(); flush();
      message('已保存到历史，后续修改会更新这一份报告。');
    } catch (_) { saveError = '保存历史失败，草稿未丢失，请重试'; status(); message('保存到历史失败，没有新增报告。当前草稿仍可编辑和复制。', true); }
  }
  function deleteHistory(all = false) {
    if (!flush() || historyReadOnly) return;
    const targets=new Set(all===true?history.map(item=>item.id):checkedReports.size?[...checkedReports]:selectedId?[selectedId]:[]);
    const removed=history.flatMap((entry,index)=>targets.has(entry.id)?[{entry,index}]:[]);if(!removed.length)return;
    try {
      writeHistory(history.filter(item => !targets.has(item.id)));
      undoDeletion = removed; checkedReports.clear(); if(targets.has(selectedId)){selectedId = ''; activeEdit = null;} editRevision++;
      confirmation.hidden=true;renderHistory(); showEditor(); message(`已删除 ${removed.length} 篇历史报告，可撤销。`);
    } catch (_) { message('删除失败，历史报告保持不变，请重试。', true); }
  }
  function undoDelete() {
    if (!undoDeletion) return;
    const next = [...history];
    for(const {entry,index} of undoDeletion)if(!next.some(row=>row.id===entry.id))next.splice(Math.min(index,next.length),0,entry);
    try { writeHistory(next); undoDeletion = null; renderHistory(); status(); message('已恢复删除的报告。'); }
    catch (_) { message('恢复失败，仍保留撤销内容，请重试。', true); }
  }
  async function copyDocument(doc, label = '报告全文已复制') {
    if (!doc?.content.trim()) return;
    try {
      const plain=L.toPlainText(doc.content),text=!doc.title||plain.startsWith(doc.title.trim())?plain:`${doc.title}\n\n${plain}`;
      const copied = api.writeClipboard ? await api.writeClipboard({ type: 'text', text }) : await navigator.clipboard.writeText(text).then(() => true);
      if (!copied) throw new Error(); message(label);
    } catch (_) { message('复制失败，请选中正文后按 Ctrl+C', true); }
  }
  async function configure(target = 'api') {
    try {
      if (target === 'prompt') {
        if (!window.SlateReportPrompt?.openSettings) throw new Error('AI 设置尚未准备好，请稍后重试');
        await window.SlateReportPrompt.openSettings(id('report-period').value);
      } else {
        if (!window.SlateApiSettings?.open) throw new Error('API 设置尚未准备好，请稍后重试');
        await window.SlateApiSettings.open('reports');
      }
    } catch (error) { message(error.message || '设置打开失败，请稍后重试', true, target); }
  }
  async function open() {
    opener = document.activeElement;
    if (!loadState()) return;
    panel.hidden = false; taskPage.classList.add('reports-open'); trigger.setAttribute('aria-expanded', 'true');
    id('report-prompt-mode').value = window.SlateReportPrompt?.getMode?.(id('report-period').value) || (localStorage.getItem('slate-report-template-mode-v1') === 'custom' ? 'custom' : 'builtin');
    updateSummary(); renderHistory(); showEditor(); id('report-period').focus();
  }
  function close() {
    if (!flush()) { message('修改尚未保存，请先复制或重试后再返回', true); return; }
    panel.hidden = true; taskPage.classList.remove('reports-open'); trigger.setAttribute('aria-expanded', 'false'); opener?.focus();
  }
  trigger.setAttribute('aria-controls', 'report-panel'); trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', open); id('reports-close').addEventListener('click', close);
  for (const name of ['report-period', 'report-date']) id(name).addEventListener('change', () => { editRevision++; updateSummary(); });
  id('report-period').addEventListener('change',()=>{id('report-prompt-mode').value=window.SlateReportPrompt?.getMode?.(id('report-period').value)||'builtin';});
  id('report-prompt-mode').addEventListener('change', () => {
    editRevision++; window.SlateReportPrompt?.setMode?.(id('report-prompt-mode').value,id('report-period').value);
    if (id('report-prompt-mode').value === 'custom' && !window.SlateReportPrompt?.getTemplate('custom',id('report-period').value)?.trim()) message('自定义提示词在 AI 设置中填写，也可以直接使用内置写作规范。', false, 'prompt');
  });
  id('report-generate').addEventListener('click', () => generate(true)); id('report-draft').addEventListener('click', () => generate(false));
  id('report-cancel').addEventListener('click', async () => {
    const request = generating; if (!request) return;
    requestSequence++; generating = null; setBusy(false);
    message('已取消生成，原稿和历史保持不变。');
    if (request.sent) { try { await api.reportCancel(); } catch (_) { message('取消请求未送达，旧结果将被忽略；原稿保持不变。', true); } }
  });
  for (const name of ['report-title', 'report-editor']) {
    id(name).addEventListener('input', () => {
      if (!loadState()) return;
      const doc = current(); doc.title = id('report-title').value; doc.content = id('report-editor').value; doc.updatedAt = Date.now();
      editRevision++; if (selectedId) activeDirty = true; else draftDirty = true; queueSave();
    });
    id(name).addEventListener('blur', () => { if (draftDirty || activeDirty) flush(); });
  }
  id('report-current-draft').addEventListener('click', () => selectHistory(''));
  id('report-search').addEventListener('input', renderHistory);
  id('report-save').addEventListener('click', () => { if (!selectedId && saveError.includes('历史')) saveToHistory(); else flush(); });
  id('report-save-history').addEventListener('click', saveToHistory);
  id('report-delete').addEventListener('click', deleteHistory); id('report-undo').addEventListener('click', undoDelete);
  id('report-select-all').onchange=event=>{const query=id('report-search').value.trim().toLocaleLowerCase();for(const item of history.filter(item=>!query||`${item.title}\n${item.content}`.toLocaleLowerCase().includes(query))){if(event.target.checked)checkedReports.add(item.id);else checkedReports.delete(item.id);}renderHistory();};
  id('report-clear').onclick=()=>{confirmation.hidden=false;id('report-clear-confirmed').focus();};
  id('report-clear-cancel').onclick=()=>{confirmation.hidden=true;id('report-clear').focus();};
  id('report-clear-confirmed').onclick=()=>deleteHistory(true);
  id('report-copy').addEventListener('click', () => copyDocument(current()));
  id('report-candidate-copy').addEventListener('click', () => copyDocument(candidate, 'AI 结果已复制，原稿保持不变。'));
  id('report-candidate-apply').addEventListener('click', () => { if (candidate && replaceDraft(candidate)) { candidate = null; renderCandidate(); message('已将 AI 结果放入当前草稿，确认后可保存到历史。'); id('report-editor').focus(); } });
  id('report-candidate-dismiss').addEventListener('click', () => { candidate = null; renderCandidate(); });
  id('report-configure').addEventListener('click', () => configure('api'));
  id('report-prompt-settings').addEventListener('click', () => configure('prompt'));
  id('report-guide').addEventListener('click', () => configure(id('report-guide').dataset.target));
  document.addEventListener('slate:tasks-changed', () => { if (!panel.hidden) updateSummary(); });
  document.addEventListener('slate:tabchange', () => { if (draftDirty || activeDirty) flush(); });
  window.addEventListener('beforeunload', () => { if (draftDirty || activeDirty) flush(); });
  window.SlateReports = Object.freeze({ open, close, flush });
}());
