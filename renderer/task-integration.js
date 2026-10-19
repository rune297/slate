(()=>{'use strict';const api=window.slateAPI;
  function sync(){if(window.SlateTasks?.isReady())window.SlateTasks.syncReminders();}
  function badge(data){const handle=document.getElementById('slate');if(!handle||!data)return;handle.classList.toggle('has-overdue',data.overdue>0);handle.classList.toggle('has-important',data.important>0);handle.title=data.overdue?`${data.overdue} 项逾期待办${data.important?'，其中 '+data.important+' 项为重点':''}，点击查看`:'展开 Slate';}
  api?.onTaskBadge?.(badge);api?.getTaskBadge?.().then(badge).catch(()=>{});
  api?.onTaskOpen?.(async payload=>{await setMode(true);await window.SlateTasks.open(payload?.id||'');});
  api?.onTaskAction?.(payload=>{let result={ok:false,error:'工作区尚未就绪，请稍后重试'};try{if(window.SlateTasks.isReady()){const task=window.SlateTasks.getAll().find(t=>t.id===payload.id);if(!task)result={ok:false,error:'该任务已不存在'};else if(payload.action==='acknowledge')result={ok:true};else if(payload.action==='complete')result={ok:task.done||window.SlateTasks.updateTask(task.id,{done:true})};else if(payload.action==='reschedule')result={ok:window.SlateTasks.updateTask(task.id,{deadline:payload.deadline,planKind:'day',planDate:payload.planDate})};if(!result.ok&&!result.error)result.error='保存失败，原任务未改动';}}catch{result={ok:false,error:'保存失败，请检查任务后重试'};}api.replyTaskAction({...result,requestId:payload.requestId});});
  document.addEventListener('slate:modechange',sync);
  new MutationObserver(sync).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  setTimeout(sync,1700);
})();
