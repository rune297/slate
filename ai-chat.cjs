'use strict';
const {normalizeEndpoint,endpointFor,chatBody}=require('./ai-provider-service.cjs');
const {provider,keyOptional}=require('./ai-catalog.cjs');
async function readJSON(response){
  if(!response.body?.getReader){const text=await response.text();if(Buffer.byteLength(text)>1048576)throw Error('response_limit');return JSON.parse(text);}
  const reader=response.body.getReader(),parts=[];let length=0;
  try{while(true){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.byteLength;if(length>1048576)throw Error('response_limit');parts.push(Buffer.from(chunk.value));}return JSON.parse(Buffer.concat(parts).toString('utf8'));}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}
function requestSpec(config,messages,options={}){
  const protocol=config.protocol||provider(config.provider)?.protocol||'openai',baseURL=config.baseURL||config.baseUrl;
  const headers={'Content-Type':'application/json'};
  if(protocol==='anthropic'){
    if(config.apiKey)headers['x-api-key']=config.apiKey;headers['anthropic-version']='2023-06-01';
    return {url:endpointFor(baseURL,'messages'),headers,body:{model:config.model,max_tokens:options.maxTokens||4096,system:messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n'),messages:messages.filter(m=>m.role!=='system').map(m=>({role:m.role,content:m.content}))}};
  }
  if(config.apiKey)headers.Authorization='Bearer '+config.apiKey;
  const body=chatBody(config,messages,options);
  // Let vendor defaults handle models with fixed sampling parameters.
  if(!['openai','deepseek','custom','ollama','lmstudio'].includes(config.provider)){delete body.temperature;delete body.response_format;}
  if(config.provider==='minimax')body.reasoning_split=true;
  return {url:endpointFor(baseURL,'chat/completions'),headers,body};
}
function textResult(data,protocol){
  let text=protocol==='anthropic'?data?.content?.filter(p=>p.type==='text').map(p=>p.text).join('\n'):data?.choices?.[0]?.message?.content;
  if(typeof text!=='string'||!text.trim())throw Error('empty_response');
  text=text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/,'').trim();
  if(!text)throw Error('empty_response');
  return {text,finishReason:protocol==='anthropic'?(data.stop_reason==='max_tokens'?'length':data.stop_reason):data?.choices?.[0]?.finish_reason};
}
async function sendChat(config,messages,{fetchImpl=globalThis.fetch,signal,...options}={}){
  const spec=requestSpec(config,messages,options);
  const response=await fetchImpl(spec.url,{method:'POST',redirect:'error',signal,headers:spec.headers,body:JSON.stringify(spec.body)});
  if(!response.ok)return {ok:false,status:response.status};
  const result=textResult(await readJSON(response),config.protocol||provider(config.provider)?.protocol||'openai');
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  return {ok:true,...result};
}
async function listModels(config,{fetchImpl=globalThis.fetch,signal}={}){
  if(config.protocol==='realtime')return provider(config.provider).models;
  const protocol=config.protocol||provider(config.provider)?.protocol||'openai';
  const headers=protocol==='anthropic'?{...(config.apiKey?{'x-api-key':config.apiKey}:{}),'anthropic-version':'2023-06-01'}:config.apiKey?{Authorization:'Bearer '+config.apiKey}:{};
  if(!config.apiKey&&!keyOptional(config))throw Error('key_required');
  const response=await fetchImpl(endpointFor(config.baseURL,'models'),{method:'GET',redirect:'error',signal,headers});
  if(!response.ok)throw Error('http_'+response.status);
  const data=await readJSON(response),models=Array.isArray(data.data)?data.data:Array.isArray(data.models)?data.models:[];
  const ids=[...new Set(models.map(m=>m?.id||m?.name).filter(v=>typeof v==='string'&&v.length<=200&&!/[\r\n\0]/.test(v)))].slice(0,500).sort();
  if(!ids.length)throw Error('no_models');return ids;
}
function modelListFailure(error,{aborted=false,timedOut=false}={}){
  const message=String(error?.message||''),cause=error?.cause?.code||error?.code;
  const result=(code,text)=>({ok:false,code,error:text});
  if(aborted)return timedOut?result('timeout','读取模型超时，请检查网络或本地服务是否已启动；也可以手动填写模型 ID。'):result('cancelled','已取消读取，当前填写内容保留。');
  if(message==='key_required'||/请填写 API Key|重新填写对应的 API Key/.test(message))return result('key_required','请先填写当前服务的 API Key；已保存且地址未变更的密钥可留空保留。');
  const status=Number(/^http_(\d+)$/.exec(message)?.[1]);
  if(status===401)return result('unauthorized','API Key 验证失败（401），请检查是否属于当前服务商及地域。');
  if(status===403)return result('forbidden','当前 Key 无权读取模型（403），请检查服务商授权或地域；也可手动填写模型 ID 后测试连接。');
  if([404,405,501].includes(status))return result('unsupported','当前地址没有提供模型列表接口（'+status+'）。可直接填写控制台的模型 ID，再测试连接。');
  if(status===429)return result('rate_limited','模型列表请求受限（429），请稍后重试或检查额度；手填模型仍可保留。');
  if(status>=500)return result('unavailable','服务商暂时无法返回模型（'+status+'），请稍后重试。当前填写内容保留。');
  if(status)return result('http_error','服务商拒绝了模型列表请求（'+status+'），请核对 API 地址；可手动填写模型 ID。');
  if(message==='no_models')return result('no_models','服务没有返回可用模型；本地服务请先加载模型，云端服务可手动填写控制台的模型 ID。');
  if(error instanceof SyntaxError||message==='response_limit')return result('invalid_response','当前地址返回的不是有效模型列表，请检查 API 地址；可手动填写模型 ID。');
  if(['ENOTFOUND','EAI_AGAIN'].includes(cause)||/net::ERR_NAME_NOT_RESOLVED/.test(message))return result('dns','无法解析服务地址，请检查地址、网络或代理设置。');
  if(['CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','DEPTH_ZERO_SELF_SIGNED_CERT','ERR_TLS_CERT_ALTNAME_INVALID','SELF_SIGNED_CERT_IN_CHAIN'].includes(cause)||/net::ERR_CERT_/.test(message))return result('tls','连接的安全证书验证失败，请检查系统时间和网络代理证书。');
  if(cause==='ECONNREFUSED'||/net::ERR_CONNECTION_REFUSED/.test(message))return result('refused','无法连接服务，请确认本地模型已启动、端口正确，或检查网络代理。');
  if(error instanceof TypeError||cause||/net::ERR_/.test(message))return result('network','未能连接服务，请检查网络、代理和 API 地址；当前填写内容保留。');
  if(/^请填写|^API 地址|^远程 API|^服务配置|^AI 配置|^请选择服务商/.test(message))return result('invalid_config',message);
  return result('unknown','暂时无法读取模型列表；当前填写内容保留，也可以手动填写模型 ID 后测试连接。');
}
module.exports={requestSpec,textResult,sendChat,listModels,readJSON,modelListFailure};
