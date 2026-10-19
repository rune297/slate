const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.join(__dirname, '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.SLATE_NOTIFICATION_PORT ||= '43831';
function run(executable, args) {
  console.log(`Checking ${args.join(' ')}`);
  const result = spawnSync(executable, args, { cwd: root, env, stdio: 'inherit', timeout: 180000 });
  if (result.error) console.error(result.error);
  if (result.status !== 0) {
    if (env.TODO_TEST_LOG && fs.existsSync(env.TODO_TEST_LOG)) console.error(fs.readFileSync(env.TODO_TEST_LOG, 'utf8'));
    process.exit(result.status || 1);
  }
}
run(process.execPath, ['--test', ...fs.readdirSync(path.join(root, 'tests')).filter((name) => name.endsWith('.test.js')).map((name) => `tests/${name}`)]);
env.TODO_TEST_LOG = path.join(root, 'dist.noindex', 'windows-smoke', 'renderer-test.log');
fs.mkdirSync(path.dirname(env.TODO_TEST_LOG), { recursive: true });
fs.writeFileSync(env.TODO_TEST_LOG, '');
for (const file of ['slate-focus', 'retained-workspace', 'startup', 'dismiss-outside', 'workflow', 'newcomer', 'notes-compose', 'home-note-capture', 'topbar-recording', 'ux-actions', 'global-capture', 'task-attachments', 'v15-reminders', 'reports', 'v15-planning', 'api-settings', 'todo-mvp', 'pull-gesture', 'settings-navigation', 'note-attachments', 'beta4-features', 'beta5-product', 'prompt-optimizer', 'copy-feedback', 'beta7-quality', 'ai-network']) {
  const testProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-renderer-test-'));
  env.TODO_TEST_USER_DATA = testProfile;
  run(require('electron'), [`tests/${file}.electron.js`]);
  fs.rmSync(testProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
for (const file of ['main.js', 'main-services.js', 'platform.js', 'preload.js', 'quick-capture-preload.js', 'todo-reminder-preload.js','todo-reminders.cjs','todo-attachments.cjs','report-service.cjs','renderer/recurrence.js','renderer/task-planner.js','renderer/task-integration.js','renderer/task-attachments.js','renderer/reports.js','renderer/reminder-settings.js','renderer/todo-reminder.js','renderer/api-settings.js','renderer/pull-gesture.js', 'renderer/quick-capture.js', 'renderer/domain.js', 'renderer/workflow.js', 'renderer/workday.js', 'renderer/translation.js', 'renderer/capture.js', 'renderer/effects.js', 'renderer/app.js', 'renderer/workspace.js', 'renderer/icon-motion.js', 'renderer/notification.js', 'scripts/codex-notify.js', 'scripts/claude-notify.js', 'scripts/smoke-app.js']) {
  run(process.execPath, ['--check', file]);
}
run(process.execPath, ['--check', 'renderer/settings-navigation.js']);
for(const file of ['ai-provider-service.cjs','renderer/task-categories.js','renderer/note-attachments.js'])run(process.execPath,['--check',file]);
for(const file of ['copy-feedback.cjs','copy-feedback-preload.js','scripts/build-native.js','renderer/copy-feedback.js','renderer/copy-feedback-settings.js','renderer/quick-snippets.js'])run(process.execPath,['--check',file]);
for(const file of ['ai-catalog.cjs','ai-chat.cjs','ai-hub-service.cjs','prompt-optimizer.cjs','renderer/prompt-optimizer.js'])run(process.execPath,['--check',file]);
