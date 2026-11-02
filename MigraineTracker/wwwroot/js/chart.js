// Migraine history chart: one bar per day (peak pain), a 7-day average line, Emgality markers.
// Pinch / drag (touch) or wheel / drag (mouse) to zoom and pan; tap or hover for details.

const NS = 'http://www.w3.org/2000/svg';
const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RANGES = [['1W', 7], ['1M', 30], ['3M', 91], ['6M', 182], ['1Y', 365], ['All', 0]];
const M = { top: 22, right: 6, bottom: 24, left: 26 };
const MIN_SPAN = 7;

const utc = d => new Date(d * DAY);
const short = d => { const t = utc(d); return `${t.getUTCMonth() + 1}/${t.getUTCDate()}`; };
const long = d => { const t = utc(d); return `${WEEKDAYS[t.getUTCDay()]}, ${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}, ${t.getUTCFullYear()}`; };
const mid = d => { const t = utc(d); return `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}`; };
const fmt = v => (Math.round(v * 10) / 10).toString();
const todayUnix = () => { const n = new Date(); return Math.round(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY); };

function h(tag, attrs = {}, parent, text) {
    const e = tag.startsWith('svg:') ? document.createElementNS(NS, tag.slice(4)) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    parent?.appendChild(e);
    return e;
}

function prepare(payload) {
    const today = todayUnix();
    const byDay = new Map();
    for (const d of payload.days) {
        const cur = byDay.get(d.d);
        if (!cur) byDay.set(d.d, { v: d.v ?? 0, k: d.k, t: [d.t], meds: d.meds });
        else { cur.v = Math.max(cur.v, d.v ?? 0); cur.t.push(d.t); cur.meds += d.meds; if (d.k === 'Migraine') cur.k = d.k; }
    }
    const first = byDay.size ? Math.min(...byDay.keys()) : today - 30;
    const end = today + 1;                               // exclusive; today is the last day shown
    const n = end - first;
    const v = new Float64Array(n), avg = new Float64Array(n);
    for (let i = 0; i < n; i++) v[i] = byDay.get(first + i)?.v ?? 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
        sum += v[i];
        if (i >= 7) sum -= v[i - 7];
        avg[i] = sum / Math.min(i + 1, 7);
    }
    return { byDay, first, end, v, avg, markers: payload.markers };
}

