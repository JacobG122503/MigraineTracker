using System.Globalization;

namespace MigraineTracker.Services;

/// <summary>
/// Text edits that write lines in the journal's own format:
///   "11/2 - 4 9:15am."  "11/2 - Woke 4.5."  "... Turned 6 3pm."  "... Ibuprofen 2pm."  "(Emgality 30)"
/// </summary>
public static class JournalEditor
{
    public static string NewJournal(DateOnly today) =>
        $"MIGRAINE JOURNAL\nStarted {today.Month}-{today.Day}-{today.Year % 100:00} (Reverse order)\n\n\n";

    public static string FormatValue(double v) => v.ToString("0.#", CultureInfo.InvariantCulture);

    public static string FormatTime(DateTime now)
    {
        int h = now.Hour % 12 == 0 ? 12 : now.Hour % 12;
        var ampm = now.Hour < 12 ? "am" : "pm";
        return now.Minute == 0 ? $"{h}{ampm}" : $"{h}:{now.Minute:00}{ampm}";
    }

    static string DateLabel(DateOnly d) => $"{d.Month}/{d.Day}";

    /// <summary>Adds a blank line for each day between the newest entry and yesterday (blank = no migraine).</summary>
    public static string FillMissingDays(string text, DateOnly today)
    {
        var j = JournalParser.Parse(text, today);
        if (j.Days.Count == 0) return text;
        var newest = j.Days[0].Date;
        var yesterday = today.AddDays(-1);
        if (newest >= yesterday || yesterday.DayNumber - newest.DayNumber > 400) return text;

        var lines = j.Lines.ToList();
        for (var d = newest.AddDays(1); d <= yesterday; d = d.AddDays(1))
            lines.Insert(j.InsertIndex, DateLabel(d));
        return string.Join('\n', lines);
    }

    public static string AddRating(string text, DateTime now, double value, bool woke)
    {
        var v = FormatValue(value);
        return AppendToToday(text, now, entry =>
            entry?.Start is not null ? $"Turned {v} {FormatTime(now)}."
            : woke ? $"Woke {v}."
            : $"{v} {FormatTime(now)}.");
    }

    public static string AddMed(string text, DateTime now, string med) =>
        AppendToToday(text, now, _ => $"{med} {FormatTime(now)}.");

    public static string AddNote(string text, DateTime now, string note)
    {
        note = note.Trim();
        if (note.Length == 0) return text;
        if (!".!?)".Contains(note[^1])) note += ".";
        return AppendToToday(text, now, _ => note);
    }

    public static string AddEmgality(string text, DateTime now)
    {
        var today = DateOnly.FromDateTime(now);
        text = FillMissingDays(Ensure(text, today), today);
        var j = JournalParser.Parse(text, today);
        var n = (JournalParser.LastEmgalityNumber(j) ?? 0) + 1;
        var lines = j.Lines.ToList();
        lines.Insert(j.InsertIndex, $"(Emgality {n})");
        return string.Join('\n', lines);
    }

    static string Ensure(string text, DateOnly today) => string.IsNullOrWhiteSpace(text) ? NewJournal(today) : text;

    static string AppendToToday(string text, DateTime now, Func<DayEntry?, string> piece)
    {
        var today = DateOnly.FromDateTime(now);
        text = FillMissingDays(Ensure(text, today), today);
        var j = JournalParser.Parse(text, today);
        var lines = j.Lines.ToList();

        var top = j.Days.Count > 0 && j.Days[0].Date == today ? j.Days[0] : null;
        if (top is null)
        {
            lines.Insert(j.InsertIndex, $"{DateLabel(today)} - {piece(null)}");
        }
        else
        {
            var content = top.Content.TrimEnd();
            if (content.Length > 0 && !".!?)".Contains(content[^1])) content += ".";
            var joined = content.Length == 0 ? piece(top) : $"{content} {piece(top)}";
            lines[top.LineIndex] = $"{DateLabel(today)} - {joined}";
        }
        return string.Join('\n', lines);
    }
}
