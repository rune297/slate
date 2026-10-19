(function(root,factory){const logic=factory();if(typeof module==='object'&&module.exports)module.exports=logic;else root.SlateCategoryLogic=logic;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const KEYS={list:'slate-todo-categories-v2',names:'slate-todo-category-names-v1',data:'slate-todo-data',rules:'slate-recurring-tasks-v1'};
  const LEGACY_NAMES={P0:'课程',P1:'自媒体&写作',P2:'Vibe coding',P3:'日常'};
  const validId=id=>typeof id==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)&&!['all','__proto__','prototype','constructor'].includes(id);
  const cleanName=value=>String(value||'').replace(/\s+/g,' ').trim().slice(0,24);
  function resolveState(list,names,data,rules){
    const sourceNames=names&&typeof names==='object'&&!Array.isArray(names)?names:{};
    const sourceData=data&&typeof data==='object'&&!Array.isArray(data)?data:{};
    const explicit=Array.isArray(list)&&list.some(validId);
    const legacyShape=['P0','P1','P2'].some(id=>(Array.isArray(sourceData[id])&&sourceData[id].length)||Object.hasOwn(sourceNames,id)||(Array.isArray(list)&&list.includes(id)));
    const ids=[...new Set([...(explicit?list.filter(validId):[]),...Object.keys(sourceData).filter(id=>validId(id)&&Array.isArray(sourceData[id])&&(sourceData[id].length||legacyShape&&Object.hasOwn(LEGACY_NAMES,id))),...Object.keys(sourceNames).filter(validId)])];
    const outNames={},outData={...sourceData};
    for(const id of ids)outNames[id]=cleanName(sourceNames[id])||LEGACY_NAMES[id]||id;
    const oldP3=cleanName(sourceNames.P3)||(explicit||legacyShape?'日常':'未分组');
    let movedP3='';
    if(ids.includes('P3')&&oldP3!=='未分组'){
      movedP3='c_legacy_p3';let suffix=1;while(ids.includes(movedP3)||Object.hasOwn(sourceData,movedP3))movedP3='c_legacy_p3_'+(++suffix);
      ids[ids.indexOf('P3')]=movedP3;outNames[movedP3]=oldP3;outData[movedP3]=Array.isArray(sourceData.P3)?sourceData.P3:[];outData.P3=[];delete outNames.P3;
    }
    if(!ids.includes('P3'))ids.unshift('P3');
    outNames.P3='未分组';if(!Array.isArray(outData.P3))outData.P3=[];
    for(const id of ids)if(!Array.isArray(outData[id]))outData[id]=[];
    return {ids,names:outNames,data:outData,rules:Array.isArray(rules)?rules.map(rule=>movedP3&&rule?.bucket==='P3'?{...rule,bucket:movedP3}:rule):rules,movedP3};
  }
  function readState(storage){
    const raw={};let malformed=false;
    const read=(key,fallback)=>{raw[key]=storage.getItem(key);if(raw[key]===null)return fallback;try{return JSON.parse(raw[key]);}catch{malformed=true;return fallback;}};
    const list=read(KEYS.list,null),names=read(KEYS.names,{}),data=read(KEYS.data,{}),rules=read(KEYS.rules,null);
    if(list!==null&&(!Array.isArray(list)||!list.every(validId)))malformed=true;
    if(!names||typeof names!=='object'||Array.isArray(names)||!data||typeof data!=='object'||Array.isArray(data))malformed=true;
    const result=resolveState(list,names,data,rules);
    return {...result,raw,readOnly:malformed,hasSource:Object.values(raw).some(value=>value!==null)};
  }
  function transaction(storage,updates){
    const changed=[],before={};
    try{
      for(const [key,value] of Object.entries(updates)){
        const next=typeof value==='string'?value:JSON.stringify(value);before[key]=storage.getItem(key);
        if(before[key]===next)continue;
        storage.setItem(key,next);changed.push(key);
      }
      return {ok:true};
    }catch(error){
      let rollbackFailed=false;
      for(const key of changed.reverse()){try{if(before[key]===null)storage.removeItem(key);else storage.setItem(key,before[key]);}catch{rollbackFailed=true;}}
      return {ok:false,rollbackFailed};
    }
  }
  return {KEYS,LEGACY_NAMES,validId,cleanName,resolveState,readState,transaction};
});

