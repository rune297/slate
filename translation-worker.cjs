// Isolated CPU inference: downloads are allowed only during explicit installation.
const fs = require('node:fs');
const path = require('node:path');
// Node fetch does not use the system's HTTP proxy automatically.
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY) {
  const { EnvHttpProxyAgent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new EnvHttpProxyAgent({ httpsProxy:process.env.HTTPS_PROXY || process.env.ALL_PROXY, httpProxy:process.env.HTTP_PROXY || process.env.ALL_PROXY }));
}
let translator;
let runtime;
const MODEL = 'Xenova/m2m100_418M';
const languages = { eng:'en', jpn:'ja', kor:'ko', fra:'fr', deu:'de', spa:'es', ita:'it', por:'pt', rus:'ru', ara:'ar', vie:'vi', tha:'th', ind:'id', nld:'nl', pol:'pl', tur:'tr', ukr:'uk', hin:'hi' };
async function load(root, install) {
  runtime ||= await import('@huggingface/transformers');
  runtime.env.cacheDir = root;
  runtime.env.allowRemoteModels = install;
  runtime.env.allowLocalModels = true;
  runtime.env.localModelPath = root + path.sep;
  runtime.env.backends.onnx.wasm.numThreads = 2;
  translator ||= await runtime.pipeline('translation', MODEL, {
    dtype: 'q8', device: 'cpu',
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
    progress_callback: (progress) => process.send?.({ type:'progress', progress }),
  });
}
async function detect(text) {
  if (/[\u3040-\u30ff]/u.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/u.test(text)) return 'ko';
  if (/[\u4e00-\u9fff]/u.test(text) && !/[a-z]{4}/i.test(text)) return 'zh';
  const { franc } = await import('franc-min');
  return languages[franc(text, { only:Object.keys(languages), minLength:15 })] || 'en';
}
function chunks(text) {
  // Bound each inference input; preserve paragraph breaks and all characters.
  const result=[];
  for (const paragraph of text.split(/\n+/)) {
    if (!paragraph.trim()) continue;
    let remaining=paragraph.trim();
    while (remaining.length > 400) {
      let cut=remaining.lastIndexOf(' ',400);
      if (cut < 200) cut=400;
      result.push(remaining.slice(0,cut)); remaining=remaining.slice(cut).trim();
    }
    if (remaining) result.push(remaining);
  }
  return result;
}
process.on('message', async ({ id, action, root, text, source }) => {
  try {
    await load(root, action === 'install');
    if (action === 'install' || action === 'import') {
      fs.mkdirSync(root,{recursive:true});
      fs.writeFileSync(path.join(root,'ready.json'),JSON.stringify({ model:MODEL, dtype:'q8' }));
      process.send({ id, result:{ installed:true } }); return;
    }
    const language=source === 'auto' ? await detect(text) : source;
    const output=[];
    const segments=chunks(text);
    for (let i=0;i<segments.length;i++) {
      const result=language === 'zh' ? [{translation_text:segments[i]}] : await translator(segments[i],{src_lang:language,tgt_lang:'zh',max_new_tokens:256,num_beams:1});
      output.push(result[0].translation_text);
      process.send({type:'segment', completed:i+1,total:segments.length});
    }
    process.send({id,result:{text:output.join('\n\n'),source:language}});
  } catch (error) {
    const message=error.message === 'fetch failed'
      ? '无法连接模型下载服务器。请检查网络或系统代理，或使用“导入本地模型”。' : String(error.message || error);
    process.send?.({id,error:message});
  }
});
