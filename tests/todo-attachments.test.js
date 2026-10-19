const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTaskAttachmentService, normalizeAttachments, imageHeader, MAX_IMAGE_BYTES } = require('../todo-attachments.cjs');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=','base64');
const descriptor = (fields={}) => ({id:'11111111-1111-4111-8111-111111111111',name:'图片.png',relativePath:'todo-images/11111111-1111-4111-8111-111111111111.png',mime:'image/png',size:PNG.length,width:1,height:1,...fields});
const image = {isEmpty:()=>false,getSize:()=>({width:1,height:1}),resize:()=>({toPNG:()=>PNG})};
async function setup(t, options={}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(),'slate-attachment-test-'));
  t.after(()=>fs.rmSync(workspace,{recursive:true,force:true}));
  const service = createTaskAttachmentService({nativeImage:{createFromBuffer:()=>image},getWorkspacePath:()=>workspace,...options});
  return {service,workspace};
}

test('task metadata rejects paths, mismatched MIME, invalid dimensions, duplicates and excess images',()=>{
  assert.equal(normalizeAttachments([descriptor()]).length,1);
  for(const patch of [{relativePath:'../private.png'},{relativePath:'todo-images/../../private.png'},{mime:'text/html'},{width:20000},{height:0},{size:MAX_IMAGE_BYTES+1},{id:'not-a-uuid'}])assert.equal(normalizeAttachments([descriptor(patch)]).length,0);
  assert.equal(normalizeAttachments([descriptor(),descriptor()]).length,1);
  const many=Array.from({length:9},(_,i)=>{const id=`11111111-1111-4111-8111-${String(i).padStart(12,'0')}`;return descriptor({id,relativePath:`todo-images/${id}.png`});});
  assert.equal(normalizeAttachments(many).length,8);
  assert.equal(normalizeAttachments([descriptor({name:'../../private\u0000.png'})])[0].name.includes('/'),false);
});

test('imports save only image descriptors, retain original bytes, and return small previews',async t=>{
  const {service,workspace}=await setup(t);
  const result=await service.importImage({bytes:new Uint8Array(PNG),name:'说明.png'});
  assert.equal(result.ok,true);
  assert.equal(result.attachment.name,'说明.png');
  assert.equal(result.attachment.mime,'image/png');
  assert.equal('base64' in result.attachment,false);
  assert.deepEqual(fs.readFileSync(path.join(workspace,result.attachment.relativePath)),PNG);
  const original=await service.read(result.attachment),thumbnail=await service.read(result.attachment,{thumbnail:true});
  assert.deepEqual(Buffer.from(original.data),PNG);
  assert.equal(thumbnail.mime,'image/png');
  assert.equal((await service.read({...result.attachment,relativePath:'../secret'})).ok,false);
});

test('invalid, too-large, oversized-dimension and undecodable images create no files',async t=>{
  let decoded=0;
  const {service,workspace}=await setup(t,{nativeImage:{createFromBuffer:()=>{decoded++;return {...image,isEmpty:()=>true};}}});
  for(const bytes of [Buffer.from('<svg onload="alert(1)"></svg>'),new Uint8Array(MAX_IMAGE_BYTES+1),Buffer.alloc(0)])assert.equal((await service.importImage({bytes})).ok,false);
  const giant=Buffer.from(PNG);giant.writeUInt32BE(20000,16);
  assert.equal((await service.importImage({bytes:giant})).ok,false);
  assert.equal(decoded,0,'reject obvious allocation bombs before OS decoding');
  assert.equal((await service.importImage({bytes:PNG})).ok,false);
  assert.equal(decoded,1);
  assert.deepEqual(fs.readdirSync(workspace),[]);
});

test('missing images return recoverable feedback and a missing thumbnail falls back to the original',async t=>{
  const {service,workspace}=await setup(t);
  const imported=await service.importImage({bytes:PNG});
  fs.unlinkSync(path.join(workspace,'todo-images',`${imported.attachment.id}.thumb.png`));
  assert.equal((await service.read(imported.attachment,{thumbnail:true})).ok,true);
  fs.unlinkSync(path.join(workspace,imported.attachment.relativePath));
  const result=await service.read(imported.attachment);
  assert.equal(result.ok,false);assert.match(result.error,/找不到图片/);
});

test('a linked image directory cannot expose files outside the workspace',async t=>{
  const source=await setup(t),outside=await setup(t);
  const item=(await source.service.importImage({bytes:PNG})).attachment;
  const directory=path.join(source.workspace,'todo-images');fs.renameSync(directory,path.join(source.workspace,'original-images'));
  fs.writeFileSync(path.join(outside.workspace,path.basename(item.relativePath)),PNG);
  try {fs.symlinkSync(outside.workspace,directory,process.platform==='win32'?'junction':'dir');}
  catch(error){if(['EPERM','EACCES'].includes(error.code)){t.skip('OS forbids link creation in this test environment');return;}throw error;}
  const result=await source.service.read(item);assert.equal(result.ok,false);assert.match(result.error,/图片目录不可用/);
});

