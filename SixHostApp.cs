using System;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.IO;
using System.Drawing;
using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

public static class SixHostApp {
  private static bool _closing = false;
  private static bool _approved = false;
  private static TaskCompletionSource<bool> _tcs;
  [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError=true)]
  private static extern bool DestroyIcon(IntPtr hIcon);
  private static bool TryGetBool(string json, string key, out bool value){
    value = false; if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(key)) return false;
    try{ var m = Regex.Match(json, "\""+Regex.Escape(key)+"\"\\s*:\\s*(true|false)", RegexOptions.IgnoreCase); if (m.Success){ value = string.Equals(m.Groups[1].Value, "true", StringComparison.OrdinalIgnoreCase); return true; } }catch{} return false; }
  private static bool TryGetInt(string json, string key, out int value){
    value = 0; if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(key)) return false;
    try{ var m = Regex.Match(json, "\""+Regex.Escape(key)+"\"\\s*:\\s*(-?\\d+)", RegexOptions.IgnoreCase); if (m.Success){ int v; if (int.TryParse(m.Groups[1].Value, out v)){ value = v; return true; } } }catch{} return false; }
  public static void Run(string url){
    Application.SetHighDpiMode(HighDpiMode.SystemAware);
    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    var form = new Form(); form.Text = "six-webview2"; form.Width = 1200; form.Height = 800; var wv = new WebView2(){ Dock = DockStyle.Fill }; form.Controls.Add(wv);
    try{ string iconPath = ICON_PATH_PLACEHOLDER; if (!string.IsNullOrEmpty(iconPath) && File.Exists(iconPath)){ using (var bmp = new Bitmap(iconPath)){ IntPtr hIcon = bmp.GetHicon(); using (var tmp = Icon.FromHandle(hIcon)){ form.Icon = (Icon)tmp.Clone(); } DestroyIcon(hIcon); } } }catch{}
    form.Load += async (_, __) => {
      string profile = null;
      try{
        var raw = url ?? ""; int h = raw.IndexOf('#'); if (h >= 0) raw = raw.Substring(0, h);
        var u = new Uri(raw);
        string baseDir = null;
        if (u.IsFile) baseDir = Path.GetDirectoryName(u.LocalPath); else baseDir = Environment.CurrentDirectory;
        if (!string.IsNullOrEmpty(baseDir)){
          profile = Path.Combine(baseDir, ".wv2-profile");
          try{ Directory.CreateDirectory(profile); }catch{}
        }
      }catch{}
      var env = await CoreWebView2Environment.CreateAsync(browserExecutableFolder: null, userDataFolder: profile, options: null);
      await wv.EnsureCoreWebView2Async(env); wv.CoreWebView2.Settings.AreDefaultScriptDialogsEnabled = false;
      wv.CoreWebView2.WebMessageReceived += (s, e) => {
        try{
          var txt = e.TryGetWebMessageAsString(); if (string.IsNullOrEmpty(txt)) return;
          if (Regex.IsMatch(txt, "\"type\"\\s*:\\s*\"close-result\"")){
            bool ok = Regex.IsMatch(txt, "\"ok\"\\s*:\\s*true"); _tcs?.TrySetResult(ok); return;
          }
          if (txt.Contains("\"type\":\"six-window-restore\"")){
            bool requestMax = false; TryGetBool(txt, "requestMaximize", out requestMax);
            int nW=0,nH=0,sX=0,sY=0,nX=0,nY=0;
            bool hasNW = TryGetInt(txt, "normalOuterW", out nW);
            bool hasNH = TryGetInt(txt, "normalOuterH", out nH);
            bool hasSX = TryGetInt(txt, "screenX", out sX);
            bool hasSY = TryGetInt(txt, "screenY", out sY);
            bool hasNX = TryGetInt(txt, "normalX", out nX);
            bool hasNY = TryGetInt(txt, "normalY", out nY);
            form.BeginInvoke(new Action(()=>{
              try{
                if (requestMax){
                  if (hasNW && hasNH){ try{ form.WindowState = FormWindowState.Normal; form.StartPosition = FormStartPosition.Manual; if (hasNX && hasNY) form.Location = new Point(nX, nY); else if (hasSX && hasSY) form.Location = new Point(sX, sY); form.Size = new Size(Math.Max(200, nW), Math.Max(150, nH)); }catch{} }
                  try{ form.WindowState = FormWindowState.Maximized; }catch{}
                } else {
                  if (hasNW && hasNH){ try{ form.WindowState = FormWindowState.Normal; form.StartPosition = FormStartPosition.Manual; if (hasNX && hasNY) form.Location = new Point(nX, nY); else if (hasSX && hasSY) form.Location = new Point(sX, sY); form.Size = new Size(Math.Max(200, nW), Math.Max(150, nH)); }catch{} }
                }
              }catch{}
            }));
            return;
          }
        }catch{}
      };
      wv.CoreWebView2.Navigate(url);
    };
    form.FormClosing += async (sender, e) => {
      if (_approved) return; if (_closing){ e.Cancel = true; return; } if (wv.CoreWebView2 == null) return;
      e.Cancel = true; _closing = true; _tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
      try{
        wv.CoreWebView2.PostWebMessageAsJson("{\\\"type\\\":\\\"close-request\\\"}");
        using (var cts = new System.Threading.CancellationTokenSource(15000)){
          using (cts.Token.Register(()=> _tcs.TrySetResult(false))){
            var ok = await _tcs.Task.ConfigureAwait(true); if (ok){ _approved = true; form.Close(); }
          }
        }
      }catch{} finally{ _closing = false; }
    };
    Application.Run(form);
  }
}
