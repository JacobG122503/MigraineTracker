// Migraine history, Happy Scale style:
//  - a smooth trend line of daily pain (pain-free days count as 0)
//  - a dot per migraine day, with a stem to the trend
//  - a band between the trend and a slower 30-day trend: green = improving, red = worsening
//  - a dashed line at the average for the visible range
// Below the chart: stats, patterns and a month table for the same range.
// Pinch / drag (touch) or wheel / drag (mouse) to zoom and pan; tap or hover for details.

const NS = 'http://www.w3.org/2000/svg';
const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LETTERS = 'JFMAMJJASOND';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RANGES = [['1W', 7], ['1M', 30], ['3M', 91], ['6M', 182], ['1Y', 365], ['All', 0]];
const MIN_SPAN = 7;
const FAST = 4;      // trend: Gaussian smoothing, sigma in days
const SLOW = 20;     // comparison trend (~2 months wide)
const SEVERE = 6;

const utc = d => new Date(d * DAY);
const short = d => { const t = utc(d); return `${t.getUTCMonth() + 1}/${t.getUTCDate()}`; };
const long = d => { const t = utc(d); return `${WEEKDAYS[t.getUTCDay()]}, ${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}, ${t.getUTCFullYear()}`; };
const mid = d => { const t = utc(d); return `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}`; };
const fmt = v => (Math.round(v * 10) / 10).toString();
const pct = (a, b) => b ? `${Math.round(100 * a / b)}%` : '–';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const todayUnix = () => { const n = new Date(); return Math.round(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY); };
const monthStart = d => { const t = utc(d); return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1) / DAY; };
const nextMonth = d => { const t = utc(d); return Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1) / DAY; };

function h(tag, attrs = {}, parent, text) {
    const e = tag.startsWith('svg:') ? document.createElementNS(NS, tag.slice(4)) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    parent?.appendChild(e);
    return e;
}

