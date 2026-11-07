// Small browser helpers called from Blazor.
window.mt = {
    now() {
        const d = new Date();
        return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];
    },

    store: {
        get(k) { try { return localStorage.getItem(k); } catch { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch { } },
        remove(k) { try { localStorage.removeItem(k); } catch { } },
    },

    // Calls back into .NET whenever the app comes back to the foreground or the network returns.
    onResume(ref) {
        let last = 0;
        const fire = () => {
            if (document.visibilityState !== 'visible' || Date.now() - last < 3000) return;
            last = Date.now();
            ref.invokeMethodAsync('OnResume');
        };
        document.addEventListener('visibilitychange', fire);
        window.addEventListener('online', fire);
    },

    download(name, text) {
        const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
        const a = Object.assign(document.createElement('a'), { href: url, download: name });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    },

    async copy(text) {
        try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
    },

    scrollToId(id) { document.getElementById(id)?.scrollIntoView({ block: 'start' }); },

    vibrate() { try { navigator.vibrate?.(15); } catch { } },
};
