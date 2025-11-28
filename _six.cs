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
  public __CLASSNAME__(int port){ this.port = port; }
  public void Start(){ try{ startAttempts++; Console.WriteLine("[nanoapi] Start() attempt="+startAttempts+" port="+port); }catch{} thread = new Thread(Run); thread.IsBackground = true; thread.Start(); }
  public bool IsAlive(){ return started && listener!=null; }
  public string LastError(){ return lastError; }
  private static string JsonEscape(string s){ if (s==null) return ""; var sb=new StringBuilder(); foreach(var ch in s){ switch(ch){ case '\\': sb.Append("\\\\"); break; case '"': sb.Append("\\\""); break; case '\n': sb.Append("\\n"); break; case '\r': sb.Append("\\r"); break; case '\t': sb.Append("\\t"); break; default: if (ch < 0x20) { sb.AppendFormat("\\u{0:X4}",(int)ch); } else sb.Append(ch); break; } } return sb.ToString(); }
  private static void Write(Socket s, string txt){ var b=Encoding.ASCII.GetBytes(txt); s.Send(b); }
  private static string UrlDecode(string s){ try{ return Uri.UnescapeDataString(s); } catch{ return s; } }
  private static string FileUriFromPath(string path){ try{ return new Uri(path).AbsoluteUri; } catch { return path; } }
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
      Console.WriteLine("[nanoapi] Run() enter port="+port);
      listener = new TcpListener(IPAddress.Loopback, port);
      listener.Start();
      started = true; Console.WriteLine("[nanoapi] listener started port="+port);
      while(true){
        try{ Console.WriteLine("[nanoapi] waiting accept port="+port); }catch{}
        var client = listener.AcceptTcpClient();
        client.NoDelay = true; client.ReceiveTimeout = 4000; client.SendTimeout = 4000;
        var sock = client.Client;
        try{
          var ms = new MemoryStream(); var buf = new byte[8192];
          while(true){ int n = sock.Receive(buf); if (n<=0) break; ms.Write(buf,0,n); var txt = Encoding.ASCII.GetString(ms.ToArray()); if (txt.Contains("\r\n\r\n")) break; if (ms.Length>65536) break; }
          var reqBytesInitial = ms.ToArray();
          var req = Encoding.ASCII.GetString(reqBytesInitial);
          int eolPos = req.IndexOf("\r\n"); var first = (eolPos>=0? req.Substring(0,eolPos).Trim() : req.Trim());
          try{ Console.WriteLine("[nanoapi req] "+first); }catch{}
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
              if (st=="on" || st=="off") { _imeState = st; contentType = "application/json; charset=utf-8"; status = "200 OK"; body = "{\"ok\":true}"; }
              else { contentType = "application/json; charset=utf-8"; status = "400 Bad Request"; body = "{\"ok\":false}"; }
            } else { contentType = "application/json; charset=utf-8"; status = "405 Method Not Allowed"; body = "{}"; }
          }
          
          else if (path.StartsWith("/dir")){
            string query=null; int qm = path.IndexOf('?'); if (qm>=0) query = path.Substring(qm+1);
            string cwdUrl=null, fsPath=null; if (query!=null){ foreach(var pair in query.Split('&')){ if (pair.Length==0) continue; var kv=pair.Split('='); var k=UrlDecode(kv[0]); var v=(kv.Length>1? UrlDecode(kv[1]) : ""); if (k=="cwd"||k=="url") cwdUrl=v; if (k=="fs") fsPath=v; } }
            string basePath=null; try{
              if (!string.IsNullOrEmpty(fsPath)) basePath = fsPath; else if (!string.IsNullOrEmpty(cwdUrl)) { var uri=new Uri(cwdUrl); if (uri.Scheme!="file") throw new Exception("bad scheme"); basePath = uri.LocalPath; }
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
            } catch { status = "400 Bad Request"; body = "{\"entries\":[]}"; }
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
          try{ Console.WriteLine("[nanoapi resp] status="+status+" path="+path+" len="+bytes.Length); }catch{}
        } catch { }
        try{ client.Close(); } catch{}
      }
    } catch (Exception ex) { try{ lastError = ex.Message; Console.WriteLine("[nanoapi] top-level error: "+ex.Message); }catch{} }
  }

}

