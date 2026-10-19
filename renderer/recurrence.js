(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SlateRecurrence=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  function date(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return null;const [y,m,d]=value.split('-').map(Number),v=new Date(y,m-1,d,12);return v.getFullYear()===y&&v.getMonth()===m-1&&v.getDate()===d?v:null;}
  function key(v){const d=new Date(v);return Number.isFinite(d.getTime())?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`:'';}
  function normalizeRule(source){
    if(!source||typeof source!=='object'||typeof source.id!=='string'||!/^[\w-]{1,100}$/.test(source.id)||!String(source.title||'').trim()||!date(source.startDate))return null;
    const frequency=['daily','weekly','monthly','once'].includes(source.frequency)?source.frequency:'daily';
    const weekdays=[...new Set((Array.isArray(source.weekdays)?source.weekdays:[]).filter(n=>Number.isInteger(n)&&n>=0&&n<=6))];
    const endDate=date(source.endDate)?source.endDate:'';
    if(endDate&&endDate<source.startDate)return null;
    return {id:source.id,title:String(source.title).trim().slice(0,600),notes:String(source.notes||'').slice(0,6000),bucket:String(source.bucket||'P3'),frequency,
      startDate:source.startDate,endDate,weekdays:weekdays.length?weekdays:[date(source.startDate).getDay()],monthDay:Math.max(1,Math.min(31,Math.floor(Number(source.monthDay)||date(source.startDate).getDate()))),
      deadlineTime:/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(source.deadlineTime)?source.deadlineTime:'',enabled:source.enabled!==false,important:source.important===true,
      createdAt:Number(source.createdAt)||Date.now(),updatedAt:Number(source.updatedAt)||Date.now(),lastGeneratedDate:date(source.lastGeneratedDate)?source.lastGeneratedDate:'',
      attachments:Array.isArray(source.attachments)?source.attachments.slice(0,8):[]};
  }
  function occursOn(source,day){const r=normalizeRule(source),d=date(day);if(!r||!d||!r.enabled||day<r.startDate||(r.endDate&&day>r.endDate))return false;
    if(r.frequency==='once')return day===r.startDate;
    if(r.frequency==='weekly')return r.weekdays.includes(d.getDay());
    if(r.frequency==='monthly')return d.getDate()===Math.min(r.monthDay,new Date(d.getFullYear(),d.getMonth()+1,0).getDate());
    return true;
  }
  // After an offline gap, restore the most recent occurrence rather than creating
  // a large backlog of identical work. Existing unfinished instances stay intact.
  function latestOccurrence(source,today){const r=normalizeRule(source);if(!r||!r.enabled||!date(today)||today<r.startDate)return '';
    if(r.frequency==='once')return r.startDate>(r.lastGeneratedDate||'')?r.startDate:'';
    const end=r.endDate&&r.endDate<today?r.endDate:today;
    let d=date(end);for(let i=0;i<367&&key(d)>=r.startDate;i++,d.setDate(d.getDate()-1)){const day=key(d);if(occursOn(r,day))return day>(r.lastGeneratedDate||'')?day:'';}return '';
  }
  function taskForDate(source,day,now=Date.now()){const r=normalizeRule(source);if(!r||!occursOn(r,day))return null;
    const deadline=r.deadlineTime?new Date(`${day}T${r.deadlineTime}:00`).toISOString():'';
    return {id:`repeat-${r.id}-${day}`,text:r.title,notes:r.notes,done:false,createdAt:now,deadline,planKind:'day',planDate:day,planWeek:'',planAddedAt:now,
      recurrenceId:r.id,occurrenceDate:day,focusDate:r.important?day:'',attachments:r.attachments};
  }
  return {date,key,normalizeRule,occursOn,latestOccurrence,taskForDate};
});
