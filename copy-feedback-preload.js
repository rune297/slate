const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('copyFeedback',{onState:callback=>{const listener=(_,state)=>callback(state);ipcRenderer.on('copy-feedback:state',listener);return()=>ipcRenderer.removeListener('copy-feedback:state',listener);}});
