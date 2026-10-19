// Event-driven Windows clipboard metadata observer. No history, network or keyboard hook.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

sealed class ClipboardObserver : NativeWindow, IDisposable {
    [DllImport("user32.dll")] static extern bool AddClipboardFormatListener(IntPtr h);
    [DllImport("user32.dll")] static extern bool RemoveClipboardFormatListener(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] static extern bool OpenClipboard(IntPtr h);
    [DllImport("user32.dll")] static extern bool CloseClipboard();
    [DllImport("user32.dll")] static extern bool IsClipboardFormatAvailable(uint format);
    [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint format);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern uint RegisterClipboardFormat(string name);
    [DllImport("user32.dll")] static extern IntPtr GetClipboardOwner();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr h);
    [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr h);
    [DllImport("kernel32.dll")] static extern UIntPtr GlobalSize(IntPtr h);
    [DllImport("shell32.dll", CharSet=CharSet.Unicode)] static extern uint DragQueryFile(IntPtr h, uint index, StringBuilder name, uint size);
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly System.Windows.Forms.Timer retry = new System.Windows.Forms.Timer();
    uint last; int attempts; bool disposed;
    public ClipboardObserver() {
        CreateHandle(new CreateParams { Caption="SlateClipboardObserver", Parent=new IntPtr(-3) });
        last=GetClipboardSequenceNumber();
        if(!AddClipboardFormatListener(Handle)) throw new InvalidOperationException("clipboard_listener_failed");
        retry.Interval=35; retry.Tick+=(s,e)=>{retry.Stop();Read();};
        Console.WriteLine("{\"type\":\"ready\"}");Console.Out.Flush();
        IntPtr window=Handle;
        new Thread(()=>{try{while(Console.In.ReadLine()!=null){} }catch{} PostMessage(window,0x10,IntPtr.Zero,IntPtr.Zero);}) { IsBackground=true }.Start();
    }
    bool Restricted(string name, bool presenceOnly) {
        uint format=RegisterClipboardFormat(name);if(!IsClipboardFormatAvailable(format))return false;
        if(presenceOnly)return true;
        IntPtr h=GetClipboardData(format),p=GlobalLock(h);if(p==IntPtr.Zero)return true;
        try{return GlobalSize(h).ToUInt64()<4||Marshal.ReadInt32(p)==0;}finally{GlobalUnlock(h);}
    }
    void Read() {
        uint sequence=GetClipboardSequenceNumber();if(sequence==last||disposed)return;
        if(!OpenClipboard(Handle)){if(++attempts<5)retry.Start();return;}
        try {
            bool concealed=Restricted("ExcludeClipboardContentFromMonitorProcessing",true)||Restricted("Clipboard Viewer Ignore",true)||Restricted("org.nspasteboard.ConcealedType",true)||Restricted("CanIncludeInClipboardHistory",false);
            last=sequence;if(concealed)return;
            uint pid;GetWindowThreadProcessId(GetClipboardOwner(),out pid);string source="";
            try{source=Process.GetProcessById((int)pid).ProcessName;}catch{}
            object message=null;
            if(IsClipboardFormatAvailable(15)){
                IntPtr drop=GetClipboardData(15);uint count=DragQueryFile(drop,0xffffffff,null,0);
                string[] names=new string[Math.Min(count,3u)];
                for(uint i=0;i<names.Length;i++){StringBuilder file=new StringBuilder(32768);DragQueryFile(drop,i,file,(uint)file.Capacity);names[i]=Path.GetFileName(file.ToString());if(names[i].Length>160)names[i]=names[i].Substring(0,160);}
                if(count>0)message=new{type="clipboard",sequence,kind="files",names,total=count,source};
            }else if(IsClipboardFormatAvailable(13)){
                IntPtr h=GetClipboardData(13),p=GlobalLock(h);
                if(p!=IntPtr.Zero)try{int length=(int)Math.Min(160uL,GlobalSize(h).ToUInt64()/2);string text=Marshal.PtrToStringUni(p,length).Split('\0')[0];if(!String.IsNullOrWhiteSpace(text))message=new{type="clipboard",sequence,kind="text",preview=text,source};}finally{GlobalUnlock(h);}
            }else if(IsClipboardFormatAvailable(8)||IsClipboardFormatAvailable(17)||IsClipboardFormatAvailable(2)||IsClipboardFormatAvailable(RegisterClipboardFormat("PNG")))message=new{type="clipboard",sequence,kind="image",source};
            if(message!=null){Console.WriteLine(json.Serialize(message));Console.Out.Flush();}
        }catch(IOException){Application.ExitThread();}catch{}finally{CloseClipboard();}
    }
    protected override void WndProc(ref Message m){
        if(m.Msg==0x31d){attempts=0;Read();}
        if(m.Msg==0x10){Dispose();Application.ExitThread();return;}base.WndProc(ref m);
    }
    public void Dispose(){if(disposed)return;disposed=true;retry.Stop();retry.Dispose();RemoveClipboardFormatListener(Handle);DestroyHandle();}
    [STAThread] static int Main(){Console.OutputEncoding=new UTF8Encoding(false);try{using(var observer=new ClipboardObserver())Application.Run();return 0;}catch{return 1;}}
}
