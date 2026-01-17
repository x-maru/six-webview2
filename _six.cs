using System;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.IO;
using System.Threading;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;

// NOTE: six.ps1 replaces __CLASSNAME__ to a unique class per run to avoid type collisions.
public class __CLASSNAME__ {
  // Win32 interop for window control (minimize)
  private const uint GA_ROOT = 2;
  private const int SW_MINIMIZE = 6;
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
  [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  // IME control interop
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] private static extern IntPtr GetFocus();
  [DllImport("user32.dll")] private static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO lpgui);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] private static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("imm32.dll")] private static extern IntPtr ImmGetContext(IntPtr hWnd);
  [DllImport("imm32.dll")] private static extern bool ImmSetOpenStatus(IntPtr hIMC, bool fOpen);
  [DllImport("imm32.dll")] private static extern bool ImmReleaseContext(IntPtr hWnd, IntPtr hIMC);
  [DllImport("imm32.dll")] private static extern IntPtr ImmGetDefaultIMEWnd(IntPtr hWnd);
  [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
  private const uint WM_IME_CONTROL = 0x0283; private const int IMC_SETOPENSTATUS = 0x0006;

  // --- Color picker helpers (global click -> screen pixel -> clipboard) ---
  private const int VK_LBUTTON = 0x01;
  private const uint CF_UNICODETEXT = 13;
  private const uint GMEM_MOVEABLE = 0x0002;
  [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
  [DllImport("gdi32.dll")] private static extern uint GetPixel(IntPtr hdc, int nXPos, int nYPos);
  [DllImport("user32.dll")] private static extern bool OpenClipboard(IntPtr hWndNewOwner);
  [DllImport("user32.dll")] private static extern bool CloseClipboard();
  [DllImport("user32.dll")] private static extern bool EmptyClipboard();
  [DllImport("user32.dll")] private static extern IntPtr SetClipboardData(uint uFormat, IntPtr hMem);
  [DllImport("kernel32.dll")] private static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);
  [DllImport("kernel32.dll")] private static extern IntPtr GlobalLock(IntPtr hMem);
  [DllImport("kernel32.dll")] private static extern bool GlobalUnlock(IntPtr hMem);

  private static readonly object _colorPickLock = new object();
  private static volatile bool _colorPickPending = false;
  private static volatile bool _colorPickCancel = false;
  private static volatile string _colorPickText = null;
  private static volatile bool _colorPickClipboardOk = false;
  private static long _colorPickDoneAt = 0;

  private static bool TrySetClipboardTextNative(string text){
    try{
      var s = text ?? "";
      // UTF-16LE with terminating NUL
      byte[] bytes;
      try{ bytes = Encoding.Unicode.GetBytes(s + "\0"); }catch{ bytes = new byte[]{0,0}; }
      // Some apps hold clipboard briefly; retry a little.
      for(int i=0;i<8;i++){
        bool opened = false;
        try{
          opened = OpenClipboard(IntPtr.Zero);
          if (!opened){ try{ Thread.Sleep(10); }catch{} continue; }
          try{ EmptyClipboard(); }catch{}
          IntPtr hMem = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)bytes.Length);
          if (hMem == IntPtr.Zero){ try{ CloseClipboard(); }catch{} return false; }
          IntPtr pMem = GlobalLock(hMem);
          if (pMem == IntPtr.Zero){ try{ CloseClipboard(); }catch{} return false; }
          try{
            Marshal.Copy(bytes, 0, pMem, bytes.Length);
          } finally {
            try{ GlobalUnlock(hMem); }catch{}
          }
          IntPtr res = SetClipboardData(CF_UNICODETEXT, hMem);
          // On success, system owns hMem.
          try{ CloseClipboard(); }catch{}
          return (res != IntPtr.Zero);
        } catch {
          try{ if (opened) CloseClipboard(); }catch{}
          try{ Thread.Sleep(10); }catch{}
        }
      }
      return false;
    }catch{ return false; }
  }
  private static bool TrySetClipboardText(string text){
    try{
      // Prefer native path (no STA dependency).
      if (TrySetClipboardTextNative(text)) return true;
    }catch{}
    // Fallback: System.Windows.Forms (may require STA; keep best-effort).
    try{
      var t = Type.GetType("System.Windows.Forms.Clipboard, System.Windows.Forms", throwOnError:false);
      if (t == null) return false;
      var m = t.GetMethod("SetText", new[]{ typeof(string) });
      if (m == null) return false;
      m.Invoke(null, new object[]{ text ?? "" });
      return true;
    }catch{ return false; }
  }
  private static string CssColorNameByHex6(string hex6Lower){
    try{
      var h = (hex6Lower ?? "").Trim().ToLowerInvariant();
      if (h.Length != 6) return null;
      int r=0,g=0,b=0;
      try{
        r = int.Parse(h.Substring(0,2), System.Globalization.NumberStyles.HexNumber);
        g = int.Parse(h.Substring(2,2), System.Globalization.NumberStyles.HexNumber);
        b = int.Parse(h.Substring(4,2), System.Globalization.NumberStyles.HexNumber);
      }catch{ return null; }
      int key = ((r&255)<<16) | ((g&255)<<8) | (b&255);
      // Lazy init using System.Drawing.KnownColor (no embedded table).
      if (_cssNameByRgb == null || _cssNameByRgb.Count == 0){
        try{ _cssNameByRgb = BuildCssNameMap(); }
        catch{ _cssNameByRgb = new System.Collections.Generic.Dictionary<int,string>(); }
      }
      string name;
      if (_cssNameByRgb != null && _cssNameByRgb.TryGetValue(key, out name)) return name;
      return null;
    }catch{ return null; }
  }

  private static System.Collections.Generic.Dictionary<int,string> _cssNameByRgb = null;
  private static string _cssNameBuildDiag = null;

  private static System.Collections.Generic.Dictionary<int,string> BuildCssNameMap(){
    try{
      var a = BuildCssNameMapFromKnownColors();
      if (a != null && a.Count > 0) return a;
    }catch{}
    try{
      var b = BuildCssNameMapFromWpfColors();
      if (b != null && b.Count > 0) return b;
    }catch{}
    return new System.Collections.Generic.Dictionary<int,string>();
  }

  private static Type FindTypeByLoadedAssemblies(string fullName){
    try{
      if (string.IsNullOrEmpty(fullName)) return null;
      try{
        var asms = AppDomain.CurrentDomain.GetAssemblies();
        if (asms != null){
          foreach(var a in asms){
            if (a == null) continue;
            try{ var t = a.GetType(fullName, throwOnError:false, ignoreCase:false); if (t != null) return t; }catch{}
          }
        }
      }catch{}
    }catch{}
    return null;
  }
  private static Type FindDrawingType(string fullName){
    try{
      var t0 = FindTypeByLoadedAssemblies(fullName);
      if (t0 != null) return t0;
      // Try load typical assemblies.
      try{ System.Reflection.Assembly.Load("System.Drawing"); }catch{}
      try{ System.Reflection.Assembly.Load("System.Drawing.Primitives"); }catch{}
      try{ System.Reflection.Assembly.Load("System.Drawing.Common"); }catch{}
      return FindTypeByLoadedAssemblies(fullName);
    }catch{ return null; }
  }

  private static Type FindWpfType(string fullName){
    try{
      var t0 = FindTypeByLoadedAssemblies(fullName);
      if (t0 != null) return t0;
      try{ System.Reflection.Assembly.Load("PresentationCore"); }catch{}
      try{ System.Reflection.Assembly.Load("WindowsBase"); }catch{}
      return FindTypeByLoadedAssemblies(fullName);
    }catch{ return null; }
  }
  private static System.Collections.Generic.Dictionary<int,string> BuildCssNameMapFromKnownColors(){
    var map = new System.Collections.Generic.Dictionary<int,string>();
    try{
      try{ _cssNameBuildDiag = "known:init"; }catch{}
      var colorType = FindDrawingType("System.Drawing.Color");
      var knownEnum = FindDrawingType("System.Drawing.KnownColor");
      if (colorType == null || knownEnum == null){
        try{ _cssNameBuildDiag = "known:types-missing"; }catch{}
        return map;
      }
      var fromKnown = colorType.GetMethod("FromKnownColor", new[]{ knownEnum });
      if (fromKnown == null){
        try{ _cssNameBuildDiag = "known:FromKnownColor-missing"; }catch{}
        return map;
      }
      var propR = colorType.GetProperty("R");
      var propG = colorType.GetProperty("G");
      var propB = colorType.GetProperty("B");
      var propA = colorType.GetProperty("A");
      var propName = colorType.GetProperty("Name");
      var propIsSystem = colorType.GetProperty("IsSystemColor");
      if (propR==null||propG==null||propB==null||propA==null||propName==null) return map;

      // Prefer common CSS synonyms when multiple names map to same RGB.
      Func<string,int> priority = (nm)=>{
        try{
          var n = (nm??"").ToLowerInvariant();
          // User preference: cyan/magenta over aqua/fuchsia.
          if (n=="cyan") return 3;
          if (n=="magenta") return 3;
          if (n=="aqua") return 2;
          if (n=="fuchsia") return 2;
          if (n=="gray" || n=="darkgray" || n=="lightgray" || n=="dimgray" || n=="slategray" || n=="lightslategray") return 2;
          return 1;
        }catch{ return 1; }
      };

      var vals = Enum.GetValues(knownEnum);
      foreach(var v in vals){
        object colObj = null;
        try{ colObj = fromKnown.Invoke(null, new object[]{ v }); }catch{ colObj = null; }
        if (colObj == null) continue;
        bool isSystem = false;
        try{ if (propIsSystem != null) isSystem = (bool)propIsSystem.GetValue(colObj, null); }catch{ isSystem = false; }
        if (isSystem) continue;
        int a=255; int r=0; int g=0; int b=0;
        try{ a = Convert.ToInt32(propA.GetValue(colObj, null), System.Globalization.CultureInfo.InvariantCulture); }catch{ a = 255; }
        if (a != 255) continue; // ignore transparent
        try{
          r = Convert.ToInt32(propR.GetValue(colObj, null), System.Globalization.CultureInfo.InvariantCulture);
          g = Convert.ToInt32(propG.GetValue(colObj, null), System.Globalization.CultureInfo.InvariantCulture);
          b = Convert.ToInt32(propB.GetValue(colObj, null), System.Globalization.CultureInfo.InvariantCulture);
        }catch{ continue; }
        string name = null;
        try{ name = Convert.ToString(propName.GetValue(colObj, null), System.Globalization.CultureInfo.InvariantCulture); }catch{ name = null; }
        if (string.IsNullOrEmpty(name)) continue;
        var css = name.ToLowerInvariant();
        // Skip any remaining non-keyword-ish names.
        if (css.Length==0) continue;
        int key = ((r&255)<<16) | ((g&255)<<8) | (b&255);
        if (!map.ContainsKey(key)) map[key] = css;
        else {
          try{ if (priority(css) > priority(map[key])) map[key] = css; }catch{}
        }
      }
      try{ _cssNameBuildDiag = "known:ok count=" + map.Count; }catch{}
    }catch{}
    return map;
  }

  private static System.Collections.Generic.Dictionary<int,string> BuildCssNameMapFromWpfColors(){
    var map = new System.Collections.Generic.Dictionary<int,string>();
    try{
      try{ _cssNameBuildDiag = "wpf:init"; }catch{}
      // WPF: System.Windows.Media.Colors has static properties like AliceBlue, Black, etc.
      var colorsType = FindWpfType("System.Windows.Media.Colors");
      if (colorsType == null){
        try{ _cssNameBuildDiag = "wpf:types-missing"; }catch{}
        return map;
      }
      var props = colorsType.GetProperties(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
      if (props == null || props.Length == 0) return map;

      // System.Windows.Media.Color struct has A/R/G/B byte properties.
      Type wpfColorType = null;
      try{ wpfColorType = FindWpfType("System.Windows.Media.Color"); }catch{}

      Func<string,int> priority = (nm)=>{
        try{
          var n = (nm??"").ToLowerInvariant();
          if (n=="cyan") return 3;
          if (n=="magenta") return 3;
          if (n=="aqua") return 2;
          if (n=="fuchsia") return 2;
          return 1;
        }catch{ return 1; }
      };

      foreach(var p in props){
        if (p == null) continue;
        string name = null;
        try{ name = Convert.ToString(p.Name, System.Globalization.CultureInfo.InvariantCulture); }catch{ name = null; }
        if (string.IsNullOrEmpty(name)) continue;
        object colObj = null;
        try{ colObj = p.GetValue(null, null); }catch{ colObj = null; }
        if (colObj == null) continue;
        int a=255,r=0,g=0,b=0;
        try{
          // Access via reflection on the boxed struct instance.
          var t = wpfColorType ?? colObj.GetType();
          var propA = t.GetProperty("A");
          var propR = t.GetProperty("R");
          var propG = t.GetProperty("G");
          var propB = t.GetProperty("B");
          if (propA==null||propR==null||propG==null||propB==null) continue;
          a = Convert.ToInt32(propA.GetValue(colObj, null), System.Globalization.CultureInfo.InvariantCulture);
          r = Convert.ToInt32(propR.GetValue(colObj, null), System.Globalization.CultureInfo.InvariantCulture);
          g = Convert.ToInt32(propG.GetValue(colObj, null), System.Globalization.CultureInfo.InvariantCulture);
          b = Convert.ToInt32(propB.GetValue(colObj, null), System.Globalization.CultureInfo.InvariantCulture);
        }catch{ continue; }
        if (a != 255) continue;
        var css = name.ToLowerInvariant();
        int key = ((r&255)<<16) | ((g&255)<<8) | (b&255);
        if (!map.ContainsKey(key)) map[key] = css;
        else { try{ if (priority(css) > priority(map[key])) map[key] = css; }catch{} }
      }
      try{ _cssNameBuildDiag = "wpf:ok count=" + map.Count; }catch{}
    }catch{}
    return map;
  }
  private static string BuildColorPickerText(int r, int g, int b){
    try{
      if (r < 0) r = 0; if (r > 255) r = 255;
      if (g < 0) g = 0; if (g > 255) g = 255;
      if (b < 0) b = 0; if (b > 255) b = 255;
      var hex3 = (r.ToString("X2") + g.ToString("X2") + b.ToString("X2")).ToLowerInvariant();
      var hex4 = hex3 + "ff";
      var rgba = "rgba(" + r + "," + g + "," + b + ",1.0)";
      var name = CssColorNameByHex6(hex3);
      if (!string.IsNullOrEmpty(name)) return hex3 + "\n" + hex4 + "\n" + rgba + "\n" + name;
      return hex3 + "\n" + hex4 + "\n" + rgba;
    }catch{ return ""; }
  }
  private static void StartColorPickerWorker(){
    try{
      bool lastDown = false;
      try{ lastDown = ((GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0); }catch{}
      while(true){
        if (_colorPickCancel){
          lock(_colorPickLock){ _colorPickPending = false; _colorPickCancel = false; _colorPickText = null; _colorPickDoneAt = 0; }
          return;
        }
        bool down = false;
        try{ down = ((GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0); }catch{}
        if (down && !lastDown){
          POINT pt; pt.X = 0; pt.Y = 0;
          try{ GetCursorPos(out pt); }catch{}
          int r = 0, g = 0, b = 0;
          try{
            var hdc = GetDC(IntPtr.Zero);
            if (hdc != IntPtr.Zero){
              uint c = GetPixel(hdc, pt.X, pt.Y);
              try{ ReleaseDC(IntPtr.Zero, hdc); }catch{}
              r = (int)(c & 0x000000FF);
              g = (int)((c & 0x0000FF00) >> 8);
              b = (int)((c & 0x00FF0000) >> 16);
            }
          }catch{}
          var text = BuildColorPickerText(r, g, b);
          bool okClip = false;
          try{ okClip = TrySetClipboardText(text); }catch{ okClip = false; }
          lock(_colorPickLock){
            _colorPickText = text;
            _colorPickClipboardOk = okClip;
            _colorPickPending = false;
            _colorPickCancel = false;
            try{ _colorPickDoneAt = (long)(DateTime.UtcNow - new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalMilliseconds; }catch{ _colorPickDoneAt = 0; }
          }
          return;
        }
        lastDown = down;
        try{ Thread.Sleep(12); }catch{}
      }
    }catch{
      lock(_colorPickLock){ _colorPickPending = false; _colorPickCancel = false; }
    }
  }
  [StructLayout(LayoutKind.Sequential)] private struct RECT { public int left; public int top; public int right; public int bottom; }
  [StructLayout(LayoutKind.Sequential)] private struct GUITHREADINFO { public uint cbSize; public uint flags; public IntPtr hwndActive; public IntPtr hwndFocus; public IntPtr hwndCapture; public IntPtr hwndMenuOwner; public IntPtr hwndMoveSize; public IntPtr hwndCaret; public RECT rcCaret; }
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  static __CLASSNAME__(){
    try{
      var providerType = Type.GetType("System.Text.CodePagesEncodingProvider, System.Text.Encoding.CodePages", throwOnError:false);
      if (providerType != null){
        var instProp = providerType.GetProperty("Instance");
        var inst = (instProp!=null? instProp.GetValue(null) : null);
        if (inst != null){
          var regs = typeof(Encoding).GetMethods();
          foreach(var m in regs){ if (m!=null && string.Equals(m.Name, "RegisterProvider", StringComparison.Ordinal)) { try{ m.Invoke(null, new object[]{ inst }); }catch{} break; } }
        }
      }
    }catch{}
  }
  private int port;
  private Thread thread;
  private TcpListener listener;
  private static string lastError = null;
  private static int startAttempts = 0;
  private volatile bool started = false;
  private volatile string _imeState = null; // "on" or "off"; null=unknown
  // --- IME control helpers (foreground window heuristic) ---
  private static void ForceImeOffWithRetry(){ try{ ForceImeOffOnce(); }catch{} try{ var th1=new Thread(()=>{ try{ Thread.Sleep(50); ForceImeOffOnce(); }catch{} }); th1.IsBackground=true; th1.Start(); var th2=new Thread(()=>{ try{ Thread.Sleep(120); ForceImeOffOnce(); }catch{} }); th2.IsBackground=true; th2.Start(); }catch{} }
  private static void ForceImeOnWithRetry(){ try{ ForceImeOnOnce(); }catch{} try{ var th1=new Thread(()=>{ try{ Thread.Sleep(50); ForceImeOnOnce(); }catch{} }); th1.IsBackground=true; th1.Start(); var th2=new Thread(()=>{ try{ Thread.Sleep(120); ForceImeOnOnce(); }catch{} }); th2.IsBackground=true; th2.Start(); }catch{} }
  private static bool TryImeOff(IntPtr hwnd){ try{ var hImc=ImmGetContext(hwnd); if(hImc!=IntPtr.Zero){ ImmSetOpenStatus(hImc,false); ImmReleaseContext(hwnd,hImc); return true; } var imeWnd=ImmGetDefaultIMEWnd(hwnd); if(imeWnd!=IntPtr.Zero){ SendMessage(imeWnd, WM_IME_CONTROL, (IntPtr)IMC_SETOPENSTATUS, IntPtr.Zero); return true; } }catch{} return false; }
  private static bool TryImeOn(IntPtr hwnd){ try{ var hImc=ImmGetContext(hwnd); if(hImc!=IntPtr.Zero){ ImmSetOpenStatus(hImc,true); ImmReleaseContext(hwnd,hImc); return true; } var imeWnd=ImmGetDefaultIMEWnd(hwnd); if(imeWnd!=IntPtr.Zero){ SendMessage(imeWnd, WM_IME_CONTROL, (IntPtr)IMC_SETOPENSTATUS, (IntPtr)1); return true; } }catch{} return false; }
  private static void ForceImeOffOnce(){ try{ var root=GetForegroundWindow(); if(root==IntPtr.Zero) return; uint pid; var tid=GetWindowThreadProcessId(root, out pid); IntPtr target=IntPtr.Zero; try{ var gti=new GUITHREADINFO(); gti.cbSize=(uint)Marshal.SizeOf(typeof(GUITHREADINFO)); if(GetGUIThreadInfo(tid, ref gti)) target=gti.hwndFocus; }catch{} if(target==IntPtr.Zero){ try{ uint selfTid = GetCurrentThreadId(); bool attached=false; try{ attached=AttachThreadInput(selfTid, tid, true); target=GetFocus(); } finally { try{ if(attached) AttachThreadInput(selfTid, tid, false); }catch{} } }catch{} } if(target!=IntPtr.Zero){ if(TryImeOff(target)) return; } if(TryImeOff(root)) return; bool done=false; try{ EnumChildWindows(root, (h,l)=>{ if(done) return false; if(TryImeOff(h)){ done=true; return false; } return true; }, IntPtr.Zero); }catch{} }catch{} }
  private static void ForceImeOnOnce(){ try{ var root=GetForegroundWindow(); if(root==IntPtr.Zero) return; uint pid; var tid=GetWindowThreadProcessId(root, out pid); IntPtr target=IntPtr.Zero; try{ var gti=new GUITHREADINFO(); gti.cbSize=(uint)Marshal.SizeOf(typeof(GUITHREADINFO)); if(GetGUIThreadInfo(tid, ref gti)) target=gti.hwndFocus; }catch{} if(target==IntPtr.Zero){ try{ uint selfTid = GetCurrentThreadId(); bool attached=false; try{ attached=AttachThreadInput(selfTid, tid, true); target=GetFocus(); } finally { try{ if(attached) AttachThreadInput(selfTid, tid, false); }catch{} } }catch{} } if(target!=IntPtr.Zero){ if(TryImeOn(target)) return; } if(TryImeOn(root)) return; bool done=false; try{ EnumChildWindows(root, (h,l)=>{ if(done) return false; if(TryImeOn(h)){ done=true; return false; } return true; }, IntPtr.Zero); }catch{} }catch{} }
  public __CLASSNAME__(int port){ this.port = port; }
  public void Start(){ try{ startAttempts++; /* Console.WriteLine("[nanoapi] Start() attempt="+startAttempts+" port="+port); */ }catch{} thread = new Thread(Run); thread.IsBackground = true; thread.Start(); }
  public bool IsAlive(){ return started && listener!=null; }
  public string LastError(){ return lastError; }
  private static string JsonEscape(string s){ if (s==null) return ""; var sb=new StringBuilder(); foreach(var ch in s){ switch(ch){ case '\\': sb.Append("\\\\"); break; case '"': sb.Append("\\\""); break; case '\n': sb.Append("\\n"); break; case '\r': sb.Append("\\r"); break; case '\t': sb.Append("\\t"); break; default: if (ch < 0x20) { sb.AppendFormat("\\u{0:X4}",(int)ch); } else sb.Append(ch); break; } } return sb.ToString(); }
  private static void Write(Socket s, string txt){ var b=Encoding.ASCII.GetBytes(txt); s.Send(b); }
  private static string UrlDecode(string s){ try{ return Uri.UnescapeDataString(s); } catch{ return s; } }
  private static string FileUriFromPath(string path){ try{ return new Uri(path).AbsoluteUri; } catch { return path; } }

  private static string NormalizeDirPath(string p){
    try{
      if (string.IsNullOrEmpty(p)) return p;
      // Normalize separators
      p = p.Replace('/', '\\');
      // Preserve drive root like "C:\\"
      if (p.Length==3 && char.IsLetter(p[0]) && p[1]==':' && p[2]=='\\') return p;
      // Trim trailing backslashes (Directory.Exists is fine, but this prevents edge-case mismatches)
      while (p.Length>0 && p.EndsWith("\\", StringComparison.Ordinal)){
        // Stop at UNC root "\\host\\share" (no trailing slash at this point) or drive root handled above
        p = p.Substring(0, p.Length-1);
      }
      // Translate WSL UNC hostname to the stable \\wsl$ share.
      // Example: \\wsl.localhost\\Ubuntu\\home\\me  -> \\wsl$\\Ubuntu\\home\\me
      const string wslPrefix = "\\\\wsl.localhost\\";
      if (p.StartsWith(wslPrefix, StringComparison.OrdinalIgnoreCase)){
        var rest = p.Substring(wslPrefix.Length);
        var idx = rest.IndexOf('\\');
        if (idx > 0){
          var distro = rest.Substring(0, idx);
          var sub = rest.Substring(idx+1);
          p = "\\\\wsl$\\" + distro + "\\" + sub;
        } else {
          p = "\\\\wsl$\\" + rest;
        }
      }
      return p;
    } catch { return p; }
  }
  private static Encoding GetEncodingFromQuery(string enc){
    if (string.IsNullOrEmpty(enc)) return Encoding.UTF8;
    enc = enc.Trim().ToLowerInvariant();
    if (enc=="utf8"||enc=="utf-8") return Encoding.UTF8;
    if (enc=="sjis"||enc=="shift_jis"||enc=="shift-jis"||enc=="cp932"||enc=="ms932"){
      try{ return Encoding.GetEncoding(932); }catch{ return Encoding.UTF8; }
    }
    try{ return Encoding.GetEncoding(enc); }catch{ return Encoding.UTF8; }
  }
  private static string TryDecodeUtf8Strict(byte[] data){
    try{
      var utf8Strict = new UTF8Encoding(false, true);
      return utf8Strict.GetString(data);
    }catch{ return null; }
  }
  private static bool IsUtf8Strict(byte[] data){
    try{ var utf8Strict = new UTF8Encoding(false, true); var _ = utf8Strict.GetString(data); return true; }catch{ return false; }
  }
  private static bool IsAsciiOnly(byte[] data){
    for(int i=0;i<data.Length;i++){ if (data[i] >= 0x80) return false; }
    return true;
  }
  private static bool TryCp932Roundtrip(byte[] data, out string text){
    text = "";
    try{
      var sjis = Encoding.GetEncoding(932);
      var s = sjis.GetString(data);
      var b = sjis.GetBytes(s);
      if (b.Length == data.Length){
        for(int i=0;i<b.Length;i++){ if (b[i]!=data[i]) return false; }
        text = s; return true;
      }
    }catch{}
    return false;
  }
  private static string DetectEol(byte[] data){
    int crlf=0, lf=0, cr=0; for(int i=0;i<data.Length;i++){
      if (data[i]==0x0D){ if (i+1<data.Length && data[i+1]==0x0A){ crlf++; i++; } else { cr++; } }
      else if (data[i]==0x0A){ lf++; }
    }
    if (crlf>0 && lf==crlf) return "dos"; // CRLF で揃っている
    if (crlf==0 && lf>0) return "unix";
    if (lf==0 && (cr>0 || crlf>0)) return "dos"; // CRのみは古Macだが実用上CRLF扱いに寄せる
    return "unknown";
  }
  private static string GuessEncodingName(byte[] data){
    if (data.Length>=3 && data[0]==0xEF && data[1]==0xBB && data[2]==0xBF) return "utf-8-bom";
    if (data.Length>=2 && data[0]==0xFF && data[1]==0xFE) return "utf-16le-bom";
    if (data.Length>=2 && data[0]==0xFE && data[1]==0xFF) return "utf-16be-bom";
    if (IsAsciiOnly(data)) return "ascii";
    if (IsUtf8Strict(data)) return "utf-8";
    try{
      var sjis = Encoding.GetEncoding(932);
      var txt = sjis.GetString(data);
      var round = sjis.GetBytes(txt);
      if (round.Length == data.Length){
        bool same=true; for(int i=0;i<round.Length;i++){ if (round[i]!=data[i]){ same=false; break; } }
        if (same) return "cp932";
      }
    }catch{}
    return "unknown";
  }
  private static bool TryReadAllTextAuto(string path, string encName, out string text){
    text = "";
    try{
      if (!string.IsNullOrEmpty(encName)){
        var enc = GetEncodingFromQuery(encName);
        text = File.ReadAllText(path, enc); return true;
      }
      // BOM 判定 → それ以外は UTF-8 優先、失敗時 SJIS
      var data = File.ReadAllBytes(path);
      if (data.Length>=3 && data[0]==0xEF && data[1]==0xBB && data[2]==0xBF){ text = Encoding.UTF8.GetString(data,3,data.Length-3); return true; }
      if (data.Length>=2){
        if (data[0]==0xFF && data[1]==0xFE){ text = Encoding.Unicode.GetString(data); return true; } // UTF-16 LE (BOM付)
        if (data[0]==0xFE && data[1]==0xFF){ text = Encoding.BigEndianUnicode.GetString(data); return true; } // UTF-16 BE (BOM付)
      }
      string sjisText;
      bool sjisOk = TryCp932Roundtrip(data, out sjisText);
      var utf8 = TryDecodeUtf8Strict(data);
      if (utf8 != null && sjisOk){
        // 曖昧ケース: 非ASCIIを含み、CP932ラウンドトリップOKならCP932を優先
        if (!IsAsciiOnly(data)) { text = sjisText; return true; }
        // 全ASCIIならUTF-8を採用（どちらでも同じ）
        text = utf8; return true;
      }
      if (utf8 != null){ text = utf8; return true; }
      if (sjisOk){ text = sjisText; return true; }
      try{ text = Encoding.GetEncoding(932).GetString(data); return true; }catch{}
    }catch{}
    return false;
  }
  private void Run(){
    try{
      /* Console.WriteLine("[nanoapi] Run() enter port="+port); */
      listener = new TcpListener(IPAddress.Loopback, port);
      listener.Start();
      started = true; /* Console.WriteLine("[nanoapi] listener started port="+port); */
      while(true){
        try{ /* Console.WriteLine("[nanoapi] waiting accept port="+port); */ }catch{}
        var client = listener.AcceptTcpClient();
        client.NoDelay = true; client.ReceiveTimeout = 4000; client.SendTimeout = 4000;
        var sock = client.Client;
        try{
          var ms = new MemoryStream(); var buf = new byte[8192];
          while(true){ int n = sock.Receive(buf); if (n<=0) break; ms.Write(buf,0,n); var txt = Encoding.ASCII.GetString(ms.ToArray()); if (txt.Contains("\r\n\r\n")) break; if (ms.Length>65536) break; }
          var reqBytesInitial = ms.ToArray();
          var req = Encoding.ASCII.GetString(reqBytesInitial);
          int eolPos = req.IndexOf("\r\n"); var first = (eolPos>=0? req.Substring(0,eolPos).Trim() : req.Trim());
          try{ /* Console.WriteLine("[nanoapi req] "+first); */ }catch{}
          // Parse request line: METHOD SP PATH SP HTTP/...
          string method = "GET"; string path = "/";
          try{
            var parts = (first ?? "").Split(' ');
            if (parts.Length>=1 && !string.IsNullOrEmpty(parts[0])) method = parts[0].ToUpperInvariant();
            if (parts.Length>=2 && !string.IsNullOrEmpty(parts[1])) path = parts[1];
          }catch{}
          string status = "200 OK"; string contentType = "application/json; charset=utf-8"; string body = "{\"entries\":[]}";
          if (path.StartsWith("/ping")){ contentType = "text/plain; charset=utf-8"; body = "ok"; }
          else if (path.StartsWith("/ime")){
            string state = null;
            if (string.Equals(method, "GET", StringComparison.OrdinalIgnoreCase)){
              // Expose latest IME state observed (set by PUT/POST)
              var st = _imeState ?? "unknown";
              contentType = "application/json; charset=utf-8"; status = "200 OK"; body = "{\"state\":\""+st+"\"}";
            } else if (string.Equals(method, "PUT", StringComparison.OrdinalIgnoreCase) || string.Equals(method, "POST", StringComparison.OrdinalIgnoreCase)){
              // Parse Content-Length and body (ASCII/form)
              int headerEnd = req.IndexOf("\r\n\r\n"); if (headerEnd < 0) headerEnd = req.Length;
              string headerText = (headerEnd > 0 ? req.Substring(0, headerEnd) : req);
              int contentLength = 0;
              try{
                foreach(var line in headerText.Split(new[]{"\r\n"}, StringSplitOptions.None)){
                  var idx = line.IndexOf(':'); if (idx<=0) continue; var k=line.Substring(0,idx).Trim(); var v=line.Substring(idx+1).Trim();
                  if (k.Equals("Content-Length", StringComparison.OrdinalIgnoreCase)) { int.TryParse(v, out contentLength); }
                }
              }catch{}
              var bodyStart = headerEnd + 4; if (bodyStart > reqBytesInitial.Length) bodyStart = reqBytesInitial.Length;
              var receivedBody = new MemoryStream(); if (reqBytesInitial.Length > bodyStart){ receivedBody.Write(reqBytesInitial, bodyStart, reqBytesInitial.Length - bodyStart); }
              int remaining = Math.Max(0, contentLength - (int)receivedBody.Length);
              var bufBody = new byte[2048]; while(remaining > 0){ int n; try{ n = sock.Receive(bufBody); } catch { break; } if (n<=0) break; receivedBody.Write(bufBody,0,n); remaining -= n; if (receivedBody.Length > 65536) break; }
              string bodyTxt = ""; try{ bodyTxt = Encoding.ASCII.GetString(receivedBody.ToArray()); }catch{}
              string st = null; foreach(var pair in bodyTxt.Split('&')){ if (string.IsNullOrEmpty(pair)) continue; var kv=pair.Split('='); var k=(kv.Length>0? kv[0] : ""); var v=(kv.Length>1? kv[1] : ""); if (k=="state"){ st = UrlDecode(v); break; } }
              if (st=="on" || st=="off") {
                _imeState = st;
                // Try to toggle OS IME immediately for current foreground/focus window
                try{ if (st=="on") ForceImeOnWithRetry(); else ForceImeOffWithRetry(); }catch{}
                contentType = "application/json; charset=utf-8"; status = "200 OK"; body = "{\"ok\":true}";
              }
              else { contentType = "application/json; charset=utf-8"; status = "400 Bad Request"; body = "{\"ok\":false}"; }
            } else { contentType = "application/json; charset=utf-8"; status = "405 Method Not Allowed"; body = "{}"; }
          }
          
          else if (path.StartsWith("/dir")){
            string query=null; int qm = path.IndexOf('?'); if (qm>=0) query = path.Substring(qm+1);
            string cwdUrl=null, fsPath=null; if (query!=null){ foreach(var pair in query.Split('&')){ if (pair.Length==0) continue; var kv=pair.Split('='); var k=UrlDecode(kv[0]); var v=(kv.Length>1? UrlDecode(kv[1]) : ""); if (k=="cwd"||k=="url") cwdUrl=v; if (k=="fs") fsPath=v; } }
            string basePath=null; try{
              if (!string.IsNullOrEmpty(fsPath)) basePath = fsPath;
              else if (!string.IsNullOrEmpty(cwdUrl)) { var uri=new Uri(cwdUrl); if (uri.Scheme!="file") throw new Exception("bad scheme"); basePath = uri.LocalPath; }
              basePath = NormalizeDirPath(basePath);
              if (string.IsNullOrEmpty(basePath) || !Directory.Exists(basePath)) throw new Exception("not found");
              var entries=new StringBuilder(); entries.Append("{\"entries\":["); bool firstE=true;
              try{
                foreach(var d in Directory.EnumerateDirectories(basePath)){
                  var name=Path.GetFileName(d);
                  var url=FileUriFromPath(d).TrimEnd('/')+"/";
                  long? mtime = null;
                  try{ var di = new DirectoryInfo(d); var dt = di.LastWriteTimeUtc; mtime = (long)(dt - new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalMilliseconds; } catch {}
                  if(!firstE) entries.Append(','); firstE=false;
                  entries.Append("{\"name\":\""+JsonEscape(name)+"\",\"isDir\":true,\"url\":\""+JsonEscape(url)+"\",\"size\":null,\"mtime\":"+(mtime.HasValue? mtime.Value.ToString():"null")+"}");
                }
              } catch{}
              try{
                foreach(var f in Directory.EnumerateFiles(basePath)){
                  var name=Path.GetFileName(f);
                  var url=FileUriFromPath(f);
                  long? size = null; long? mtime = null;
                  try{ var fi = new FileInfo(f); size = fi.Length; var dt = fi.LastWriteTimeUtc; mtime = (long)(dt - new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalMilliseconds; } catch {}
                  if(!firstE) entries.Append(','); firstE=false;
                  entries.Append("{\"name\":\""+JsonEscape(name)+"\",\"isDir\":false,\"url\":\""+JsonEscape(url)+"\",\"size\":"+(size.HasValue? size.Value.ToString():"null")+",\"mtime\":"+(mtime.HasValue? mtime.Value.ToString():"null")+"}");
                }
              } catch{}
              entries.Append("]}"); body = entries.ToString();
            } catch (Exception ex) {
              // Return 200 with an error field to avoid noisy DevTools "Failed to load resource" logs.
              status = "200 OK";
              body = "{\"entries\":[],\"error\":\"" + JsonEscape(ex.Message) + "\"}";
            }
          } else if (path.StartsWith("/read")){
            // /read?fs=\\\\host\\path[&enc=utf8|sjis|cp932|auto]
            string query=null; int qm = path.IndexOf('?'); if (qm>=0) query = path.Substring(qm+1);
            string fsPath=null, encName=null; if (query!=null){ foreach(var pair in query.Split('&')){ if (pair.Length==0) continue; var kv=pair.Split('='); var k=UrlDecode(kv[0]); var v=(kv.Length>1? UrlDecode(kv[1]) : ""); if (k=="fs") fsPath=v; if (k=="enc"||k=="charset") encName=v; } }
            if (!string.IsNullOrEmpty(encName) && encName.Trim().Equals("auto", StringComparison.OrdinalIgnoreCase)) encName = null;
            contentType = "text/plain; charset=utf-8"; string text="";
            try{
              if (string.IsNullOrEmpty(fsPath) || !File.Exists(fsPath)) throw new Exception("not found");
              if (!TryReadAllTextAuto(fsPath, encName, out text)) { text = ""; status = "500 Internal Server Error"; }
            } catch { status = "404 Not Found"; text = ""; }
            var bytesTxt = Encoding.UTF8.GetBytes(text);
            var headerRead = "HTTP/1.1 "+status
              +"\r\nContent-Type: "+contentType
              +"\r\nAccess-Control-Allow-Origin: *"
              +"\r\nCache-Control: no-store, no-cache, must-revalidate"
              +"\r\nPragma: no-cache"
              +"\r\nExpires: 0"
              +"\r\nContent-Length: "+bytesTxt.Length
              +"\r\nConnection: close\r\n\r\n";
            Write(sock, headerRead); sock.Send(bytesTxt);
            try{ client.Close(); } catch{}
            continue;
          } else if (path.StartsWith("/readbytes")){
            // /readbytes?fs=\\\\host\\path  (raw bytes)
            string query=null; int qm = path.IndexOf('?'); if (qm>=0) query = path.Substring(qm+1);
            string fsPath=null; if (query!=null){ foreach(var pair in query.Split('&')){ if (pair.Length==0) continue; var kv=pair.Split('='); var k=UrlDecode(kv[0]); var v=(kv.Length>1? UrlDecode(kv[1]) : ""); if (k=="fs") fsPath=v; } }
            byte[] data = new byte[0]; bool ok=true;
            try{ if (string.IsNullOrEmpty(fsPath) || !File.Exists(fsPath)) throw new Exception("not found"); data = File.ReadAllBytes(fsPath); }
            catch { ok=false; data = new byte[0]; }
            string st = ok? "200 OK" : "404 Not Found";
            var header = "HTTP/1.1 "+st
              +"\r\nContent-Type: application/octet-stream"
              +"\r\nAccess-Control-Allow-Origin: *"
              +"\r\nCache-Control: no-store, no-cache, must-revalidate"
              +"\r\nPragma: no-cache"
              +"\r\nExpires: 0"
              +"\r\nContent-Length: "+data.Length
              +"\r\nConnection: close\r\n\r\n";
            Write(sock, header); if (data.Length>0) sock.Send(data);
            try{ client.Close(); } catch{}
            continue;
          } else if (path.StartsWith("/probe")){
            // /probe?fs=\\host\path → JSON { encoding, eol, bom, size, mtime, utf8, cp932Roundtrip }
            string query=null; int qm = path.IndexOf('?'); if (qm>=0) query = path.Substring(qm+1);
            string fsPath=null; if (query!=null){ foreach(var pair in query.Split('&')){ if (pair.Length==0) continue; var kv=pair.Split('='); var k=UrlDecode(kv[0]); var v=(kv.Length>1? UrlDecode(kv[1]) : ""); if (k=="fs") fsPath=v; } }
            try{
              if (string.IsNullOrEmpty(fsPath) || !File.Exists(fsPath)) throw new Exception("not found");
              var data = File.ReadAllBytes(fsPath);
              string enc = GuessEncodingName(data);
              bool hasBom = enc.EndsWith("-bom", StringComparison.OrdinalIgnoreCase);
              string eolKind = DetectEol(data);
              long? size = data.LongLength;
              long? mtime = null; try{ var fi=new FileInfo(fsPath); var dt=fi.LastWriteTimeUtc; mtime=(long)(dt - new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalMilliseconds; }catch{}
              bool utf8 = enc.StartsWith("utf-8", StringComparison.OrdinalIgnoreCase);
              bool round = false; try{ var sj=Encoding.GetEncoding(932); var s= sj.GetString(data); var b=sj.GetBytes(s); round = (b.Length==data.Length) && !b.Where((t,i)=>t!=data[i]).Any(); }catch{}
              bool asciiOnly = IsAsciiOnly(data);
              bool ambiguous = !hasBom && ((utf8 && round) || asciiOnly);
              body = "{\"encoding\":\""+JsonEscape(enc)+"\",\"eol\":\""+JsonEscape(eolKind)+"\",\"bom\":"+(hasBom?"true":"false")+",\"size\":"+size+",\"mtime\":"+(mtime.HasValue? mtime.Value.ToString():"null")+",\"utf8\":"+(utf8?"true":"false")+",\"cp932Roundtrip\":"+(round?"true":"false")+",\"asciiOnly\":"+(asciiOnly?"true":"false")+",\"ambiguous\":"+(ambiguous?"true":"false")+"}";
              contentType = "application/json; charset=utf-8"; status = "200 OK";
            } catch { status = "404 Not Found"; contentType = "application/json; charset=utf-8"; body = "{}"; }
          } else if (path.StartsWith("/stat")){
            // /stat?fs=\\\\host\\path → JSON { name,isDir,url,size,mtime }
            string query=null; int qm = path.IndexOf('?'); if (qm>=0) query = path.Substring(qm+1);
            string fsPath=null; if (query!=null){ foreach(var pair in query.Split('&')){ if (pair.Length==0) continue; var kv=pair.Split('='); var k=UrlDecode(kv[0]); var v=(kv.Length>1? UrlDecode(kv[1]) : ""); if (k=="fs") fsPath=v; } }
            try{
              if (string.IsNullOrEmpty(fsPath)) throw new Exception("fs required");
              bool isDir = Directory.Exists(fsPath);
              string name = isDir? new DirectoryInfo(fsPath).Name : Path.GetFileName(fsPath);
              string url = FileUriFromPath(fsPath) + (isDir? "/" : "");
              long? size = null; long? mtime = null;
              if (isDir){ try{ var di=new DirectoryInfo(fsPath); var dt=di.LastWriteTimeUtc; mtime=(long)(dt - new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalMilliseconds; }catch{} }
              else { try{ var fi=new FileInfo(fsPath); size=fi.Length; var dt=fi.LastWriteTimeUtc; mtime=(long)(dt - new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalMilliseconds; }catch{} }
              body = "{\"name\":\""+JsonEscape(name)+"\",\"isDir\":"+(isDir?"true":"false")+",\"url\":\""+JsonEscape(url)+"\",\"size\":"+(size.HasValue? size.Value.ToString():"null")+",\"mtime\":"+(mtime.HasValue? mtime.Value.ToString():"null")+"}";
              contentType = "application/json; charset=utf-8"; status = "200 OK";
            } catch { status = "400 Bad Request"; contentType = "application/json; charset=utf-8"; body = "{}"; }
          } else if (path.StartsWith("/write")){
            // POST /write?fs=\\\\host\\path[&enc=sjis|utf8|cp932|shift_jis|utf16le|utf16be][&eol=dos|unix][&bom=1]
            // body はクライアント側で UTF-8 (BOMなし) として送る前提。サーバ側で指定エンコードに再符号化。
            string query=null; int qm = path.IndexOf('?'); if (qm>=0) query = path.Substring(qm+1);
            string fsPath=null; string encName=null; string eolMode=null; bool bomFlag=false; bool strict=false;
            if (query!=null){
              foreach(var pair in query.Split('&')){ if (pair.Length==0) continue; var kv=pair.Split('='); var k=UrlDecode(kv[0]); var v=(kv.Length>1? UrlDecode(kv[1]) : "");
                if (k=="fs") fsPath=v;
                if (k=="enc"||k=="charset") encName=v;
                if (k=="eol") eolMode=v;
                if (k=="bom") { if (!string.IsNullOrEmpty(v) && (v=="1"||v.ToLowerInvariant()=="true")) bomFlag=true; }
                if (k=="strict") { if (!string.IsNullOrEmpty(v) && (v=="1"||v.ToLowerInvariant()=="true")) strict=true; }
              }
            }
            // Parse headers for Content-Length
            int headerEnd = req.IndexOf("\r\n\r\n"); if (headerEnd < 0) headerEnd = req.Length;
            string headerText = (headerEnd > 0 ? req.Substring(0, headerEnd) : req);
            int contentLength = 0;
            try{
              foreach(var line in headerText.Split(new[]{"\r\n"}, StringSplitOptions.None)){
                var idx = line.IndexOf(':'); if (idx<=0) continue; var k=line.Substring(0,idx).Trim(); var v=line.Substring(idx+1).Trim();
                if (k.Equals("Content-Length", StringComparison.OrdinalIgnoreCase)) { int.TryParse(v, out contentLength); }
              }
            }catch{}
            // Read body bytes
            var bodyStart = headerEnd + 4; if (bodyStart > reqBytesInitial.Length) bodyStart = reqBytesInitial.Length;
            var receivedBody = new MemoryStream();
            if (reqBytesInitial.Length > bodyStart){ receivedBody.Write(reqBytesInitial, bodyStart, reqBytesInitial.Length - bodyStart); }
            int remaining = Math.Max(0, contentLength - (int)receivedBody.Length);
            var bufBody = new byte[8192];
            while(remaining > 0){ int n; try{ n = sock.Receive(bufBody); } catch { break; } if (n<=0) break; receivedBody.Write(bufBody,0,n); remaining -= n; if (receivedBody.Length > 50000000) break; }
            // Re-encode & newline transform if enc/eol 指定あり
            try{
              if (string.IsNullOrEmpty(fsPath)) throw new Exception("fs required");
              var dir = Path.GetDirectoryName(fsPath);
              if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
              byte[] raw = receivedBody.ToArray();
              byte[] outBytes = raw; // デフォルト: そのまま (後方互換)
              bool reencode = !string.IsNullOrEmpty(encName);
              if (reencode){
                // UTF-8としてテキスト化
                string txt; try{ txt = Encoding.UTF8.GetString(raw); } catch { txt = Encoding.UTF8.GetString(raw,0,raw.Length); }
                // 改行変換
                if (!string.IsNullOrEmpty(eolMode)){
                  if (eolMode.Equals("unix", StringComparison.OrdinalIgnoreCase)){
                    txt = txt.Replace("\r\n", "\n");
                  } else if (eolMode.Equals("dos", StringComparison.OrdinalIgnoreCase) || eolMode.Equals("crlf", StringComparison.OrdinalIgnoreCase)){
                    // 正規化して CRLF
                    txt = txt.Replace("\r\n", "\n");
                    txt = txt.Replace("\n", "\r\n");
                  }
                }
                Encoding enc;
                if (!string.IsNullOrEmpty(encName)){
                  enc = GetEncodingFromQuery(encName);
                } else {
                  enc = Encoding.UTF8;
                }
                if (strict){
                  // 変換不能文字がある場合はエラーにする
                  var encStrict = Encoding.GetEncoding(enc.CodePage, new EncoderExceptionFallback(), new DecoderExceptionFallback());
                  outBytes = encStrict.GetBytes(txt);
                } else {
                  outBytes = enc.GetBytes(txt); // 既定: 置換fallback
                }
                // BOM 付与要求 (UTF-8 / UTF-16 のみ BOM 設定; Shift_JIS には通常付けない)
                if (bomFlag){
                  if (enc == Encoding.UTF8){
                    var withBom = new byte[outBytes.Length + 3]; withBom[0]=0xEF; withBom[1]=0xBB; withBom[2]=0xBF; Buffer.BlockCopy(outBytes,0,withBom,3,outBytes.Length); outBytes = withBom;
                  } else if (Equals(enc, Encoding.Unicode)){ /* UTF-16 LE */
                    var preamble = Encoding.Unicode.GetPreamble();
                    if (preamble!=null && preamble.Length>0){ var wb=new byte[preamble.Length+outBytes.Length]; Buffer.BlockCopy(preamble,0,wb,0,preamble.Length); Buffer.BlockCopy(outBytes,0,wb,preamble.Length,outBytes.Length); outBytes=wb; }
                  } else if (Equals(enc, Encoding.BigEndianUnicode)){ /* UTF-16 BE */
                    var preamble = Encoding.BigEndianUnicode.GetPreamble();
                    if (preamble!=null && preamble.Length>0){ var wb=new byte[preamble.Length+outBytes.Length]; Buffer.BlockCopy(preamble,0,wb,0,preamble.Length); Buffer.BlockCopy(outBytes,0,wb,preamble.Length,outBytes.Length); outBytes=wb; }
                  }
                }
              }
              File.WriteAllBytes(fsPath, outBytes);
              try { File.SetLastWriteTimeUtc(fsPath, DateTime.UtcNow); } catch {}
              body = "{\"ok\":true,\"reencoded\":"+(reencode?"true":"false")+"}"; contentType = "application/json; charset=utf-8"; status = "200 OK";
            } catch (Exception ex) {
              status = "400 Bad Request"; contentType = "application/json; charset=utf-8"; body = "{\"ok\":false,\"error\":\""+JsonEscape(ex.Message)+"\"}";
            }
          } else if (path.StartsWith("/shares")){
            // /shares?host=wsl.localhost → ディストリ名を shares として返す
            string query=null; int qm = path.IndexOf('?'); if (qm>=0) query = path.Substring(qm+1);
            string host=null; if (query!=null){ foreach(var pair in query.Split('&')){ if (pair.Length==0) continue; var kv=pair.Split('='); var k=UrlDecode(kv[0]); var v=(kv.Length>1? UrlDecode(kv[1]) : ""); if (k=="host") host=v; } }
            try{
              var shares = new StringBuilder(); shares.Append("{\"shares\":["); bool firstE=true;
              if (!string.IsNullOrEmpty(host) && string.Equals(host, "wsl.localhost", StringComparison.OrdinalIgnoreCase)){
                try{
                  var psi = new ProcessStartInfo(){ FileName = "wsl.exe", Arguments = "-l -q", UseShellExecute=false, RedirectStandardOutput=true, RedirectStandardError=true, CreateNoWindow=true };
                  try{ psi.StandardOutputEncoding = Encoding.UTF8; psi.StandardErrorEncoding = Encoding.UTF8; }catch{}
                  using (var p = Process.Start(psi)){
                    if (p!=null){
                      string output = p.StandardOutput.ReadToEnd();
                      try{ p.WaitForExit(1500); }catch{}
                      if (!string.IsNullOrEmpty(output)){
                        using (var sr = new StringReader(output)){
                          string line; while((line = sr.ReadLine()) != null){
                            var nameRaw = line.Trim(); if (nameRaw.Length==0) continue;
                            string name;
                            try{ name = nameRaw.Normalize(NormalizationForm.FormKC); }catch{ name = nameRaw; }
                            var url = "file:////wsl.localhost/" + Uri.EscapeDataString(name) + "/";
                            if(!firstE) shares.Append(','); firstE=false;
                            shares.Append("{\"name\":\""+JsonEscape(name)+"\",\"isDir\":true,\"url\":\""+JsonEscape(url)+"\"}");
                          }
                        }
                      }
                    }
                  }
                } catch {}
              }
              shares.Append("]}"); body = shares.ToString();
            } catch { status = "400 Bad Request"; body = "{\"shares\":[]}"; }
          } else if (path.StartsWith("/win/colorpicker")){
            // GET /win/colorpicker/start  -> arm click-wait worker (global LButton edge)
            // GET /win/colorpicker/poll   -> { pending, done, text, doneAt }
            // GET /win/colorpicker/cancel -> cancel pending pick
            try{
              if (path.StartsWith("/win/colorpicker/start")){
                bool already = false;
                lock(_colorPickLock){
                  already = _colorPickPending;
                  _colorPickCancel = false;
                  _colorPickText = null;
                  _colorPickClipboardOk = false;
                  _colorPickDoneAt = 0;
                  _colorPickPending = true;
                }
                if (!already){
                  try{ var th = new Thread(StartColorPickerWorker); th.IsBackground = true; th.Start(); }catch{}
                }
                contentType = "application/json; charset=utf-8"; status = "200 OK";
                body = "{\"ok\":true,\"pending\":true}";
              }
              else if (path.StartsWith("/win/colorpicker/cancel")){
                lock(_colorPickLock){
                  if (_colorPickPending){ _colorPickCancel = true; }
                }
                contentType = "application/json; charset=utf-8"; status = "200 OK";
                body = "{\"ok\":true}";
              }
              else if (path.StartsWith("/win/colorpicker/poll")){
                bool pending = false; string text = null; long doneAt = 0; bool clipOk = false;
                lock(_colorPickLock){ pending = _colorPickPending; text = _colorPickText; doneAt = _colorPickDoneAt; clipOk = _colorPickClipboardOk; }
                bool done = (!pending) && (!string.IsNullOrEmpty(text));
                contentType = "application/json; charset=utf-8"; status = "200 OK";
                body = "{\"pending\":" + (pending?"true":"false") + ",\"done\":" + (done?"true":"false") + ",\"clipboardOk\":" + (clipOk?"true":"false") + ",\"doneAt\":" + doneAt + ",\"text\":\"" + JsonEscape(text ?? "") + "\"}";
              }
              else {
                contentType = "application/json; charset=utf-8"; status = "404 Not Found";
                body = "{\"ok\":false}";
              }
            } catch (Exception ex) {
              status = "500 Internal Server Error"; contentType = "application/json; charset=utf-8";
              body = "{\"ok\":false,\"error\":\""+JsonEscape(ex.Message)+"\"}";
            }
          } else if (path.StartsWith("/win/state")){
            // GET  /win/state  -> returns saved JSON state (or {})
            // POST /win/state  -> saves request body as JSON text to .six-winstate.json in current directory
            try{
              var statePath = Path.Combine(Directory.GetCurrentDirectory(), ".six-winstate.json");
              if (string.Equals(method, "GET", StringComparison.OrdinalIgnoreCase)){
                try{
                  if (File.Exists(statePath)){
                    body = File.ReadAllText(statePath, Encoding.UTF8);
                    if (string.IsNullOrWhiteSpace(body)) body = "{}";
                  } else {
                    body = "{}";
                  }
                } catch { body = "{}"; }
                contentType = "application/json; charset=utf-8"; status = "200 OK";
              }
              else if (string.Equals(method, "POST", StringComparison.OrdinalIgnoreCase) || string.Equals(method, "PUT", StringComparison.OrdinalIgnoreCase)){
                // Parse headers for Content-Length
                int headerEnd = req.IndexOf("\r\n\r\n"); if (headerEnd < 0) headerEnd = req.Length;
                string headerText = (headerEnd > 0 ? req.Substring(0, headerEnd) : req);
                int contentLength = 0;
                try{
                  foreach(var line in headerText.Split(new[]{"\r\n"}, StringSplitOptions.None)){
                    var idx = line.IndexOf(':'); if (idx<=0) continue; var k=line.Substring(0,idx).Trim(); var v=line.Substring(idx+1).Trim();
                    if (k.Equals("Content-Length", StringComparison.OrdinalIgnoreCase)) { int.TryParse(v, out contentLength); }
                  }
                }catch{}
                // Read body bytes
                var bodyStart = headerEnd + 4; if (bodyStart > reqBytesInitial.Length) bodyStart = reqBytesInitial.Length;
                var receivedBody = new MemoryStream();
                if (reqBytesInitial.Length > bodyStart){ receivedBody.Write(reqBytesInitial, bodyStart, reqBytesInitial.Length - bodyStart); }
                int remaining = Math.Max(0, contentLength - (int)receivedBody.Length);
                var bufBody = new byte[4096];
                while(remaining > 0){
                  int n; try{ n = sock.Receive(bufBody); } catch { break; }
                  if (n<=0) break;
                  receivedBody.Write(bufBody,0,n);
                  remaining -= n;
                  if (receivedBody.Length > 262144) break;
                }
                try{
                  var outBytes = receivedBody.ToArray();
                  // If empty body, treat as no-op
                  if (outBytes == null || outBytes.Length == 0){
                    body = "{\"ok\":false,\"error\":\"empty\"}";
                  } else {
                    File.WriteAllBytes(statePath, outBytes);
                    body = "{\"ok\":true}";
                  }
                  contentType = "application/json; charset=utf-8"; status = "200 OK";
                } catch (Exception ex) {
                  contentType = "application/json; charset=utf-8"; status = "500 Internal Server Error";
                  body = "{\"ok\":false,\"error\":\""+JsonEscape(ex.Message)+"\"}";
                }
              }
              else {
                contentType = "application/json; charset=utf-8"; status = "405 Method Not Allowed"; body = "{}";
              }
            } catch {
              contentType = "application/json; charset=utf-8"; status = "500 Internal Server Error"; body = "{\"ok\":false}";
            }
          } else if (path.StartsWith("/win/minimize")){
            // Minimize the current foreground window (resolve to root window)
            try{
              IntPtr hwnd = GetForegroundWindow();
              IntPtr root = hwnd;
              try{ if (hwnd != IntPtr.Zero) root = GetAncestor(hwnd, GA_ROOT); }catch{}
              if (root == IntPtr.Zero) root = hwnd;
              bool ok = false;
              try{ if (root != IntPtr.Zero) ok = ShowWindow(root, SW_MINIMIZE); }catch{}
              contentType = "application/json; charset=utf-8";
              status = ok ? "200 OK" : "200 OK"; // treat as success even if ShowWindow returned false
              body = "{\"ok\":" + (ok?"true":"false") + "}";
            } catch {
              contentType = "application/json; charset=utf-8"; status = "500 Internal Server Error"; body = "{\"ok\":false}";
            }
          } else { status = "404 Not Found"; body = "{\"entries\":[]}"; }
          var bytes = Encoding.UTF8.GetBytes(body);
          var headerJson = "HTTP/1.1 "+status
            +"\r\nContent-Type: "+contentType
            +"\r\nAccess-Control-Allow-Origin: *"
            +"\r\nCache-Control: no-store, no-cache, must-revalidate"
            +"\r\nPragma: no-cache"
            +"\r\nExpires: 0"
            +"\r\nContent-Length: "+bytes.Length
            +"\r\nConnection: close\r\n\r\n";
          Write(sock, headerJson); sock.Send(bytes);
          try{ /* Console.WriteLine("[nanoapi resp] status="+status+" path="+path+" len="+bytes.Length); */ }catch{}
        } catch { }
        try{ client.Close(); } catch{}
      }
    } catch (Exception ex) { try{ lastError = ex.Message; Console.WriteLine("[nanoapi] top-level error: "+ex.Message); }catch{} }
  }

}

