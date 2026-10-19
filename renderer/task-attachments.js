(function () {
  'use strict';
  const MAX_IMAGES = 8, MAX_BYTES = 10 * 1024 * 1024;
  const panels = new Set(), busyTasks = new Set();
  const api = window.slateAPI || {};
  let viewer = null, viewerUrl = '', viewerOpener = null, viewerToken = 0;

  const getTask = (id) => window.SlateTasks?.getAll().find((task) => task.id === id);
  const attachments = (task) => Array.isArray(task?.attachments) ? task.attachments : [];
  function message(panel, text, error = false) {
    if (!panel?.isConnected) return;
    const status = panel.querySelector('.task-image-status');
    status.textContent = text || '';
    status.dataset.error = String(error);
  }
  function releasePanel(panel) {
    for (const url of panel.imageUrls || []) URL.revokeObjectURL(url);
    panel.imageUrls = [];
    panels.delete(panel);
  }
  function blobUrl(result) {
    if (!result?.ok || !result.data) throw new Error(result?.error || '图片读取失败，请重试');
    return URL.createObjectURL(new Blob([result.data], { type: result.mime || 'image/png' }));
  }
  function setBusy(id, on) {
    if (on) busyTasks.add(id); else busyTasks.delete(id);
    for (const panel of panels) if (panel.dataset.taskId === id) {
      panel.setAttribute('aria-busy',String(on));
      panel.querySelectorAll('button').forEach((button) => { button.disabled = on || (button.classList.contains('task-image-add') && attachments(getTask(id)).length >= MAX_IMAGES); });
    }
  }

  async function persistAdded(id, additions, panel, error = '') {
    const task = getTask(id);
    if (!task) { message(panel,'任务已被删除，图片未添加',true); return false; }
    const previous = attachments(task), room = Math.max(0,MAX_IMAGES-previous.length);
    const selected = additions.slice(0,room);
    if (!selected.length) { message(panel,error || '每条任务最多添加 8 张图片',true); return false; }
    const saved = window.SlateTasks.updateTask(id,{attachments:[...previous,...selected]},{preserveDrafts:true});
    if (!saved) { message(panel,'图片未保存，请稍后重试',true); return false; }
    const current = [...panels].find((candidate)=>candidate.isConnected && candidate.dataset.taskId===id) || panel;
    await paintImages(current);
    const suffix = additions.length > room ? '；超出的图片未添加' : '';
    message(current,error ? `已添加 ${selected.length} 张；${error}${suffix}` : `已添加 ${selected.length} 张图片${suffix}`,!!error || !!suffix);
    return true;
  }

  async function chooseImages(id, panel) {
    if (busyTasks.has(id)) return;
    if (!api.taskAttachmentChoose || !window.SlateTasks?.updateTask) { message(panel,'图片功能暂不可用，请重启 Slate',true); return; }
    setBusy(id,true); message(panel,'正在选择图片…');
    try {
      const result = await api.taskAttachmentChoose();
      if (result?.canceled) { message(panel,''); return; }
      if (result?.attachments?.length) await persistAdded(id,result.attachments,panel,result.error);
      else message(panel,result?.error || '未添加图片',!result?.ok);
    } catch(error) { message(panel,error.message || '添加失败，请重试',true); }
    finally { setBusy(id,false); }
  }

  async function importFiles(id, files, panel) {
    if (busyTasks.has(id)) return false;
    if (!api.taskAttachmentImport || !window.SlateTasks?.updateTask) { message(panel,'图片功能暂不可用，请重启 Slate',true); return false; }
    const remaining = MAX_IMAGES-attachments(getTask(id)).length;
    if (remaining <= 0) { message(panel,'每条任务最多添加 8 张图片',true); return false; }
    const selected = Array.from(files).slice(0,remaining), added = [], errors = [];
    setBusy(id,true); message(panel,'正在保存图片…');
    try {
      for (const file of selected) {
        if (!file.size || file.size > MAX_BYTES) { errors.push('每张图片需小于 10 MB'); continue; }
        const result = await api.taskAttachmentImport({bytes:new Uint8Array(await file.arrayBuffer()),name:file.name || '粘贴的图片.png'});
        if (result?.ok && result.attachment) added.push(result.attachment); else errors.push(result?.error || '图片添加失败');
      }
      if (files.length > remaining) errors.push('每条任务最多 8 张图片');
      if (added.length) return await persistAdded(id,added,panel,[...new Set(errors)].join('；'));
      message(panel,[...new Set(errors)].join('；') || '请选择图片文件',true); return false;
    } catch(error) { message(panel,error.message || '添加失败，请重试',true); return false; }
    finally { setBusy(id,false); }
  }

  async function paintImages(panel) {
    if (!panel?.isConnected) return;
    for (const url of panel.imageUrls || []) URL.revokeObjectURL(url);
    panel.imageUrls = [];
    const token = (panel.paintToken || 0)+1; panel.paintToken = token;
    const items = attachments(getTask(panel.dataset.taskId));
    const list = panel.querySelector('.task-image-list'); list.replaceChildren();
    panel.querySelector('.task-image-count').textContent = `${items.length} / ${MAX_IMAGES}`;
    panel.querySelector('.task-image-add').disabled = busyTasks.has(panel.dataset.taskId) || items.length >= MAX_IMAGES;
    for (const item of items) {
      const figure = document.createElement('figure'); figure.className='task-image-item';
      const preview = document.createElement('button'); preview.type='button'; preview.className='task-image-preview'; preview.setAttribute('aria-label',`放大查看：${item.name}`);
      const loading = document.createElement('span'); loading.textContent='加载图片…'; preview.append(loading);
      preview.addEventListener('click',()=>openViewer(item,preview));
      const caption=document.createElement('figcaption'); caption.textContent=item.name; caption.title=item.name;
      const remove=document.createElement('button'); remove.type='button'; remove.className='task-image-remove'; remove.textContent='移除'; remove.setAttribute('aria-label',`从任务移除图片：${item.name}`);
      remove.addEventListener('click',()=>{
        const task=getTask(panel.dataset.taskId); if(!task || busyTasks.has(task.id))return;
        if(window.SlateTasks.updateTask(task.id,{attachments:attachments(task).filter(a=>a.id!==item.id)},{preserveDrafts:true})) {
          const current=[...panels].find(candidate=>candidate.isConnected && candidate.dataset.taskId===task.id) || panel;
          paintImages(current); message(current,'已移除图片');
        } else message(panel,'移除失败，请重试',true);
      });
      figure.append(preview,caption,remove);list.append(figure);
      if (!api.taskAttachmentRead) { loading.textContent='图片暂不可用'; continue; }
      api.taskAttachmentRead(item,{thumbnail:true}).then(result=>{
        if(!panel.isConnected || panel.paintToken!==token)return;
        try {
          const url=blobUrl(result);panel.imageUrls.push(url);
          const image=document.createElement('img');image.src=url;image.alt=item.name;image.draggable=false;image.loading='lazy';
          image.onerror=()=>{loading.textContent='图片无法显示，点击重试';preview.replaceChildren(loading);};
          preview.replaceChildren(image);
        } catch(error) {loading.textContent='图片缺失，点击查看原因';}
      }).catch(()=>{if(panel.isConnected && panel.paintToken===token)loading.textContent='图片读取失败';});
    }
  }

  function mount() {
    for(const panel of panels) if(!panel.isConnected)releasePanel(panel);
    document.querySelectorAll('.todo-item[data-id] .todo-work-details').forEach(details=>{
      if(details.querySelector('.task-images'))return;
      const row=details.closest('.todo-item[data-id]'), task=getTask(row.dataset.id);if(!task)return;
      const panel=document.createElement('section');panel.className='task-images';panel.dataset.taskId=task.id;panel.setAttribute('aria-label','任务图片');
      panel.innerHTML='<div class="task-image-toolbar"><span class="task-image-label">图片附件 <small class="task-image-count"></small></span><button type="button" class="task-image-add">添加图片</button></div><p class="task-image-hint">可拖入图片，或在此任务详情内粘贴图片；单张不超过 10 MB。</p><div class="task-image-list"></div><p class="task-image-status" role="status" aria-live="polite"></p>';
      details.append(panel);panels.add(panel);panel.querySelector('.task-image-add').addEventListener('click',()=>chooseImages(task.id,panel));
      // Only the explicitly opened task details receives pasted images. Text
      // paste in the rest of Slate and the OS remains untouched.
      details.addEventListener('paste',event=>{
        const files=Array.from(event.clipboardData?.files || []).filter(file=>file.type.startsWith('image/'));
        if(!files.length)return;event.preventDefault();event.stopPropagation();void importFiles(task.id,files,panel);
      });
      details.addEventListener('dragover',event=>{if(!Array.from(event.dataTransfer?.types || []).includes('Files'))return;event.preventDefault();panel.classList.add('is-dragging');});
      details.addEventListener('dragleave',event=>{if(!details.contains(event.relatedTarget))panel.classList.remove('is-dragging');});
      details.addEventListener('drop',event=>{
        const files=Array.from(event.dataTransfer?.files || []);if(!files.length)return;event.preventDefault();event.stopPropagation();panel.classList.remove('is-dragging');
        const images=files.filter(file=>file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name));
        if(!images.length){message(panel,'请选择图片文件',true);return;}void importFiles(task.id,images,panel);
      });
      void paintImages(panel);
    });
  }

  function closeViewer() {
    viewerToken++;
    if(viewer?.open)viewer.close();
    if(viewerUrl)URL.revokeObjectURL(viewerUrl);viewerUrl='';
    viewer?.querySelector('img')?.removeAttribute('src');
    if(viewerOpener?.isConnected)viewerOpener.focus({preventScroll:true});viewerOpener=null;
  }
  function createViewer() {
    if(viewer)return;
    viewer=document.createElement('dialog');viewer.className='task-image-viewer';viewer.setAttribute('aria-label','查看任务图片');
    viewer.innerHTML='<div class="task-image-viewer-toolbar"><strong class="task-image-viewer-name"></strong><span class="task-image-viewer-size"></span><button type="button" data-image-fit aria-pressed="false">原始尺寸</button><button type="button" data-image-close aria-label="关闭图片查看">关闭</button></div><p class="task-image-viewer-status" role="status"></p><div class="task-image-viewer-canvas"><img alt="" /></div>';
    document.body.append(viewer);
    viewer.querySelector('[data-image-close]').addEventListener('click',closeViewer);
    viewer.querySelector('[data-image-fit]').addEventListener('click',()=>{
      const full=viewer.classList.toggle('is-original');const button=viewer.querySelector('[data-image-fit]');button.textContent=full?'适应窗口':'原始尺寸';button.setAttribute('aria-pressed',String(full));
    });
    viewer.addEventListener('cancel',event=>{event.preventDefault();closeViewer();});
    viewer.addEventListener('click',event=>{if(event.target===viewer)closeViewer();});
    document.addEventListener('keydown',event=>{if(viewer?.open && event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeViewer();}},true);
  }
  async function openViewer(item,opener) {
    createViewer();closeViewer();viewerOpener=opener;const token=++viewerToken;
    viewer.classList.remove('is-original');viewer.querySelector('[data-image-fit]').textContent='原始尺寸';viewer.querySelector('[data-image-fit]').setAttribute('aria-pressed','false');
    viewer.querySelector('.task-image-viewer-name').textContent=item.name;
    viewer.querySelector('.task-image-viewer-size').textContent=`${item.width} × ${item.height}`;
    const status=viewer.querySelector('.task-image-viewer-status');status.textContent='正在加载原图…';viewer.showModal();
    try {
      const result=await api.taskAttachmentRead(item);
      if(!viewer.open || token!==viewerToken)return;
      viewerUrl=blobUrl(result);const image=viewer.querySelector('img');image.src=viewerUrl;image.alt=item.name;
      image.onload=()=>{if(token===viewerToken)status.textContent='';};image.onerror=()=>{if(token===viewerToken)status.textContent='图片无法显示，请重新添加';};
    } catch(error) {if(token===viewerToken)status.textContent=error.message || '图片读取失败';}
  }

  async function importClipboardEntry(entry) {
    if(entry?.type!=='image' || !entry.imagePath || !api.readClipImage || !api.taskAttachmentImport)return {ok:false,error:'这条剪贴板没有图片'};
    const data=await api.readClipImage(entry.imagePath);
    if(typeof data!=='string' || !/^data:image\/(png|jpeg|webp|gif|bmp);base64,/.test(data))return {ok:false,error:'剪贴板图片已丢失，请重新复制'};
    const base64=data.slice(data.indexOf(',')+1);
    if(base64.length>Math.ceil(MAX_BYTES/3)*4)return {ok:false,error:'每张图片需小于 10 MB'};
    const raw=atob(base64),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    return api.taskAttachmentImport({bytes,name:'剪贴板图片.png'});
  }

  window.SlateTaskAttachments=Object.freeze({mount,importClipboardEntry,closeViewer});
  document.addEventListener('slate:tasks-rendered',mount);
  document.addEventListener('slate:workspace-reloaded',()=>{closeViewer();mount();});
  document.addEventListener('slate:modechange',event=>{if(event.detail?.expanded===false)closeViewer();});
  window.addEventListener('beforeunload',()=>{for(const panel of panels)releasePanel(panel);closeViewer();});
  mount();
})();
