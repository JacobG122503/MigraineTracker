using System.Text.RegularExpressions;

namespace MigraineTracker.Services;

public enum DayKind { None, Migraine, Sick, Other }

/// <summary>One dated line of the journal, e.g. "10/26 - 3.5 9am. Ibuprofen 2pm."</summary>
public sealed record DayEntry(
    DateOnly Date,
    int LineIndex,
    string Line,
    string Content,
    double? Start,
    double? Peak,
    bool Woke,
    int Meds,
    DayKind Kind);

/// <summary>A parenthesised line between days, e.g. "(Emgality 29)". It sits after <see cref="After"/>.</summary>
public sealed record Marker(DateOnly After, int LineIndex, string Label, bool IsEmgality);

public sealed record Journal(
    string[] Lines,
    IReadOnlyList<DayEntry> Days,      // file order: newest first
    IReadOnlyList<Marker> Markers,     // file order: newest first
    int InsertIndex);                  // where a new top entry goes (just under the header)

/// <summary>
/// Reads the plain-text journal. The text is the source of truth; nothing here rewrites it.
/// Lines have no year, so years are inferred by walking from the oldest line (bottom) upward.
/// </summary>
public static partial class JournalParser
{
    const string Time = @"(?:\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)|\d{1,2}:\d{2})";
    const string MedNames = "ibuprofen|tylenol|excedrin|advil|aleve|motrin|naproxen|sumatriptan|rizatriptan|maxalt|imitrex|nurtec|ubrelvy";

    [GeneratedRegex(@"^\s*(\d{1,2})/(\d{1,2})(?![\d/])\s*-?\s*(.*?)\s*$")]
    private static partial Regex DateLineRx();

    [GeneratedRegex(@"started\s+(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})", RegexOptions.IgnoreCase)]
    private static partial Regex StartedRx();

    [GeneratedRegex(@"\([^)]*\)?")]
    private static partial Regex ParensRx();

    [GeneratedRegex(@"\b(?:" + MedNames + @")\b(?:\s+(?:" + Time + @"|\d{1,2}\b(?!\.\d)))?", RegexOptions.IgnoreCase)]
    private static partial Regex MedRx();

    [GeneratedRegex(Time, RegexOptions.IgnoreCase)]
    private static partial Regex TimeRx();

    [GeneratedRegex(@"\b(?:turned|got)\s+(?:to\s+)?(\d{1,2}(?:\.\d+)?)", RegexOptions.IgnoreCase)]
    private static partial Regex TurnedRx();

    [GeneratedRegex(@"(?<![\d.])(\d{1,2}(?:\.\d+)?)(?![\d:])")]
    private static partial Regex NumberRx();

    [GeneratedRegex(@"\bwo[kn]e\b", RegexOptions.IgnoreCase)]
    private static partial Regex WokeRx();

    [GeneratedRegex(@"\d+")]
    private static partial Regex DigitsRx();

    public static Journal Parse(string text, DateOnly today)
    {
        var lines = SplitLines(text);

        // Pass 1: find dated lines and markers, top to bottom.
        var raw = new List<(int Index, int Month, int Day, string Content)>();
        var markerLines = new List<int>();
        int insertIndex = -1;
        for (int i = 0; i < lines.Length; i++)
        {
            var m = DateLineRx().Match(lines[i]);
            if (m.Success)
            {
                int month = int.Parse(m.Groups[1].Value), day = int.Parse(m.Groups[2].Value);
                if (month is < 1 or > 12 || day is < 1 or > 31) continue;
                raw.Add((i, month, day, m.Groups[3].Value));
                if (insertIndex < 0) insertIndex = i;
            }
            else if (lines[i].TrimStart().StartsWith('('))
            {
                markerLines.Add(i);
                if (insertIndex < 0) insertIndex = i;
            }
        }
        if (insertIndex < 0) insertIndex = lines.Length;

        // Pass 2: infer years from the bottom (oldest) up. Moving up, a big drop in month means a new year.
        var years = new int[raw.Count];
        int wraps = 0;
        for (int k = raw.Count - 1; k >= 0; k--)
        {
            if (k < raw.Count - 1 && raw[k].Month < raw[k + 1].Month - 6) wraps++;
            years[k] = wraps;
        }
        int baseYear;
        var started = StartedRx().Match(text);
        if (started.Success)
        {
            baseYear = int.Parse(started.Groups[3].Value);
            if (baseYear < 100) baseYear += 2000;
        }
        else if (raw.Count > 0)
        {
            // No header: assume the newest line is not in the future.
            int topYear = today.Year;
            if (new DateOnly(topYear, raw[0].Month, Math.Min(raw[0].Day, DateTime.DaysInMonth(topYear, raw[0].Month))) > today) topYear--;
            baseYear = topYear - years[0];
        }
        else baseYear = today.Year;

        var days = new List<DayEntry>(raw.Count);
        for (int k = 0; k < raw.Count; k++)
        {
            var (index, month, day, content) = raw[k];
            int year = baseYear + years[k];
            var date = new DateOnly(year, month, Math.Min(day, DateTime.DaysInMonth(year, month)));
            days.Add(ParseDay(date, index, lines[index], content));
        }

        // A marker belongs after the nearest dated line below it.
        var markers = new List<Marker>();
        foreach (var li in markerLines)
        {
            var below = days.FirstOrDefault(d => d.LineIndex > li);
            if (below is null) continue;
            var label = lines[li].Trim().Trim('(', ')').Trim();
            markers.Add(new Marker(below.Date, li, label, label.Contains("emgality", StringComparison.OrdinalIgnoreCase)));
        }

        return new Journal(lines, days, markers, insertIndex);
    }

    static DayEntry ParseDay(DateOnly date, int index, string line, string content)
    {
        var s = ParensRx().Replace(content, " ");
        int meds = MedRx().Matches(s).Count;
        s = MedRx().Replace(s, " ");
        s = TimeRx().Replace(s, " ");

        var values = new List<double>();
        double? start = null;
        foreach (Match m in NumberRx().Matches(TurnedRx().Replace(s, " ")))
        {
            if (double.TryParse(m.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture, out var v) && v is > 0 and <= 10)
            {
                start ??= v;
                values.Add(v);
            }
        }
        foreach (Match m in TurnedRx().Matches(s))
            if (double.TryParse(m.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture, out var v) && v is > 0 and <= 10)
                values.Add(v);

        double? peak = values.Count > 0 ? values.Max() : null;
        var kind = peak is not null ? DayKind.Migraine
            : content.Contains("sick", StringComparison.OrdinalIgnoreCase) ? DayKind.Sick
            : string.IsNullOrWhiteSpace(content) ? DayKind.None
            : DayKind.Other;

        return new DayEntry(date, index, line, content, start ?? peak, peak, WokeRx().IsMatch(content), meds, kind);
    }

    /// <summary>Highest Emgality number in the newest Emgality marker, e.g. "Emgality 9 + 10" → 10.</summary>
    public static int? LastEmgalityNumber(Journal j)
    {
        var m = j.Markers.FirstOrDefault(x => x.IsEmgality);
        if (m is null) return null;
        var nums = DigitsRx().Matches(m.Label).Select(x => int.Parse(x.Value)).ToList();
        return nums.Count > 0 ? nums.Max() : null;
    }

    public static string[] SplitLines(string text) => text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
}
