using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.JSInterop;

namespace MigraineTracker.Services;

public enum SyncState { LocalOnly, Syncing, Synced, Pending, Error }

/// <summary>
/// Holds the journal text. Every change is saved to the phone (localStorage) immediately,
/// then pushed to the GitHub Gist a moment later. On open / return to the app it pulls the gist.
/// </summary>
public sealed class JournalStore(IJSRuntime js, GistClient gist) : IDisposable
{
    const string KeyText = "mt.text", KeyDirty = "mt.dirty", KeyToken = "mt.token", KeyGist = "mt.gist", KeyLogin = "mt.login",
        KeyTheme = "mt.theme", KeyThemeDirty = "mt.themeDirty";

    bool _initialized, _themeDirty;
    string? _undoText;
    CancellationTokenSource? _pushDelay;
    DotNetObjectReference<JournalStore>? _selfRef;
    readonly SemaphoreSlim _syncLock = new(1, 1);

    public string Text { get; private set; } = "";
    public Journal Journal { get; private set; } = JournalParser.Parse("", DateOnly.FromDateTime(DateTime.Now));
    public SyncState Sync { get; private set; } = SyncState.LocalOnly;
    public string? SyncMessage { get; private set; }
    public string? Token { get; private set; }
    public string? GistId { get; private set; }
    public string? Login { get; private set; }
    public bool Dirty { get; private set; }
    public string Theme { get; private set; } = Themes.Default;
    public bool CanUndo => _undoText is not null;
    public bool IsConnected => Token is not null && GistId is not null;

    public event Action? Changed;

    public async Task<DateTime> NowAsync()
    {
        // Ask the browser so the time is always the phone's local time.
        var p = await js.InvokeAsync<int[]>("mt.now");
        return new DateTime(p[0], p[1], p[2], p[3], p[4], 0);
    }

    public async Task InitializeAsync()
    {
        if (_initialized) return;
        _initialized = true;

        Text = await Get(KeyText) ?? "";
        Dirty = await Get(KeyDirty) == "1";
        Token = await Get(KeyToken);
        GistId = await Get(KeyGist);
        Login = await Get(KeyLogin);
        _themeDirty = await Get(KeyThemeDirty) == "1";
        var savedTheme = await Get(KeyTheme);
        if (Themes.IsValid(savedTheme)) Theme = savedTheme!;
        else await js.InvokeVoidAsync("mtTheme.apply", Theme);
        Sync = IsConnected ? (Dirty || _themeDirty ? SyncState.Pending : SyncState.Synced) : SyncState.LocalOnly;
        await Reparse();
        Changed?.Invoke();

        _selfRef = DotNetObjectReference.Create(this);
        await js.InvokeVoidAsync("mt.onResume", _selfRef);
        _ = OnResume(); // don't hold up the first screen on the network
    }

    [JSInvokable]
    public async Task OnResume()
    {
        if (IsConnected)
        {
            if (Dirty || _themeDirty) await PushAsync();
            else await PullAsync();
        }
        // A new day may have started since the app was last opened.
        var today = DateOnly.FromDateTime(await NowAsync());
        if (Text.Length > 0)
        {
            var filled = JournalEditor.FillMissingDays(Text, today);
            if (filled != Text) await SetTextAsync(filled, keepUndo: true);
        }
    }

    // ---- Edits ----

    public async Task ApplyAsync(Func<string, DateTime, string> edit)
    {
        var now = await NowAsync();
        var before = Text;
        var after = edit(Text, now);
        if (after == before) return;
        _undoText = before;
        await SetTextAsync(after, keepUndo: true);
    }

    public async Task UndoAsync()
    {
        if (_undoText is null) return;
        var t = _undoText;
        _undoText = null;
        await SetTextAsync(t, keepUndo: true);
    }

    /// <summary>Replace the whole text (Notes editor, import).</summary>
    public async Task SetTextAsync(string text, bool keepUndo = false)
    {
        if (!keepUndo) _undoText = null;
        if (text == Text) return;
        Text = text;
        Dirty = true;
        await Set(KeyText, Text);
        await Set(KeyDirty, "1");
        await Reparse();
        if (IsConnected) Sync = SyncState.Pending;
        Changed?.Invoke();
        SchedulePush();
    }

    public async Task SetThemeAsync(string color)
    {
        if (color == Theme || !Themes.IsValid(color)) return;
        await ApplyThemeAsync(color);
        await SetThemeDirtyAsync(true);
        if (IsConnected) Sync = SyncState.Pending;
        Changed?.Invoke();
        SchedulePush();
    }

    async Task ApplyThemeAsync(string color)
    {
        Theme = color;
        await Set(KeyTheme, color);
        await js.InvokeVoidAsync("mtTheme.apply", color);
    }

