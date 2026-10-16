(() => {
  const Tasks=window.SlateTasks, Workflow=window.SlateWorkflow;
  const list=document.getElementById('home-focus-list'),input=document.getElementById('home-task-input');
  const completedList=document.getElementById('home-completed-list'),completedToggle=document.getElementById('home-completed-toggle');
  if(!Tasks || !Workflow || !list || !input)return;
  let period='day',showCompleted=false;
  const labels={day:'今天',week:'本周',later:'以后'};
  const icons={up:'<path d="m6 14 6-6 6 6"/>',down:'<path d="m6 10 6 6 6-6"/>',reschedule:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 11h16"/>',toggle:'<path d="m5 12 4 4 10-10"/>'};
  function button(action,label,disabled=false) {
    const element=document.createElement('button');element.type='button';element.dataset.workAction=action;
    element.title=label;element.setAttribute('aria-label',label);element.disabled=disabled;
    element.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[action]}</svg>`;
    return element;
  }
  function rowFor(item,focusIds,done=false) {
    const row=document.createElement('li');row.dataset.id=item.id;row.className=`home-focus-item${done?' completed':''}`;
    row.append(button('toggle',`${done?'恢复未完成':'完成'}：${item.text}`));
    const name=document.createElement('button');name.type='button';name.dataset.workAction='details';name.className='home-focus-name';
    const title=document.createElement('strong');title.textContent=item.text;name.append(title);
    const meta=document.createElement('small');
    const state=item.status==='waiting'?'等待反馈':item.status==='followup'?'持续跟进':'';
    const schedule=item.planKind==='day' && item.planDate!==Workflow.dateKey() ? `${item.planDate} ${item.planDate<Workflow.dateKey()?'未完成':'安排'}` : '';
    meta.textContent=[done?'已完成':state,item.estimateMinutes?`${item.estimateMinutes} 分钟`:'',schedule].filter(Boolean).join(' · ');
    if(meta.textContent)name.append(meta);row.append(name);
    if(!done) {
      const actions=document.createElement('div');actions.className='home-focus-actions';
      const focused=Workflow.isFocus(item),index=focusIds.indexOf(item.id);
      const focus=document.createElement('button');focus.type='button';focus.dataset.workAction='focus';focus.textContent=focused?'重点':'先做';
      focus.title=focused?'取消今日重点':'设为今日重点，插到列表最前';focus.setAttribute('aria-pressed',String(focused));
      focus.className='home-focus-priority';row.append(focus);
      if(focused)actions.append(button('up','提前执行',index===0),button('down','稍后执行',index===focusIds.length-1));
      actions.append(button('reschedule','安排到其他日期'));row.append(actions);
    }
    return row;
  }
  function render() {
    const all=Tasks.getAll(),now=new Date();
    const rows=Workflow.sortTasks(all.filter(item=>Workflow.isInPeriod(item,period,now)),now);
    const pending=rows.filter(item=>!item.done),completed=rows.filter(item=>item.done);
    const focusIds=Workflow.focusTasks(all,now).map(item=>item.id);
    const stats=Workflow.periodStats(all,period,now);
    list.replaceChildren();completedList.replaceChildren();
    if(!pending.length) {
      const empty=document.createElement('li');empty.className='home-focus-empty';
      empty.textContent=stats.total ? `${labels[period]}的任务都完成了。临时有新任务，直接在下方添加。` : period==='day'?'今天想完成什么？在下方写下第一件事。':period==='week'?'本周想做但还没确定哪天的事，先记在这里。':'暂时不着急、还没确定日期的工作，先记下来。';
      list.append(empty);
    }
    pending.forEach(item=>list.append(rowFor(item,focusIds)));
    completed.forEach(item=>completedList.append(rowFor(item,focusIds,true)));
    const summary=document.getElementById('home-focus-summary');
    summary.textContent=`已完成 ${stats.completed} / ${stats.total}`;
    summary.title=`按当前安排统计；新增或移走任务会改变总数。${stats.waiting?` 等待反馈 ${stats.waiting}。`:''}${stats.followup?` 持续跟进 ${stats.followup}。`:''}${stats.overdue?` 逾期 ${stats.overdue}。`:''}${stats.added?` 期间新增 ${stats.added}。`:''}`;
    document.getElementById('home-task-title').textContent=period==='day'?'今日待办':`${labels[period]}待办`;
    const progress=document.getElementById('home-task-progress');
    progress.max=Math.max(1,stats.total);progress.value=stats.completed;
    progress.setAttribute('aria-label',`${labels[period]}待办完成进度`);
    progress.setAttribute('aria-valuetext',`已完成 ${stats.completed} / ${stats.total}`);
    completedToggle.hidden=!completed.length;completedToggle.textContent=`${showCompleted?'收起':'查看'}已完成（${completed.length}）`;
    completedToggle.setAttribute('aria-expanded',String(showCompleted));completedList.hidden=!showCompleted;
  }
  function add() {
    const text=input.value.trim();if(!text){input.focus();return;}
    if(Tasks.add(text,{period})) {input.value='';render();input.focus();}
  }
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing&&!event.repeat){event.preventDefault();add();}});
  document.getElementById('home-task-add').onclick=add;
  const act=event=> {
    const control=event.target.closest('[data-work-action]'),row=control?.closest('[data-id]');if(!control || !row || control.disabled)return;
    const id=row.dataset.id,action=control.dataset.workAction;
    if(action==='toggle')Tasks.toggle(id);
    if(action==='focus') {
      const item=Tasks.getAll().find(task=>task.id===id);
      if(Workflow.isFocus(item))Tasks.setFocus(id,false);else Tasks.prioritize(id);
    }
    if(action==='up')Tasks.moveFocus(id,-1);if(action==='down')Tasks.moveFocus(id,1);
    if(action==='reschedule')Tasks.reschedule(id,control);if(action==='details')Tasks.open(id,period);
  };
  list.addEventListener('click',act);completedList.addEventListener('click',act);
  completedToggle.onclick=()=>{showCompleted=!showCompleted;render();};
  document.querySelectorAll('[data-home-period]').forEach(element=>element.onclick=()=>{
    period=element.dataset.homePeriod;showCompleted=false;
    document.querySelectorAll('[data-home-period]').forEach(tab=>{const selected=tab===element;tab.classList.toggle('active',selected);tab.setAttribute('aria-pressed',String(selected));});
    input.placeholder=`添加${labels[period]}要做的事，回车确认`;render();
  });
  document.getElementById('home-work-open').onclick=()=>Tasks.open('',period);
  for(const kind of ['day','week'])document.getElementById(`home-review-${kind}`).onclick=()=>window.SlateWorkNotes.review(kind);
  document.addEventListener('slate:tasks-changed',render);document.addEventListener('slate:tasks-rendered',render);
  document.addEventListener('slate:tabchange',event=>{if(event.detail.tab==='home')render();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)render();});render();
})();