export function mount(root, payload) {
    root.replaceChildren();
    const ranges = h('div', { class: 'viz-ranges', role: 'group', 'aria-label': 'Time range' }, root);
    const span = h('div', { class: 'viz-span' }, root);
    const stats = h('div', { class: 'viz-stats' }, root);
    const tile = (label) => {
        const t = h('div', { class: 'viz-tile' }, stats);
        const val = h('div', { class: 'viz-tile-value' }, t);
        h('div', { class: 'viz-tile-label' }, t, label);
        const sub = h('div', { class: 'viz-tile-sub' }, t);
        return { val, sub };
    };
    const tDays = tile('Migraine days'), tAvg = tile('Avg pain'), tMeds = tile('Pills'), tWorst = tile('Worst');

    const legend = h('div', { class: 'viz-legend' }, root);
    const l1 = h('span', {}, legend); h('i', { class: 'key-bar' }, l1); l1.append('Daily peak');
    const l2 = h('span', {}, legend); h('i', { class: 'key-line' }, l2); l2.append('7-day average');
    const l3 = h('span', {}, legend); h('i', { class: 'key-mark' }, l3); l3.append('Emgality');

    const plot = h('div', { class: 'viz-plot' }, root);
    const svg = h('svg:svg', { class: 'viz-svg', role: 'img', 'aria-label': 'Daily migraine pain chart' }, plot);
    const tip = h('div', { class: 'viz-tip', hidden: '' }, plot);
    h('div', { class: 'viz-hint' }, root, 'Pinch or drag to zoom and scroll · tap a day for details');

    const clipId = `viz-clip-${Math.random().toString(36).slice(2)}`;
    let data = prepare(payload);
    let x0 = data.end - 30, x1 = data.end;
    let W = 300, H = 280, activeRange = 30, tipDay = null, raf = 0;

    const btns = RANGES.map(([label, days]) => {
        const b = h('button', { type: 'button', 'data-days': days }, ranges, label);
        b.addEventListener('click', () => setRange(days));
        return b;
    });

    const plotW = () => W - M.left - M.right;
    const ppd = () => plotW() / (x1 - x0);
    const sx = d => M.left + (d - x0) * ppd();
    const sy = v => M.top + (1 - v / 10) * (H - M.top - M.bottom);
    const fullSpan = () => Math.max(MIN_SPAN, data.end - data.first);

    function clamp() {
        let s = Math.min(Math.max(x1 - x0, MIN_SPAN), fullSpan());
        if (x0 < data.first) x0 = data.first;
        x1 = x0 + s;
        if (x1 > data.end) { x1 = data.end; x0 = x1 - s; }
    }

    function setRange(days) {
        activeRange = days;
        x1 = data.end;
        x0 = days === 0 ? data.first : x1 - days;
        if (days === 0) x0 = Math.min(x0, x1 - MIN_SPAN);
        clamp();
        tipDay = null;
        schedule();
    }

    function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }

    function xTicks() {
        const p = ppd(), out = [];
        const dayStep = [1, 2, 3, 7, 14].find(s => s * p >= 46);
        const lo = Math.ceil(x0), hi = Math.floor(x1);
        if (dayStep) {
            for (let d = lo; d <= hi; d++) if ((d - 4) % dayStep === 0) out.push([d, short(d)]); // weeks start Monday
            return out;
        }
        const mStep = [1, 2, 3, 6, 12].find(s => s * 30.4 * p >= 46) ?? 12;
        const start = utc(lo);
        let y = start.getUTCFullYear(), m = start.getUTCMonth();
        for (; ;) {
            const d = Date.UTC(y, m, 1) / DAY;
            if (d > hi) break;
            if (d >= lo && m % mStep === 0) out.push([d, m === 0 ? `${MONTHS[m]} '${String(y).slice(2)}` : MONTHS[m]]);
            if (++m === 12) { m = 0; y++; }
        }
        return out;
    }

    function render() {
        W = plot.clientWidth || 300;
        H = Math.max(240, Math.min(420, Math.round(W * 0.95)));
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.setAttribute('width', W);
        svg.setAttribute('height', H);
        svg.replaceChildren();
        btns.forEach(b => b.classList.toggle('active', +b.dataset.days === activeRange));

        const y0 = sy(0), p = ppd();
        const grid = h('svg:g', { class: 'viz-grid' }, svg);
        for (let v = 0; v <= 10; v += 2) {
            h('svg:line', { x1: M.left, x2: W - M.right, y1: sy(v), y2: sy(v), class: v === 0 ? 'base' : '' }, grid);
            h('svg:text', { x: M.left - 6, y: sy(v) + 4, 'text-anchor': 'end' }, grid, v);
        }
        for (const [d, label] of xTicks()) {
            h('svg:text', { x: sx(d + 0.5), y: H - 6, 'text-anchor': 'middle' }, grid, label);
        }

        const defs = h('svg:defs', {}, svg);
        const cp = h('svg:clipPath', { id: clipId }, defs);
        h('svg:rect', { x: M.left, y: 0, width: plotW(), height: H }, cp);
        const clip = h('svg:g', { 'clip-path': `url(#${clipId})` }, svg);
        const lo = Math.max(data.first, Math.floor(x0)), hi = Math.min(data.end - 1, Math.ceil(x1));

        // Emgality markers sit on the boundary after the day they follow.
        let lastLabel = Infinity;
        for (const mk of [...data.markers].sort((a, b) => b.d - a.d)) {
            const x = sx(mk.d + 1);
            if (x < M.left - 1 || x > W - M.right + 1) continue;
            h('svg:line', { x1: x, x2: x, y1: M.top - 4, y2: y0, class: 'viz-marker' }, clip);
            if (lastLabel - x < 30) continue;                       // too crowded to label
            const n = (mk.label.match(/\d+(\.\d+)?/g) ?? []).map(Number);
            const atEdge = x > W - M.right - 14;
            h('svg:text', { x, y: M.top - 8, 'text-anchor': atEdge ? 'end' : 'middle', class: 'viz-marker-label' }, svg,
                n.length ? `E${Math.floor(Math.max(...n))}` : 'E');
            lastLabel = x;
        }

        // Bars
        const gap = p >= 6 ? 2 : p >= 3 ? 1 : 0;
        const bw = Math.max(1, p - gap);
        const bars = h('svg:g', { class: 'viz-bars' }, clip);
        for (let d = lo; d <= hi; d++) {
            const v = data.v[d - data.first];
            const info = data.byDay.get(d);
            const x = sx(d) + gap / 2;
            if (v > 0) {
                const top = sy(v), r = Math.min(4, bw / 2, y0 - top);
                h('svg:path', {
                    d: `M${x},${y0}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${y0}Z`,
                    class: d === tipDay ? 'hot' : '',
                }, bars);
            } else if (info && (info.k === 'Sick' || info.k === 'Other') && p >= 3) {
                h('svg:circle', { cx: sx(d + 0.5), cy: y0 - 5, r: Math.min(3, p / 2), class: 'viz-other' }, clip);
            }
        }

        // 7-day average
        if (hi >= lo) {
            let pts = '';
            for (let d = lo; d <= hi; d++) pts += `${sx(d + 0.5).toFixed(1)},${sy(data.avg[d - data.first]).toFixed(1)} `;
            h('svg:polyline', { points: pts, class: 'viz-avg' }, clip);
        }

        if (tipDay != null && tipDay >= lo && tipDay <= hi) {
            const cx = sx(tipDay + 0.5);
            h('svg:line', { x1: cx, x2: cx, y1: M.top, y2: y0, class: 'viz-cross' }, svg);
            h('svg:circle', { cx, cy: sy(data.avg[tipDay - data.first]), r: 4, class: 'viz-avg-dot' }, svg);
        }
        renderTip();
        renderStats(lo, hi);
    }

    function renderTip() {
        if (tipDay == null || tipDay < data.first || tipDay >= data.end) { tip.hidden = true; return; }
        const info = data.byDay.get(tipDay);
        const v = data.v[tipDay - data.first];
        tip.replaceChildren();
        h('div', { class: 'tip-value' }, tip, v > 0 ? `Pain ${fmt(v)}` : info?.k === 'Sick' ? 'Sick' : 'No migraine');
        h('div', { class: 'tip-date' }, tip, long(tipDay));
        for (const t of info?.t ?? []) if (t.trim()) h('div', { class: 'tip-line' }, tip, t);
        if (!info) h('div', { class: 'tip-line' }, tip, 'No entry');
        h('div', { class: 'tip-avg' }, tip, `7-day avg ${fmt(data.avg[tipDay - data.first])}`);
        tip.hidden = false;
        const x = sx(tipDay + 0.5), tw = tip.offsetWidth;
        let left = x + 12;
        if (left + tw > W - 4) left = x - 12 - tw;
        tip.style.left = `${Math.max(4, left)}px`;
    }

    function renderStats(lo, hi) {
        const a = Math.max(lo, Math.ceil(x0 - 0.5)), b = Math.min(hi, Math.floor(x1 - 0.5));
        let days = 0, mig = 0, sum = 0, meds = 0, worst = 0, worstDay = null;
        for (let d = a; d <= b; d++) {
            days++;
            const v = data.v[d - data.first];
            if (v > 0) { mig++; sum += v; if (v > worst) { worst = v; worstDay = d; } }
            meds += data.byDay.get(d)?.meds ?? 0;
        }
        const sameYear = utc(a).getUTCFullYear() === utc(b).getUTCFullYear();
        const from = sameYear ? mid(a) : `${mid(a)}, ${utc(a).getUTCFullYear()}`;
        span.textContent = days ? `${from} – ${mid(b)}, ${utc(b).getUTCFullYear()} · ${days} days` : '';
        tDays.val.textContent = `${mig}`;
        tDays.sub.textContent = days ? `of ${days} · ${Math.round(100 * mig / days)}%` : '';
        tAvg.val.textContent = mig ? fmt(sum / mig) : '–';
        tAvg.sub.textContent = 'on migraine days';
        tMeds.val.textContent = `${meds}`;
        tMeds.sub.textContent = days ? `${fmt(meds / days * 7)} / week` : '';
        tWorst.val.textContent = worst ? fmt(worst) : '–';
        tWorst.sub.textContent = worstDay != null ? short(worstDay) : '';
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
    setRange(30);

    return {
        update(p) {
            const keepEnd = x1 >= data.end - 0.01;
            data = prepare(p);
            if (keepEnd) { const s = x1 - x0; x1 = data.end; x0 = x1 - s; }
            clamp(); schedule();
        },
        dispose() { ro.disconnect(); cancelAnimationFrame(raf); root.replaceChildren(); },
    };
}
