(() => {
  'use strict';
  const page = document.getElementById('settings-page');
  if (!page) return;
  const byId = id => document.getElementById(id);
  const previousColumns = [...page.querySelectorAll(':scope > .settings-column')];
  const groups = [
    { id: 'general', label: '常规', description: '唤出后显示什么，以及开机启动。', keywords: '默认展开页 启动 开机 唤出' },
    { id: 'shortcuts', label: '快捷键', description: '在任意应用里快速唤出和处理内容。', keywords: '键盘 快捷键 唤出 文字处理 翻译 剪贴板' },
    { id: 'appearance', label: '外观', description: '选择适合当前环境的面板配色。', keywords: '主题 深灰 浅色 跟随系统 配色' },
    { id: 'home', label: '首页与功能', description: '只保留你需要的首页组件和功能入口。', keywords: '组件 功能 显示 待办 笔记 启动' },
    { id: 'clipboard', label: '剪贴板', description: '决定记录哪些内容、保存多久。', keywords: '采集 记录 历史 保留 忽略 隐私 暂停' },
    { id: 'reminders', label: '待办提醒', description: '到点提醒和未完成事项汇总。', keywords: '待办 提醒 通知 时间 截止 汇总 逾期' },
    { id: 'translation', label: '本地翻译', description: '管理离线翻译模型。', keywords: '模型 下载 导入 翻译 离线' },
    { id: 'ai', label: 'AI 配置', description: '添加服务和模型，再选择各个功能使用哪一个。', keywords: 'API AI 密钥 Key 模型 服务商 报告 提示词 优化 Skill 模板 转写 智能整理 Ollama Claude Gemini DeepSeek' },
    { id: 'data', label: '数据与备份', description: '管理本机数据目录、备份与恢复。', keywords: '文件夹 数据 路径 导出 导入 备份 恢复' },
  ];
  const navigation = document.createElement('aside');
  navigation.className = 'settings-navigation';
  navigation.setAttribute('aria-label', '设置分类');
  navigation.innerHTML = '<h1>设置</h1><div class="settings-search-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.6"></circle><path d="m16 16 4.3 4.3"></path></svg><input id="settings-search" type="search" placeholder="搜索设置" aria-label="搜索设置" autocomplete="off" /><button id="settings-search-clear" type="button" aria-label="清除搜索" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg></button></div><nav class="settings-menu" role="tablist" aria-label="设置分类" aria-orientation="vertical"></nav><p id="settings-search-status" class="settings-search-status" role="status" aria-live="polite"></p>';
  const content = document.createElement('div');
  content.className = 'settings-content';
  content.innerHTML = '<div class="settings-content-scroll"><header class="settings-section-heading"><h2 id="settings-section-title">常规</h2><p id="settings-section-description"></p></header><div class="settings-groups"></div><div id="settings-search-empty" hidden><strong>没有找到相关设置</strong><p>试试“快捷键”“提醒”或“API”。</p></div></div>';
  page.classList.add('settings-with-navigation');
  page.append(navigation, content);
  const menu = navigation.querySelector('.settings-menu');
  const host = content.querySelector('.settings-groups');
  const scroller = content.querySelector('.settings-content-scroll');
  const search = byId('settings-search');
  let selected = 'general';
  for (const group of groups) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'settings-menu-item';
    button.id = `settings-menu-${group.id}`; button.dataset.settingsGroup = group.id;
    button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', `settings-group-${group.id}`);
    button.textContent = group.label; menu.append(button);
    const section = document.createElement('section');
    section.id = `settings-group-${group.id}`; section.className = 'settings-group';
    section.dataset.settingsGroup = group.id;
    section.setAttribute('role', 'tabpanel'); section.setAttribute('aria-labelledby', button.id);
    section.hidden = true; host.append(section);
    group.button = button; group.section = section;
    button.addEventListener('click', () => activate(group.id, { findMatch: true }));
  }
  const groupHost = key => groups.find(group => group.id === key).section;
  function makeCard(key, title) {
    const card = document.createElement('section');
    card.className = 'settings-card settings-device-card';
    const heading = document.createElement('div'); heading.className = 'settings-card-heading';
    const strong = document.createElement('strong'); strong.textContent = title; heading.append(strong); card.append(heading);
    groupHost(key).append(card); return card;
  }
  function move(selector, target) { const node = page.querySelector(selector); if (node) target.append(node); return node; }
  const device = page.querySelector('.settings-device-card');
  const generalCard = makeCard('general', '唤出与启动');
  move('.settings-default-tab-row:has(#settings-default-tab)', generalCard);
  move('.settings-auto-launch-row', generalCard);
  const shortcutCard = makeCard('shortcuts', '全局快捷键');
  for (const selector of ['.settings-device-row:has(#settings-shortcut-value)', '.settings-device-row:has(#settings-capture-shortcut-value)', '.settings-device-row:has(#settings-clip-shortcut-value)']) move(selector, shortcutCard);
  const translationShortcut = move('.settings-translation-card .settings-option', shortcutCard);
  if (translationShortcut) {
    translationShortcut.classList.add('settings-shortcut-translation');
    const title = document.createElement('strong'); title.textContent = '剪贴板翻译快捷键'; translationShortcut.prepend(title);
  }
  move('.settings-appearance-row', makeCard('appearance', '面板配色'));
  for (const selector of ['.settings-home-modules-card', '.settings-features-card', '.home-commands']) move(selector, groupHost('home'));
  move('.settings-clipboard-card', groupHost('clipboard'));
  move('#settings-todo-reminders', groupHost('reminders'));
  const translation = move('.settings-translation-card', groupHost('translation'));
  if (translation) translation.querySelector('.settings-card-heading strong').textContent = '离线模型';
  const apiCard = move('#settings-api-card', groupHost('ai'));
  if (apiCard) {
    apiCard.querySelector('.settings-card-heading strong').textContent = '服务商与功能分配';
    byId('settings-api-configure').textContent = '管理 AI 服务';
  }
  move('.settings-workspace-row', makeCard('data', '数据文件夹'));
  move('.settings-backup-card', groupHost('data'));
  // Existing listeners retain the same nodes; their feedback is shared by all categories.
  const inlineNote = move('#settings-inline-note', content);
  inlineNote?.classList.add('settings-feedback');
  if (device?.isConnected && device.parentElement === previousColumns[1]) device.remove();
  previousColumns.forEach(column => column.remove());
  page.querySelectorAll('.settings-card-heading .tile-label').forEach(node => node.remove());

  const promptCard = makeCard('ai', '自动报告提示词');
  promptCard.id = 'settings-report-prompt';
  promptCard.innerHTML += '<label class="settings-prompt-mode"><span>默认写作方式</span><select id="settings-report-prompt-mode" aria-label="自动报告默认写作方式"><option value="builtin">内置 Skill</option><option value="custom">自定义提示词</option></select></label><p id="settings-report-prompt-builtin">内置规范按“已完成、未完成、顺延与遗留”整理，保留真实任务和时间，不编造进展。</p><div id="settings-report-prompt-custom" hidden><label for="settings-report-prompt-text">报告写作要求</label><textarea id="settings-report-prompt-text" maxlength="16000" rows="7" placeholder="例如：每项用一句话说明成果，保留截止时间；未完成事项写明已记录的原因。" spellcheck="false"></textarea><div class="settings-actions"><button id="settings-report-prompt-import" type="button">导入文本</button><button id="settings-report-prompt-reset" type="button">恢复内置 Skill</button></div><input id="settings-report-prompt-file" type="file" accept=".txt,.md,text/plain,text/markdown" hidden /><small>支持 TXT / Markdown，最多 16,000 字、100 KB。</small></div><p id="settings-report-prompt-status" role="status" aria-live="polite">修改后自动保存，仅用于生成工作报告。</p>';
  const TEMPLATE_KEY = 'slate-report-template-v1';
  const MODE_KEY = 'slate-report-template-mode-v1';
  const modeInput = byId('settings-report-prompt-mode');
  const promptInput = byId('settings-report-prompt-text');
  const L=window.SlateReportsLogic,unsavedPrompts={},unsavedFormats={};let reportPeriod='day';
  const periodLabel=document.createElement('label');periodLabel.className='settings-prompt-mode';periodLabel.innerHTML='<span>报告周期</span><select id="settings-report-period" aria-label="选择要修改的报告模板"><option value="day">日报</option><option value="week">周报</option><option value="month">月报</option></select>';promptCard.querySelector('.settings-card-heading').after(periodLabel);
  const formatSection=document.createElement('div');formatSection.className='settings-report-format';formatSection.innerHTML='<label for="settings-report-format">纯文本排版模板</label><textarea id="settings-report-format" maxlength="24000" rows="9" spellcheck="false" aria-label="当前周期的纯文本报告模板"></textarea><p>可修改公司要求的标题和顺序。保留需要的数据占位符：{{已完成}}、{{未完成}}、{{顺延遗留}}、{{问题与协助}}、{{后续计划}}。明细会自动填入，无需配置 AI。</p><button id="settings-report-format-reset" type="button">恢复此周期默认模板</button>';promptCard.append(formatSection);const formatInput=byId('settings-report-format');
  byId('settings-report-prompt-builtin').textContent='各周期使用独立写作规范，只输出纯文本；月报包含已记录的卡点与所需协助。';
  function read(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
  function validCustom(value) { return typeof value === 'string' && value.length <= 16000 && !value.includes('\0') && value.trim() ? value : ''; }
  function profiles(){try{return L.readProfiles(localStorage);}catch(error){promptStatus(error.message,true);return null;}}
  function getMode(period=reportPeriod) { return profiles()?.[period]?.mode==='custom'?'custom':'builtin'; }
  function getTemplate(mode=getMode(),period=reportPeriod){return mode==='custom'?validCustom(profiles()?.[period]?.prompt):L.DEFAULT_TEMPLATES[period]||L.DEFAULT_TEMPLATE;}
  function getFormat(period=reportPeriod){const value=profiles()?.[period]?.format;return typeof value==='string'&&value.trim()?value:L.DEFAULT_FORMATS[period]||L.DEFAULT_FORMATS.day;}
  function writeProfile(patch,period=reportPeriod){const current=profiles();if(!current)throw Error('报告模板无法读取，已停止覆盖');localStorage.setItem(L.PROFILES_KEY,JSON.stringify({version:2,profiles:{...current,[period]:{...current[period],...patch}}}));}
  function promptStatus(text, error = false) {
    byId('settings-report-prompt-status').textContent = text;
    byId('settings-report-prompt-status').classList.toggle('error', error);
  }
  function ready() { return window.SlateTasks?.isReady?.() !== false; }
  function refreshPrompt() {
    modeInput.value = getMode();
    byId('settings-report-prompt-custom').hidden = modeInput.value !== 'custom';
    byId('settings-report-prompt-builtin').hidden = modeInput.value === 'custom';
    if (document.activeElement !== promptInput) promptInput.value = unsavedPrompts[reportPeriod] ?? getTemplate('custom');
    if (document.activeElement !== formatInput) formatInput.value=unsavedFormats[reportPeriod]??getFormat();
    byId('settings-report-period').value=reportPeriod;
  }
  function changed() { document.dispatchEvent(new CustomEvent('slate:report-prompt-changed', { detail: { mode: getMode(),period:reportPeriod } })); }
  function setMode(mode,period=reportPeriod) {
    if (!['builtin', 'custom'].includes(mode) || !ready()) return false;
    try {
      writeProfile({mode},period); refreshPrompt(); changed();
      promptStatus(mode === 'builtin' ? '已使用内置 Skill；原自定义内容保留。' : getTemplate('custom') ? '自定义提示词已启用，修改后自动保存。' : '写下你的要求或导入文本后，即可使用自定义方式。');
      return true;
    } catch (_) { promptStatus('未能保存设置，请重试；原配置仍然保留。', true); return false; }
  }
  function savePrompt(value) {
    if (!ready()) { promptStatus('正在读取本地数据，请稍后重试。', true); return false; }
    if (typeof value !== 'string' || value.length > 16000 || value.includes('\0')) { promptStatus('文本需在 16,000 字以内，且不能包含二进制内容。', true); return false; }
    try {
      writeProfile({prompt:value}); delete unsavedPrompts[reportPeriod]; changed();
      promptStatus(value.trim() ? `已自动保存 · ${value.length.toLocaleString('zh-CN')} / 16,000 字` : '尚未填写提示词，生成报告时会提示你补充。');
      return true;
    } catch (_) { unsavedPrompts[reportPeriod] = value; promptStatus('保存失败，文字仍在编辑框中。请复制保留后重试。', true); return false; }
  }
  byId('settings-report-period').onchange=event=>{reportPeriod=event.target.value;refreshPrompt();promptStatus('正在编辑'+({day:'日报',week:'周报',month:'月报'}[reportPeriod])+'模板，各周期独立保存。');};
  formatInput.oninput=()=>{
    const value=formatInput.value;unsavedFormats[reportPeriod]=value;
    if(!ready())return promptStatus('工作区尚未就绪，文字已保留，请稍后重试。',true);
    if(!/{{(?:已完成|未完成|顺延遗留|问题与协助|后续计划)}}/.test(value))return promptStatus('请至少保留一个任务明细占位符，以便填入真实内容；当前修改尚未保存。',true);
    try{writeProfile({format:value});delete unsavedFormats[reportPeriod];changed();promptStatus('此周期排版模板已自动保存；本地整理与 AI 生成均使用它。');}catch{promptStatus('模板保存失败，文字保留在编辑框中，请复制后重试。',true);}
  };
  byId('settings-report-format-reset').onclick=()=>{try{writeProfile({format:L.DEFAULT_FORMATS[reportPeriod]});delete unsavedFormats[reportPeriod];refreshPrompt();promptStatus('已恢复此周期的默认排版，其他周期不变。');}catch{promptStatus('恢复失败，原模板保留，请重试。',true);}};
  modeInput.addEventListener('change', () => { if (!setMode(modeInput.value)) refreshPrompt(); });
  promptInput.addEventListener('input', () => savePrompt(promptInput.value));
  byId('settings-report-prompt-reset').addEventListener('click', () => setMode('builtin'));
  byId('settings-report-prompt-import').addEventListener('click', () => byId('settings-report-prompt-file').click());
  byId('settings-report-prompt-file').addEventListener('change', async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    try {
      if (file.size > 100 * 1024 || !/\.(?:txt|md)$/i.test(file.name)) throw new Error('请选择 100 KB 以内的 TXT 或 Markdown 文件。');
      const text = await file.text();
      if (!text.trim() || !validCustom(text)) throw new Error('文件需为非空纯文本，且不超过 16,000 字。');
      if (savePrompt(text)) { promptInput.value = text; setMode('custom'); promptStatus(`已导入 ${file.name}，仅作为报告写作要求。`); }
    } catch (error) { promptStatus(error.message || '导入失败，原提示词保留。', true); }
  });

  function matches(group, query) {
    if (!query) return true;
    const corpus = `${group.label} ${group.keywords} ${group.section.textContent}`.toLocaleLowerCase();
    return query.split(/\s+/).every(word => corpus.includes(word));
  }
  function findSettingMatch(group) {
    const query = search.value.trim().toLocaleLowerCase();
    if (!query) return null;
    const candidates = [...group.section.querySelectorAll('.settings-device-row,.settings-option,.settings-ignored-apps,.settings-prompt-mode,.settings-card-heading,label')];
    return candidates.find(node => query.split(/\s+/).every(word => node.textContent.toLocaleLowerCase().includes(word))) || null;
  }
  function activate(key, { findMatch = false } = {}) {
    const group = groups.find(item => item.id === key && !item.button.hidden);
    if (!group) return false;
    if (selected !== group.id && inlineNote) inlineNote.textContent = '';
    selected = group.id;
    groups.forEach(item => {
      const active = item === group;
      item.section.hidden = !active; item.section.inert = !active;
      item.button.setAttribute('aria-selected', String(active)); item.button.tabIndex = active ? 0 : -1;
    });
    byId('settings-section-title').textContent = group.label;
    byId('settings-section-description').textContent = group.description;
    byId('settings-search-empty').hidden = true;
    content.querySelector('.settings-section-heading').hidden = false;
    group.button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    page.querySelectorAll('.settings-search-match').forEach(node => node.classList.remove('settings-search-match'));
    scroller.scrollTop = 0;
    if (findMatch) {
      const match = findSettingMatch(group);
      if (match) { match.classList.add('settings-search-match'); match.scrollIntoView({ block: 'nearest' }); }
    }
    if (key === 'ai') refreshPrompt();
    return true;
  }
  function filter() {
    const query = search.value.trim().toLocaleLowerCase();
    byId('settings-search-clear').hidden = !query;
    groups.forEach(group => { group.button.hidden = !matches(group, query); });
    const found = groups.filter(group => !group.button.hidden);
    byId('settings-search-status').textContent = query ? `找到 ${found.length} 个分类` : '';
    if (found.length) activate(found.some(group => group.id === selected) ? selected : found[0].id, { findMatch: true });
    else {
      groups.forEach(group => { group.section.hidden = true; group.section.inert = true; group.button.setAttribute('aria-selected', 'false'); group.button.tabIndex = -1; });
      content.querySelector('.settings-section-heading').hidden = true; byId('settings-search-empty').hidden = false;
    }
  }
  search.addEventListener('input', filter);
  search.addEventListener('keydown', event => {
    if (event.key === 'Escape' && search.value) { event.preventDefault(); event.stopPropagation(); search.value = ''; filter(); }
    else if (event.key === 'Enter' || event.key === 'ArrowDown') {
      const first = groups.find(group => !group.button.hidden);
      if (first) { event.preventDefault(); activate(first.id, { findMatch: true }); first.button.focus(); }
    }
  });
  byId('settings-search-clear').addEventListener('click', () => { search.value = ''; filter(); search.focus(); });
  menu.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const visible = groups.filter(group => !group.button.hidden);
    if (!visible.length) return;
    event.preventDefault();
    const index = visible.findIndex(group => group.button === document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length;
    activate(visible[next].id, { findMatch: true }); visible[next].button.focus();
  });
  async function open(key = 'general') {
    if (typeof window.setMode === 'function') await window.setMode(true);
    if (typeof window.setActiveTab === 'function') await window.setActiveTab('settings');
    search.value = ''; filter(); activate(key);
    byId(`settings-menu-${selected}`)?.focus({ preventScroll: true });
    return true;
  }
  async function openPromptSettings(period=reportPeriod) {
    if(['day','week','month'].includes(period))reportPeriod=period;
    await open('ai');
    promptCard.scrollIntoView({ block: 'start' }); modeInput.focus({ preventScroll: true });
    return true;
  }
  document.addEventListener('slate:tabchange', event => { if (event.detail?.tab === 'settings') refreshPrompt(); });
  window.SlateSettingsNavigation = Object.freeze({ open, activate: key => { search.value = ''; filter(); return activate(key); }, getSelected: () => selected });
  window.SlateReportPrompt = Object.freeze({ getTemplate, getMode, setMode,getFormat, openSettings: openPromptSettings });
  refreshPrompt(); activate('general');
})();
