'use strict';
const CATALOG=Object.freeze([
  {id:'openai',label:'OpenAI',baseURL:'https://api.openai.com/v1',protocol:'openai',capabilities:['chat','asr'],models:['gpt-5-mini','gpt-4.1-mini','gpt-4o-mini','gpt-4o-mini-transcribe','whisper-1'],docs:'https://developers.openai.com/api/reference/resources/models/methods/list'},
  {id:'anthropic',label:'Anthropic · Claude',baseURL:'https://api.anthropic.com/v1',protocol:'anthropic',capabilities:['chat'],models:[],docs:'https://platform.claude.com/docs/en/api/overview'},
  {id:'gemini',label:'Google · Gemini',baseURL:'https://generativelanguage.googleapis.com/v1beta/openai',protocol:'openai',capabilities:['chat'],models:[],docs:'https://ai.google.dev/gemini-api/docs/openai'},
  {id:'deepseek',label:'DeepSeek',baseURL:'https://api.deepseek.com',protocol:'openai',capabilities:['chat'],models:['deepseek-flash','deepseek-pro'],docs:'https://api-docs.deepseek.com/api/list-models/'},
  {id:'kimi',label:'Kimi · 月之暗面',baseURL:'https://api.moonshot.cn/v1',protocol:'openai',capabilities:['chat'],models:[],docs:'https://platform.kimi.com/blog/posts/kimi-api-quick-start-guide'},
  {id:'zhipu',label:'智谱 · GLM',baseURL:'https://open.bigmodel.cn/api/paas/v4',protocol:'openai',capabilities:['chat'],models:[],docs:'https://docs.bigmodel.cn/cn/best-practice/case/ai-search-engine'},
  {id:'zai',label:'Z.AI · 国际',baseURL:'https://api.z.ai/api/paas/v4',protocol:'openai',capabilities:['chat'],models:[],docs:'https://docs.z.ai/guides/capabilities/mcp-call'},
  {id:'volcengine',label:'火山方舟 · 豆包',baseURL:'https://ark.cn-beijing.volces.com/api/v3',protocol:'openai',capabilities:['chat'],models:[],docs:'https://docs.volcengine.com/docs/ark/compatible-with-openai-sdk?lang=zh'},
  {id:'bailian',label:'阿里云百炼 · 中国内地',baseURL:'https://dashscope.aliyuncs.com/compatible-mode/v1',protocol:'openai',capabilities:['chat'],models:['qwen-plus'],docs:'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope'},
  {id:'bailian-intl',label:'阿里云百炼 · 国际',baseURL:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',protocol:'openai',capabilities:['chat'],models:['qwen-plus'],docs:'https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope'},
  {id:'siliconflow',label:'硅基流动',baseURL:'https://api.siliconflow.cn/v1',protocol:'openai',capabilities:['chat','asr'],models:[],docs:'https://docs.siliconflow.cn/docs/api/chat-completions-post'},
  {id:'openrouter',label:'OpenRouter',baseURL:'https://openrouter.ai/api/v1',protocol:'openai',capabilities:['chat'],models:[],docs:'https://openrouter.ai/docs/api/api-reference/models/get-models'},
  {id:'minimax',label:'MiniMax · 国际',baseURL:'https://api.minimax.io/v1',protocol:'openai',capabilities:['chat'],models:['MiniMax-M3','MiniMax-M2.7'],docs:'https://platform.minimax.io/docs/api-reference/text-openai-api'},
  {id:'groq',label:'Groq',baseURL:'https://api.groq.com/openai/v1',protocol:'openai',capabilities:['chat','asr'],models:[],docs:'https://console.groq.com/docs/openai'},
  {id:'xai',label:'xAI · Grok',baseURL:'https://api.x.ai/v1',protocol:'openai',capabilities:['chat'],models:[],docs:'https://docs.x.ai/developers/quickstart'},
  {id:'ollama',label:'Ollama · 本地',baseURL:'http://localhost:11434/v1',protocol:'openai',capabilities:['chat'],models:[],local:true,docs:'https://docs.ollama.com/api/openai-compatibility'},
  {id:'lmstudio',label:'LM Studio · 本地',baseURL:'http://localhost:1234/v1',protocol:'openai',capabilities:['chat'],models:[],local:true,docs:'https://lmstudio.ai/docs/developer/openai-compat'},
  {id:'custom',label:'自定义 · OpenAI 兼容',baseURL:'',protocol:'openai',capabilities:['chat','asr'],models:[]},
  {id:'dashscope-realtime',label:'阿里云百炼 · 实时语音',baseURL:'https://dashscope.aliyuncs.com',protocol:'realtime',capabilities:['asr'],models:['qwen3-asr-flash-realtime'],docs:'https://help.aliyun.com/zh/model-studio/qwen-real-time-speech-recognition'},
]);
const FEATURES=Object.freeze([{id:'prompt',label:'提示词优化',capability:'chat'},{id:'reports',label:'工作报告',capability:'chat'},{id:'llm',label:'智能整理与命名',capability:'chat'},{id:'asr',label:'录音转写',capability:'asr'}]);
const provider=id=>CATALOG.find(item=>item.id===id);
function isLoopback(value){try{return ['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname);}catch{return false;}}
function keyOptional(config){return isLoopback(config.baseURL||config.baseUrl);}
function configReady(config){return !!(config&&config.model&&config.baseURL&&(config.apiKey||keyOptional(config)));}
module.exports={CATALOG,FEATURES,provider,isLoopback,keyOptional,configReady};
