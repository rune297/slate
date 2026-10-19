const test=require('node:test'),assert=require('node:assert/strict');
const {listModels,modelListFailure}=require('../ai-chat.cjs');
const config={provider:'siliconflow',baseURL:'https://api.siliconflow.cn/v1',apiKey:'fixture-secret'};
for(const [status,code]of [[401,'unauthorized'],[403,'forbidden'],[404,'unsupported'],[405,'unsupported'],[501,'unsupported'],[429,'rate_limited'],[503,'unavailable'],[400,'http_error']])test('model discovery classifies HTTP '+status+' without leaking server data',async()=>{
  let failure;try{await listModels(config,{fetchImpl:async()=>new Response('fixture-secret private upstream',{status})});}catch(error){failure=modelListFailure(error);}
  assert.equal(failure.code,code);assert.equal(failure.ok,false);assert.match(failure.error,new RegExp(String(status)));assert.doesNotMatch(JSON.stringify(failure),/fixture-secret|private upstream/);
});
test('model discovery errors distinguish key, empty list, invalid data and cancellations',async()=>{
  for(const [fetchImpl,expected]of [[async()=>Response.json({data:[]}), 'no_models'],[async()=>new Response('<html>private</html>'),'invalid_response']]){
    await assert.rejects(listModels(config,{fetchImpl}),error=>modelListFailure(error).code===expected);
  }
  assert.equal(modelListFailure(Error('请填写 API Key；已保存的密钥可留空保留。')).code,'key_required');
  assert.equal(modelListFailure(Error(),{aborted:true,timedOut:true}).code,'timeout');
  assert.equal(modelListFailure(Error(),{aborted:true}).code,'cancelled');
});
test('model discovery network failures are actionable and never echo request credentials',()=>{
  for(const [cause,expected]of [['ENOTFOUND','dns'],['ECONNREFUSED','refused'],['UNABLE_TO_VERIFY_LEAF_SIGNATURE','tls'],['ECONNRESET','network']]){
    const error=new TypeError('private fixture-secret',{cause:{code:cause}}),result=modelListFailure(error);assert.equal(result.code,expected);assert.doesNotMatch(JSON.stringify(result),/fixture-secret|private/);
  }
});
