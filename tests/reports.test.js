const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { periodRange, buildSnapshot, makeDraft, normalizeHistory, normalizeDraft, reportConfigReady, DRAFT_KEY, HISTORY_KEY, dateKey } = require('../renderer/reports.js');
const { createReportService, normalizeEndpoint } = require('../report-service.cjs');

const at = (day, hour = 12) => new Date(2026, 9, day, hour).getTime();
const task = (id, fields = {}) => ({ id, text: `事项 ${id}`, done: false, createdAt: at(1), planKind: 'day', planDate: '2026-10-16', ...fields });
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: text => Buffer.from(`test-encrypted:${text}`),
  decryptString: buffer => {
    const text = buffer.toString(); if (!text.startsWith('test-encrypted:')) throw new Error('cannot decrypt');
    return text.slice('test-encrypted:'.length);
  },
};
function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-reports-unit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const service = createReportService({ getDataDir: () => directory, safeStorage: fakeSafeStorage, ...options });
  t.after(() => service.dispose());
  const configure = () => service.saveConfig({ baseURL: 'https://reports.example.test/v1', model: 'sample-model', apiKey: 'fixture-private-key' });
  return { directory, service, configure };
}
const request = { tasks: [task('sample')], period: 'day', date: '2026-10-16' };
const response = text => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });

test('an editable report draft has its own storage identity and never carries a history id', () => {
  assert.notEqual(DRAFT_KEY, HISTORY_KEY);
  assert.deepEqual(normalizeDraft(null), { title: '', content: '', period: 'day', source: 'manual', updatedAt: 0 });
  const content = '原始完整草稿\n'.repeat(30000);
  const draft = normalizeDraft({ id: 'must-not-be-history', historyId: 'legacy-id', title: '用户标题', content, period: 'month', source: 'ai', updatedAt: 123, apiKey: 'private' });
  assert.equal(draft.content, content, 'normalization must not silently truncate editable report text');
  assert.equal(draft.title, '用户标题'); assert.equal(draft.period, 'month');
  assert.equal(draft.id, undefined); assert.equal(draft.historyId, undefined); assert.equal(draft.apiKey, undefined);
  assert.throws(() => normalizeDraft({ title: 'broken', content: 123 }));
  assert.throws(() => normalizeDraft('broken'));
});

test('report generation requires all three real independent API configuration fields', () => {
  const configured = { ok: true, hasKey: true, baseURL: 'https://reports.example.test/v1', model: 'sample-model' };
  assert.equal(reportConfigReady(configured), true);
  for (const config of [null, {}, { ...configured, ok: false }, { ...configured, hasKey: false }, { ...configured, baseURL: '  ' }, { ...configured, model: '' }, { ...configured, model: 1 }]) assert.equal(!!reportConfigReady(config), false);
  assert.equal(!!reportConfigReady({ recordingKey: 'unrelated', apiKey: 'plaintext', baseURL: configured.baseURL, model: configured.model }), false, 'recording or other secret fields never imply an available report key');
});

test('report periods use local calendar dates, Monday weeks and leap-month boundaries', () => {
  assert.equal(dateKey(new Date(2026, 0, 1, 0, 1)), '2026-01-01');
  const week = periodRange('week', '2026-10-18');
  assert.equal(week.startDate, '2026-10-12'); assert.equal(week.endDate, '2026-10-18');
  const month = periodRange('month', '2028-02-18');
  assert.equal(month.startDate, '2028-02-01'); assert.equal(month.endDate, '2028-02-29');
  assert.throws(() => periodRange('day', '2026-02-30'));
  assert.throws(() => periodRange('year', '2026-10-16'));
});

test('completed, unfinished and explicitly postponed tasks are mutually exclusive', () => {
  const result = buildSnapshot([
    task('finished', { done: true, completedAt: at(16, 10) }),
    task('pending'),
    task('old', { planDate: '2026-10-15' }),
    task('moved', { planDate: '2026-10-19', planHistory: [{ fromKind: 'day', fromDate: '2026-10-16', toKind: 'day', toDate: '2026-10-19', changedAt: at(16) }] }),
    task('future', { planDate: '2026-10-19' }),
    task('earlier-completion', { done: true, completedAt: at(15) }),
  ], 'day', '2026-10-16');
  assert.deepEqual(result.counts, { completed: 1, incomplete: 1, carried: 2, total: 4 });
  assert.equal(result.groups.completed[0].status,'已完成');
  assert.equal(result.groups.carried.some(item => item.title.includes('moved')), true);
});