if(typeof window==='object'&&typeof document==='object')(()=>{
  'use strict';
  let picker,manager,taskId='',opener=null,editingId='';
  const adapter=()=>window.SlateCategories;
  const id=name=>document.getElementById(name);
  function message(text){if(manager)id('category-manager-status').textContent=text;}
  function restoreFocus(){if(opener?.isConnected)opener.focus({preventScroll:true});else document.querySelector('.todo-view.is-active')?.focus({preventScroll:true});}
  function closeButton(dialog){dialog.querySelector('[data-category-close]').onclick=()=>dialog.close();dialog.addEventListener('close',restoreFocus);}
  function choices(){
    const list=id('category-picker-list');list.replaceChildren();const query=id('category-picker-search').value.trim().toLocaleLowerCase();
    const selected=window.SlateTasks?.getAll().find(task=>task.id===taskId)?.bucket;
    const rows=adapter()?.getAll().filter(row=>row.name.toLocaleLowerCase().includes(query))||[];
    if(!rows.length){const p=document.createElement('p');p.className='category-empty';p.textContent='没有匹配的分类';list.append(p);return;}
    for(const row of rows){const button=document.createElement('button');button.type='button';button.dataset.categoryId=row.id;button.setAttribute('role','option');button.setAttribute('aria-selected',String(selected===row.id));
      const text=document.createElement('span');text.textContent=row.name;const mark=document.createElement('small');mark.textContent=selected===row.id?'当前分类':row.id==='P3'?'不指定分类':'';button.append(text,mark);
      button.onclick=()=>{if(adapter().moveTask(taskId,row.id)){picker.close();}else id('category-picker-status').textContent='分类未保存，原任务保持不变，请重试。';};list.append(button);}
  }
  function ensurePicker(){
    if(picker)return;picker=document.createElement('dialog');picker.id='category-picker';picker.className='category-dialog category-picker';picker.setAttribute('aria-labelledby','category-picker-heading');
    picker.innerHTML='<header><h2 id="category-picker-heading">选择分类</h2><button type="button" data-category-close>关闭</button></header><input id="category-picker-search" type="search" placeholder="搜索分类" aria-label="搜索分类"><div id="category-picker-list" role="listbox" aria-label="待办分类"></div><p id="category-picker-status" role="status"></p>';
    document.body.append(picker);closeButton(picker);id('category-picker-search').oninput=choices;
    picker.addEventListener('keydown',event=>{if(!['ArrowDown','ArrowUp'].includes(event.key))return;const buttons=[...id('category-picker-list').querySelectorAll('button')];if(!buttons.length)return;event.preventDefault();const current=buttons.indexOf(document.activeElement);buttons[(current+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();});
  }
  function renderManager(){
    const list=id('category-manager-list');list.replaceChildren();
    const all=document.createElement('div');all.className='category-manager-row';const fixed=document.createElement('div');fixed.innerHTML='<strong>全部分类</strong><small>固定置顶，仅用于筛选</small>';all.append(fixed);list.append(all);
    const rows=adapter()?.getAll()||[];
    for(const [index,row] of rows.entries()){
      const line=document.createElement('div');line.className='category-manager-row';line.dataset.categoryId=row.id;
      const description=document.createElement('div');description.className='category-manager-name';
      if(editingId===row.id&&row.id!=='P3'){
        const input=document.createElement('input');input.value=row.name;input.maxLength=24;input.setAttribute('aria-label','新分类名称');description.append(input);
        const save=document.createElement('button');save.type='button';save.textContent='保存';save.onclick=()=>{if(adapter().rename(row.id,input.value)){editingId='';renderManager();message('分类名称已保存');}else message('名称无效、重复或保存失败，请检查后重试。');};description.append(save);
        input.onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();save.click();}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();editingId='';renderManager();}};
        requestAnimationFrame(()=>{input.focus();input.select();});
      }else{const name=document.createElement('strong');name.textContent=row.name;description.append(name);if(row.id==='P3'){const note=document.createElement('small');note.textContent='系统分类，可调整顺序';description.append(note);}}
      const controls=document.createElement('section');controls.className='category-manager-actions';
      const button=(action,text,disabled=false)=>{const element=document.createElement('button');element.type='button';element.dataset.categoryAction=action;element.textContent=text;element.disabled=disabled;element.setAttribute('aria-label',text+'：'+row.name);return element;};
      const up=button('up','上移',index===0),down=button('down','下移',index===rows.length-1);
      up.onclick=()=>{if(adapter().reorder(row.id,-1)){renderManager();message('分类顺序已保存');}else message('顺序未保存，请重试。');};down.onclick=()=>{if(adapter().reorder(row.id,1)){renderManager();message('分类顺序已保存');}else message('顺序未保存，请重试。');};controls.append(up,down);
      if(row.id!=='P3'){const rename=button('rename','重命名'),remove=button('delete','删除');rename.onclick=()=>{editingId=row.id;renderManager();};remove.onclick=()=>{if(adapter().remove(row.id)){editingId='';renderManager();message('已删除分类，其中的待办已移到未分组。');}else message('删除未保存，分类和任务保持不变，请重试。');};controls.append(rename,remove);}
      line.append(description,controls);list.append(line);
    }
  }
  function ensureManager(){
    if(manager)return;manager=document.createElement('dialog');manager.id='category-manager';manager.className='category-dialog category-manager';manager.setAttribute('aria-labelledby','category-manager-heading');
    manager.innerHTML='<header><div><h2 id="category-manager-heading">管理分类</h2><p>全部分类固定置顶；删除自定义分类后，任务会移到未分组。</p></div><button type="button" data-category-close>关闭</button></header><form id="category-add-form"><input id="category-add-name" maxlength="24" placeholder="新分类名称" aria-label="新分类名称"><button type="submit">新增分类</button></form><div id="category-manager-list"></div><p id="category-manager-status" role="status"></p>';
    document.body.append(manager);closeButton(manager);id('category-add-form').onsubmit=event=>{event.preventDefault();if(adapter().add(id('category-add-name').value)){id('category-add-name').value='';renderManager();message('分类已创建');id('category-add-name').focus();}else message('名称不能为空、不能与已有分类重复，请检查或重试保存。');};
  }
  window.SlateCategoryPicker={
    open(task,anchor){if(!adapter()||!window.SlateTasks?.isReady())return;ensurePicker();taskId=task;opener=anchor||document.activeElement;id('category-picker-search').value='';id('category-picker-status').textContent='';choices();if(!picker.open)picker.showModal();id('category-picker-search').focus();},
    manage(options={}){if(!adapter()||!window.SlateTasks?.isReady())return;ensureManager();opener=options.anchor||document.activeElement;editingId=options.editId==='P3'?'':options.editId||'';renderManager();message('');if(!manager.open)manager.showModal();if(!editingId)id('category-add-name').focus();}
  };
})();
