const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {TranslationService}=require('../translation-service.cjs');
test('optional translation rejects uninstalled use, cancels work, and releases idle worker',async()=> {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'slate-translation-'));
 let starts=0, child;
 const service=new TranslationService({root,idleMs:20,notify:()=>{},spawn:()=> {
   starts++; child=new EventEmitter(); child.send=m=>{child.request=m}; child.kill=()=>{child.killed=true}; return child;
 }});
 try {
  await assert.rejects(service.run('translate','hello'),/下载/); assert.equal(starts,0);
  const install=service.run('install');
  await assert.rejects(service.run('install'),/已有/);
  fs.writeFileSync(path.join(root,'ready.json'),'{}');
  child.emit('message',{id:child.request.id,result:{installed:true}}); await install;
  const cancelled=service.run('translate','hello'); service.release();
  await assert.rejects(cancelled,/取消/); assert.equal(child.killed,true);
  const next=service.run('translate','hello'); child.emit('message',{id:child.request.id,result:{text:'你好'}});
  assert.equal((await next).text,'你好');
  await new Promise(resolve=>setTimeout(resolve,50)); assert.equal(service.status().loaded,false);
 } finally {service.release();fs.rmSync(root,{recursive:true,force:true});}
});