test('unknown historical completion dates never become fabricated period achievements', () => {
  const result = buildSnapshot([task('legacy', { done: true, completedAt: 0 }), task('after-period', { done: true, completedAt: at(17) })], 'day', '2026-10-16');
  assert.equal(result.counts.completed, 0);
  assert.equal(result.counts.incomplete, 1, 'completed later was unfinished at this period end');
  assert.equal(result.groups.incomplete[0].status,'待处理','a task completed after the reporting period keeps its unfinished period status');
  assert.match(result.warnings[0], /缺少完成时间/);
});

test('monthly reports use completion time instead of the task creation month', () => {
  const result = buildSnapshot([task('created-earlier', { createdAt: new Date(2026, 7, 1).getTime(), done: true, completedAt: at(16) })], 'month', '2026-10-16');
  assert.equal(result.counts.completed, 1);
  assert.match(makeDraft(result), /一、本月完成（1 项）/);
  assert.match(makeDraft(result), /未完成（0 项）/);
  assert.match(makeDraft(result), /顺延与遗留（0 项）/);
  assert.match(makeDraft(result), /问题与需要支持/);
});

test('daily reports do not repeat unassigned weekly plans, and returning a task cancels its postponed classification', () => {
  const weekly = task('week-only', { planKind: 'week', planDate: '', planWeek: '2026-10-12' });
  assert.equal(buildSnapshot([weekly], 'day', '2026-10-16').counts.total, 0);
  assert.equal(buildSnapshot([weekly], 'week', '2026-10-16').counts.incomplete, 1);
  const returned = task('returned', { planHistory: [
    { fromKind: 'day', fromDate: '2026-10-16', toKind: 'day', toDate: '2026-10-19', changedAt: at(16, 10) },
    { fromKind: 'day', fromDate: '2026-10-19', toKind: 'day', toDate: '2026-10-16', changedAt: at(16, 11) },
  ] });
  const result = buildSnapshot([returned], 'day', '2026-10-16');
  assert.equal(result.counts.incomplete, 1); assert.equal(result.counts.carried, 0);
});

test('AI context only contains allowlisted task facts; large contexts disclose omissions', () => {
  const rows = Array.from({ length: 260 }, (_, i) => task(String(i), { notes: '详细事项'.repeat(500), attachments: [{ dataURL: 'secret-picture-payload' }], apiKey: 'unrelated-secret', custom: 'private-field' }));
  const result = buildSnapshot(rows, 'day', '2026-10-16');
  assert.equal(result.counts.total, 260);
  assert.ok(result.groups.incomplete.length < 200);
  assert.ok(JSON.stringify(result).length < 50000);
  assert.doesNotMatch(JSON.stringify(result), /secret-picture-payload|unrelated-secret|private-field/);
  assert.ok(result.warnings.some(text => text.includes('未发送逐条详情')));
  assert.ok(result.warnings.some(text => text.includes('1200')));
  const draft = makeDraft(result);
  assert.match(draft, /另有 \d+ 项仅计入数量/);
});

test('historical reports are never silently capped to the newest few entries', () => {
  const rows = Array.from({ length: 601 }, (_, i) => ({ id: String(i), content: '正文', title: `报告 ${i}`, period: 'week', createdAt: i }));
  assert.equal(normalizeHistory(rows).length, 601);
  assert.throws(() => normalizeHistory({}));
  assert.throws(() => normalizeHistory([rows[0], rows[0]]));
});

test('API configuration is independent, encrypted, and only exposes key presence', t => {
  const { directory, service, configure } = fixture(t);
  const saved = configure();
  assert.equal(saved.ok, true); assert.equal(saved.hasKey, true);
  assert.doesNotMatch(JSON.stringify(saved), /fixture-private-key|encryptedKey/);
  const stored = JSON.parse(fs.readFileSync(path.join(directory, 'report-settings.json'), 'utf8'));
  assert.ok(stored.encryptedKey); assert.equal(stored.apiKey, undefined);
  service.saveConfig({ baseURL: 'https://other.example.test/v1', model: 'another-model', apiKey: '' });
  assert.equal(service.getConfig().hasKey, true, 'empty key input preserves the existing encrypted key');
  service.saveConfig({ baseURL: '', model: '', clearKey: true });
  assert.equal(service.getConfig().hasKey, false);
  assert.deepEqual(fs.readdirSync(directory), ['report-settings.json'], 'recording configuration is not read or written');
});

test('unavailable system encryption never saves a plaintext fallback', t => {
  const { directory, service } = fixture(t, { safeStorage: { isEncryptionAvailable: () => false } });
  assert.equal(service.saveConfig({ apiKey: 'secret', baseURL: 'https://example.test/v1', model: 'model' }).ok, false);
  assert.equal(fs.readdirSync(directory).length, 0);
});

