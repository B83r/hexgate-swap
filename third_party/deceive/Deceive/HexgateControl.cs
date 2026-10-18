using System;
using System.IO;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace Deceive;

/// <summary>
/// Loopback-only control channel for Hexgate. Deceive's chat proxy remains the
/// upstream implementation; this channel only exposes its existing controls.
/// </summary>
internal sealed class HexgateControl
{
    private readonly MainController Controller;
    private readonly HttpListener Listener = new();
    private readonly string Token;
    private readonly string ControlFile;
    private readonly int Port;

    internal HexgateControl(MainController controller, int port, string token, string controlFile)
    {
        Controller = controller;
        Port = port;
        Token = token;
        ControlFile = controlFile;
        Listener.Prefixes.Add($"http://127.0.0.1:{port}/hexgate/");
    }

    internal void Start()
    {
        Listener.Start();
        var parent = Path.GetDirectoryName(ControlFile);
        if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
        File.WriteAllText(ControlFile, JsonSerializer.Serialize(new
        {
            port = Port,
            token = Token,
            pid = System.Diagnostics.Process.GetCurrentProcess().Id,
        }));
        AppDomain.CurrentDomain.ProcessExit += (_, _) =>
        {
            try { File.Delete(ControlFile); } catch { /* stale file is rejected by the client */ }
        };
        _ = Task.Run(ServeAsync);
    }

    private async Task ServeAsync()
    {
        while (Listener.IsListening)
        {
            HttpListenerContext context;
            try { context = await Listener.GetContextAsync(); }
            catch (HttpListenerException) { return; }
            catch (ObjectDisposedException) { return; }
            _ = Task.Run(() => HandleAsync(context));
        }
    }

    private async Task HandleAsync(HttpListenerContext context)
    {
        try
        {
            if (!string.Equals(context.Request.Headers["X-Hexgate-Control"], Token, StringComparison.Ordinal))
            {
                await RespondAsync(context, 401, new { error = "unauthorized" });
                return;
            }
            if (context.Request.HttpMethod == "GET" && context.Request.Url?.AbsolutePath == "/hexgate/state")
            {
                await RespondAsync(context, 200, await Controller.HexgateStateAsync());
                return;
            }
            if (context.Request.HttpMethod == "POST" && context.Request.Url?.AbsolutePath == "/hexgate/state")
            {
                using var document = await JsonDocument.ParseAsync(context.Request.InputStream);
                var root = document.RootElement;
                var status = root.GetProperty("status").GetString() ?? "";
                var enabled = root.GetProperty("enabled").GetBoolean();
                var lobbyChat = root.GetProperty("lobbyChat").GetBoolean();
                await RespondAsync(context, 200,
                    await Controller.SetHexgateStateAsync(status, enabled, lobbyChat));
                return;
            }
            if (context.Request.HttpMethod == "POST" && context.Request.Url?.AbsolutePath == "/hexgate/stop")
            {
                await RespondAsync(context, 200, new { stopping = true });
                await Controller.StopHexgateAsync();
                return;
            }
            await RespondAsync(context, 404, new { error = "not found" });
        }
        catch (Exception e)
        {
            try { await RespondAsync(context, 400, new { error = e.Message }); }
            catch { /* client disconnected */ }
        }
    }

    private static async Task RespondAsync(HttpListenerContext context, int code, object body)
    {
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(body));
        context.Response.StatusCode = code;
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.ContentLength64 = bytes.Length;
        await context.Response.OutputStream.WriteAsync(bytes, 0, bytes.Length);
        context.Response.Close();
    }
}
