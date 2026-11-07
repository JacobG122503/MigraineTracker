namespace MigraineTracker.Services;

/// <summary>The color themes offered in Settings. Each color is a CSS color name.</summary>
public static class Themes
{
    public sealed record Theme(string Name, string Color);

    public const string Default = "mediumseagreen";

    public static readonly IReadOnlyList<Theme> All =
    [
        new("Medium Sea Green", Default),
        new("Coral", "coral"),
        new("Steel Blue", "steelblue"),
        new("Medium Purple", "mediumpurple"),
        new("Hot Pink", "hotpink"),
        new("Goldenrod", "goldenrod"),
        new("Dark Turquoise", "darkturquoise"),
    ];

    public static bool IsValid(string? color) => All.Any(t => t.Color == color);
}
