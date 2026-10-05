const fs = require('node:fs');
const path = require('node:path');
class TranslationService {
  constructor({ spawn, root, notify, idleMs=60000 }) {
    Object.assign(this,{spawn,root,notify,idleMs}); this.sequence=0; this.worker=null; this.pending=null;
  }
  status() { return { installed:fs.existsSync(path.join(this.root,'ready.json')), loaded:!!this.worker, busy:!!this.pending }; }
  release() {
    clearTimeout(this.timer);
    const child=this.worker; this.worker=null;
    if (this.pending) { this.pending.reject(new Error('任务已取消')); this.pending=null; }
    child?.kill(); this.notify({type:'status',...this.status()});
  }
  async run(action, text='', source='auto') {
    if (this.pending) throw new Error('已有翻译任务，请等待完成或取消');
    if (!['install','import','translate'].includes(action)) throw new Error('不支持的翻译操作');
    if (action === 'translate' && !this.status().installed) throw new Error('请先下载本地翻译模型');
    if (action === 'translate' && (!text.trim() || text.length > 6000)) throw new Error('请输入 1–6000 个字符');
    if (!['auto','en','ja','ko','fr','de','es','it','pt','ru','ar','vi','th','id','nl','pl','tr','uk','hi','zh'].includes(source)) throw new Error('不支持此原文语言');
    clearTimeout(this.timer);
    if (!this.worker) {
      const child=this.spawn(); this.worker=child;
      child.on('message', message => {
        if (child !== this.worker) return;
        if (!message.id) return this.notify(message);
        if (message.id !== this.pending?.id) return;
        const pending=this.pending; this.pending=null;
        if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.result);
        this.timer=setTimeout(()=>this.release(),this.idleMs);
        this.notify({type:'status',...this.status()});
      });
      child.on('exit',()=> { if (child===this.worker) this.release(); });
      child.on('error',()=> { if (child===this.worker) this.release(); });
    }
    const promise=new Promise((resolve,reject)=> { this.pending={id:++this.sequence,resolve,reject}; });
    this.worker.send({id:this.sequence,action,root:this.root,text,source});
    return promise;
  }
}
module.exports={TranslationService};
