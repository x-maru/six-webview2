// Minimal WinForms WebView2 host for six-webview2
// Build on Windows with .NET 6+ and WebView2 SDK
// dotnet add package Microsoft.Web.WebView2
// dotnet build && run

using System;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace SixHost
{
    public class MainForm : Form
    {
        private readonly WebView2 _webview = new WebView2();
        private bool _closingNegotiation = false;
        private bool _approvedClose = false;
        private TaskCompletionSource<bool>? _closeTcs;

        public MainForm(string url)
        {
            Text = "six-webview2";
            Width = 1200; Height = 800;
            Controls.Add(_webview);
            _webview.Dock = DockStyle.Fill;
            Load += async (_, __) => await InitializeAsync(url);
            FormClosing += OnFormClosing;
        }

        private async Task InitializeAsync(string url)
        {
            // Ensure environment
            var env = await CoreWebView2Environment.CreateAsync();
            await _webview.EnsureCoreWebView2Async(env);

            // Optional: disable default JS dialogs (page has custom modals)
            _webview.CoreWebView2.Settings.AreDefaultScriptDialogsEnabled = false;

            // Wire page->host messages
            _webview.CoreWebView2.WebMessageReceived += OnWebMessageReceived;

            // Navigate
            _webview.CoreWebView2.Navigate(url);
        }

        private async void OnFormClosing(object? sender, FormClosingEventArgs e)
        {
            if (_approvedClose) return; // already okayed
            if (_closingNegotiation) { e.Cancel = true; return; }

            // Start negotiation with page
            if (_webview.CoreWebView2 == null) return; // nothing to do
            e.Cancel = true; // cancel this close; resume only when page okays
            _closingNegotiation = true;
            _closeTcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

            try
            {
                _webview.CoreWebView2.PostWebMessageAsJson("{\"type\":\"close-request\"}");
                // Wait for result (with timeout to avoid deadlock)
                using var cts = new System.Threading.CancellationTokenSource(15000);
                using (cts.Token.Register(() => _closeTcs.TrySetResult(false)))
                {
                    bool ok = await _closeTcs.Task.ConfigureAwait(true);
                    if (ok)
                    {
                        _approvedClose = true;
                        Close(); // try again; OnFormClosing will pass
                    }
                }
            }
            catch
            {
                // On error: keep window open
            }
            finally
            {
                _closingNegotiation = false;
            }
        }

        private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                var json = e.TryGetWebMessageAsString();
                if (string.IsNullOrEmpty(json)) return;
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                if (root.ValueKind != JsonValueKind.Object) return;
                if (root.TryGetProperty("type", out var t) && t.GetString() == "close-result")
                {
                    bool ok = false;
                    if (root.TryGetProperty("ok", out var okProp) && okProp.ValueKind == JsonValueKind.True) ok = true;
                    _closeTcs?.TrySetResult(ok);
                }
            }
            catch { /* ignore */ }
        }

        [STAThread]
        public static void Main(string[] args)
        {
            Application.SetHighDpiMode(HighDpiMode.SystemAware);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            var url = args.Length > 0 ? args[0] : new Uri(new Uri(AppContext.BaseDirectory), "_six.html").ToString();
            Application.Run(new MainForm(url));
        }
    }
}
