const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

function createNativePointer(profile, screen) {
  const source = path.join(profile, 'PointerDriver.cs');
  const binary = path.join(profile, 'PointerDriver.exe');
  fs.writeFileSync(source, String.raw`
using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
class PointerDriver {
  [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct GuiThreadInfo {
    public uint Size, Flags;
    public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
    public Rect CaretRect;
  }
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool GetCursorPos(out Point p);
  [DllImport("user32.dll")] static extern bool GetPhysicalCursorPos(out Point p);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, uint x, uint y, uint data, UIntPtr extra);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr GetCapture();
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GuiThreadInfo info);

  static uint ProcessId(IntPtr window) {
    uint pid = 0;
    if (window != IntPtr.Zero) GetWindowThreadProcessId(window, out pid);
    return pid;
  }
  static void Handle(StringBuilder json, string name, IntPtr window) {
    json.Append(",\"").Append(name).Append("\":\"").Append(window.ToInt64().ToString(CultureInfo.InvariantCulture)).Append("\"");
  }
  static void Number(StringBuilder json, string name, long number) {
    json.Append(",\"").Append(name).Append("\":").Append(number.ToString(CultureInfo.InvariantCulture));
  }
  static void Inspect(int requestId, Point requested) {
    Point cursor;
    if (!GetPhysicalCursorPos(out cursor)) GetCursorPos(out cursor);
    IntPtr hit = WindowFromPoint(requested);
    IntPtr root = GetAncestor(hit, 2); // GA_ROOT
    IntPtr foreground = GetForegroundWindow();
    IntPtr capture = GetCapture(); // Calling thread only; see foregroundCapture below.
    uint foregroundPid = 0;
    uint foregroundThread = GetWindowThreadProcessId(foreground, out foregroundPid);
    GuiThreadInfo gui = new GuiThreadInfo();
    gui.Size = (uint)Marshal.SizeOf(typeof(GuiThreadInfo));
    bool hasGui = foregroundThread != 0 && GetGUIThreadInfo(foregroundThread, ref gui);
    short leftState = GetAsyncKeyState(1); // VK_LBUTTON
    StringBuilder json = new StringBuilder("{\"requestId\":").Append(requestId);
    json.Append(",\"requestedPhysical\":{\"x\":").Append(requested.X).Append(",\"y\":").Append(requested.Y).Append("}");
    json.Append(",\"cursorPhysical\":{\"x\":").Append(cursor.X).Append(",\"y\":").Append(cursor.Y).Append("}");
    Handle(json, "hitHwnd", hit); Number(json, "hitPid", ProcessId(hit));
    Handle(json, "rootHwnd", root); Number(json, "rootPid", ProcessId(root));
    Handle(json, "foregroundHwnd", foreground); Number(json, "foregroundPid", foregroundPid);
    Number(json, "foregroundThreadId", foregroundThread);
    Handle(json, "captureHwnd", capture); Number(json, "capturePid", ProcessId(capture));
    json.Append(",\"captureScope\":\"pointer-driver-thread\"");
    json.Append(",\"foregroundGuiAvailable\":").Append(hasGui ? "true" : "false");
    Handle(json, "foregroundCaptureHwnd", gui.Capture); Number(json, "foregroundCapturePid", ProcessId(gui.Capture));
    Handle(json, "foregroundFocusHwnd", gui.Focus);
    Number(json, "leftButtonState", leftState);
    json.Append(",\"leftButtonDown\":").Append((leftState & 0x8000) != 0 ? "true" : "false");
    Console.WriteLine(json.Append("}").ToString());
    Console.Out.Flush();
  }
  static void Main() {
    SetProcessDPIAware();
    Point original;
    GetCursorPos(out original);
    try {
      string line;
      while ((line = Console.ReadLine()) != null) {
        string[] p = line.Split(',');
        if (p[0] == "I") {
          // An inspection never moves the pointer or changes a button. Reading
          // this command after M/D/U acknowledges their ordered processing.
          Point requested = new Point { X = int.Parse(p[2]), Y = int.Parse(p[3]) };
          Inspect(int.Parse(p[1]), requested);
          continue;
        }
        SetCursorPos(int.Parse(p[1]), int.Parse(p[2]));
        if (p[0] == "D") mouse_event(2, 0, 0, 0, UIntPtr.Zero);
        else if (p[0] == "U") mouse_event(4, 0, 0, 0, UIntPtr.Zero);
      }
    } finally {
      mouse_event(4, 0, 0, 0, UIntPtr.Zero);
      SetCursorPos(original.X, original.Y);
    }
  }
}
`);
  const compile = spawnSync(path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    ['/nologo', '/target:exe', '/out:' + binary, source], { windowsHide: true, encoding: 'utf8' });
  if (compile.status !== 0) throw Error(compile.stdout || compile.stderr || 'Native pointer compilation failed');
  const child = spawn(binary, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  const pending = new Map();
  let closed = false, sequence = 0, output = '';
  function rejectPending(error) {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear();
  }
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    output += chunk;
    let newline;
    while ((newline = output.indexOf('\n')) >= 0) {
      const line = output.slice(0, newline).trim();
      output = output.slice(newline + 1);
      if (!line) continue;
      let value;
      try { value = JSON.parse(line); }
      catch (_) { rejectPending(new Error('Invalid native pointer inspection response')); continue; }
      const request = pending.get(value.requestId);
      if (!request) continue;
      pending.delete(value.requestId);
      clearTimeout(request.timer);
      request.resolve(value);
    }
  });
  child.stdin.on('error', error => rejectPending(error));
  child.on('error', error => { closed = true; rejectPending(error); });
  child.on('exit', (code, signal) => {
    closed = true;
    rejectPending(new Error(`Native pointer exited (${code ?? signal})`));
  });
  function physicalPoint(point, window) {
    const bounds = window.getContentBounds();
    const physical = screen.dipToScreenPoint({ x: bounds.x + point.x, y: bounds.y + point.y });
    return { x: Math.round(physical.x), y: Math.round(physical.y) };
  }
  return {
    send(type, point, window) {
      const flags = { mouseMove: 'M', mouseDown: 'D', mouseUp: 'U' };
      if (!flags[type]) return false;
      const physical = physicalPoint(point, window);
      child.stdin.write(`${flags[type]},${physical.x},${physical.y}\n`);
      return true;
    },
    inspect(point, window) {
      if (closed || child.stdin.destroyed || child.stdin.writableEnded) return Promise.reject(new Error('Native pointer is closed'));
      const physical = physicalPoint(point, window);
      const requestId = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`Native pointer inspection ${requestId} timed out`));
        }, 4000);
        pending.set(requestId, { resolve, reject, timer });
        // The same pipe orders the inspection strictly after all earlier sends.
        child.stdin.write(`I,${requestId},${physical.x},${physical.y}\n`, error => {
          if (!error || !pending.has(requestId)) return;
          clearTimeout(timer);
          pending.delete(requestId);
          reject(error);
        });
      });
    },
    close() {
      closed = true;
      rejectPending(new Error('Native pointer closed'));
      child.stdin.end();
    },
  };
}

module.exports = { createNativePointer };
