using System;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.IO;
using System.Threading;
using System.Diagnostics;

// NOTE: six.ps1 replaces __CLASSNAME__ to a unique class per run to avoid type collisions.
public class __CLASSNAME__ {
  private int port;
  private Thread thread;
  private TcpListener listener;
  public __CLASSNAME__(int port){ this.port = port; }
  public void Start(){ thread = new Thread(Run); thread.IsBackground = true; thread.Start(); }
  private static string JsonEscape(string s){ if (s==null) return ""; var sb=new StringBuilder(); foreach(var ch in s){ switch(ch){ case '\\': sb.Append("\\\\"); break; case '"': sb.Append("\\\""); break; case '\n': sb.Append("\\n"); break; case '\r': sb.Append("\\r"); break; case '\t': sb.Append("\\t"); break; default: if (ch < 0x20) { sb.AppendFormat("\\u{0:X4}",(int)ch); } else sb.Append(ch); break; } } return sb.ToString(); }
  private static void Write(Socket s, string txt){ var b=Encoding.ASCII.GetBytes(txt); s.Send(b); }
  private static string UrlDecode(string s){ try{ return Uri.UnescapeDataString(s); } catch{ return s; } }
  private static string FileUriFromPath(string path){ try{ return new Uri(path).AbsoluteUri; } catch { return path; } }
  private void Run(){
    try{
      listener = new TcpListener(IPAddress.Loopback, port);
      listener.Start();
      while(true){
        var client = listener.AcceptTcpClient();
        client.NoDelay = true; client.ReceiveTimeout = 4000; client.SendTimeout = 4000;
        var sock = client.Client;
        try{
          var ms = new MemoryStream(); var buf = new byte[8192];
          while(true){ int n = sock.Receive(buf); if (n<=0) break; ms.Write(buf,0,n); var txt = Encoding.ASCII.GetString(ms.ToArray()); if (txt.Contains("\r\n\r\n")) break; if (ms.Length>65536) break; }
          var reqBytesInitial = ms.ToArray();
          var req = Encoding.ASCII.GetString(reqBytesInitial);
          int eol = req.IndexOf("\r\n"); var first = (eol>=0? req.Substring(0,eol).Trim() : req.Trim());
          // Parse request line: METHOD SP PATH SP HTTP/...
          string method = "GET"; string path = "/";
          try{
            var parts = (first ?? "").Split(' ');
            if (parts.Length>=1 && !string.IsNullOrEmpty(parts[0])) method = parts[0].ToUpperInvariant();
            if (parts.Length>=2 && !string.IsNullOrEmpty(parts[1])) path = parts[1];
          }catch{}
          string status = "200 OK"; string contentType = "application/json; charset=utf-8"; string body = "{\"entries\":[]}";
          if (path.StartsWith("/ping")){ contentType = "text/plain; charset=utf-8"; body = "ok"; }
          else if (path.StartsWith("/dir")){
            string query=null; int qm = path.IndexOf('?'); if (qm>=0) query = path.Substring(qm+1);
            string cwdUrl=null, fsPath=null; if (query!=null){ foreach(var pair in query.Split('&')){ if (pair.Length==0) continue; var kv=pair.Split('='); var k=UrlDecode(kv[0]); var v=(kv.Length>1? UrlDecode(kv[1]) : ""); if (k=="cwd"||k=="url") cwdUrl=v; if (k=="fs") fsPath=v; } }
            string basePath=null; try{
              if (!string.IsNullOrEmpty(fsPath)) basePath = fsPath; else if (!string.IsNullOrEmpty(cwdUrl)) { var uri=new Uri(cwdUrl); if (uri.Scheme!="file") throw new Exception("bad scheme"); basePath = uri.LocalPath; }
              if (string.IsNullOrEmpty(basePath) || !Directory.Exists(basePath)) throw new Exception("not found");
              var entries=new StringBuilder(); entries.Append("{\"entries\":["); bool firstE=true;
              try{ foreach(var d in Directory.EnumerateDirectories(basePath)){ var name=Path.GetFileName(d); var url=FileUriFromPath(d).TrimEnd('/')+"/"; if(!firstE) entries.Append(','); firstE=false; entries.Append("{\"name\":\""+JsonEscape(name)+"\",\"isDir\":true,\"url\":\""+JsonEscape(url)+"\"}"); } } catch{}
              try{ foreach(var f in Directory.EnumerateFiles(basePath)){ var name=Path.GetFileName(f); var url=FileUriFromPath(f); if(!firstE) entries.Append(','); firstE=false; entries.Append("{\"name\":\""+JsonEscape(name)+"\",\"isDir\":false,\"url\":\""+JsonEscape(url)+"\"}"); } } catch{}
              entries.Append("]}"); body = entries.ToString();
            } catch { status = "400 Bad Request"; body = "{\"entries\":[]}"; }
          } else if (path.StartsWith("/read")){
            // /read?fs=\\\\host\\path  (UTF-8 テキストとして返す)
            string query=null; int qm = path.IndexOf('?'); if (qm>=0) query = path.Substring(qm+1);
            string fsPath=null; if (query!=null){ foreach(var pair in query.Split('&')){ if (pair.Length==0) continue; var kv=pair.Split('='); var k=UrlDecode(kv[0]); var v=(kv.Length>1? UrlDecode(kv[1]) : ""); if (k=="fs") fsPath=v; } }
            contentType = "text/plain; charset=utf-8"; string text="";
            try{
              if (string.IsNullOrEmpty(fsPath) || !File.Exists(fsPath)) throw new Exception("not found");
              text = File.ReadAllText(fsPath, Encoding.UTF8);
            } catch { status = "404 Not Found"; text = ""; }
            var bytesTxt = Encoding.UTF8.GetBytes(text);
            var headerRead = "HTTP/1.1 "+status+"\r\nContent-Type: "+contentType+"\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: "+bytesTxt.Length+"\r\nConnection: close\r\n\r\n";
            Write(sock, headerRead); sock.Send(bytesTxt);
            try{ client.Close(); } catch{}
            continue;
          } else if (path.StartsWith("/write")){
            // POST /write?fs=\\\\host\\path  body=utf-8 text
            string query=null; int qm = path.IndexOf('?'); if (qm>=0) query = path.Substring(qm+1);
            string fsPath=null; if (query!=null){ foreach(var pair in query.Split('&')){ if (pair.Length==0) continue; var kv=pair.Split('='); var k=UrlDecode(kv[0]); var v=(kv.Length>1? UrlDecode(kv[1]) : ""); if (k=="fs") fsPath=v; } }
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
            string textToWrite = "";
            try{ textToWrite = Encoding.UTF8.GetString(receivedBody.ToArray()); }catch{ textToWrite = ""; }
            // Write file
            try{
              if (string.IsNullOrEmpty(fsPath)) throw new Exception("fs required");
              var dir = Path.GetDirectoryName(fsPath);
              if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
              File.WriteAllText(fsPath, textToWrite, Encoding.UTF8);
              body = "{\"ok\":true}"; contentType = "application/json; charset=utf-8"; status = "200 OK";
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
                  using (var p = Process.Start(psi)){
                    if (p!=null){
                      string output = p.StandardOutput.ReadToEnd();
                      try{ p.WaitForExit(1500); }catch{}
                      if (!string.IsNullOrEmpty(output)){
                        using (var sr = new StringReader(output)){
                          string line; while((line = sr.ReadLine()) != null){
                            var name = line.Trim(); if (name.Length==0) continue;
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
          } else { status = "404 Not Found"; body = "{\"entries\":[]}"; }
          var bytes = Encoding.UTF8.GetBytes(body);
          var headerJson = "HTTP/1.1 "+status+"\r\nContent-Type: "+contentType+"\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: "+bytes.Length+"\r\nConnection: close\r\n\r\n";
          Write(sock, headerJson); sock.Send(bytes);
        } catch { }
        try{ client.Close(); } catch{}
      }
    } catch { }
  }
}
