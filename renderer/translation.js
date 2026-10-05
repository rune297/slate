(() => {
  const api=window.slateAPI;
  const el=id=>document.getElementById(`translation-${id}`);
  let busy=false, installed=false, generation=0;
  let shortcutListener;
  function stopShortcutRecording() {
    if(shortcutListener) document.removeEventListener('keydown',shortcutListener,true);
    shortcutListener=null;
  }
  function status(text) { el('status').textContent=text; el('install-status').textContent=text; }
  function lock(value) {
    busy=value;
    for (const id of ['run','install','import','paste']) el(id).disabled=value;
    el('source').disabled=value;
    el('input').readOnly=value;
  }
  async function refresh() {
    if (!api?.translationStatus) return;
    const state=await api.translationStatus(); installed=state.installed;
    el('setup').hidden=installed;
    el('shortcut').textContent=state.shortcut || '设置快捷键';
  }
  async function run() {
    if (busy) return;
    if (!installed) { status('请在设置中下载或导入模型'); await setActiveTab('settings'); return; }
    const text=el('input').value.trim();
    if (!text) return status('请先输入或读取剪贴板文字');
    const current=++generation; lock(true); el('output').value=''; el('copy').disabled=true;
    status('正在本地加载模型并翻译，首次加载可能较慢…');
    try {
      const result=await api.translateLocal({text,source:el('source').value});
      if (current !== generation) return;
      if (!result.ok) throw new Error(result.error);
      el('output').value=result.text; el('copy').disabled=!result.text;
      status(`翻译完成 · 原文语言 ${result.source} · 模型空闲 1 分钟后释放`);
    } catch (error) { if (current===generation) status(error.message); }
    finally { if (current===generation) lock(false); }
  }
  async function paste(auto=false) {
    if (busy) return;
    try {
      el('input').value=await api.translationClipboard();
      status(el('input').value ? '已读取剪贴板文字' : '剪贴板里没有文字');
      if (auto && el('input').value) await run();
    } catch(error) {status(`无法读取剪贴板：${error.message}`);}
  }
  el('paste').onclick=()=>paste(true); el('run').onclick=run;
  el('install').onclick=async()=> {
    const current=++generation; lock(true); status('正在下载模型，请保持网络连接…');
    try {
      const result=await api.installTranslation();
      if (current!==generation) return;
      if (!result.ok) throw new Error(result.error);
      await refresh(); status('模型已准备好，可以离线翻译');
    } catch(error) { if(current===generation) status(`下载未完成：${error.message}，可重试`); }
    finally { if(current===generation) lock(false); }
  };
  el('import').onclick=async()=> { lock(true); try { const result=await api.importTranslation(); if(result.cancelled) return; if(!result.ok) throw new Error(result.error); await refresh(); status('本地模型已准备好'); } catch(error) { status(error.message); } finally {lock(false);} };
  refresh().catch(()=>status('无法读取模型状态'));
  el('release').onclick=async()=> { ++generation; await api.releaseTranslation(); lock(false); status('已停止任务并释放模型内存'); };
  el('copy').onclick=async()=> { const result=await api.writeClipboard({type:'text',text:el('output').value}); status(result ? '已复制译文' : '复制失败，请重试'); };
  el('shortcut').onclick=()=> {
    stopShortcutRecording();
    status('请按下 Ctrl / Alt / Shift 组合快捷键，Esc 取消');
    const listen=async event=> {
      event.preventDefault(); event.stopImmediatePropagation();
      if(event.key==='Escape') { stopShortcutRecording(); return status('已取消设置'); }
      const value=keyEventToAccelerator(event);
      if(!value || !(event.ctrlKey || event.altKey || event.shiftKey) || ['Control','Alt','Shift'].includes(event.key)) return;
      const result=await api.setTranslationShortcut(value);
      if(!result.ok) return status('快捷键已被占用，请重新选择');
      stopShortcutRecording(); await refresh(); status('翻译快捷键已保存');
    };
    shortcutListener=listen; document.addEventListener('keydown',listen,true);
  };
  el('shortcut-clear').onclick=async()=> { await api.setTranslationShortcut(''); await refresh(); status('已清除翻译快捷键'); };
  api?.onOpenTranslation?.(async()=> { window.SlateHome?.setModuleVisible('translation',true); await setActiveTab('home'); if(!isExpanded) await setMode(true); await refresh(); await paste(true); });
  api?.onTranslationEvent?.(event=> {
    if(!busy) return;
    if(event.type==='progress') status(`准备模型：${event.progress.file || ''}${event.progress.progress ? ' '+Math.round(event.progress.progress)+'%' : ''}`);
    if(event.type==='segment') status(`正在本地翻译 ${event.completed}/${event.total} 段`);
  });
  document.addEventListener('slate:tabchange',event=> { stopShortcutRecording(); if(['home','settings'].includes(event.detail.tab)) refresh().catch(()=>status('无法读取翻译状态')); });
})();
