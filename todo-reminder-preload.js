const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('todoReminderAPI',{
  ready:()=>ipcRenderer.invoke('todo-v15:reminder-ready'),
  action:payload=>ipcRenderer.invoke('todo-v15:reminder-action',payload),
  close:()=>ipcRenderer.invoke('todo-v15:reminder-close'),
  resize:height=>ipcRenderer.invoke('todo-v15:reminder-resize',height),
  onData:cb=>{const listener=(_event,payload)=>cb(payload);ipcRenderer.on('todo-v15:reminder-data',listener);return()=>ipcRenderer.removeListener('todo-v15:reminder-data',listener);},
});