    async Task SetThemeDirtyAsync(bool dirty)
    {
        _themeDirty = dirty;
        await Set(KeyThemeDirty, dirty ? "1" : "0");
    }

    static string SettingsJson(string theme) => new JsonObject { ["theme"] = theme }.ToJsonString();

    /// <summary>The theme in a gist's settings file, or null if it's missing or not one we offer.</summary>
    static string? ParseTheme(string? settings)
    {
        if (settings is null) return null;
        try
        {
            return JsonNode.Parse(settings)?["theme"] is JsonValue v && v.TryGetValue<string>(out var t) && Themes.IsValid(t) ? t : null;
        }
        catch (JsonException) { return null; }
    }

    async Task Reparse() => Journal = JournalParser.Parse(Text, DateOnly.FromDateTime(await NowAsync()));

    // ---- Sync ----

    void SchedulePush()
    {
        if (!IsConnected) return;
        _pushDelay?.Cancel();
        var cts = _pushDelay = new CancellationTokenSource();
        _ = Task.Delay(1200, cts.Token).ContinueWith(async t =>
        {
            if (!t.IsCanceled) await PushAsync();
        }, TaskScheduler.Default);
    }

    public async Task PushAsync()
    {
        if (!IsConnected) return;
        await _syncLock.WaitAsync();
        try
        {
            var sent = Text;
            var sentTheme = Theme;
            SetSync(SyncState.Syncing, null);
            await gist.WriteAsync(Token!, GistId!, Dirty ? sent : null, _themeDirty ? SettingsJson(sentTheme) : null);
            if (sent == Text)
            {
                Dirty = false;
                await Set(KeyDirty, "0");
            }
            if (sentTheme == Theme) await SetThemeDirtyAsync(false);
            SetSync(Dirty || _themeDirty ? SyncState.Pending : SyncState.Synced, null);
        }
        catch (GistException e) { SetSync(SyncState.Error, e.Message); }
        finally { _syncLock.Release(); }
    }

    public async Task PullAsync()
    {
        if (!IsConnected) return;
        await _syncLock.WaitAsync();
        try
        {
            SetSync(SyncState.Syncing, null);
            var remote = await gist.ReadAsync(Token!, GistId!);
            if (!Dirty && remote.Journal != Text)
            {
                Text = remote.Journal;
                await Set(KeyText, Text);
                await Reparse();
            }
            if (!_themeDirty && ParseTheme(remote.Settings) is string theme && theme != Theme)
                await ApplyThemeAsync(theme);
            SetSync(Dirty ? SyncState.Pending : SyncState.Synced, null);
        }
        catch (GistException e) { SetSync(SyncState.Error, e.Message); }
        finally { _syncLock.Release(); }
    }

    public async Task SyncNowAsync()
    {
        if (Dirty || _themeDirty) await PushAsync(); else await PullAsync();
    }

    /// <summary>
    /// Connects to GitHub. Uses the existing journal gist if there is one (its text and saved theme replace
    /// what's on this device); otherwise creates a new secret gist from what's on this device.
    /// </summary>
    public async Task ConnectAsync(string token)
    {
        token = token.Trim();
        var login = await gist.GetLoginAsync(token);
        var id = await gist.FindAsync(token);
        GistData? remote = null;
        if (id is null)
        {
            var seed = Text.Length > 0 ? Text : JournalEditor.NewJournal(DateOnly.FromDateTime(await NowAsync()));
            id = await gist.CreateAsync(token, seed);
            Text = seed;
        }
        else remote = await gist.ReadAsync(token, id);

        Token = token; GistId = id; Login = login;
        await Set(KeyToken, token); await Set(KeyGist, id); await Set(KeyLogin, login);
        if (remote is not null) Text = remote.Journal;
        Dirty = false;
        // A gist with no saved theme yet takes this device's; OnResume below pushes it.
        var remoteTheme = ParseTheme(remote?.Settings);
        if (remoteTheme is not null) await ApplyThemeAsync(remoteTheme);
        await SetThemeDirtyAsync(remoteTheme is null);
        _undoText = null;
        await Set(KeyText, Text); await Set(KeyDirty, "0");
        await Reparse();
        SetSync(SyncState.Synced, null);
        await OnResume();
    }

    public async Task DisconnectAsync()
    {
        Token = GistId = Login = null;
        foreach (var k in new[] { KeyToken, KeyGist, KeyLogin }) await js.InvokeVoidAsync("mt.store.remove", k);
        SetSync(SyncState.LocalOnly, null);
    }

    void SetSync(SyncState s, string? message)
    {
        Sync = s;
        SyncMessage = message;
        Changed?.Invoke();
    }

    Task<string?> Get(string key) => js.InvokeAsync<string?>("mt.store.get", key).AsTask();
    Task Set(string key, string value) => js.InvokeVoidAsync("mt.store.set", key, value).AsTask();

    public void Dispose() => _selfRef?.Dispose();
}
