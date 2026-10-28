/* ═══════════════════════════════════════════════════════════
   analytics.js — KPI Engine
   Handles: data parsing, merging, YTD, PPG%, MS%, ranking
═══════════════════════════════════════════════════════════ */

const Analytics = (() => {

  const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const YTD_MONTH = 10; // October — auto-detected from current date

  /* ── Month column detection ─────────────────────────────── */
  function parseMonthCol(header) {
    const h = String(header).trim();
    const hl = h.toLowerCase();

    let monthNum = -1, year = -1, type = null;

    // Detect month
    for (let i = 0; i < MONTHS.length; i++) {
      if (hl.includes(MONTHS[i])) { monthNum = i + 1; break; }
    }
    if (monthNum === -1) return null;

    // Detect year — full 4-digit preferred
    let m = hl.match(/20(\d{2})/);
    if (m) { year = 2000 + parseInt(m[1]); }
    else {
      // short year like "-25" or " 25"
      m = hl.match(/[-_\s\/](\d{2})(?:\b|$)/);
      if (m) { year = 2000 + parseInt(m[1]); }
    }
    if (year === -1) return null;

    // Detect type
    if (/\bunit|\bqty|\bvol|\bunits\b|\bu\b|\bpacks?\b/i.test(h)) type = 'units';
    else if (/\bval|\bvalue|\bsales|\begp|\ble\b|\brevenue|\bv\b/i.test(h)) type = 'value';

    return { col: header, monthNum, year, type };
  }

  function detectMonthCols(headers) {
    return headers.map(parseMonthCol).filter(Boolean);
  }

  /* ── Best guess for attribute columns ──────────────────── */
  function guessCol(headers, patterns) {
    for (const pat of patterns) {
      const re = new RegExp(pat, 'i');
      const found = headers.find(h => re.test(String(h).trim()));
      if (found !== undefined) return found;
    }
    return headers[0] || '';
  }

  function guessProductCol(headers) {
    return guessCol(headers, [
      'brand','product\\s*name','trade\\s*name','product','item','drug'
    ]);
  }

  function guessMfrCol(headers) {
    return guessCol(headers, [
      'manufacturer','company','mfr','corp','maker','pharma','lab'
    ]);
  }

  function guessMolCol(headers) {
    return guessCol(headers, ['molecule','active\\s*ingredient','api','generic']);
  }

  function guessFormCol(headers) {
    return guessCol(headers, ['form','dosage\\s*form','pharma\\s*form']);
  }

  /* ── Data merging ──────────────────────────────────────── */
  function mergeData(dmRows, dsRows, mapping) {
    const {
      dmProductCol, dmMfrCol, dmMolCol, dmFormCol,
      dsProductCol, dsMfrCol,
      dmMonths, dsMonths
    } = mapping;

    // Fast Map-based indexing of DS by normalised product name (supports multiple packs/SKUs per brand)
    const dsIndex = new Map();
    for (let i = 0; i < dsRows.length; i++) {
      const row = dsRows[i];
      const prodName = row[dsProductCol];
      if (!prodName) continue;
      const key = normalise(prodName);
      if (!key) continue;
      let list = dsIndex.get(key);
      if (!list) {
        list = [];
        dsIndex.set(key, list);
      }
      list.push(row);
    }

    const merged = [];
    let updateCount = 0;
    const seenDmKeys = new Set();

    for (const dmRow of dmRows) {
      const productName = String(dmRow[dmProductCol] || '').trim();
      if (!productName) continue;

      const key = normalise(productName);
      if (seenDmKeys.has(key)) continue;
      seenDmKeys.add(key);

      const dsList = dsIndex.get(key);

      const entry = {
        product: productName,
        manufacturer: (dmMfrCol && dmMfrCol !== dmProductCol) ? String(dmRow[dmMfrCol] || '').trim() : '',
        molecule: dmMolCol ? String(dmRow[dmMolCol] || '').trim() : '',
        form: dmFormCol ? String(dmRow[dmFormCol] || '').trim() : '',
        months: {}, // {year: {month: {units, value}}}
        updated: false,
      };

      // Load existing DM month data
      for (const mc of dmMonths) {
        const y = mc.year, mo = mc.monthNum;
        if (!entry.months[y]) entry.months[y] = {};
        if (!entry.months[y][mo]) entry.months[y][mo] = { units: 0, value: 0 };
        const raw = dmRow[mc.col];
        const val = parseFloat(raw) || 0;
        if (mc.type === 'units') entry.months[y][mo].units = val;
        else if (mc.type === 'value') entry.months[y][mo].value = val;
      }

      // Aggregate DS data if product found in Data Source (handles multiple packs/sectors)
      if (dsList && dsList.length) {
        for (let i = 0; i < dsList.length; i++) {
          const dsRow = dsList[i];
          for (const mc of dsMonths) {
            const y = mc.year, mo = mc.monthNum;
            if (!entry.months[y]) entry.months[y] = {};
            if (!entry.months[y][mo]) entry.months[y][mo] = { units: 0, value: 0 };
            const raw = dsRow[mc.col];
            if (raw !== undefined && raw !== null && raw !== '') {
              const val = parseFloat(raw) || 0;
              if (mc.type === 'units') entry.months[y][mo].units += val;
              else if (mc.type === 'value') entry.months[y][mo].value += val;
            }
          }
          // Grab manufacturer from DS if not in DM
          if (!entry.manufacturer && dsMfrCol && dsRow[dsMfrCol]) {
            entry.manufacturer = String(dsRow[dsMfrCol]).trim();
          }
        }
        entry.updated = true;
        updateCount++;
      }

      merged.push(entry);
    }

    const excludedDsCount = Math.max(0, dsRows.length - updateCount);
    return {
      products: merged,
      updateCount,
      totalDmCount: dmRows.length,
      excludedDsCount,
      matchRate: dmRows.length ? updateCount / dmRows.length : 0
    };
  }

  /* ── Period Sales calculation (e.g. Jan–Jun 2026 vs Jan–Jun 2025) ── */
  function periodSales(product, year, startMo = 1, endMo = 10) {
    const y = product.months[year];
    if (!y) return { units: 0, value: 0 };
    let units = 0, value = 0;
    for (let m = startMo; m <= endMo; m++) {
      const d = y[m] || { units: 0, value: 0 };
      units += d.units;
      value += d.value;
    }
    return { units, value };
  }

  /* ── Legacy ytd wrapper ─────────────────────────────────── */
  function ytd(product, year, upTo) {
    return periodSales(product, year, 1, upTo);
  }

  /* ── PPG% ───────────────────────────────────────────────── */
  function ppg(curr, prev) {
    if (!prev || prev === 0) return null;
    return ((curr / prev) - 1) * 100;
  }

  /* ── Monthly trend array ────────────────────────────────── */
  function trend(product, year, upTo) {
    const arr = [];
    const y = product.months[year] || {};
    for (let m = 1; m <= upTo; m++) {
      const d = y[m] || { units: 0, value: 0 };
      arr.push(d);
    }
    return arr;
  }

  /* ── Full analytics calculation with same-period comparison ── */
  function calculate(mergedProducts, startMonth = 1, endMonth = 10) {
    const startMo = Math.min(parseInt(startMonth) || 1, parseInt(endMonth) || 10);
    const endMo = Math.max(parseInt(startMonth) || 1, parseInt(endMonth) || 10);

    // Period label formatting
    let periodName = '';
    if (startMo === 1 && endMo === 6) periodName = 'H1 (Jan–Jun)';
    else if (startMo === 1 && endMo === 3) periodName = 'Q1 (Jan–Mar)';
    else if (startMo === 1 && endMo === 9) periodName = 'Q3 (Jan–Sep)';
    else if (startMo === 1 && endMo === 12) periodName = 'Full Year (Jan–Dec)';
    else if (startMo === 1) periodName = `YTD Jan–${MONTH_LABELS[endMo - 1]}`;
    else periodName = `${MONTH_LABELS[startMo - 1]}–${MONTH_LABELS[endMo - 1]}`;

    const periodFull26 = `${periodName} 2026`;
    const periodFull25 = `${periodName} 2025`;

    // Per-product KPIs for the EXACT SAME period each year
    const products = mergedProducts.map(p => {
      const c = periodSales(p, 2026, startMo, endMo);
      const prev = periodSales(p, 2025, startMo, endMo);

      return {
        ...p,
        ytd26v: c.value, ytd26u: c.units,
        ytd25v: prev.value, ytd25u: prev.units,
        ppgv: ppg(c.value, prev.value),
        ppgu: ppg(c.units, prev.units),
        msv: 0, msu: 0, // filled below
        rank: 0,
        trend26: trend(p, 2026, endMo),
        trend25: trend(p, 2025, endMo),
      };
    });

    // Market totals for the selected period
    const totalV26 = products.reduce((s, p) => s + p.ytd26v, 0);
    const totalU26 = products.reduce((s, p) => s + p.ytd26u, 0);
    const totalV25 = products.reduce((s, p) => s + p.ytd25v, 0);
    const totalU25 = products.reduce((s, p) => s + p.ytd25u, 0);

    // Defined Market PPG% for the selected period
    const mktPpgV = ppg(totalV26, totalV25);
    const mktPpgU = ppg(totalU26, totalU25);

    // MS% within Defined Market for the selected period
    products.forEach(p => {
      p.msv = totalV26 ? (p.ytd26v / totalV26) * 100 : 0;
      p.msu = totalU26 ? (p.ytd26u / totalU26) * 100 : 0;
    });

    products.sort((a, b) => b.ytd26v - a.ytd26v);
    products.forEach((p, i) => { p.rank = i + 1; });

    // Monthly market trend up to endMo
    const marketTrend26 = [];
    const marketTrend25 = [];
    for (let m = 1; m <= endMo; m++) {
      let v26 = 0, v25 = 0, u26 = 0, u25 = 0;
      mergedProducts.forEach(p => {
        const d26 = (p.months[2026] || {})[m] || { units: 0, value: 0 };
        const d25 = (p.months[2025] || {})[m] || { units: 0, value: 0 };
        v26 += d26.value; u26 += d26.units;
        v25 += d25.value; u25 += d25.units;
      });
      marketTrend26.push({ units: u26, value: v26 });
      marketTrend25.push({ units: u25, value: v25 });
    }

    // By manufacturer for the selected period
    const mfrMap = {};
    products.forEach(p => {
      const mfr = p.manufacturer || 'Unknown';
      if (!mfrMap[mfr]) mfrMap[mfr] = { manufacturer: mfr, ytd26v: 0, ytd26u: 0, ytd25v: 0, ytd25u: 0, count: 0 };
      mfrMap[mfr].ytd26v += p.ytd26v;
      mfrMap[mfr].ytd26u += p.ytd26u;
      mfrMap[mfr].ytd25v += p.ytd25v;
      mfrMap[mfr].ytd25u += p.ytd25u;
      mfrMap[mfr].count++;
    });
    const manufacturers = Object.values(mfrMap).sort((a, b) => b.ytd26v - a.ytd26v);
    manufacturers.forEach(m => {
      m.ppgv = ppg(m.ytd26v, m.ytd25v);
      m.ppgu = ppg(m.ytd26u, m.ytd25u);
      m.msv = totalV26 ? (m.ytd26v / totalV26) * 100 : 0;
    });

    return {
      products,
      manufacturers,
      marketTrend26,
      marketTrend25,
      summary: {
        totalV26, totalV25, totalU26, totalU25,
        mktPpgV, mktPpgU,
        productCount: products.length,
        startMonth: startMo,
        endMonth: endMo,
        periodName,
        periodFull26,
        periodFull25,
        periodLabel: `${periodName} 2026 vs. 2025`,
        ytdMonth: endMo,
        ytdLabel: MONTH_LABELS[endMo - 1],
        mfrCount: manufacturers.length,
      }
    };
  }

  /* ── Normalise product name for matching ────────────────── */
  function normalise(str) {
    if (!str) return '';
    return String(str).toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  /* ── Sample data generator (Egyptian PPI market) ─────────── */
  function generateSampleData() {
    const products = [
      { name: 'Nexium 40mg',     mfr: 'AstraZeneca Egypt', mol: 'Esomeprazole', form: 'Tab' },
      { name: 'Controloc 40mg',  mfr: 'Takeda Egypt',       mol: 'Pantoprazole',  form: 'Tab' },
      { name: 'Losec 20mg',      mfr: 'AstraZeneca Egypt', mol: 'Omeprazole',    form: 'Cap' },
      { name: 'Pantazol 40mg',   mfr: 'Pharco',             mol: 'Pantoprazole',  form: 'Tab' },
      { name: 'Panzo 40mg',      mfr: 'EVA Pharma',         mol: 'Pantoprazole',  form: 'Tab' },
      { name: 'Pariet 20mg',     mfr: 'Janssen Egypt',      mol: 'Rabeprazole',   form: 'Tab' },
      { name: 'Omeprazol Pharco',mfr: 'Pharco',             mol: 'Omeprazole',    form: 'Cap' },
      { name: 'Lokev 20mg',      mfr: 'Novartis Egypt',     mol: 'Omeprazole',    form: 'Cap' },
      { name: 'Rabezol 20mg',    mfr: 'Medical Union',      mol: 'Rabeprazole',   form: 'Tab' },
      { name: 'Omez 20mg',       mfr: "Dr. Reddy's Egypt",  mol: 'Omeprazole',    form: 'Cap' },
      { name: 'Gastrex 40mg',    mfr: 'Global Napi',        mol: 'Pantoprazole',  form: 'Tab' },
      { name: 'Ulcozol 20mg',    mfr: 'Sigma Pharma',       mol: 'Omeprazole',    form: 'Cap' },
      { name: 'Helicid 40mg',    mfr: 'EIPICO',             mol: 'Pantoprazole',  form: 'Tab' },
      { name: 'Zoton 30mg',      mfr: 'Pfizer Egypt',       mol: 'Lansoprazole',  form: 'Cap' },
      { name: 'Prevacid 30mg',   mfr: 'Sanofi Egypt',       mol: 'Lansoprazole',  form: 'Cap' },
      { name: 'Aciphex 20mg',    mfr: 'Janssen Egypt',      mol: 'Rabeprazole',   form: 'Tab' },
      { name: 'Pantoloc 40mg',   mfr: 'Nile Pharma',        mol: 'Pantoprazole',  form: 'Tab' },
      { name: 'Omepran 20mg',    mfr: 'Pharco',             mol: 'Omeprazole',    form: 'Cap' },
    ];

    // Base value and unit scales (EGP thousands per month)
    const baseV = [22000,18500,14200,9800,8600,7400,6800,5900,5200,4800,4300,3900,3500,3100,2800,2500,2200,2000];
    const baseU = [180,155,110,95,88,72,68,58,52,48,43,39,35,31,28,25,22,20];

    // Generate 2025 monthly data with slight growth trend
    // Generate 2026 with varied growth (some positive, some negative)
    const growth25 = [1.02,1.01,1.03,0.99,1.02,1.01,1.04,1.02,1.00,1.03,1.02,1.01,1.00,1.02,1.01,1.03,1.02,1.01];
    const growth26 = [1.18,1.22,1.08,-0.05,1.15,1.10,1.25,1.12,1.06,1.20,-0.08,1.18,1.14,1.09,1.22,-0.12,1.16,1.20];

    const dmRows = []; // Defined Market — has 2025 but outdated 2026
    const dsRows = []; // Data Source — has updated 2026 data

    products.forEach((p, idx) => {
      const bv = baseV[idx];
      const bu = baseU[idx];
      const g25 = growth25[idx];
      const g26 = growth26[idx];

      const dmRow = { 'Brand': p.name, 'Manufacturer': p.mfr, 'Molecule': p.mol, 'Form': p.form };
      const dsRow = { 'Brand': p.name, 'Manufacturer': p.mfr };

      for (let mo = 1; mo <= 12; mo++) {
        const label25 = `${MONTH_LABELS[mo-1]} 2025`;
        const label26 = `${MONTH_LABELS[mo-1]} 2026`;

        const seasonal = 1 + 0.15 * Math.sin((mo - 3) * Math.PI / 6);
        const v25 = Math.round(bv * g25 * seasonal * (0.95 + Math.random() * 0.1));
        const u25 = Math.round(bu * g25 * seasonal * (0.95 + Math.random() * 0.1));
        const v26 = Math.round(v25 * (g26 > 0 ? g26 : 0.88) * (0.96 + Math.random() * 0.08));
        const u26 = Math.round(u25 * (g26 > 0 ? g26 * 0.7 : 0.82) * (0.96 + Math.random() * 0.08));

        // DM has 2025 + partial 2026 (older)
        dmRow[`${label25} Units`] = u25;
        dmRow[`${label25} Value`] = v25;
        dmRow[`${label26} Units`] = Math.round(u26 * 0.92); // slightly outdated
        dmRow[`${label26} Value`] = Math.round(v26 * 0.90); // slightly outdated

        // DS has updated 2026 data
        dsRow[`${label26} Units`] = u26;
        dsRow[`${label26} Value`] = v26;
      }

      dmRows.push(dmRow);
      dsRows.push(dsRow);
    });

    // Add extra products to Data Source that are NOT in the Defined Market
    // to simulate real-world audits (e.g. IQVIA) containing broader market products
    const extraDS = [
      { name: 'Dexilant 60mg',    mfr: 'Takeda Egypt',       baseV: 11000, baseU: 70 },
      { name: 'Nexium IV 40mg',   mfr: 'AstraZeneca Egypt', baseV: 8500,  baseU: 45 },
      { name: 'Controloc IV 40mg',mfr: 'Takeda Egypt',       baseV: 7200,  baseU: 40 },
      { name: 'Zurcal 40mg',      mfr: 'Sandoz Egypt',       baseV: 4500,  baseU: 38 },
      { name: 'Peptazol 40mg',    mfr: 'Spimaco Egypt',      baseV: 3900,  baseU: 32 },
      { name: 'Esoral 40mg',      mfr: 'Hikma Egypt',        baseV: 3200,  baseU: 28 },
    ];

    extraDS.forEach(p => {
      const extraRow = { 'Brand': p.name, 'Manufacturer': p.mfr };
      for (let mo = 1; mo <= 12; mo++) {
        const label26 = `${MONTH_LABELS[mo-1]} 2026`;
        extraRow[`${label26} Units`] = Math.round(p.baseU * (0.95 + Math.random() * 0.1));
        extraRow[`${label26} Value`] = Math.round(p.baseV * (0.95 + Math.random() * 0.1));
      }
      dsRows.push(extraRow);
    });

    return { dmRows, dsRows };
  }

  /* ── Export updated Excel workbook ─────────────────────── */
  function buildExportWorkbook(analyticsResult, mapping) {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Updated Defined Market
    const dmData = analyticsResult.products.map(p => {
      const row = { Brand: p.product, Manufacturer: p.manufacturer, Molecule: p.molecule, Form: p.form };
      for (let mo = 1; mo <= 10; mo++) {
        const lbl = MONTH_LABELS[mo-1];
        const d25 = (p.months[2025] || {})[mo] || { units: 0, value: 0 };
        const d26 = (p.months[2026] || {})[mo] || { units: 0, value: 0 };
        row[`${lbl} 2025 Units`] = d25.units;
        row[`${lbl} 2025 Value`] = d25.value;
        row[`${lbl} 2026 Units`] = d26.units;
        row[`${lbl} 2026 Value`] = d26.value;
      }
      return row;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dmData), 'Updated Defined Market');

    // Sheet 2: KPI Summary for selected period
    const pName = analyticsResult.summary?.periodName || 'Period';
    const kpiData = analyticsResult.products.map(p => {
      const row = {
        Rank: p.rank,
        Brand: p.product,
        Manufacturer: p.manufacturer,
        Molecule: p.molecule,
      };
      row[`${pName} 2026 Value (EGP)`] = Math.round(p.ytd26v);
      row[`${pName} 2025 Value (EGP)`] = Math.round(p.ytd25v);
      row[`Value PPG% (${pName})`] = p.ppgv !== null ? +p.ppgv.toFixed(1) : '';
      row[`${pName} 2026 Units`] = Math.round(p.ytd26u);
      row[`${pName} 2025 Units`] = Math.round(p.ytd25u);
      row[`Volume PPG% (${pName})`] = p.ppgu !== null ? +p.ppgu.toFixed(1) : '';
      row['Defined MS% Value'] = +p.msv.toFixed(2);
      row['Defined MS% Volume'] = +p.msu.toFixed(2);
      return row;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kpiData), `KPI Summary`);

    // Sheet 3: By Manufacturer
    const mfrData = analyticsResult.manufacturers.map(m => {
      const row = {
        Manufacturer: m.manufacturer,
        'Products Count': m.count,
      };
      row[`${pName} 2026 Value (EGP)`] = Math.round(m.ytd26v);
      row[`${pName} 2025 Value (EGP)`] = Math.round(m.ytd25v);
      row[`Value PPG% (${pName})`] = m.ppgv !== null ? +m.ppgv.toFixed(1) : '';
      row[`${pName} 2026 Units`] = Math.round(m.ytd26u);
      row[`${pName} 2025 Units`] = Math.round(m.ytd25u);
      row[`Volume PPG% (${pName})`] = m.ppgu !== null ? +m.ppgu.toFixed(1) : '';
      row['Defined MS% Value'] = +m.msv.toFixed(2);
      return row;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mfrData), `By Manufacturer`);

    return wb;
  }

  return {
    detectMonthCols,
    guessProductCol,
    guessMfrCol,
    guessMolCol,
    guessFormCol,
    mergeData,
    calculate,
    periodSales,
    generateSampleData,
    buildExportWorkbook,
    MONTHS,
    MONTH_LABELS,
    YTD_MONTH,
    normalise,
  };
})();