test('choosing images supports cancellation and partial failures without discarding successful files',async t=>{
  let selected=[];
  const {service,workspace}=await setup(t,{dialog:{showOpenDialog:async()=>({canceled:!selected.length,filePaths:selected})}});
  assert.equal((await service.choose()).canceled,true);
  const source=path.join(workspace,'chosen.png'),invalid=path.join(workspace,'invalid.jpg');
  fs.writeFileSync(source,PNG);fs.writeFileSync(invalid,'no image');selected=[source,invalid];
  const result=await service.choose();assert.equal(result.ok,true);assert.equal(result.attachments.length,1);assert.ok(result.error);
});

test('unreferenced cleanup keeps recent images and all live/undo references',async t=>{
  const {service,workspace}=await setup(t);
  const kept=(await service.importImage({bytes:PNG})).attachment,orphan=(await service.importImage({bytes:PNG})).attachment;
  assert.equal((await service.removeUnreferenced([])).removed,0);
  assert.equal((await service.removeUnreferenced(undefined)).ok,false,'cannot clean without a complete reference list');
  const result=await service.removeUnreferenced([kept.id],{olderThanMs:0});
  assert.equal(result.ok,true);assert.equal(result.removed,2);
  assert.equal(fs.existsSync(path.join(workspace,kept.relativePath)),true);
  assert.equal(fs.existsSync(path.join(workspace,orphan.relativePath)),false);
});

test('portable backup restores exact IDs and original bytes into another workspace',async t=>{
  const source=await setup(t),destination=await setup(t);
  const one=(await source.service.importImage({bytes:PNG,name:'示例.png'})).attachment;
  const backup=await source.service.exportPortable([one]);assert.equal(backup.ok,true);assert.equal(backup.images.length,1);
  const restored=await destination.service.importPortable(backup.images);assert.equal(restored.ok,true);assert.deepEqual(restored.attachments,[one]);
  assert.deepEqual(fs.readFileSync(path.join(destination.workspace,one.relativePath)),PNG);
  assert.equal((await destination.service.importPortable(backup.images)).ok,true,'restoring the same backup is idempotent');
});

test('multi-megabyte portable images validate without overflowing the regular-expression stack',async t=>{
  const {service}=await setup(t),bytes=Buffer.concat([PNG,Buffer.alloc(2*1024*1024)]);
  const result=await service.importPortable([{attachment:descriptor({size:bytes.length}),base64:bytes.toString('base64')}]);
  assert.equal(result.ok,true,result.error);
  assert.deepEqual(Buffer.from((await service.read(result.attachments[0])).data),bytes);
});

test('repeated tasks can share hundreds of references without duplicating backup image bytes',async t=>{
  const {service}=await setup(t),item=(await service.importImage({bytes:PNG})).attachment;
  const backup=await service.exportPortable(Array.from({length:1000},()=>({...item})));
  assert.equal(backup.ok,true);assert.equal(backup.images.length,1);
  assert.equal((await service.exportPortable([item,{...item,width:2}])).ok,false,'conflicting metadata for one image ID must reject');
});

test('all backup entries validate before writes; forged paths, MIME and base64 are rejected',async t=>{
  const {service,workspace}=await setup(t);
  const good={attachment:descriptor(),base64:PNG.toString('base64')};
  const otherId='22222222-2222-4222-8222-222222222222';
  const bad={attachment:descriptor({id:otherId,relativePath:`todo-images/${otherId}.png`}),base64:'broken'};
  for(const images of [[good,bad],[{...good,attachment:descriptor({relativePath:'../steal.png'})}],[{...good,attachment:descriptor({mime:'text/html'})}],[good,good]])assert.equal((await service.importPortable(images)).ok,false);
  assert.deepEqual(fs.readdirSync(workspace),[]);
});

test('a same-ID but different-content backup cannot overwrite live images',async t=>{
  const {service,workspace}=await setup(t);
  const item=(await service.importImage({bytes:PNG})).attachment;
  const changed=Buffer.concat([PNG,Buffer.from('metadata')]);
  const result=await service.importPortable([{attachment:{...item,size:changed.length},base64:changed.toString('base64')}]);
  assert.equal(result.ok,false);assert.match(result.error,/冲突/);assert.deepEqual(fs.readFileSync(path.join(workspace,item.relativePath)),PNG);
});

test('file-write failure rolls back the original when thumbnail persistence fails',async t=>{
  const broken={...fs,promises:{...fs.promises,writeFile:async(location,...args)=>{if(location.endsWith('.thumb.png'))throw new Error('disk full');return fs.promises.writeFile(location,...args);}}};
  const {service,workspace}=await setup(t,{fs:broken});
  assert.equal((await service.importImage({bytes:PNG})).ok,false);
  assert.deepEqual(fs.readdirSync(path.join(workspace,'todo-images')),[]);
});

test('header parsing derives type and dimensions from content, never a filename',()=>{
  assert.deepEqual(imageHeader(PNG),{ext:'png',width:1,height:1});
  assert.deepEqual(imageHeader(Buffer.from('47494638396102000300','hex')),{ext:'gif',width:2,height:3});
  const jpg=Buffer.from('ffd8ffc0000b080003000201011100ffd9','hex');
  assert.deepEqual(imageHeader(jpg),{ext:'jpg',width:2,height:3});
  assert.equal(imageHeader(Buffer.from('not an image')),null);
});
