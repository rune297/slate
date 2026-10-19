'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {CATALOG,FEATURES,provider,keyOptional}=require('./ai-catalog.cjs');
const {normalizeEndpoint}=require('./ai-provider-service.cjs');
function createAIHub({getDataDir,safeStorage,readLegacy=()=>({}),writeFile}){
  const file=()=>path.join(getDataDir(),'ai-services.json');
  const secure=()=>{try{return safeStorage.isEncryptionAvailable()===true;}catch{return false;}};
  const decrypt=value=>{try{return value&&secure()?safeStorage.decryptString(Buffer.from(value,'base64')):'';}catch{return '';}};
  function read(){
    if(!fs.existsSync(file()))return null;
    let state;try{state=JSON.parse(fs.readFileSync(file(),'utf8'));}catch{throw Error('AI 配置无法读取，已停止覆盖；请先备份后检查配置文件。');}
    if(state?.version!==1||!Number.isInteger(state.revision)||state.revision<0||!Array.isArray(state.services)||state.services.length>40||!state.bindings||typeof state.bindings!=='object'||Array.isArray(state.bindings)||state.services.some(s=>!s||typeof s.id!=='string'||!provider(s.provider)||typeof s.encryptedKey!=='string'||typeof s.baseURL!=='string'||typeof s.name!=='string'||!Array.isArray(s.models)||s.models.some(m=>typeof m!=='string'))||new Set(state.services.map(s=>s.id)).size!==state.services.length)throw Error('AI 配置格式异常，原配置已保留。');
    return state;
  }
  function persist(state){
    fs.mkdirSync(getDataDir(),{recursive:true});const next={...state,revision:(state.revision||0)+1};
    if(writeFile){writeFile(file(),next);return next;}
    const temporary=file()+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temporary,JSON.stringify(next,null,2),{mode:0o600});fs.renameSync(temporary,file());return next;}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  }
  function fromLegacy(state,feature,config){
    const oldBinding=state.bindings[feature],used=oldBinding&&Object.entries(state.bindings).some(([kind,b])=>kind!==feature&&b?.serviceId===oldBinding.serviceId);
    const id=oldBinding&&!used?oldBinding.serviceId:'legacy-'+feature+'-'+crypto.randomUUID();
    const known=provider(config.provider)||provider('custom'),baseURL=config.baseURL||known.baseURL;
    if(!baseURL)return;
    const record={id,name:'原'+FEATURES.find(f=>f.id===feature).label,provider:known.id,baseURL,encryptedKey:String(config.encryptedKey||''),models:[config.model].filter(Boolean),defaultModel:String(config.model||''),region:config.region==='singapore'?'singapore':'beijing',workspaceId:String(config.workspaceId||'')};
    state.services=state.services.filter(s=>s.id!==id);state.services.push(record);state.bindings[feature]={serviceId:id,model:record.defaultModel};
  }
  function ensure(){
    let state=read();if(state)return state;
    state={version:1,revision:0,services:[],bindings:{}};const legacy=readLegacy();
    for(const feature of ['asr','llm','reports']){const value=legacy[feature];if(value&&(value.encryptedKey||value.baseURL&&value.model))fromLegacy(state,feature,value);}
    return persist(state);
  }
  function publicState(state){return {ok:true,revision:state.revision,catalog:CATALOG,features:FEATURES,bindings:state.bindings,secureStorage:secure(),services:state.services.map(s=>{const p=provider(s.provider),hasKey=!!decrypt(s.encryptedKey);return {id:s.id,name:s.name,provider:s.provider,baseURL:s.baseURL,models:s.models||[],defaultModel:s.defaultModel||'',region:s.region||'beijing',workspaceId:s.workspaceId||'',hasKey,needsReentry:!!s.encryptedKey&&!hasKey,capabilities:p.capabilities,protocol:p.protocol,keyOptional:keyOptional(s)};})};}
  function getState(){try{return publicState(ensure());}catch(error){return {ok:false,error:error.message};}}
  function checkRevision(state,revision){if(revision!==undefined&&revision!==state.revision)throw Error('配置已在其他操作中更新，请重新读取后再保存。');}
  function cleanDraft(payload,state){
    if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('配置格式无效');
    const current=payload.id?state.services.find(s=>s.id===payload.id):null;if(payload.id&&!current)throw Error('服务配置已删除，请重新添加。');
    const p=provider(payload.provider||current?.provider);if(!p)throw Error('请选择服务商模板');
    const baseURL=normalizeEndpoint(payload.baseURL===undefined?current?.baseURL||p.baseURL:payload.baseURL);
    const changed=!!current&&(p.id!==current.provider||baseURL!==current.baseURL);
    const apiKey=String(payload.apiKey||'').trim();if(apiKey.length>4096||/[\r\n\0]/.test(apiKey))throw Error('API Key 格式无效');
    const reused=!changed&&payload.clearKey!==true?current?.encryptedKey||'':'';
    const key=apiKey||(payload.clearKey===true?'':decrypt(reused));
    if(!key&&!keyOptional({baseURL})&&payload.clearKey!==true)throw Error(changed?'服务地址或厂商已改变，请重新填写对应的 API Key。':'请填写 API Key；已保存的密钥可留空保留。');
    return {p,current,baseURL,key,apiKey,reused};
  }
  function saveService(payload){try{
    const state=ensure();checkRevision(state,payload?.revision);const {p,current,baseURL,apiKey,reused}=cleanDraft(payload,state);
    if(current){const incompatible=FEATURES.find(f=>state.bindings[f.id]?.serviceId===current.id&&!p.capabilities.includes(f.capability));if(incompatible)throw Error('此服务仍用于'+incompatible.label+'，请先在功能分配中更换它的服务，再切换厂商。');}
    if(!current&&state.services.length>=40)throw Error('最多保存 40 个服务配置');
    if(apiKey&&!secure())throw Error('系统安全存储不可用，密钥没有保存。');
    const models=[...new Set((Array.isArray(payload.models)?payload.models:current?.models||p.models).filter(m=>typeof m==='string'&&m.trim()&&m.length<=200&&!/[\r\n\0]/.test(m)))].slice(0,500);
    const model=String(payload.defaultModel??current?.defaultModel??models[0]??'').trim();if(model.length>200||/[\r\n\0]/.test(model))throw Error('模型名称无效');if(model&&!models.includes(model))models.unshift(model);
    const name=String(payload.name||current?.name||p.label).trim().slice(0,80),workspaceId=String(payload.workspaceId??current?.workspaceId??'').trim();if(!/^[A-Za-z0-9_-]{0,128}$/.test(workspaceId))throw Error('业务空间 ID 格式无效');
    const record={id:current?.id||crypto.randomUUID(),name,provider:p.id,baseURL,encryptedKey:payload.clearKey===true?'':apiKey?safeStorage.encryptString(apiKey).toString('base64'):reused,models,defaultModel:model,region:payload.region==='singapore'?'singapore':'beijing',workspaceId};
    const services=current?state.services.map(s=>s.id===record.id?record:s):[...state.services,record];
    return {...publicState(persist({...state,services})),savedId:record.id};
  }catch(error){return {ok:false,error:error.message};}}
  function assign(payload){try{
    const state=ensure();checkRevision(state,payload?.revision);if(!payload?.bindings||typeof payload.bindings!=='object'||Array.isArray(payload.bindings))throw Error('功能分配格式无效');
    const bindings={...state.bindings};
    for(const [kind,binding]of Object.entries(payload.bindings)){
      const feature=FEATURES.find(f=>f.id===kind);if(!feature)throw Error('功能无效');
      if(!binding?.serviceId){delete bindings[kind];continue;}
      const service=state.services.find(s=>s.id===binding.serviceId),p=service&&provider(service.provider);
      if(!p?.capabilities.includes(feature.capability))throw Error('该服务不支持'+feature.label);
      const model=String(binding.model||'').trim();if(!model||model.length>200||/[\r\n\0]/.test(model))throw Error('请为'+feature.label+'选择模型');
      bindings[kind]={serviceId:service.id,model};
    }
    return publicState(persist({...state,bindings}));
  }catch(error){return {ok:false,error:error.message};}}
  function remove(payload){try{const state=ensure();checkRevision(state,payload?.revision);if(!state.services.some(s=>s.id===payload?.id))throw Error('服务已删除');return publicState(persist({...state,services:state.services.filter(s=>s.id!==payload.id),bindings:Object.fromEntries(Object.entries(state.bindings).filter(([,b])=>b.serviceId!==payload.id))}));}catch(error){return {ok:false,error:error.message};}}
  function resolve(feature){
    const state=read();if(!state)return null;const binding=state.bindings[feature],service=state.services.find(s=>s.id===binding?.serviceId);if(!service)return {};
    const p=provider(service.provider);return {serviceId:service.id,provider:p.id,protocol:p.protocol,baseURL:service.baseURL,baseUrl:service.baseURL,model:binding.model,apiKey:decrypt(service.encryptedKey),keyOptional:keyOptional(service),needsReentry:!!service.encryptedKey&&!decrypt(service.encryptedKey),region:service.region,workspaceId:service.workspaceId};
  }
  function draftConfig(payload){const state=ensure(),draft=cleanDraft(payload,state);return {provider:draft.p.id,protocol:draft.p.protocol,baseURL:draft.baseURL,apiKey:draft.key,keyOptional:keyOptional(draft),model:String(payload.model||payload.defaultModel||'').trim(),region:payload.region||draft.current?.region||'beijing',workspaceId:payload.workspaceId||draft.current?.workspaceId||''};}
  function syncLegacy(feature,config){if(!read())return;const state=ensure();fromLegacy(state,feature,config);persist(state);}
  return {getState,saveService,assign,remove,resolve,draftConfig,syncLegacy,exists:()=>fs.existsSync(file())};
}
module.exports={createAIHub};