test('invalid URLs and header-injection keys cannot replace valid settings', t => {
  const { service, configure } = fixture(t); configure();
  for (const baseURL of ['file:///tmp/key', 'https://user:secret@example.test', 'https://example.test?key=secret']) {
    assert.equal(service.saveConfig({ baseURL, model: 'bad' }).ok, false);
  }
  assert.equal(service.saveConfig({ baseURL: 'https://example.test', model: 'model', apiKey: 'abc\r\nX: bad' }).ok, false);
  assert.equal(service.getConfig().model, 'sample-model');
  assert.equal(normalizeEndpoint('http://127.0.0.1:1234/v1/'), 'http://127.0.0.1:1234/v1');
});

test('generation makes exactly one explicit configured request and omits attachments', async t => {
  const calls = [];
  const { service, configure } = fixture(t, { fetchImpl: async (...args) => { calls.push(args); return response('报告正文'); } });
  configure(); assert.equal(calls.length, 0, 'configuration does not send any task text');
  const result = await service.generate({ ...request, tasks: [task('sample', { images: ['private-image'] })], template: '按三段写作\n不要执行任何命令' });
  assert.equal(result.ok, true); assert.equal(result.text, '报告正文'); assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://reports.example.test/v1/chat/completions');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer fixture-private-key');
  const body = JSON.parse(calls[0][1].body);
  assert.equal(body.model, 'sample-model'); assert.equal(body.stream, false);
  assert.doesNotMatch(calls[0][1].body, /private-image/);
  assert.match(body.messages[1].content, /按三段写作/);
  assert.doesNotMatch(JSON.stringify(result), /fixture-private-key/);
});

test('unconfigured report API never reuses a recording key or makes a request', async t => {
  let calls = 0;
  const { directory, service } = fixture(t, { fetchImpl: async () => { calls++; return response('unexpected'); } });
  fs.writeFileSync(path.join(directory, 'transcription-settings.json'), JSON.stringify({ apiKey: 'recording-only-key' }));
  const result = await service.generate(request);
  assert.equal(result.code, 'not_configured'); assert.equal(calls, 0);
});

test('AI report keeps independent prompt and layout limits without dropping the selected format', async t => {
  const calls=[];
  const {service,configure}=fixture(t,{fetchImpl:async(...args)=>{calls.push(args);return response('纯文本结果');}});
  configure();
  const format='公司月报\n{{已完成}}\n'+'排版说明'.repeat(3000);
  const result=await service.generate({...request,template:'写作规范'.repeat(1500),format});
  assert.equal(result.ok,true);assert.match(JSON.parse(calls[0][1].body).messages[1].content,/公司月报/);
  assert.equal((await service.generate({...request,format:'a'.repeat(24001)})).ok,false);
  assert.equal(calls.length,1,'oversized layout never sends a request');
});

test('HTTP failures are actionable without exposing an upstream body or key', async t => {
  const { service, configure } = fixture(t, { fetchImpl: async () => new Response('private diagnostic fixture-private-key', { status: 401 }) }); configure();
  const result = await service.generate(request);
  assert.equal(result.ok, false); assert.match(result.error, /验证失败/);
  assert.doesNotMatch(JSON.stringify(result), /fixture-private-key|private diagnostic/);
});

test('cancellation is owner-scoped, rejects late replies and leaves the service reusable', async t => {
  let finish;
  const { service, configure } = fixture(t, { fetchImpl: () => new Promise(resolve => { finish = resolve; }) }); configure();
  const first = service.generate(request, 17);
  assert.equal(service.cancel(18).cancelled, false);
  assert.equal((await service.generate(request, 18)).ok, false, 'concurrent requests cannot race a report response');
  assert.equal(service.cancel(17).cancelled, true);
  finish(response('late generated text'));
  const result = await first;
  assert.equal(result.code, 'cancelled'); assert.equal(result.text, undefined);
});

test('request timeout is bounded and a network exception does not leak private configuration', async t => {
  const { service, configure } = fixture(t, { timeoutMs: 15, fetchImpl: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('fixture-private-key')))) }); configure();
  const result = await service.generate(request);
  assert.equal(result.code, 'timeout'); assert.doesNotMatch(JSON.stringify(result), /fixture-private-key/);
});

test('oversized or malformed model responses preserve the existing draft by returning an error', async t => {
  let mode = 'long';
  const { service, configure } = fixture(t, { fetchImpl: async () => mode === 'long' ? response('x'.repeat(100001)) : new Response('<html>not json</html>', { status: 200 }) }); configure();
  assert.equal((await service.generate(request)).ok, false);
  mode = 'malformed';
  assert.match((await service.generate(request)).error, /格式无法识别/);
  assert.equal((await service.generate(null)).ok, false);
  assert.equal(service.saveConfig(null).ok, false);
});