// Centred Gaussian moving average; near the ends it uses whatever neighbours exist.
function smooth(src, out, sigma) {
    const r = Math.ceil(sigma * 3), w = [];
    for (let k = -r; k <= r; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
    for (let i = 0; i < src.length; i++) {
        let sum = 0, wsum = 0;
        for (let k = -r; k <= r; k++) {
            const j = i + k;
            if (j < 0 || j >= src.length) continue;
            sum += src[j] * w[k + r]; wsum += w[k + r];
        }
        out[i] = sum / wsum;
    }
}

function prepare(payload) {
    const today = todayUnix();
    const byDay = new Map();
    for (const d of payload.days) {
        const cur = byDay.get(d.d);
        if (!cur) byDay.set(d.d, { v: d.v ?? 0, k: d.k, t: [d.t], meds: d.meds, w: d.w, hr: d.hr });
        else {
            cur.v = Math.max(cur.v, d.v ?? 0); cur.t.push(d.t); cur.meds += d.meds;
            cur.w ||= d.w; cur.hr ??= d.hr;
            if (d.k === 'Migraine') cur.k = d.k;
        }
    }
    const first = byDay.size ? Math.min(...byDay.keys()) : today - 30;
    const end = today + 1;                               // exclusive; today is the last day shown
    const n = end - first;
    const v = new Float64Array(n), f = new Float64Array(n), s = new Float64Array(n);
    for (let i = 0; i < n; i++) v[i] = byDay.get(first + i)?.v ?? 0;
    smooth(v, f, FAST);
    smooth(v, s, SLOW);
    const shots = payload.markers.map(m => ({ d: m.d + 1, label: m.label })).sort((x, y) => x.d - y.d);
    return { byDay, first, end, v, f, s, shots };
}

/** Everything the stat panels show, for days a..b inclusive. */
function summarize(data, a, b) {
    const r = {
        days: 0, mig: 0, sum: 0, migSum: 0, severe: 0, meds: 0, worst: 0, worstDay: null,
        woke: 0, longestFree: 0, freeFrom: null, freeTo: null,
        weekday: Array.from({ length: 7 }, () => ({ n: 0, mig: 0 })),
        tod: { Woke: 0, Morning: 0, Afternoon: 0, Evening: 0, Night: 0 },
        cycle: Array.from({ length: 4 }, () => ({ n: 0, mig: 0, sum: 0 })),
        months: [],
    };
    let run = 0, runStart = null, shotIdx = -1;
    let month = null;
    for (let d = a; d <= b; d++) {
        const i = d - data.first;
        if (i < 0 || i >= data.v.length) continue;
        const v = data.v[i], info = data.byDay.get(d), wd = utc(d).getUTCDay();
        r.days++; r.sum += v; r.meds += info?.meds ?? 0;
        r.weekday[wd].n++;
        while (shotIdx + 1 < data.shots.length && data.shots[shotIdx + 1].d <= d) shotIdx++;
        const cyc = shotIdx >= 0 ? r.cycle[Math.min(3, Math.floor((d - data.shots[shotIdx].d) / 7))] : null;
        if (cyc) { cyc.n++; cyc.sum += v; }

        const ms = monthStart(d);
        if (!month || month.start !== ms) { month = { start: ms, days: 0, mig: 0, migSum: 0, meds: 0, worst: 0 }; r.months.push(month); }
        month.days++; month.meds += info?.meds ?? 0;

        if (v > 0) {
            r.mig++; r.migSum += v; month.mig++; month.migSum += v;
            month.worst = Math.max(month.worst, v);
            r.weekday[wd].mig++;
            if (cyc) cyc.mig++;
            if (v >= SEVERE) r.severe++;
            if (v > r.worst) { r.worst = v; r.worstDay = d; }
            if (info?.w) { r.woke++; r.tod.Woke++; }
            else if (info?.hr != null) {
                const hr = info.hr;
                r.tod[hr >= 5 && hr < 12 ? 'Morning' : hr >= 12 && hr < 17 ? 'Afternoon' : hr >= 17 && hr < 21 ? 'Evening' : 'Night']++;
            }
            run = 0;
        } else {
            if (run === 0) runStart = d;
            run++;
            if (run > r.longestFree) { r.longestFree = run; r.freeFrom = runStart; r.freeTo = d; }
        }
    }
    return r;
}

export function mount(root, payload) {
    root.replaceChildren();
    const ranges = h('div', { class: 'viz-ranges', role: 'group', 'aria-label': 'Time range' }, root);
    const span = h('div', { class: 'viz-span' }, root);

    const card = h('div', { class: 'viz-card' }, root);
    const legend = h('div', { class: 'viz-legend' }, card);
    const key = (cls, label) => { const s = h('span', {}, legend); h('i', { class: cls }, s); s.append(label); };
    key('key-line', 'Trend'); key('key-dot', 'Migraine day'); key('key-dash', 'Range average');
    key('key-good', 'Better than 2-month trend'); key('key-bad', 'Worse'); key('key-shot', 'Preventive shot');
    const plot = h('div', { class: 'viz-plot' }, card);
    const svg = h('svg:svg', { class: 'viz-svg', role: 'img', 'aria-label': 'Migraine pain trend chart' }, plot);
    const tip = h('div', { class: 'viz-tip', hidden: '' }, plot);
    h('div', { class: 'viz-hint' }, card, 'Pinch or drag to zoom and scroll · tap a day for details');

    const tiles = h('div', { class: 'viz-stats' }, root);
    const patterns = h('div', { class: 'viz-patterns' }, root);
    const monthsBox = h('div', { class: 'viz-months' }, root);

    const clipId = `viz-clip-${Math.random().toString(36).slice(2)}`;
    let data = prepare(payload);
    let x0 = data.end - 30, x1 = data.end;
    let W = 300, H = 280, activeRange = 30, tipDay = null, raf = 0, statsKey = '';
    const M = { top: 54, right: 8, bottom: 10, left: 28 };

    const btns = RANGES.map(([label, days]) => {
        const b = h('button', { type: 'button', 'data-days': days }, ranges, label);
        b.addEventListener('click', () => setRange(days));
        return b;
    });

    const plotW = () => W - M.left - M.right;
    const ppd = () => plotW() / (x1 - x0);
    const sx = d => M.left + (d - x0) * ppd();
    let yMax = 10;
    const sy = v => M.top + (1 - v / yMax) * (H - M.top - M.bottom);
    const fullSpan = () => Math.max(MIN_SPAN, data.end - data.first);

    function clamp() {
        const s = Math.min(Math.max(x1 - x0, MIN_SPAN), fullSpan());
        if (x0 < data.first) x0 = data.first;
        x1 = x0 + s;
        if (x1 > data.end) { x1 = data.end; x0 = x1 - s; }
    }

    function setRange(days) {
        activeRange = days;
        x1 = data.end;
        x0 = days === 0 ? Math.min(data.first, x1 - MIN_SPAN) : x1 - days;
        clamp();
        tipDay = null;
        schedule();
    }

    function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }

    // Catmull-Rom through day centres, as cubic Bézier segments from index i to j (j = i ± 1).
    const pt = (arr, i) => {
        const k = Math.max(0, Math.min(arr.length - 1, i));
        return [sx(data.first + k + 0.5), sy(arr[k])];
    };
    function curve(arr, from, to, moveTo = true) {
        const step = to >= from ? 1 : -1;
        const p0 = pt(arr, from);
        let d = moveTo ? `M${p0[0].toFixed(1)},${p0[1].toFixed(1)}` : `L${p0[0].toFixed(1)},${p0[1].toFixed(1)}`;
        for (let i = from; i !== to; i += step) {
            const j = i + step, pi = pt(arr, i), pj = pt(arr, j), pk = pt(arr, i - step), pl = pt(arr, j + step);
            const c1 = [pi[0] + (pj[0] - pk[0]) / 6, pi[1] + (pj[1] - pk[1]) / 6];
            const c2 = [pj[0] - (pl[0] - pi[0]) / 6, pj[1] - (pl[1] - pi[1]) / 6];
            d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${pj[0].toFixed(1)},${pj[1].toFixed(1)}`;
        }
        return d;
    }

    function render() {
        W = plot.clientWidth || 300;
        const wide = W >= 700;
        H = Math.round(wide ? Math.max(320, Math.min(window.innerHeight - 300, 560)) : Math.max(260, Math.min(420, W * 0.95)));
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.setAttribute('width', W);
        svg.setAttribute('height', H);
        svg.replaceChildren();
        btns.forEach(b => b.classList.toggle('active', +b.dataset.days === activeRange));

        const p = ppd();
        const lo = Math.max(data.first, Math.floor(x0)), hi = Math.min(data.end - 1, Math.ceil(x1));
        const ilo = lo - data.first, ihi = hi - data.first;

        // Fit the y scale to what's visible.
        let top = 0;
        for (let i = ilo; i <= ihi; i++) top = Math.max(top, data.v[i], data.f[i], data.s[i]);
        yMax = Math.min(10, Math.max(4, Math.ceil(top)));
        const yStep = yMax <= 5 ? 1 : 2;
        if (yMax % yStep) yMax++;
        const y0 = sy(0), yTop = sy(yMax);

        const grid = h('svg:g', { class: 'viz-grid' }, svg);
        for (let v = 0; v <= yMax; v += yStep) {
            h('svg:line', { x1: M.left, x2: W - M.right, y1: sy(v), y2: sy(v), class: v === 0 ? 'base' : '' }, grid);
            h('svg:text', { x: M.left - 6, y: sy(v) + 4, 'text-anchor': 'end' }, grid, v);
        }

        // Month columns + header (year row, month row), like Happy Scale.
        const head = h('svg:g', { class: 'viz-head' }, svg);
        const years = [];
        for (let ms = monthStart(lo); ms <= hi; ms = nextMonth(ms)) {
            const me = nextMonth(ms), t = utc(ms), m = t.getUTCMonth();
            const xs = sx(ms), a = Math.max(xs, M.left), b = Math.min(sx(me), W - M.right);
            const monthPx = 30.4 * p;
            if (xs >= M.left && (monthPx >= 10 || m === 0 || (monthPx >= 5 && m % 3 === 0)))
                h('svg:line', { x1: xs, x2: xs, y1: M.top - 14, y2: y0, class: m === 0 ? 'month year' : 'month' }, grid);
            const w = b - a;
            if (w >= 9) h('svg:text', { x: (a + b) / 2, y: M.top - 20, 'text-anchor': 'middle' }, head, w >= 34 ? MONTHS[m] : LETTERS[m]);
            if (m === 0 || ms === monthStart(lo)) years.push([Math.max(xs, M.left) + 2, t.getUTCFullYear()]);
        }
        if (years.length > 1 && years[1][0] - years[0][0] < 46) years.shift();
        for (const [yx, label] of years) if (yx < W - 34) h('svg:text', { x: yx, y: 14, class: 'year' }, head, label);

        // Day numbers when zoomed in far enough.
        if (p >= 9) {
            const step = [1, 2, 3, 5, 7].find(s => s * p >= 22) ?? 7;
            for (let d = lo; d <= hi; d++) {
                const dom = utc(d).getUTCDate();
                if ((dom - 1) % step === 0 && dom < 30) h('svg:text', { x: sx(d + 0.5), y: M.top - 6, 'text-anchor': 'middle', class: 'dom' }, head, dom);
            }
        }

        const defs = h('svg:defs', {}, svg);
        const cp = h('svg:clipPath', { id: clipId }, defs);
        h('svg:rect', { x: M.left, y: yTop - 6, width: plotW(), height: y0 - yTop + 6 }, cp);
        const g = h('svg:g', { 'clip-path': `url(#${clipId})` }, svg);

        // Band between trend and slow trend, split into runs of the same sign.
        const a0 = Math.max(0, ilo - 1), b0 = Math.min(data.v.length - 1, ihi + 1);
        for (let i = a0; i < b0;) {
            const good = data.f[i] <= data.s[i];
            let j = i;
            while (j < b0 && (data.f[j + 1] <= data.s[j + 1]) === good) j++;
            const end = Math.min(j + 1, b0);
            h('svg:path', { d: curve(data.f, i, end) + curve(data.s, end, i, false) + 'Z', class: good ? 'viz-good' : 'viz-bad' }, g);
            i = end;
        }

        // Emgality shots
        let lastShotX = -Infinity;
        for (const sh of data.shots) {
            const x = sx(sh.d);
            if (x < M.left || x > W - M.right) continue;
            const roomy = p >= 1.2;
            h('svg:line', { x1: x, x2: x, y1: roomy ? yTop : y0 - 7, y2: y0, class: roomy ? 'viz-shot' : 'viz-shot tick' }, g);
            if (!roomy || x - lastShotX < 30) continue;
            const n = (sh.label.match(/\d+(\.\d+)?/g) ?? []).map(Number);
            const prefix = /^aimovig/i.test(sh.label) ? 'Am' : /^ajovy/i.test(sh.label) ? 'A' : 'E';
            const right = x > W - M.right - 30;
            h('svg:text', { x: right ? x - 3 : x + 3, y: y0 - 4, 'text-anchor': right ? 'end' : 'start', class: 'viz-shot-label' }, g, n.length ? `${prefix}${Math.floor(Math.max(...n))}` : prefix);
            lastShotX = x;
        }

        // Stems + dots for migraine days
        const big = p >= 3, showDots = p >= 0.8;
        const r = p >= 10 ? 4.5 : p >= 5 ? 3.5 : big ? 2.5 : 1.6;
        for (let d = lo; d <= hi; d++) {
            const i = d - data.first, v = data.v[i];
            const x = sx(d + 0.5);
            if (v > 0 && showDots) {
                if (big) h('svg:line', { x1: x, x2: x, y1: sy(v), y2: sy(data.f[i]), class: 'viz-stem' }, g);
                h('svg:circle', { cx: x, cy: sy(v), r: d === tipDay ? r + 1.5 : r, class: big ? 'viz-dot ring' : 'viz-dot' }, g);
            } else if (big && data.byDay.get(d)?.k === 'Sick') {
                h('svg:circle', { cx: x, cy: y0 - 4, r: 2.5, class: 'viz-other' }, g);
            }
        }

        // Trend line
        h('svg:path', { d: curve(data.f, a0, b0), class: 'viz-trend' }, g);

        // Average for the visible range (dashed)
        const s = summarize(data, Math.max(data.first, Math.ceil(x0 - 0.5)), Math.min(data.end - 1, Math.floor(x1 - 0.5)));
        if (s.days) {
            const avg = s.sum / s.days, y = sy(avg);
            h('svg:line', { x1: M.left, x2: W - M.right, y1: y, y2: y, class: 'viz-avg' }, svg);
            const label = `Avg ${fmt(avg)}`;
            const lw = label.length * 6.6 + 12;
            const ly = y - 20 < yTop ? y + 4 : y - 20;
            h('svg:rect', { x: W - M.right - lw - 2, y: ly, width: lw, height: 16, rx: 8, class: 'viz-avg-pill' }, svg);
            h('svg:text', { x: W - M.right - lw / 2 - 2, y: ly + 12, 'text-anchor': 'middle', class: 'viz-avg-text' }, svg, label);
        }

        if (tipDay != null && tipDay >= lo && tipDay <= hi) {
            const cx = sx(tipDay + 0.5);
            h('svg:line', { x1: cx, x2: cx, y1: yTop, y2: y0, class: 'viz-cross' }, svg);
            h('svg:circle', { cx, cy: sy(data.f[tipDay - data.first]), r: 4, class: 'viz-trend-dot' }, svg);
        }
        renderTip();

        const k = `${s.days}|${Math.ceil(x0 - 0.5)}|${data.v.length}|${data.end}`;
        if (k !== statsKey) { statsKey = k; renderStats(s); }
    }

    function renderTip() {
        if (tipDay == null || tipDay < data.first || tipDay >= data.end) { tip.hidden = true; return; }
        const info = data.byDay.get(tipDay), i = tipDay - data.first, v = data.v[i];
        tip.replaceChildren();
        h('div', { class: 'tip-value' }, tip, v > 0 ? `Pain ${fmt(v)}` : info?.k === 'Sick' ? 'Sick' : 'No migraine');
        h('div', { class: 'tip-date' }, tip, long(tipDay));
        for (const t of info?.t ?? []) if (t.trim()) h('div', { class: 'tip-line' }, tip, t);
        if (!info) h('div', { class: 'tip-line' }, tip, 'No entry');
        h('div', { class: 'tip-avg' }, tip, `Trend ${fmt(data.f[i])} · 2-month ${fmt(data.s[i])}`);
        tip.hidden = false;
        const x = sx(tipDay + 0.5), tw = tip.offsetWidth;
        let left = x + 12;
        if (left + tw > W - 4) left = x - 12 - tw;
        tip.style.left = `${Math.max(4, left)}px`;
    }

    function tile(label, value, sub) {
        const t = h('div', { class: 'viz-tile' }, tiles);
        h('div', { class: 'viz-tile-value' }, t, value);
        h('div', { class: 'viz-tile-label' }, t, label);
        h('div', { class: 'viz-tile-sub' }, t, sub ?? '');
    }

    function bars(title, note, rows, fmtVal) {
        const box = h('section', { class: 'viz-box' }, patterns);
        h('h3', {}, box, title);
        if (note) h('p', { class: 'viz-note' }, box, note);
        const max = Math.max(...rows.map(r => r.value), 0.0001);
        for (const r of rows) {
            const row = h('div', { class: 'hbar' }, box);
            h('span', { class: 'hbar-label' }, row, r.label);
            const track = h('span', { class: 'hbar-track' }, row);
            const fill = h('span', { class: 'hbar-fill' }, track);
            fill.style.width = `${(r.value / max) * 100}%`;
            h('span', { class: 'hbar-value' }, row, r.n ? fmtVal(r) : '–');
        }
    }

    function renderStats(s) {
        const a = Math.max(data.first, Math.ceil(x0 - 0.5)), b = Math.min(data.end - 1, Math.floor(x1 - 0.5));
        const sameYear = utc(a).getUTCFullYear() === utc(b).getUTCFullYear();
        span.textContent = s.days
            ? `${sameYear ? mid(a) : `${mid(a)}, ${utc(a).getUTCFullYear()}`} – ${mid(b)}, ${utc(b).getUTCFullYear()} · ${plural(s.days, 'day')}`
            : '';

        // Same-length window just before this one, for comparison.
        const prevB = a - 1, prevA = Math.max(data.first, a - s.days);
        const prev = prevB >= data.first && prevB - prevA + 1 === s.days ? summarize(data, prevA, prevB) : null;

        tiles.replaceChildren();
        tile('Migraine days', `${s.mig}`, `of ${s.days} · ${pct(s.mig, s.days)}`);
        tile('Avg daily pain', s.days ? fmt(s.sum / s.days) : '–', 'counting pain-free days');
        tile('Avg when it hits', s.mig ? fmt(s.migSum / s.mig) : '–', 'on migraine days');
        tile(`Severe (${SEVERE}+)`, `${s.severe}`, s.mig ? `${pct(s.severe, s.mig)} of migraines` : '');
        tile('Pills', `${s.meds}`, s.days ? `${fmt(s.meds / s.days * 7)} / week` : '');
        tile('Longest pain-free', plural(s.longestFree, 'day'), s.freeFrom != null ? `${short(s.freeFrom)} – ${short(s.freeTo)}` : '');
        tile('Woke with it', pct(s.woke, s.mig), s.mig ? `${s.woke} of ${s.mig} migraines` : '');
        if (prev) {
            const dm = s.mig - prev.mig;
            tile('vs previous period', dm === 0 ? 'Same' : `${dm > 0 ? '▲' : '▼'} ${Math.abs(dm)}`,
                `${dm > 0 ? 'more' : dm < 0 ? 'fewer' : ''} migraine days (${prev.mig} → ${s.mig})`.trim());
        } else {
            tile('vs previous period', '–', 'not enough history');
        }
        tile('Worst day', s.worst ? fmt(s.worst) : '–', s.worstDay != null ? mid(s.worstDay) : '');

        let since = null;
        for (let i = data.v.length - 1; i >= 0; i--) if (data.v[i] > 0) { since = data.v.length - 1 - i; break; }
        tile('Days since last', since == null ? '–' : `${since}`, since === 0 ? 'migraine today' : 'migraine-free right now');

        patterns.replaceChildren();
        const order = [1, 2, 3, 4, 5, 6, 0];
        bars('By weekday', '% of days with a migraine', order.map(i => ({
            label: WEEKDAYS[i], value: s.weekday[i].n ? s.weekday[i].mig / s.weekday[i].n : 0, n: s.weekday[i].n,
            mig: s.weekday[i].mig,
        })), r => pct(r.mig, r.n));

        const todTotal = Object.values(s.tod).reduce((x, y) => x + y, 0);
        bars('When it starts', 'Share of migraines with a known start', Object.entries(s.tod).map(([label, c]) => ({
            label, value: c, n: todTotal, c,
        })), r => pct(r.c, r.n));

        bars('Shot cycle', 'Migraine days by week since the last Emgality / Ajovy / Aimovig shot', s.cycle.map((c, i) => ({
            label: i < 3 ? `Week ${i + 1}` : 'Week 4+', value: c.n ? c.mig / c.n : 0, n: c.n, c,
        })), r => `${pct(r.c.mig, r.c.n)} · ${fmt(r.c.sum / r.c.n)}`);

        monthsBox.replaceChildren();
        if (s.months.length > 1) {
            h('h3', {}, monthsBox, 'By month');
            const table = h('table', {}, monthsBox);
            const hr = h('tr', {}, h('thead', {}, table));
            for (const c of ['Month', 'Migraine days', 'Avg pain', 'Pills', 'Worst']) h('th', {}, hr, c);
            const body = h('tbody', {}, table);
            for (const m of [...s.months].reverse()) {
                const t = utc(m.start);
                const tr = h('tr', {}, body);
                h('td', {}, tr, `${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}${m.days < new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate() ? '*' : ''}`);
                h('td', {}, tr, `${m.mig} / ${m.days}`);
                h('td', {}, tr, m.mig ? fmt(m.migSum / m.mig) : '–');
                h('td', {}, tr, `${m.meds}`);
                h('td', {}, tr, m.worst ? fmt(m.worst) : '–');
            }
            h('p', { class: 'viz-note' }, monthsBox, '* partial month in this range. Avg pain is on migraine days.');
        }
    }

    // ---- Gestures ----
    const pointers = new Map();
    let drag = null, pinch = null;
    const localX = e => e.clientX - svg.getBoundingClientRect().left;
    const dayAt = x => Math.floor(x0 + (x - M.left) / ppd());

    svg.addEventListener('pointerdown', e => {
        svg.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, localX(e));
        if (pointers.size === 1) drag = { x: localX(e), x0, x1, moved: false };
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            pinch = { dist: Math.max(10, Math.abs(a - b)), mid: (a + b) / 2, x0, x1 };
            drag = null;
        }
    });
    svg.addEventListener('pointermove', e => {
        if (!pointers.has(e.pointerId)) {
            if (e.pointerType === 'mouse') { tipDay = dayAt(localX(e)); schedule(); }
            return;
        }
        pointers.set(e.pointerId, localX(e));
        if (pinch && pointers.size >= 2) {
            const [a, b] = [...pointers.values()];
            const dist = Math.max(10, Math.abs(a - b)), m = (a + b) / 2;
            const s0 = pinch.x1 - pinch.x0;
            const anchor = pinch.x0 + (pinch.mid - M.left) / plotW() * s0;
            const s = Math.min(Math.max(s0 * pinch.dist / dist, MIN_SPAN), fullSpan());
            x0 = anchor - (m - M.left) / plotW() * s;
            x1 = x0 + s;
            activeRange = null; tipDay = null;
            clamp(); schedule();
        } else if (drag) {
            const dx = localX(e) - drag.x;
            if (Math.abs(dx) > 6) drag.moved = true;
            if (drag.moved) {
                const shift = -dx / (plotW() / (drag.x1 - drag.x0));
                x0 = drag.x0 + shift; x1 = drag.x1 + shift;
                activeRange = null; tipDay = null;
                clamp(); schedule();
            }
        }
    });
    const end = e => {
        if (!pointers.has(e.pointerId)) return;
        pointers.delete(e.pointerId);
        if (drag && !drag.moved && e.type === 'pointerup') {
            const d = dayAt(localX(e));
            tipDay = tipDay === d && e.pointerType !== 'mouse' ? null : d;
            schedule();
        }
        if (pointers.size < 2) pinch = null;
        if (pointers.size === 0) drag = null;
        else if (pointers.size === 1) { const [x] = pointers.values(); drag = { x, x0, x1, moved: true }; }
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !pointers.size) { tipDay = null; schedule(); } });
    svg.addEventListener('wheel', e => {
        e.preventDefault();
        const x = localX(e), s0 = x1 - x0;
        const anchor = x0 + (x - M.left) / plotW() * s0;
        const s = Math.min(Math.max(s0 * Math.exp(e.deltaY * 0.002), MIN_SPAN), fullSpan());
        x0 = anchor - (x - M.left) / plotW() * s; x1 = x0 + s;
        activeRange = null;
        clamp(); schedule();
    }, { passive: false });

    const ro = new ResizeObserver(schedule);
    ro.observe(plot);
    window.addEventListener('resize', schedule);
    setRange(30);

    return {
        update(p) {
            const keepEnd = x1 >= data.end - 0.01;
            data = prepare(p);
            statsKey = '';
            if (keepEnd) { const s = x1 - x0; x1 = data.end; x0 = x1 - s; }
            clamp(); schedule();
        },
        dispose() { ro.disconnect(); window.removeEventListener('resize', schedule); cancelAnimationFrame(raf); root.replaceChildren(); },
    };
}
