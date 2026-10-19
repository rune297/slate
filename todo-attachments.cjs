'use strict';

const crypto = require('node:crypto');
const defaultFs = require('node:fs');
const defaultPath = require('node:path');

const MAX_ATTACHMENTS = 8;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 20000000;
const FORMATS = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' });
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function cleanName(value, fallback) {
  return String(value || fallback).replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 128) || fallback;
}

function normalizeAttachments(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || !ID.test(item.id) || ids.has(item.id)) return [];
    const ext = Object.keys(FORMATS).find((key) => item.relativePath === `todo-images/${item.id}.${key}` && item.mime === FORMATS[key]);
    const width = Number(item.width), height = Number(item.height), size = Number(item.size);
    if (!ext || !Number.isInteger(size) || size <= 0 || size > MAX_IMAGE_BYTES || !validDimensions(width, height)) return [];
    ids.add(item.id);
    return [{ id: item.id, name: cleanName(item.name, `图片.${ext}`), relativePath: item.relativePath, mime: item.mime, size, width, height }];
  }).slice(0, MAX_ATTACHMENTS);
}

function validDimensions(width, height) {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    && width <= 16384 && height <= 16384 && width * height <= MAX_PIXELS;
}

const dimensionsMatch = (one, two) => (one.width === two.width && one.height === two.height)
  || (one.width === two.height && one.height === two.width);

// Read dimensions before asking the OS decoder to allocate a bitmap. Filename and
// caller-supplied MIME never decide the stored type.
function imageHeader(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii',12,16) === 'IHDR') {
    return { ext: 'png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 10 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return { ext: 'gif', width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  if (bytes.length >= 26 && bytes.toString('ascii', 0, 2) === 'BM') return { ext: 'bmp', width: Math.abs(bytes.readInt32LE(18)), height: Math.abs(bytes.readInt32LE(22)) };
  if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const type = bytes.toString('ascii',12,16);
    if (type === 'VP8X') return { ext: 'webp', width: 1 + bytes.readUIntLE(24,3), height: 1 + bytes.readUIntLE(27,3) };
    if (type === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) return { ext: 'webp', width: bytes.readUInt16LE(26) & 16383, height: bytes.readUInt16LE(28) & 16383 };
    if (type === 'VP8L' && bytes[20] === 47) { const bits = bytes.readUInt32LE(21); return { ext: 'webp', width: (bits & 16383) + 1, height: ((bits >>> 14) & 16383) + 1 }; }
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 7) {
        return { ext: 'jpg', width: bytes.readUInt16BE(offset+5), height: bytes.readUInt16BE(offset+3) };
      }
      offset += length;
    }
  }
  return null;
}

