// Loaded in <head> so the saved color is on screen before the app starts.
window.mtTheme = {
    apply(color) {
        document.documentElement.style.setProperty('--theme', color);
        this.setFavicon(color);
    },

    // Drawn rather than a static file so the browser tab matches the theme (and can't show a stale cached icon).
    setFavicon(color) {
        const link = document.querySelector('link[rel="icon"]');
        const ctx = document.createElement('canvas').getContext('2d');
        if (!link || !ctx) return;
        ctx.canvas.width = ctx.canvas.height = 64;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(0, 0, 64, 64, 15);
        ctx.fill();
        ctx.fillStyle = '#fff7f0';
        // Four bars with equal margins on all sides.
        for (const [x, top] of [[10, 24], [22, 10], [34, 34], [46, 18]]) {
            ctx.beginPath();
            ctx.roundRect(x, top, 8, 54 - top, 4);
            ctx.fill();
        }
        link.type = 'image/png';
        link.href = ctx.canvas.toDataURL('image/png');
    },
};

(function () {
    let saved = null;
    try { saved = localStorage.getItem('mt.theme'); } catch { }
    window.mtTheme.apply(saved || 'mediumseagreen');
})();
