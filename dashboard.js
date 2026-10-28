/* ═══════════════════════════════════════════════════════════
   dashboard.js — Chart.js Visualizations
   Renders all 6 charts + data table + KPI cards
═══════════════════════════════════════════════════════════ */

const Dashboard = (() => {

  /* ── Palette ────────────────────────────────────────────── */
  const PALETTE = [
    '#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4',
    '#ec4899','#6366f1','#84cc16','#f97316','#14b8a6','#a855f7',
    '#eab308','#0ea5e9','#22c55e','#fb923c','#e11d48','#7c3aed',
  ];

  const CHART_DEFAULTS = {
    color: '#94a3b8',
    borderColor: 'rgba(255,255,255,0.07)',
    font: { family: "'Inter', sans-serif", size: 11 },
  };

  Chart.defaults.color = CHART_DEFAULTS.color;
  Chart.defaults.borderColor = CHART_DEFAULTS.borderColor;
  Chart.defaults.font.family = CHART_DEFAULTS.font.family;

  /* ── State ──────────────────────────────────────────────── */
  let charts = {};
  let currentData = null;
  let sortCol = 'rank', sortDir = 'asc';
  let productOrientation = 'y'; // 'y' = vertical bars, 'x' = horizontal

  /* ── Format helpers ─────────────────────────────────────── */
  function fmtVal(v) {
    if (v === null || v === undefined) return '—';
    const abs = Math.abs(v);
    if (abs >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return v.toFixed(0);
  }

  function fmtPPG(v) {
    if (v === null || v === undefined) return '—';
    const s = v >= 0 ? '+' : '';
    return s + v.toFixed(1) + '%';
  }

  function fmtMS(v) {
    if (!v && v !== 0) return '—';
    return v.toFixed(1) + '%';
  }

  function ppgClass(v) {
    if (v === null || v === undefined) return 'ppg-neu';
    if (v > 0) return 'ppg-pos';
    if (v < 0) return 'ppg-neg';
    return 'ppg-neu';
  }

  function rankClass(r) {
    if (r === 1) return 'rk-1';
    if (r === 2) return 'rk-2';
    if (r === 3) return 'rk-3';
    return 'rk-x';
  }

  /* ── Destroy all charts ─────────────────────────────────── */
  function destroyAll() {
    Object.values(charts).forEach(c => { try { c.destroy(); } catch(e){} });
    charts = {};
  }

  /* ── Main render ────────────────────────────────────────── */
  function render(data) {
    currentData = data;
    destroyAll();
    renderKPI(data);
    renderProductsChart(data);
    renderDonut(data);
    renderPPG(data);
    renderManufacturer(data);
    renderBubble(data);
    populateTrendSelect(data);
    renderTrend(data, '__total__');
    renderTable(data);
  }

  /* ── KPI Cards ──────────────────────────────────────────── */
  function renderKPI(data) {
    const { summary } = data;
    const metric = App.state.metric;
    const isVal = metric === 'value';

    const cards = [
      {
        icon: '💰', label: `Defined Market Sales (${summary.periodFull26})`,
        val: fmtVal(isVal ? summary.totalV26 : summary.totalU26) + (isVal ? ' EGP' : ' units'),
        change: isVal ? summary.mktPpgV : summary.mktPpgU,
        sub: `vs ${fmtVal(isVal ? summary.totalV25 : summary.totalU25)} (${summary.periodFull25})`,
      },
      {
        icon: '📈', label: `Defined Market PPG% (${isVal ? 'Value' : 'Volume'})`,
        val: fmtPPG(isVal ? summary.mktPpgV : summary.mktPpgU),
        change: isVal ? summary.mktPpgV : summary.mktPpgU,
        sub: `${summary.periodLabel}`,
      },
      {
        icon: '💊', label: 'Defined Market Products',
        val: summary.productCount,
        change: null,
        sub: `${summary.mfrCount} manufacturers`,
      },
      {
        icon: '🏆', label: `Top Brand Defined MS% (${isVal ? 'Value' : 'Volume'})`,
        val: fmtMS(isVal ? data.products[0]?.msv : data.products[0]?.msu),
        change: null,
        sub: data.products[0]?.product || '',
      },
      {
        icon: '🏭', label: 'Top Manufacturer',
        val: data.manufacturers[0]?.manufacturer?.split(' ')[0] || '—',
        change: data.manufacturers[0]?.ppgv,
        sub: fmtVal(data.manufacturers[0]?.ytd26v) + ' EGP in period',
      },
      {
        icon: '📅', label: 'Comparison Period',
        val: summary.periodName,
        change: null,
        sub: '2026 vs. 2025 (Same Period)',
      },
    ];

    const grid = document.getElementById('kpi-grid');
    grid.innerHTML = cards.map(c => {
      const chg = c.change;
      const cls = chg === null ? 'neu' : (chg >= 0 ? 'pos' : 'neg');
      const arrow = chg === null ? '' : (chg >= 0 ? '▲' : '▼');
      return `
        <div class="kpi-card">
          <span class="kpi-icon">${c.icon}</span>
          <div class="kpi-label">${c.label}</div>
          <div class="kpi-value">${c.val}</div>
          <div class="kpi-change ${cls}">${arrow} ${chg !== null ? fmtPPG(chg) : ''}</div>
          <div class="kpi-sub">${c.sub}</div>
        </div>`;
    }).join('');
  }

  /* ── Products Bar Chart with PPG% beside bars ────────────── */
  function renderProductsChart(data) {
    const metric = App.state.metric;
    const isVal = metric === 'value';
    const topN = App.state.topN;
    const filtered = getFilteredProducts(data).slice(0, topN);
    const labels = filtered.map(p => p.product);
    const d26 = filtered.map(p => isVal ? p.ytd26v : p.ytd26u);
    const d25 = filtered.map(p => isVal ? p.ytd25v : p.ytd25u);

    const ctx = document.getElementById('ch-products');
    if (!ctx) return;

    const isHoriz = productOrientation === 'x';
    const indexAxis = isHoriz ? 'y' : 'x';

    const titleEl = document.getElementById('prod-chart-title');
    if (titleEl) titleEl.textContent = `${isVal ? 'Value (EGP)' : 'Volume (Units)'} by Defined Product with PPG% — ${data.summary.periodLabel}`;

    charts.products = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: `${data.summary.periodName} 2026`,
            data: d26,
            backgroundColor: 'rgba(59,130,246,0.85)',
            borderColor: '#3b82f6',
            borderWidth: 1,
            borderRadius: 4,
            borderSkipped: false
          },
          {
            label: `${data.summary.periodName} 2025`,
            data: d25,
            backgroundColor: 'rgba(100,116,139,0.5)',
            borderColor: '#64748b',
            borderWidth: 1,
            borderRadius: 4,
            borderSkipped: false
          },
        ],
      },
      options: {
        indexAxis,
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: {
            right: isHoriz ? 60 : 14,
            top: !isHoriz ? 32 : 12,
            bottom: !isHoriz ? 26 : 10,
            left: isHoriz ? 14 : 6
          }
        },
        plugins: {
          legend: { position: 'top', labels: { padding: 16, usePointStyle: true, pointStyle: 'circle' } },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${fmtVal(ctx.raw)} ${isVal ? 'EGP' : 'units'}`,
              afterBody: (items) => {
                const idx = items[0]?.dataIndex;
                const p = filtered[idx];
                if (!p) return [];
                const ppgVal = isVal ? p.ppgv : p.ppgu;
                const msVal = isVal ? p.msv : p.msu;
                return [
                  ` Defined MS%: ${fmtMS(msVal)}`,
                  ` PPG%: ${fmtPPG(ppgVal)}`
                ];
              }
            },
          },
          datalabels: {
            display: (ctx) => ctx.datasetIndex === 0, // Show PPG% directly beside YTD 2026 bar
            anchor: 'end',
            align: isHoriz ? 'right' : 'top',
            offset: 4,
            clip: false,
            color: (ctx) => {
              const p = filtered[ctx.dataIndex];
              if (!p) return '#94a3b8';
              const ppgVal = isVal ? p.ppgv : p.ppgu;
              if (ppgVal === null || ppgVal === undefined) return '#94a3b8';
              return ppgVal >= 0 ? '#34d399' : '#f87171';
            },
            backgroundColor: 'rgba(15, 23, 42, 0.88)',
            borderColor: (ctx) => {
              const p = filtered[ctx.dataIndex];
              if (!p) return 'transparent';
              const ppgVal = isVal ? p.ppgv : p.ppgu;
              return ppgVal >= 0 ? 'rgba(52, 211, 153, 0.45)' : 'rgba(248, 113, 113, 0.45)';
            },
            borderWidth: 1,
            borderRadius: 4,
            padding: { top: 2, bottom: 2, left: 5, right: 5 },
            font: {
              size: 10,
              weight: 'bold',
              family: "'Inter', sans-serif"
            },
            formatter: (value, ctx) => {
              const p = filtered[ctx.dataIndex];
              if (!p) return '';
              const ppgVal = isVal ? p.ppgv : p.ppgu;
              return ppgVal !== null && ppgVal !== undefined ? fmtPPG(ppgVal) : '—';
            }
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: {
              autoSkip: false, // Ensures EVERY brand name appears below its sales bar
              maxRotation: isHoriz ? 0 : 50,
              minRotation: isHoriz ? 0 : 30,
              font: {
                size: filtered.length > 20 ? 9 : 10,
                weight: '700',
                family: "'Inter', sans-serif"
              },
              color: '#cbd5e1',
              callback: isHoriz ? (v) => fmtVal(v) : function(val, index) {
                const lbl = this.getLabelForValue(val);
                return lbl !== undefined ? lbl : (filtered[index]?.product || '');
              }
            },
            grace: isHoriz ? '15%' : undefined,
          },
          y: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: {
              autoSkip: false,
              font: {
                size: 10,
                weight: '600',
                family: "'Inter', sans-serif"
              },
              color: '#cbd5e1',
              callback: !isHoriz ? (v) => fmtVal(v) : function(val, index) {
                const lbl = this.getLabelForValue(val);
                return lbl !== undefined ? lbl : (filtered[index]?.product || '');
              }
            },
            grace: !isHoriz ? '15%' : undefined,
          },
        },
      },
    });
  }

  function setProductOrientation(axis) {
    productOrientation = axis;
    document.querySelectorAll('#cbtn-vert, #cbtn-horiz').forEach(b => b.classList.remove('active'));
    document.getElementById(axis === 'y' ? 'cbtn-vert' : 'cbtn-horiz')?.classList.add('active');
    if (currentData) { charts.products?.destroy(); delete charts.products; renderProductsChart(currentData); }
  }

  /* ── Market Share Donut ─────────────────────────────────── */
  function renderDonut(data) {
    const metric = App.state.metric;
    const isVal = metric === 'value';
    const topN = Math.min(10, App.state.topN);
    const filtered = getFilteredProducts(data).slice(0, topN);

    const others = getFilteredProducts(data).slice(topN);
    const othersTotal = others.reduce((s, p) => s + (isVal ? p.msv : p.msu), 0);

    const labels = filtered.map(p => p.product);
    const values = filtered.map(p => isVal ? p.msv : p.msu);
    if (othersTotal > 0.1) { labels.push('Others'); values.push(othersTotal); }

    const colors = labels.map((_, i) => PALETTE[i % PALETTE.length]);

    const ctx = document.getElementById('ch-donut');
    if (!ctx) return;

    const sub = document.getElementById('ms-sub');
    if (sub) sub.textContent = `by ${isVal ? 'Value' : 'Volume'}`;

    charts.donut = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#1a2235', hoverOffset: 8 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => ` ${c.label}: ${fmtMS(c.raw)}` } },
          datalabels: {
            display: ctx => ctx.dataset.data[ctx.dataIndex] > 3,
            color: '#fff', font: { size: 10, weight: 'bold' },
            formatter: v => fmtMS(v),
          },
        },
      },
    });

    // Custom legend
    const leg = document.getElementById('donut-legend');
    if (leg) {
      leg.innerHTML = labels.map((l, i) =>
        `<div class="dl-item"><div class="dl-dot" style="background:${colors[i]}"></div><span>${l} (${fmtMS(values[i])})</span></div>`
      ).join('');
    }
  }

  /* ── PPG% Bar ───────────────────────────────────────────── */
  function renderPPG(data) {
    const metric = App.state.metric;
    const isVal = metric === 'value';
    const topN = App.state.topN;
    const filtered = getFilteredProducts(data).slice(0, topN);

    const labels = filtered.map(p => p.product);
    const ppgVals = filtered.map(p => isVal ? p.ppgv : p.ppgu);
    const colors = ppgVals.map(v => v === null ? '#64748b' : v >= 0 ? 'rgba(16,185,129,0.8)' : 'rgba(239,68,68,0.8)');

    const ctx = document.getElementById('ch-ppg');
    if (!ctx) return;

    charts.ppg = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: `${isVal ? 'Value' : 'Volume'} PPG%`,
          data: ppgVals,
          backgroundColor: colors,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => ` PPG%: ${fmtPPG(c.raw)}` } },
          datalabels: {
            display: true, anchor: ctx => ctx.dataset.data[ctx.dataIndex] >= 0 ? 'end' : 'start',
            align: ctx => ctx.dataset.data[ctx.dataIndex] >= 0 ? 'top' : 'bottom',
            color: ctx => ctx.dataset.data[ctx.dataIndex] >= 0 ? '#34d399' : '#f87171',
            font: { size: 9, weight: 'bold' },
            formatter: v => v !== null ? fmtPPG(v) : '',
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: {
              autoSkip: false,
              maxRotation: 50,
              minRotation: 25,
              font: { size: filtered.length > 20 ? 9 : 10, weight: '700' },
              color: '#cbd5e1'
            }
          },
          y: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { callback: v => v + '%' },
            suggestedMin: -30,
          },
        },
      },
    });
  }

  /* ── Manufacturer Chart ─────────────────────────────────── */
  function renderManufacturer(data) {
    const metric = App.state.metric;
    const isVal = metric === 'value';
    const mfrs = getFilteredManufacturers(data).slice(0, 12);

    const labels = mfrs.map(m => m.manufacturer);
    const d26 = mfrs.map(m => isVal ? m.ytd26v : m.ytd26u);
    const d25 = mfrs.map(m => isVal ? m.ytd25v : m.ytd25u);
    const ppgVals = mfrs.map(m => isVal ? m.ppgv : m.ppgu);

    const ctx = document.getElementById('ch-mfr');
    if (!ctx) return;

    charts.mfr = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: `${data.summary.periodName} 2026`, data: d26, backgroundColor: mfrs.map((_, i) => PALETTE[i % PALETTE.length] + 'cc'), borderRadius: 4 },
          { label: `${data.summary.periodName} 2025`, data: d25, backgroundColor: 'rgba(100,116,139,0.4)', borderRadius: 4 },
        ],
      },
      options: {
        indexAxis: 'y',
        layout: { padding: { right: 55 } },
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12 } },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${fmtVal(ctx.raw)} ${isVal ? 'EGP' : 'units'}`,
              afterLabel: (ctx) => {
                const mfr = mfrs[ctx.dataIndex];
                if (ctx.datasetIndex === 0 && mfr) return ` PPG%: ${fmtPPG(isVal ? mfr.ppgv : mfr.ppgu)}`;
                return '';
              },
            },
          },
          datalabels: {
            display: (ctx) => ctx.datasetIndex === 0,
            anchor: 'end',
            align: 'right',
            offset: 4,
            clip: false,
            color: (ctx) => {
              const mfr = mfrs[ctx.dataIndex];
              const ppgVal = isVal ? mfr?.ppgv : mfr?.ppgu;
              return ppgVal >= 0 ? '#34d399' : '#f87171';
            },
            backgroundColor: 'rgba(15, 23, 42, 0.88)',
            borderColor: (ctx) => {
              const mfr = mfrs[ctx.dataIndex];
              const ppgVal = isVal ? mfr?.ppgv : mfr?.ppgu;
              return ppgVal >= 0 ? 'rgba(52, 211, 153, 0.45)' : 'rgba(248, 113, 113, 0.45)';
            },
            borderWidth: 1,
            borderRadius: 4,
            padding: { top: 2, bottom: 2, left: 5, right: 5 },
            font: { size: 10, weight: 'bold', family: "'Inter', sans-serif" },
            formatter: (value, ctx) => {
              const mfr = mfrs[ctx.dataIndex];
              const ppgVal = isVal ? mfr?.ppgv : mfr?.ppgu;
              return ppgVal !== null && ppgVal !== undefined ? fmtPPG(ppgVal) : '—';
            }
          },
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: v => fmtVal(v) }, grace: '15%' },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { font: { size: 10 } } },
        },
      },
    });
  }

  /* ── Bubble Chart (MS% vs PPG%) ─────────────────────────── */
  function renderBubble(data) {
    const metric = App.state.metric;
    const isVal = metric === 'value';
    const filtered = getFilteredProducts(data);
    if (!filtered.length) return;

    const maxSales = Math.max(...filtered.map(p => isVal ? p.ytd26v : p.ytd26u));

    // Group by manufacturer for colors
    const mfrList = [...new Set(filtered.map(p => p.manufacturer))];
    const mfrColor = {};
    mfrList.forEach((m, i) => { mfrColor[m] = PALETTE[i % PALETTE.length]; });

    const datasets = mfrList.map(mfr => {
      const prods = filtered.filter(p => p.manufacturer === mfr);
      return {
        label: mfr,
        data: prods.map(p => ({
          x: isVal ? p.msv : p.msu,
          y: isVal ? p.ppgv : p.ppgu,
          r: Math.max(5, Math.round(((isVal ? p.ytd26v : p.ytd26u) / maxSales) * 28)),
          product: p.product,
          ms: isVal ? p.msv : p.msu,
          ppg: isVal ? p.ppgv : p.ppgu,
        })),
        backgroundColor: mfrColor[mfr] + '88',
        borderColor: mfrColor[mfr],
        borderWidth: 1.5,
      };
    });

    const ctx = document.getElementById('ch-bubble');
    if (!ctx) return;

    charts.bubble = new Chart(ctx, {
      type: 'bubble',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: mfrList.length <= 8, position: 'top', labels: { font: { size: 10 }, usePointStyle: true, pointStyle: 'circle' } },
          tooltip: {
            callbacks: {
              label: ctx => {
                const d = ctx.raw;
                return [` ${d.product}`, ` MS%: ${fmtMS(d.ms)}`, ` PPG%: ${fmtPPG(d.ppg)}`];
              },
            },
          },
          datalabels: { display: false },
          annotation: {},
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            title: { display: true, text: `MS% (${isVal ? 'Value' : 'Volume'})`, color: '#64748b' },
            ticks: { callback: v => v + '%' },
          },
          y: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            title: { display: true, text: 'PPG%', color: '#64748b' },
            ticks: { callback: v => v + '%' },
          },
        },
      },
    });
  }

  /* ── Trend Line Chart ───────────────────────────────────── */
  function renderTrend(data, productKey) {
    const metric = App.state.metric;
    const isVal = metric === 'value';
    const ytdMo = data.summary.ytdMonth;
    const labels = Analytics.MONTH_LABELS.slice(0, ytdMo);

    let d26, d25, title;

    if (productKey === '__total__') {
      d26 = data.marketTrend26.map(d => isVal ? d.value : d.units);
      d25 = data.marketTrend25.map(d => isVal ? d.value : d.units);
      title = 'Total Market';
    } else {
      const prod = data.products.find(p => p.product === productKey);
      if (!prod) return;
      d26 = prod.trend26.map(d => isVal ? d.value : d.units);
      d25 = prod.trend25.map(d => isVal ? d.value : d.units);
      title = prod.product;
    }

    const ctx = document.getElementById('ch-trend');
    if (!ctx) return;

    if (charts.trend) { charts.trend.destroy(); delete charts.trend; }

    charts.trend = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '2026', data: d26,
            borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.12)',
            tension: 0.4, fill: true, pointRadius: 4, pointBackgroundColor: '#3b82f6', borderWidth: 2.5,
          },
          {
            label: '2025', data: d25,
            borderColor: '#64748b', backgroundColor: 'rgba(100,116,139,0.08)',
            tension: 0.4, fill: true, pointRadius: 3, pointBackgroundColor: '#64748b', borderWidth: 1.5, borderDash: [5, 3],
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle' } },
          tooltip: {
            mode: 'index', intersect: false,
            callbacks: { label: c => ` ${c.dataset.label}: ${fmtVal(c.raw)} ${isVal ? 'EGP' : 'units'}` },
          },
          datalabels: { display: false },
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: v => fmtVal(v) } },
        },
        interaction: { mode: 'index', intersect: false },
      },
    });
  }

  function updateTrend(val) {
    if (currentData) renderTrend(currentData, val);
  }

  function populateTrendSelect(data) {
    const sel = document.getElementById('trend-select');
    if (!sel) return;
    const curVal = sel.value;
    const products = getFilteredProducts(data);
    sel.innerHTML = '<option value="__total__">Total Market</option>' +
      products.map(p =>
        `<option value="${p.product}">${p.product}</option>`
      ).join('');
    if (products.some(p => p.product === curVal)) {
      sel.value = curVal;
    } else {
      sel.value = '__total__';
    }
  }

  /* ── Data Table ─────────────────────────────────────────── */
  function renderTable(data) {
    const filtered = getFilteredProducts(data);
    const sorted = sortProducts([...filtered]);

    document.getElementById('tbl-count').textContent = `${sorted.length} products`;

    // Dynamic period column headers
    const pName = data.summary.periodName || 'Period';
    const thV26 = document.getElementById('th-val26');
    const thV25 = document.getElementById('th-val25');
    const thU26 = document.getElementById('th-vol26');
    const thU25 = document.getElementById('th-vol25');
    if (thV26) thV26.innerHTML = `${pName} 2026 Value <span class="sort-icon"></span>`;
    if (thV25) thV25.innerHTML = `${pName} 2025 Value <span class="sort-icon"></span>`;
    if (thU26) thU26.innerHTML = `${pName} 2026 Units <span class="sort-icon"></span>`;
    if (thU25) thU25.innerHTML = `${pName} 2025 Units <span class="sort-icon"></span>`;

    const maxMsv = Math.max(...sorted.map(p => p.msv), 0.01);
    const maxMsu = Math.max(...sorted.map(p => p.msu), 0.01);

    const tbody = document.getElementById('tbl-body');
    if (!tbody) return;

    tbody.innerHTML = sorted.map(p => `
      <tr>
        <td><span class="rank-cell ${rankClass(p.rank)}">${p.rank}</span></td>
        <td class="brand-cell">${p.product}</td>
        <td><span class="mfr-tag">${p.manufacturer || '—'}</span></td>
        <td class="mol-cell">${p.molecule || '—'}</td>
        <td>${fmtVal(p.ytd26v)}</td>
        <td>${fmtVal(p.ytd25v)}</td>
        <td class="${ppgClass(p.ppgv)}">${fmtPPG(p.ppgv)}</td>
        <td>${fmtVal(p.ytd26u)}</td>
        <td>${fmtVal(p.ytd25u)}</td>
        <td class="${ppgClass(p.ppgu)}">${fmtPPG(p.ppgu)}</td>
        <td>
          <div class="ms-wrap">
            <div class="ms-bar-bg"><div class="ms-bar-fill" style="width:${(p.msv/maxMsv)*100}%;background:#3b82f6"></div></div>
            <span>${fmtMS(p.msv)}</span>
          </div>
        </td>
        <td>
          <div class="ms-wrap">
            <div class="ms-bar-bg"><div class="ms-bar-fill" style="width:${(p.msu/maxMsu)*100}%;background:#10b981"></div></div>
            <span>${fmtMS(p.msu)}</span>
          </div>
        </td>
      </tr>`).join('');

    // Update sort indicators
    document.querySelectorAll('.th-sort').forEach(th => {
      th.classList.remove('sorted-asc','sorted-desc');
      if (th.dataset.col === sortCol) {
        th.classList.add(sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
      }
    });
  }

  function sortTable(col) {
    if (sortCol === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortCol = col; sortDir = col === 'rank' || col === 'product' || col === 'manufacturer' ? 'asc' : 'desc'; }
    if (currentData) renderTable(currentData);
  }

  function sortProducts(arr) {
    const dir = sortDir === 'asc' ? 1 : -1;
    const colMap = {
      rank: p => p.rank,
      product: p => p.product,
      manufacturer: p => p.manufacturer || '',
      ytd26v: p => p.ytd26v,
      ytd25v: p => p.ytd25v,
      ppgv: p => p.ppgv ?? -999,
      ytd26u: p => p.ytd26u,
      ytd25u: p => p.ytd25u,
      ppgu: p => p.ppgu ?? -999,
      msv: p => p.msv,
      msu: p => p.msu,
    };
    const fn = colMap[sortCol] || (p => p.rank);
    return arr.sort((a, b) => {
      const av = fn(a), bv = fn(b);
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }

  /* ── Filtering helpers ──────────────────────────────────── */
  function getFilteredProducts(data) {
    let prods = data.products;

    // Manufacturer filter
    const activeMfrs = App.state.activeMfrs;
    if (activeMfrs.size > 0) {
      prods = prods.filter(p => activeMfrs.has(p.manufacturer));
    }

    // Molecule filter
    const activeMols = App.state.activeMols;
    if (activeMols.size > 0) {
      prods = prods.filter(p => activeMols.has(p.molecule));
    }

    // Search filter
    const q = (App.state.search || '').toLowerCase();
    if (q) {
      prods = prods.filter(p => p.product.toLowerCase().includes(q));
    }

    return prods;
  }

  function getFilteredManufacturers(data) {
    const activeMfrs = App.state.activeMfrs;
    if (activeMfrs.size === 0) return data.manufacturers;
    return data.manufacturers.filter(m => activeMfrs.has(m.manufacturer));
  }

  /* ── Refresh all charts with current filters ────────────── */
  function refresh(data) {
    currentData = data;
    renderKPI(data);
    if (charts.products) { charts.products.destroy(); delete charts.products; } renderProductsChart(data);
    if (charts.donut) { charts.donut.destroy(); delete charts.donut; } renderDonut(data);
    if (charts.ppg) { charts.ppg.destroy(); delete charts.ppg; } renderPPG(data);
    if (charts.mfr) { charts.mfr.destroy(); delete charts.mfr; } renderManufacturer(data);
    if (charts.bubble) { charts.bubble.destroy(); delete charts.bubble; } renderBubble(data);
    populateTrendSelect(data);
    const trendSel = document.getElementById('trend-select');
    renderTrend(data, trendSel?.value || '__total__');
    renderTable(data);
  }

  return {
    render,
    refresh,
    setProductOrientation,
    updateTrend,
    sortTable,
    getFilteredProducts,
  };
})();
