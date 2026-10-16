const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// This temporary renderer can only request explicit text actions. Workspace
// storage, application settings and privileged shell APIs stay in the main UI.
contextBridge.exposeInMainWorld('quickCaptureAPI', {
  read: () => ipcRenderer.invoke('quick-capture:read'),
  status: () => ipcRenderer.invoke('quick-capture:status'),
  perform: payload => ipcRenderer.invoke('quick-capture:perform', payload),
  copy: text => ipcRenderer.invoke('quick-capture:copy', text),
  cancel: () => ipcRenderer.invoke('quick-capture:cancel'),
  close: () => ipcRenderer.invoke('quick-capture:close'),
  openSettings: text => ipcRenderer.invoke('quick-capture:settings', text),
  onEvent: callback => subscribe('quick-capture:event', callback),
  onClipboard: callback => subscribe('quick-capture:clipboard', callback),
  onEscape: callback => subscribe('quick-capture:escape', callback),
});
