'use strict';

const MAX_PCM_BYTES = 16000 * 2 * 10 * 60;
const PRESETS = Object.freeze({
  llm: [
    { id: 'openai', label: 'OpenAI', baseURL: 'https://api.openai.com/v1', model: 'gpt-5.4-mini' },
    { id: 'deepseek', label: 'DeepSeek', baseURL: 'https://api.deepseek.com', model: 'deepseek-flash' },
    { id: 'bailian', label: '阿里云百炼', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    { id: 'custom', label: '自定义兼容接口', baseURL: '', model: '' },
  ],
  asr: [
    { id: 'dashscope-realtime', label: '阿里云百炼 · 实时转写', baseURL: '', model: 'qwen3-asr-flash-realtime', mode: 'realtime' },
    { id: 'openai', label: 'OpenAI · 录音后转写', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini-transcribe', mode: 'file' },
    { id: 'custom', label: '自定义兼容音频接口 · 录音后转写', baseURL: '', model: '', mode: 'file' },
  ],
});
function inferProvider(value, baseURL = '', kind = 'llm') {
  const choices = PRESETS[kind === 'asr' ? 'asr' : 'llm'];
  if (choices.some(item => item.id === value)) return value;
  if (kind === 'asr') return 'dashscope-realtime';
  try {
    const host = new URL(baseURL).hostname;
    return host === 'api.openai.com' ? 'openai' : host === 'api.deepseek.com' ? 'deepseek' : /(?:^|\.)aliyuncs\.com$/.test(host) ? 'bailian' : 'custom';
  } catch (_) { return 'custom'; }
}
function normalizeEndpoint(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2048) throw new Error('请填写有效的 API 地址');
  let url; try { url = new URL(raw); } catch (_) { throw new Error('请填写完整的 API 地址'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API 地址仅支持 HTTP / HTTPS，且不能包含密钥或查询参数');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('远程 API 请使用 HTTPS，本机服务可使用 HTTP');
  return url.toString().replace(/\/+$/, '');
}
function endpointFor(baseURL, suffix) {
  const endpoint = normalizeEndpoint(baseURL);
  return endpoint.endsWith(`/${suffix}`) ? endpoint : `${endpoint}/${suffix}`;
}
function chatBody(config, messages, { maxTokens = 1024, temperature = 0.2, responseFormat } = {}) {
  const model = String(config.model || '');
  const reasoning = /^(?:gpt-[56](?:[.-]|$)|o[1-9](?:-|$))/.test(model);
  return { model, stream: false, messages,
    ...(reasoning ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens, temperature }),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    ...(/^deepseek/.test(model) && inferProvider(config.provider, config.baseURL || config.baseUrl) === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
  };
}
function wavFromPcm(pcm) {
  const bytes = Buffer.from(pcm);
  if (!bytes.length || bytes.length % 2 || bytes.length > MAX_PCM_BYTES) throw new Error('audio_limit');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + bytes.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(bytes.length, 40);
  return Buffer.concat([header, bytes]);
}
async function readJson(response) {
  let text = '';
  if (response.body?.getReader) {
    const reader = response.body.getReader(); let size = 0; const parts = [];
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 1024 * 1024) throw new Error('response_limit'); parts.push(Buffer.from(value));
      }
      text = Buffer.concat(parts).toString('utf8');
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
  } else { text = await response.text(); if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('response_limit'); }
  try { return JSON.parse(text); } catch (_) { throw new Error('invalid_response'); }
}
function httpError(status) {
  return status === 401 ? '密钥验证失败，请检查当前功能的 API Key。'
    : status === 403 ? '当前密钥没有此模型的调用权限，请检查授权与服务地域。'
      : status === 404 ? '没有找到接口或模型，请检查 API 地址和模型名称。'
        : status === 429 ? '请求受限或余额不足，请检查额度后重试。'
          : status === 400 || status === 422 ? '接口拒绝了请求，请检查模型和接口是否兼容。'
            : `服务返回错误（HTTP ${Number(status) || '未知'}），请稍后重试。`;
}
async function transcribePcm(config, pcm, { fetchImpl = globalThis.fetch, signal, timeoutMs = 90000, test = false } = {}) {
  const controller = new AbortController(); let timedOut = false;
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    if (signal?.aborted) controller.abort();
    const form = new FormData();
    form.append('model', String(config.model || '')); form.append('response_format', 'json');
    form.append('file', new Blob([wavFromPcm(pcm)], { type: 'audio/wav' }), test ? 'slate-connection-test.wav' : 'slate-recording.wav');
    const response = await fetchImpl(endpointFor(config.baseURL, 'audio/transcriptions'), {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}, body: form,
    });
    if (!response.ok) return { ok: false, code: `http_${response.status}`, error: httpError(response.status) };
    const result = await readJson(response);
    if (typeof result?.text !== 'string' || result.text.length > 100000) return { ok: false, error: '服务未返回有效的转写文本，请检查音频转写兼容接口。' };
    if (controller.signal.aborted) return { ok: false, code: timedOut ? 'timeout' : 'cancelled', error: timedOut ? '转写超时，本地音频已保留。' : '已取消转写，本地音频已保留。' };
    return { ok: true, transcript: result.text.trim() };
  } catch (error) {
    return { ok: false, code: timedOut ? 'timeout' : signal?.aborted ? 'cancelled' : 'connection_failed', error: timedOut ? '转写超时，本地音频已保留。' : signal?.aborted ? '已取消转写，本地音频已保留。' : error.message === 'audio_limit' ? '文件转写最多支持 10 分钟，本地录音仍会保留。' : '无法连接音频转写服务，请检查地址、网络和配置。' };
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
function realtimeUrl(config) {
  const host = config.workspaceId
    ? `${config.workspaceId}.${config.region === 'singapore' ? 'ap-southeast-1' : 'cn-beijing'}.maas.aliyuncs.com`
    : config.region === 'singapore' ? 'dashscope-intl.aliyuncs.com' : 'dashscope.aliyuncs.com';
  return `wss://${host}/api-ws/v1/realtime?model=${encodeURIComponent(config.model||'qwen3-asr-flash-realtime')}&heartbeat=true`;
}
function testRealtime(config, signal, WebSocketImpl) {
  return new Promise(resolve => {
    let socket, settled = false;
    const finish = result => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); try { socket?.terminate(); } catch (_) {} resolve(result); };
    const abort = () => finish({ ok: false, code: 'cancelled', error: '测试已取消。' });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    try {
      socket = new WebSocketImpl(realtimeUrl(config), { headers: { Authorization: `Bearer ${config.apiKey}`, 'OpenAI-Beta':'realtime=v1', ...(config.workspaceId ? { 'X-DashScope-WorkSpace': config.workspaceId } : {}) } });
      socket.on('open', () => { socket.send(JSON.stringify({ event_id: 'slate_connection_test', type: 'session.update', session: { input_audio_format: 'pcm', sample_rate: 16000, input_audio_transcription: { language: 'zh' } } })); });
      socket.on('message', raw => {
        let value; try { value = JSON.parse(String(raw)); } catch (_) { return; }
        if (value.type === 'session.updated') finish({ ok: true, message: '实时转写会话及模型配置已通过验证；未上传麦克风音频。' });
        else if (value.type === 'error') finish({ ok: false, error: '实时转写服务拒绝了配置，请检查密钥、模型权限与地域。' });
      });
      socket.on('error', () => finish({ ok: false, error: '无法建立实时转写连接，请检查网络、密钥与服务地域。' }));
      socket.on('close', () => finish({ ok: false, error: '实时转写会话未确认配置便已关闭，请检查模型权限。' }));
    } catch (_) { finish({ ok: false, error: '无法连接实时转写服务，请检查配置。' }); }
  });
}
function createConnectionTester({ resolveConfig, fetchImpl = globalThis.fetch, WebSocketImpl, timeoutMs = 15000 }) {
  const active = new Map();
  function cancel(owner) { const job = active.get(owner); if (!job) return { ok: true, cancelled: false }; job.cancelled = true; job.controller.abort(); return { ok: true, cancelled: true }; }
  async function test(payload, owner, credentialsResolved = false) {
    if (!payload || !['asr', 'llm', 'reports','prompt'].includes(payload.capability)) return { ok: false, error: '请选择要测试的功能。' };
    if (active.has(owner)) return { ok: false, error: '正在测试，请先取消或等待完成。' };
    const job = { controller: new AbortController(), cancelled: false, timedOut: false }; let timer;
    try {
      const saved = credentialsResolved ? {} : resolveConfig(payload.capability);
      const config = { ...saved, ...payload, apiKey: String(payload.apiKey || saved?.apiKey || '').trim() };
      if ((!config.apiKey&&!require('./ai-catalog.cjs').keyOptional(config)) || config.apiKey.length > 4096 || /[\r\n]/.test(config.apiKey)) return { ok: false, error: '请填写 API Key，或先保存当前功能的密钥。' };
      if (config.capability !== 'asr' || config.provider !== 'dashscope-realtime') {
        config.baseURL = normalizeEndpoint(config.baseURL);
        if (!config.model || String(config.model).length > 200 || /[\r\n]/.test(config.model)) return { ok: false, error: '请填写有效的模型名称。' };
      } else if (!/^[A-Za-z0-9_-]{0,128}$/.test(String(config.workspaceId || ''))) return { ok: false, error: '业务空间 ID 格式不正确。' };
      active.set(owner, job);
      timer = setTimeout(() => { job.timedOut = true; job.controller.abort(); }, timeoutMs);
      let result;
      if (config.capability === 'asr') {
        result = config.provider === 'dashscope-realtime' ? await testRealtime(config, job.controller.signal, WebSocketImpl)
          : await transcribePcm(config, Buffer.alloc(32000), { fetchImpl, signal: job.controller.signal, test: true, timeoutMs });
        if (result.ok && !result.message) result = { ok: true, message: '音频转写接口及模型请求已通过；测试上传 1 秒静音，未验证识别准确率。' };
      } else {
        const response=await require('./ai-chat.cjs').sendChat(config,[{role:'user',content:'Reply with OK.'}],{fetchImpl,signal:job.controller.signal,maxTokens:1024,temperature:0});
        result=response.ok?{ok:true,message:'已完成一次模型请求，地址、密钥与当前模型可用。测试未保存任何内容。'}:{ok:false,code:`http_${response.status}`,error:httpError(response.status)};
      }
      return job.timedOut ? { ok: false, code: 'timeout', error: '测试超时，请检查网络和 API 地址。' } : job.cancelled ? { ok: false, code: 'cancelled', error: '测试已取消。' } : result;
    } catch (_) { return { ok: false, code: job.timedOut ? 'timeout' : job.cancelled ? 'cancelled' : 'connection_failed', error: job.timedOut ? '测试超时，请检查网络和 API 地址。' : job.cancelled ? '测试已取消。' : '测试失败，请检查 API 地址、网络、密钥与模型。' }; }
    finally { clearTimeout(timer); if (active.get(owner) === job) active.delete(owner); }
  }
  return { test, cancel, dispose: () => { for (const owner of active.keys()) cancel(owner); } };
}
module.exports = { PRESETS, MAX_PCM_BYTES, inferProvider, normalizeEndpoint, endpointFor, chatBody, wavFromPcm, transcribePcm, realtimeUrl, createConnectionTester };
