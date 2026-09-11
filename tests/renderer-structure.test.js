const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace.js'), 'utf8');
const effectsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'effects.js'), 'utf8');

test('clipboard rows define both favorite icons before rendering entries', () => {
  assert.match(appJs, /const starOutlineSvg\s*=/);
  assert.match(appJs, /const starFilledSvg\s*=/);
});

test('notes have a dedicated top-level tab and management panel', () => {
  assert.match(html, /data-tab="notes"/);
  assert.match(html, /id="tab-notes"/);
  assert.match(html, /id="notes-search"/);
  assert.match(html, /id="notes-list"/);
  assert.match(html, /id="notes-detail"/);
});

test('home scratch note keeps only the save action', () => {
  const homeNote = html.match(/<section class="tile home-note"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(homeNote, /id="note-save-btn"/);
  assert.doesNotMatch(homeNote, /id="note-library-btn"/);
  assert.doesNotMatch(homeNote, /id="note-library"/);
});

test('recordings expose in-page API settings and create a live draft while recording', () => {
  assert.match(html, /id="recording-configure"/);
  assert.match(workspaceJs, /function beginRecordingDraft\(\)/);
  assert.match(workspaceJs, /recordingLiveTranscript/);
  assert.match(workspaceJs, /configure-transcription/);
});

test('a live recording can be paused, resumed, and stopped from the recordings tab', () => {
  assert.match(workspaceJs, /recording-live-pause/);
  assert.match(workspaceJs, /recording-live-stop/);
  assert.match(workspaceJs, /togglePauseRecording/);
  assert.match(workspaceJs, /stopRecording/);
});

test('homepage visibility has one storage key, exact validation, and lifecycle events', () => {
  assert.match(appJs, /slate-home-hidden-modules-v1/);
  assert.match(appJs, /validateHomeWidgetLayout/);
  assert.match(appJs, /window\.SlateHome\s*=/);
  assert.match(appJs, /slate:home-modules-changed/);
  assert.match(appJs, /slate:home-layout-error/);
  assert.match(appJs, /new Set\(homeTiles\.map\(\(tile\) => tile\.dataset\.homeModule\)\)/);
});

test('settings exposes exactly one switch for every homepage widget', () => {
  const switches = [...html.matchAll(/data-settings-home-module="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(switches, [
    'launcher', 'recorder', 'windows', 'note', 'commands',
  ]);
  assert.match(workspaceJs, /isRecordingActive/);
  assert.match(workspaceJs, /recording_active/);
  assert.match(workspaceJs, /at_least_one_required/);
});

test('settings exposes every panel tab as a possible default opening page', () => {
  const select = html.match(/<select id="settings-default-tab"[\s\S]*?<\/select>/)?.[0] || '';
  const options = [...select.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(options, [
    'home', 'todo', 'notes', 'links', 'recordings', 'credentials', 'clip', 'settings',
  ]);
  assert.match(workspaceJs, /setDefaultTab/);
});

test('hidden visual widgets stop presentation-only background work', () => {
  assert.match(effectsJs, /setEnabled/);
  assert.match(effectsJs, /slate:home-modules-changed/);
  assert.match(workspaceJs, /SlateHome\?\.isVisible/);
});

// 样式表只能服务于真实存在的界面：任何类选择器都必须能在渲染层源码里找到出处。
// 语料刻意排除 tests/ 自身，避免测试里的字符串把死亡规则“续命”。
function collectStyleClasses(source) {
  const names = new Set();
  source.split(/\r?\n/).forEach((line) => {
    if (/^\s*\/\*/.test(line)) return;
    for (const match of line.replace(/\/\*.*?\*\//g, '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) names.add(match[1]);
  });
  return [...names];
}

function collectRendererCorpus(root) {
  const skip = new Set(['node_modules', '.git', 'dist.noindex', 'tests']);
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|html|css|json|md)$/.test(entry.name) && entry.name !== 'styles.css') files.push(full);
    }
  };
  walk(root);
  return files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
}

test('styles.css keeps no rule for a class the renderer never references', () => {
  const root = path.join(__dirname, '..');
  const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');
  const corpus = collectRendererCorpus(root);
  const orphans = collectStyleClasses(css).filter((name) => {
    const pattern = new RegExp('(^|[^\\w-])' + name.replace(/-/g, '\\-') + '([^\\w-]|$)');
    return !pattern.test(corpus);
  });
  assert.deepEqual(orphans, [], '以下类选择器在渲染层已无任何引用: ' + orphans.join(', '));
});

test('retired interface classes stay out of the stylesheet', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  const retired = [
    'note-library', 'note-library-row', 'note-library-delete', 'note-library-empty',
    'module-effect-canvas', 'mirror-placeholder', 'mirror-label', 'mirror-hint', 'mirror-zoom',
    'quadrant-label', 'quadrant-title', 'priority-card', 'topbar-actions', 'topbar-mid',
    'todo-deadline-input', 'todo-add-button', 'todo-editor-backdrop', 'todo-editor-name', 'todo-meta',
    'credential-inline-editor', 'credential-inline-head', 'credential-inline-fields',
  ];
  retired.forEach((name) => {
    assert.doesNotMatch(css, new RegExp('\\.' + name + '(?![\\w-])'), '已下线的 .' + name + ' 不应再出现在 styles.css');
  });
});