function createTaskAttachmentService(options = {}) {
  const fs = options.fs || defaultFs, path = options.path || defaultPath;
  const fsp = fs.promises;
  const { nativeImage, dialog, getWorkspacePath } = options;
  if (!nativeImage || typeof getWorkspacePath !== 'function') throw new Error('Task attachment service requires nativeImage and getWorkspacePath');
  const fail = (error) => ({ ok: false, error: error?.message || String(error || '图片操作失败，请重试') });

  async function directory(create = false) {
    const workspace = path.resolve(getWorkspacePath());
    const folder = path.join(workspace, 'todo-images');
    if (create) await fsp.mkdir(folder, { recursive: true });
    const [rootReal, folderReal] = await Promise.all([fsp.realpath(workspace), fsp.realpath(folder)]);
    if (path.relative(rootReal, folderReal) !== 'todo-images') throw new Error('图片目录不可用，请检查数据文件夹');
    return folderReal;
  }

  async function safeFile(descriptor, thumbnail = false) {
    const normalized = normalizeAttachments([descriptor])[0];
    if (!normalized) throw new Error('图片记录无效，请重新添加');
    const folder = await directory();
    const filename = thumbnail ? `${normalized.id}.thumb.png` : path.basename(normalized.relativePath);
    const location = path.join(folder, filename);
    const real = await fsp.realpath(location);
    if (path.dirname(real) !== folder || path.basename(real) !== filename) throw new Error('图片位置无效');
    const stat = await fsp.stat(real);
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) throw new Error('图片文件无效或过大');
    return { location: real, normalized };
  }

  async function importImage(payload = {}) {
    try {
      const value = payload.bytes;
      if (!(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value) && !Array.isArray(value)) throw new Error('未收到图片，请重新选择');
      const count = value.byteLength ?? value.length;
      if (!count || count > MAX_IMAGE_BYTES) throw new Error('每张图片需小于 10 MB');
      const bytes = value instanceof ArrayBuffer ? Buffer.from(value) : ArrayBuffer.isView(value) ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : Buffer.from(value);
      const header = imageHeader(bytes);
      if (!header || !validDimensions(header.width, header.height)) throw new Error('请选择 PNG、JPEG、WebP、GIF 或 BMP 图片，且不超过 2000 万像素');
      const image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty()) throw new Error('图片损坏或格式不支持，请换一张图片');
      const actual = image.getSize();
      if (!validDimensions(actual.width, actual.height) || !dimensionsMatch(actual,header)) throw new Error('图片尺寸无效，请重新导出后添加');
      const id = crypto.randomUUID(), name = cleanName(payload.name, `图片.${header.ext}`);
      const attachment = { id, name, relativePath: `todo-images/${id}.${header.ext}`, mime: FORMATS[header.ext], size: bytes.length, width: actual.width, height: actual.height };
      const folder = await directory(true);
      const originalPath = path.join(folder, `${id}.${header.ext}`), thumbPath = path.join(folder, `${id}.thumb.png`);
      try {
        await fsp.writeFile(originalPath, bytes, { flag: 'wx', mode: 0o600 });
        const ratio = Math.min(1, 240 / actual.width, 160 / actual.height);
        const thumbnail = image.resize({ width: Math.max(1,Math.round(actual.width*ratio)), height: Math.max(1,Math.round(actual.height*ratio)), quality: 'good' }).toPNG();
        await fsp.writeFile(thumbPath, thumbnail, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        await Promise.allSettled([fsp.unlink(originalPath),fsp.unlink(thumbPath)]);
        throw error;
      }
      return { ok: true, attachment };
    } catch (error) { return fail(error); }
  }

  async function choose(parentWindow) {
    try {
      const config = { title: '添加任务图片', properties: ['openFile','multiSelections'], filters: [{ name: '图片', extensions: ['png','jpg','jpeg','webp','gif','bmp'] }] };
      const result = parentWindow ? await dialog.showOpenDialog(parentWindow,config) : await dialog.showOpenDialog(config);
      if (result.canceled) return { ok: true, canceled: true, attachments: [] };
      if (result.filePaths.length > MAX_ATTACHMENTS) throw new Error('每条任务最多添加 8 张图片');
      const attachments = [], errors = [];
      for (const file of result.filePaths) {
        try {
          const stat = await fsp.stat(file);
          if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) throw new Error('每张图片需小于 10 MB');
          const imported = await importImage({ bytes: await fsp.readFile(file), name: path.basename(file) });
          if (imported.ok) attachments.push(imported.attachment); else errors.push(imported.error);
        } catch (error) { errors.push(error.message); }
      }
      return { ok: attachments.length > 0 || errors.length === 0, attachments, error: errors.join('；') };
    } catch (error) { return fail(error); }
  }

  async function read(descriptor, options = {}) {
    try {
      let file;
      try { file = await safeFile(descriptor, options.thumbnail === true); }
      catch (error) { if (options.thumbnail !== true || error.code !== 'ENOENT') throw error; file = await safeFile(descriptor); }
      const bytes = await fsp.readFile(file.location);
      return { ok: true, data: new Uint8Array(bytes), mime: file.location.endsWith('.thumb.png') ? 'image/png' : file.normalized.mime };
    } catch (error) { return fail(error.code === 'ENOENT' ? new Error('找不到图片；更换数据文件夹或恢复备份时，请一并带上 todo-images 文件夹') : error); }
  }

  // Removing a reference never deletes its file. The main process may run this
  // after collecting all live AND undo/history references, with a 30-day grace.
  async function removeUnreferenced(referencedIds, options = {}) {
    try {
      if (!Array.isArray(referencedIds)) throw new Error('缺少任务图片引用，已跳过清理');
      const ids = new Set(referencedIds.filter(id => typeof id === 'string' && ID.test(id)));
      const olderThanMs = Number.isFinite(options.olderThanMs) ? Math.max(0, options.olderThanMs) : 30*24*60*60*1000;
      let folder;
      try { folder = await directory(); } catch (error) { if (error.code === 'ENOENT') return { ok:true, removed:0 }; throw error; }
      let removed = 0;
      for (const name of await fsp.readdir(folder)) {
        const match = /^([a-f0-9-]{36})\.(png|jpg|webp|gif|bmp|thumb\.png)$/.exec(name);
        if (!match || !ID.test(match[1]) || ids.has(match[1])) continue;
        const location = path.join(folder,name), stat = await fsp.lstat(location);
        if (!stat.isFile() || Date.now()-stat.mtimeMs < olderThanMs) continue;
        await fsp.unlink(location); removed++;
      }
      return { ok:true, removed };
    } catch (error) { return fail(error); }
  }

  function normalizeAll(value) {
    if (!Array.isArray(value) || value.length > 100000) throw new Error('备份图片引用数量过多，请分批导出');
    const result = [], ids = new Map();
    for (const item of value) {
      const normalized = normalizeAttachments([item])[0];
      if (!normalized) throw new Error('备份包含无效的图片记录');
      if (ids.has(normalized.id)) {
        const previous=ids.get(normalized.id);
        if(['relativePath','mime','size','width','height'].some(key=>normalized[key]!==previous[key]))throw new Error('备份中的图片引用信息冲突，请重新添加相关图片');
        continue;
      }
      if(result.length>=512)throw new Error('备份图片数量过多，请分批导出');
      ids.set(normalized.id,normalized); result.push(normalized);
    }
    return result;
  }

  async function exportPortable(descriptors) {
    try {
      const images = []; let total = 0;
      for (const attachment of normalizeAll(descriptors)) {
        const file = await safeFile(attachment), bytes = await fsp.readFile(file.location);
        total += bytes.length;
        if (total > 100*1024*1024) throw new Error('图片合计超过 100 MB，请分批备份');
        images.push({ attachment, base64: bytes.toString('base64') });
      }
      return { ok: true, images };
    } catch(error) { return fail(error); }
  }

  async function importPortable(images) {
    const created = [];
    try {
      if (!Array.isArray(images) || images.length > 512) throw new Error('备份图片格式或数量无效');
      if (!images.length) return { ok:true, attachments:[] };
      const descriptors = normalizeAll(images.map(item=>item?.attachment));
      if (descriptors.length !== images.length) throw new Error('备份图片编号重复');
      const prepared = []; let total = 0;
      // Validate every entry before writing anything, including the native
      // decoder. Backup JSON may be edited or received from someone else.
      for (let index=0;index<images.length;index++) {
        const attachment = descriptors[index], encoded = images[index].base64;
        if (typeof encoded !== 'string' || encoded.length > Math.ceil(MAX_IMAGE_BYTES/3)*4 || encoded.length%4!==0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('备份图片内容无效或过大');
        const bytes = Buffer.from(encoded,'base64'); total += bytes.length;
        if (total > 100*1024*1024 || bytes.length !== attachment.size) throw new Error('备份图片大小不符，或合计超过 100 MB');
        const header = imageHeader(bytes);
        if (!header || FORMATS[header.ext] !== attachment.mime || !attachment.relativePath.endsWith(`.${header.ext}`) || !dimensionsMatch(header,attachment) || !validDimensions(header.width,header.height)) throw new Error('备份图片格式或尺寸不符');
        const image = nativeImage.createFromBuffer(bytes), size = image.getSize();
        if(image.isEmpty() || size.width!==attachment.width || size.height!==attachment.height)throw new Error('备份包含损坏的图片');
        const ratio = Math.min(1,240/size.width,160/size.height);
        const thumbnail = image.resize({width:Math.max(1,Math.round(size.width*ratio)),height:Math.max(1,Math.round(size.height*ratio)),quality:'good'}).toPNG();
        prepared.push({attachment,bytes,thumbnail});
      }
      const folder = await directory(true);
      // Preserve existing files. A same-ID/different-content collision must not
      // silently corrupt the live workspace while a backup is being restored.
      for(const entry of prepared) {
        const original = path.join(folder,path.basename(entry.attachment.relativePath));
        try {
          const safe = await safeFile(entry.attachment), existing = await fsp.readFile(safe.location);
          if (!existing.equals(entry.bytes)) throw new Error('备份图片编号与本机文件冲突，请保留原数据并更换数据文件夹恢复');
          entry.existing = true;
        } catch(error) { if(error.code!=='ENOENT')throw error; }
        entry.original = original;
      }
      for(const entry of prepared) {
        for(const [location,bytes] of [[entry.original,entry.bytes],[path.join(folder,`${entry.attachment.id}.thumb.png`),entry.thumbnail]]) {
          if(location===entry.original && entry.existing)continue;
          let handle;
          try {
            handle=await fsp.open(location,'wx',0o600);created.push(location);await handle.writeFile(bytes);
          } catch(error) {
            if(error.code==='EEXIST' && location!==entry.original) {
              // Existing previews are optional, but must still stay in the
              // image folder and cannot be symlinks to an arbitrary location.
              await safeFile(entry.attachment,true);continue;
            }
            throw error;
          } finally { if(handle)await handle.close(); }
        }
      }
      return {ok:true,attachments:descriptors};
    } catch(error) {
      await Promise.allSettled(created.map(location=>fsp.unlink(location)));
      return fail(error);
    }
  }

  return Object.freeze({ choose, importImage, read, normalizeAttachments, removeUnreferenced, exportPortable, importPortable });
}

module.exports = { createTaskAttachmentService, normalizeAttachments, imageHeader, MAX_ATTACHMENTS, MAX_IMAGE_BYTES };
