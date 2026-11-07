using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Components.WebAssembly.Http;

namespace MigraineTracker.Services;

public sealed class GistException(string message, HttpStatusCode? status = null) : Exception(message)
{
    public HttpStatusCode? Status { get; } = status;
}

/// <summary>What a gist holds: the journal text, and the app settings JSON if it has been saved yet.</summary>
public sealed record GistData(string Journal, string? Settings);

/// <summary>Reads and writes the journal and app settings as two files in a secret GitHub Gist.</summary>
public sealed class GistClient
{
    public const string FileName = "migraine-journal.txt";
    public const string SettingsFileName = "migraine-settings.json";
    const string Api = "https://api.github.com";

    readonly HttpClient _http = new();

    static HttpRequestMessage Request(HttpMethod method, string url, string token, JsonNode? body = null)
    {
        var req = new HttpRequestMessage(method, url);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        req.Headers.Accept.ParseAdd("application/vnd.github+json");
        req.SetBrowserRequestCache(BrowserRequestCache.NoStore);
        if (body is not null) req.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        return req;
    }

    async Task<JsonNode> SendAsync(HttpRequestMessage req)
    {
        HttpResponseMessage res;
        try { res = await _http.SendAsync(req); }
        catch (HttpRequestException) { throw new GistException("Can't reach GitHub (offline?)"); }

        var body = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
        {
            var msg = res.StatusCode switch
            {
                HttpStatusCode.Unauthorized => "GitHub rejected the token. Check it hasn't expired.",
                HttpStatusCode.NotFound => "Gist not found (deleted, or token lacks the gist scope).",
                HttpStatusCode.Forbidden => "GitHub refused the request (rate limit or missing gist scope).",
                _ => $"GitHub error {(int)res.StatusCode}",
            };
            throw new GistException(msg, res.StatusCode);
        }
        return JsonNode.Parse(body.Length == 0 ? "{}" : body)!;
    }

    public async Task<string> GetLoginAsync(string token)
    {
        var user = await SendAsync(Request(HttpMethod.Get, $"{Api}/user", token));
        return user["login"]?.GetValue<string>() ?? "unknown";
    }

    /// <summary>Finds an existing gist holding <see cref="FileName"/>.</summary>
    public async Task<string?> FindAsync(string token)
    {
        for (int page = 1; page <= 10; page++)
        {
            var list = (await SendAsync(Request(HttpMethod.Get, $"{Api}/gists?per_page=100&page={page}", token))).AsArray();
            foreach (var g in list)
                if (g?["files"]?[FileName] is not null) return g["id"]!.GetValue<string>();
            if (list.Count < 100) break;
        }
        return null;
    }

    public async Task<string> CreateAsync(string token, string content)
    {
        var body = new JsonObject
        {
            ["description"] = "Migraine journal (Migraine Tracker app)",
            ["public"] = false,
            ["files"] = new JsonObject { [FileName] = new JsonObject { ["content"] = content } },
        };
        var g = await SendAsync(Request(HttpMethod.Post, $"{Api}/gists", token, body));
        return g["id"]!.GetValue<string>();
    }

    public async Task<GistData> ReadAsync(string token, string id)
    {
        var g = await SendAsync(Request(HttpMethod.Get, $"{Api}/gists/{id}", token));
        var settings = g["files"]?[SettingsFileName]?["content"]?.GetValue<string>();
        var file = g["files"]?[FileName] ?? throw new GistException($"The gist has no {FileName} file.");
        if (file["truncated"]?.GetValue<bool>() == true)
        {
            var raw = new HttpRequestMessage(HttpMethod.Get, file["raw_url"]!.GetValue<string>());
            raw.SetBrowserRequestCache(BrowserRequestCache.NoStore);
            return new GistData(await (await _http.SendAsync(raw)).Content.ReadAsStringAsync(), settings);
        }
        return new GistData(file["content"]?.GetValue<string>() ?? "", settings);
    }

    /// <summary>Updates whichever files are given; a null file is left as it is in the gist.</summary>
    public async Task WriteAsync(string token, string id, string? journal, string? settings)
    {
        var files = new JsonObject();
        // GitHub rejects empty file content, which would also delete the file.
        if (journal is not null) files[FileName] = new JsonObject { ["content"] = journal.Length == 0 ? " " : journal };
        if (settings is not null) files[SettingsFileName] = new JsonObject { ["content"] = settings };
        if (files.Count == 0) return;
        var body = new JsonObject { ["files"] = files };
        await SendAsync(Request(new HttpMethod("PATCH"), $"{Api}/gists/{id}", token, body));
    }
}
