/* ═══════════════════════════════════════════════════════════
   app.js — Main Application Controller
   Handles: screens, file upload, Excel parsing, column mapping,
            filters, state, export, toast, drag-and-drop
═══════════════════════════════════════════════════════════ */

const App = (() => {

  /* ── Application state ──────────────────────────────────── */
  const state = {
    dmData: null,          // Raw DM rows (array of objects)
    dsData: null,          // Raw DS rows (array of objects)
    dmHeaders: [],         // DM column headers
    dsHeaders: [],         // DS column headers
    dmMarketName: '',      // Current defined market name/label
    mergedProducts: null,  // Merged product objects
    analyticsData: null,   // Full analytics result
    startMonth: 1,         // Period start month (1 = Jan)
    endMonth: 6,           // Period end month (6 = Jun, default H1)
    periodPreset: 'h1',    // 'h1' | 'q1' | 'q2' | 'q3' | 'oct' | 'fy' | 'custom'
    metric: 'value',       // 'value' | 'volume'
    topN: 15,
    search: '',
    activeMfrs: new Set(), // empty = all
    activeMols: new Set(), // empty = all
    usingSample: false,
  };

  const STORAGE_KEY_MARKETS = 'pharmadash_recorded_markets_v1';
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  /* ── Recorded Defined Markets (LocalStorage) ────────────── */
  function getRecordedMarkets() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_MARKETS);
      return raw ? JSON.parse(raw) : [];
    } catch(e) {
      console.warn('LocalStorage error:', e);
      return [];
    }
  }

  function saveRecordedMarkets(list) {
    try {
      localStorage.setItem(STORAGE_KEY_MARKETS, JSON.stringify(list));
      return true;
    } catch(e) {
      console.warn('LocalStorage save error:', e);
      toast('Could not save market: browser storage is full or blocked. Try deleting older saved markets.', 'err', 6000);
      return false;
    }
  }

  function initRecordedMarketsUI() {
    // Drop legacy auto-seeded sample entries; built-ins come from BUILTIN_MARKETS
    const list = getRecordedMarkets().filter(m => !m.isSample);
    const sel = document.getElementById('saved-market-select');
    const delBtn = document.getElementById('btn-del-mkt');
    if (!sel) return;

    sel.innerHTML = '<option value="">-- Choose a Defined Market --</option>';

    // Built-in markets grouped by therapeutic area
    const builtins = (typeof BUILTIN_MARKETS !== 'undefined') ? BUILTIN_MARKETS : [];
    const groups = {};
    builtins.forEach(m => { (groups[m.group] = groups[m.group] || []).push(m); });
    Object.keys(groups).forEach(g => {
      const og = document.createElement('optgroup');
      og.label = `★ Built-in — ${g}`;
      groups[g].forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = `${m.name} (${m.brands.length} products)`;
        og.appendChild(opt);
      });
      sel.appendChild(og);
    });

    // User-recorded markets
    if (list.length) {
      const og = document.createElement('optgroup');
      og.label = '💾 My Recorded Markets';
      list.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = `${m.name} (${m.dmData ? m.dmData.length : 0} products, ${m.savedAt || 'saved'})`;
        og.appendChild(opt);
      });
      sel.appendChild(og);
    }

    if (delBtn) delBtn.style.display = 'none';
  }

  function onSelectSavedMarket(marketId) {
    const delBtn = document.getElementById('btn-del-mkt');
    if (delBtn) delBtn.style.display = 'none';
    if (!marketId) return;

    // Built-in market?
    const builtins = (typeof BUILTIN_MARKETS !== 'undefined') ? BUILTIN_MARKETS : [];
    const bi = builtins.find(m => m.id === marketId);
    let found;
    if (bi) {
      found = {
        name: bi.name,
        dmHeaders: ['Brand Name'],
        dmData: bi.brands.map(b => ({ 'Brand Name': b })),
      };
    } else {
      found = getRecordedMarkets().find(m => m.id === marketId);
      if (!found) return;
      if (delBtn) delBtn.style.display = 'inline-block';
    }

    if (found.dmData && found.dmHeaders) {
      state.dmData = found.dmData;
      state.dmHeaders = found.dmHeaders;
      state.dmMarketName = found.name;
      state.usingSample = false;

      document.getElementById('status-defined').textContent = `✓ ${found.dmData.length} products loaded from [${found.name}]`;
      document.getElementById('zone-defined').classList.add('loaded');
      document.getElementById('badge-defined').style.display = 'block';

      const recInput = document.getElementById('record-market-name');
      if (recInput) recInput.value = found.name;

      checkBothLoaded();
      toast(`Loaded defined market: ${found.name} (${found.dmData.length} products)`, 'ok');
    }
  }

  function recordCurrentMarket() {
    const input = document.getElementById('record-market-name');
    const name = input ? input.value.trim() : '';
    if (!name) {
      toast('Please enter a name for this defined market (e.g. PPI Egyptian Market)', 'err');
      return;
    }
    if (!state.dmData || !state.dmData.length) {
      toast('No defined market data loaded yet to record.', 'err');
      return;
    }

    const list = getRecordedMarkets();
    const id = 'mkt_' + Date.now();
    const entry = {
      id,
      name,
      savedAt: new Date().toLocaleDateString(),
      dmData: state.dmData,
      dmHeaders: state.dmHeaders
    };

    // Replace if same name or push new
    const existingIdx = list.findIndex(m => m.name.toLowerCase() === name.toLowerCase());
    if (existingIdx >= 0) {
      list[existingIdx] = entry;
    } else {
      list.unshift(entry);
    }

    if (!saveRecordedMarkets(list)) return;
    initRecordedMarketsUI();

    const sel = document.getElementById('saved-market-select');
    if (sel) sel.value = id;
    const hint = document.getElementById('record-hint');
    if (hint) hint.textContent = `✓ Saved as "${name}" — select it from "Saved Markets" on the upload screen next time.`;
    const delBtn = document.getElementById('btn-del-mkt');
    if (delBtn) delBtn.style.display = 'inline-block';

    state.dmMarketName = name;
    toast(`Market recorded: "${name}" saved for future selection!`, 'ok', 4000);
  }

  function deleteSelectedMarket() {
    const sel = document.getElementById('saved-market-select');
    if (!sel || !sel.value) return;
    const val = sel.value;
    let list = getRecordedMarkets();
    const target = list.find(m => m.id === val);
    if (!target) return;

    if (confirm(`Are you sure you want to delete the recorded market "${target.name}"?`)) {
      list = list.filter(m => m.id !== val);
      saveRecordedMarkets(list);
      initRecordedMarketsUI();
      sel.value = '';
      const delBtn = document.getElementById('btn-del-mkt');
      if (delBtn) delBtn.style.display = 'none';
      toast(`Removed recorded market "${target.name}"`, 'info');
    }
  }

  /* ── Screen navigation ──────────────────────────────────── */
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  function goToUpload() { showScreen('screen-upload'); }

  function goToMapping() {
    if (!state.dmData || !state.dsData) { toast('Please load both sheets first.', 'err'); return; }
    buildMappingUI();
    showScreen('screen-mapping');
  }

  /* ── Toast notifications ────────────────────────────────── */
  function toast(msg, type = 'info', duration = 3200) {
    const div = document.createElement('div');
    div.className = `toast ${type}`;
    div.textContent = msg;
    document.getElementById('toasts').appendChild(div);
    setTimeout(() => { div.style.opacity = '0'; div.style.transition = '.3s'; setTimeout(() => div.remove(), 320); }, duration);
  }

  /* ── Loading overlay ────────────────────────────────────── */
  function showLoading(msg = 'Processing…') {
    document.getElementById('loading-msg').textContent = msg;
    document.getElementById('loading').style.display = 'flex';
  }
  function hideLoading() { document.getElementById('loading').style.display = 'none'; }

  /* ── Ultra-Fast Excel / CSV file parsing ────────────────── */
  function parseExcel(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        // Yield execution to allow UI loading spinner to show immediately
        setTimeout(() => {
          try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, {
              type: 'array',
              cellFormula: false,
              cellHTML: false,
              cellText: false,
              cellStyles: false,
              raw: true
            });

            const sheetName = wb.SheetNames[0];
            const ws = wb.Sheets[sheetName];
            if (!ws) {
              resolve({ rows: [], headers: [] });
              return;
            }

            // High-speed array-of-arrays extraction (bypasses expensive defval object allocation)
            const matrix = XLSX.utils.sheet_to_json(ws, {
              header: 1,
              raw: true,
              blankrows: false
            });

            if (!matrix || !matrix.length) {
              resolve({ rows: [], headers: [] });
              return;
            }

            // Detect header row (first non-empty row)
            let headerRowIndex = 0;
            for (let i = 0; i < matrix.length; i++) {
              if (matrix[i] && matrix[i].some(c => c !== null && c !== undefined && String(c).trim() !== '')) {
                headerRowIndex = i;
                break;
              }
            }

            const rawHeaders = matrix[headerRowIndex] || [];
            const headerColMap = [];
            const headers = [];

            for (let colIdx = 0; colIdx < rawHeaders.length; colIdx++) {
              const colName = rawHeaders[colIdx];
              const cleaned = (colName !== null && colName !== undefined) ? String(colName).trim() : '';
              if (cleaned) {
                headers.push(cleaned);
                headerColMap.push({ name: cleaned, idx: colIdx });
              }
            }

            if (!headers.length) {
              resolve({ rows: [], headers: [] });
              return;
            }

            // Fast row parsing: only process valid columns
            const rows = [];
            const totalRows = matrix.length;
            for (let i = headerRowIndex + 1; i < totalRows; i++) {
              const r = matrix[i];
              if (!r || !r.length) continue;

              let hasData = false;
              const rowObj = {};
              for (let j = 0; j < headerColMap.length; j++) {
                const col = headerColMap[j];
                const val = r[col.idx];
                if (val !== undefined && val !== null && val !== '') {
                  rowObj[col.name] = val;
                  hasData = true;
                } else {
                  rowObj[col.name] = '';
                }
              }
              if (hasData) {
                rows.push(rowObj);
              }
            }

            resolve({ rows, headers });
          } catch (err) {
            reject(err);
          }
        }, 40);
      };

      reader.onerror = () => reject(new Error('Failed to read file from disk.'));
      reader.readAsArrayBuffer(file);
    });
  }

  /* ── File upload handler ────────────────────────────────── */
  function handleFile(file, type) {
    if (!file) return;
    const isSupported = /\.(xlsx|xls|csv)$/i.test(file.name);
    if (!isSupported) { toast('Please upload an Excel or CSV file (.xlsx, .xls, .csv)', 'err'); return; }

    const sizeMb = (file.size / 1048576).toFixed(1);
    showLoading(`Optimized parsing for ${type === 'defined' ? 'Defined Market' : 'Data Source'} sheet (${sizeMb} MB)…`);

    parseExcel(file)
      .then(({ rows, headers }) => {
        if (type === 'defined') {
          state.dmData = rows;
          state.dmHeaders = headers;
          state.dmMarketName = file.name.replace(/\.(xlsx|xls|csv)$/i, '');
          state.usingSample = false;
          const sel = document.getElementById('saved-market-select');
          if (sel) sel.value = '';
          const recInput = document.getElementById('record-market-name');
          if (recInput) recInput.value = state.dmMarketName;
          document.getElementById('status-defined').textContent = `✓ ${rows.length.toLocaleString()} products, ${headers.length} columns`;
          document.getElementById('zone-defined').classList.add('loaded');
          document.getElementById('badge-defined').style.display = 'block';
        } else {
          state.dsData = rows;
          state.dsHeaders = headers;
          document.getElementById('status-source').textContent = `✓ ${rows.length.toLocaleString()} products, ${headers.length} columns`;
          document.getElementById('zone-source').classList.add('loaded');
          document.getElementById('badge-source').style.display = 'block';
        }
        checkBothLoaded();
        toast(`${type === 'defined' ? 'Defined Market' : 'Data Source'} sheet parsed in high speed: ${rows.length.toLocaleString()} rows`, 'ok', 3500);
      })
      .catch(err => {
        toast('Error parsing file: ' + err.message, 'err', 5000);
      })
      .finally(() => hideLoading());
  }

  function checkBothLoaded() {
    const btn = document.getElementById('btn-configure');
    btn.disabled = !(state.dmData && state.dsData);
  }

  /* ── Sample data loader ─────────────────────────────────── */
  function loadSampleData() {
    showLoading('Generating sample Egyptian PPI market data…');
    setTimeout(() => {
      const { dmRows, dsRows } = Analytics.generateSampleData();

      state.dmData = dmRows;
      state.dsData = dsRows;
      state.dmHeaders = Object.keys(dmRows[0] || {});
      state.dsHeaders = Object.keys(dsRows[0] || {});
      state.usingSample = true;

      document.getElementById('status-defined').textContent = `✓ ${dmRows.length} Defined Market products (sample)`;
      document.getElementById('zone-defined').classList.add('loaded');
      document.getElementById('badge-defined').style.display = 'block';

      document.getElementById('status-source').textContent = `✓ ${dsRows.length} Market products (sample audit)`;
      document.getElementById('zone-source').classList.add('loaded');
      document.getElementById('badge-source').style.display = 'block';

      checkBothLoaded();
      hideLoading();
      toast(`Sample loaded: ${dmRows.length} Defined Market products + ${dsRows.length} Data Source products.`, 'ok');
    }, 600);
  }

  /* ── Build Mapping UI ───────────────────────────────────── */
  function buildMappingUI() {
    const dmH = state.dmHeaders;
    const dsH = state.dsHeaders;

    // Sheet info
    document.getElementById('dm-info').innerHTML =
      `${state.dmData.length} rows &nbsp;•&nbsp; ${dmH.length} columns &nbsp;•&nbsp; ` +
      `${Analytics.detectMonthCols(dmH).length} month columns detected`;
    document.getElementById('ds-info').innerHTML =
      `${state.dsData.length} rows &nbsp;•&nbsp; ${dsH.length} columns &nbsp;•&nbsp; ` +
      `${Analytics.detectMonthCols(dsH).length} month columns detected`;

    // Populate selects
    populateSelect('dm-product', dmH, Analytics.guessProductCol(dmH));
    populateSelect('dm-mfr',     dmH, Analytics.guessMfrCol(dmH));
    populateSelect('dm-mol',     dmH, Analytics.guessMolCol(dmH), true);
    populateSelect('dm-form',    dmH, Analytics.guessFormCol(dmH), true);

    populateSelect('ds-product', dsH, Analytics.guessProductCol(dsH));
    populateSelect('ds-mfr',     dsH, Analytics.guessMfrCol(dsH), true);

    // Detected month columns preview
    renderMonthsPreview();
  }

  function populateSelect(id, headers, selected, hasEmpty) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const emptyOpt = hasEmpty ? '<option value="">— Skip —</option>' : '';
    sel.innerHTML = emptyOpt + headers.map(h =>
      `<option value="${h}" ${h === selected ? 'selected' : ''}>${h}</option>`
    ).join('');
  }

  function renderMonthsPreview() {
    const dmMons = Analytics.detectMonthCols(state.dmHeaders);
    const dsMons = Analytics.detectMonthCols(state.dsHeaders);
    const container = document.getElementById('months-preview');
    if (!container) return;

    const all = [...dmMons, ...dsMons];
    if (!all.length) {
      container.innerHTML = '<span style="color:#f87171;font-size:13px">No month columns detected. Check your column headers include month names (Jan, Feb…) and years (2025, 2026).</span>';
      return;
    }

    // Group by year+month+type for display
    const tags = all.map(m => {
      const typeCls = m.type === 'units' ? 'units' : m.type === 'value' ? 'value' : 'unknown';
      const typeLabel = m.type === 'units' ? 'U' : m.type === 'value' ? 'V' : '?';
      const src = dmMons.includes(m) ? 'DM' : 'DS';
      return `<span class="m-tag ${typeCls}" title="${m.col}">${Analytics.MONTH_LABELS[m.monthNum-1]} ${m.year} · ${typeLabel} · ${src}</span>`;
    });

    container.innerHTML = tags.join('');

    // Update match summary
    const matchCount = countMatches();
    const dmTotal = state.dmData ? state.dmData.length : 0;
    const dsTotal = state.dsData ? state.dsData.length : 0;
    const excludedCount = Math.max(0, dsTotal - matchCount);

    document.getElementById('match-summary').innerHTML =
      `Defined Market: <strong>${dmTotal}</strong> products &nbsp;|&nbsp; ` +
      `Updated from Data Source: <strong>${matchCount}</strong> / ${dmTotal} &nbsp;|&nbsp; ` +
      `<span style="color:#10b981;font-weight:600">✓ Strictly analyzing ${dmTotal} Defined Market products</span>` +
      (excludedCount > 0 ? ` <span style="color:#64748b">(${excludedCount} unlisted products in Data Source excluded)</span>` : '');
  }

  function countMatches() {
    const dsProductCol = document.getElementById('ds-product')?.value;
    if (!dsProductCol || !state.dsData) return 0;
    const dsKeys = new Set(state.dsData.map(r => Analytics.normalise(r[dsProductCol])));
    const dmProductCol = document.getElementById('dm-product')?.value;
    if (!dmProductCol) return 0;
    return state.dmData.filter(r => dsKeys.has(Analytics.normalise(r[dmProductCol]))).length;
  }

  /* ── Run Analysis ───────────────────────────────────────── */
  function runAnalysis() {
    showLoading('Merging data and calculating Defined Market KPIs…');

    setTimeout(() => {
      try {
        const dmProductCol = document.getElementById('dm-product').value;
        const dmMfrCol     = document.getElementById('dm-mfr').value;
        const dmMolCol     = document.getElementById('dm-mol').value;
        const dmFormCol    = document.getElementById('dm-form').value;
        const dsProductCol = document.getElementById('ds-product').value;
        const dsMfrCol     = document.getElementById('ds-mfr').value;

        const dmMonths = Analytics.detectMonthCols(state.dmHeaders);
        const dsMonths = Analytics.detectMonthCols(state.dsHeaders);

        if (!dmMonths.length && !dsMonths.length) {
          hideLoading();
          toast('No month columns detected. Check column headers contain month names and years.', 'err', 5000);
          return;
        }

        const mapping = { dmProductCol, dmMfrCol, dmMolCol: dmMolCol || null, dmFormCol: dmFormCol || null, dsProductCol, dsMfrCol: dsMfrCol || null, dmMonths, dsMonths };

        // Merge Sheet 1 (Defined Market) with Sheet 2 (Data Source)
        const { products: merged, updateCount, totalDmCount, excludedDsCount, matchRate } =
          Analytics.mergeData(state.dmData, state.dsData, mapping);

        // Auto-record the defined market (if named and not the built-in sample)
        const recName = (document.getElementById('record-market-name')?.value || '').trim();
        const isBuiltinName = (typeof BUILTIN_MARKETS !== 'undefined') &&
          BUILTIN_MARKETS.some(m => m.name.toLowerCase() === recName.toLowerCase());
        if (recName && !state.usingSample && !isBuiltinName) {
          const list = getRecordedMarkets();
          const exists = list.some(m => m.name.toLowerCase() === recName.toLowerCase() && m.dmData &&
            m.dmData.length === state.dmData.length);
          if (!exists) recordCurrentMarket();
          state.dmMarketName = recName;
        }

        // Store merged products for dynamic period changes
        state.mergedProducts = merged;

        // Calculate KPIs strictly on Defined Market universe for selected same period
        const analyticsData = Analytics.calculate(merged, state.startMonth, state.endMonth);
        state.analyticsData = analyticsData;

        // Build sidebar filters
        buildMfrFilter(analyticsData);
        buildMolFilter(analyticsData);

        // Sync period controls
        syncPeriodUI(state.periodPreset);

        // Update Market Name in Dashboard Header
        const marketHdr = document.getElementById('dash-market-name');
        if (marketHdr) {
          marketHdr.textContent = state.dmMarketName
            ? `${state.dmMarketName} — Market Analytics`
            : 'Defined Market Analytics Dashboard';
        }

        // Render dashboard
        showScreen('screen-dashboard');
        setTimeout(() => {
          Dashboard.render(analyticsData);
          hideLoading();
          let toastMsg = `Defined Market analysis complete (${analyticsData.summary.periodLabel}): ${merged.length} products loaded.`;
          if (excludedDsCount > 0) {
            toastMsg += ` ${excludedDsCount} unlisted products in Data Source were excluded.`;
          }
          toast(toastMsg, 'ok', 4500);
        }, 80);

      } catch(err) {
        hideLoading();
        toast('Analysis error: ' + err.message, 'err', 6000);
        console.error(err);
      }
    }, 150);
  }

  /* ── Dynamic Period Handlers (Same Period Each Year) ─────── */
  function setPeriod(startM, endM, presetKey = 'custom') {
    state.startMonth = parseInt(startM);
    state.endMonth = parseInt(endM);
    state.periodPreset = presetKey;

    if (state.mergedProducts) {
      showLoading(`Calculating ${state.startMonth === 1 && state.endMonth === 6 ? 'H1 (Jan–Jun)' : 'period'} metrics…`);
      setTimeout(() => {
        const analyticsData = Analytics.calculate(state.mergedProducts, state.startMonth, state.endMonth);
        state.analyticsData = analyticsData;

        syncPeriodUI(presetKey);
        Dashboard.render(analyticsData);
        hideLoading();
        toast(`Comparison period: ${analyticsData.summary.periodLabel}`, 'ok', 3500);
      }, 50);
    }
  }

  function onHeaderPeriodChange(val) {
    if (!val) return;
    const parts = val.split('-');
    const s = parseInt(parts[0]);
    const e = parseInt(parts[1]);
    let preset = 'custom';
    if (s === 1 && e === 6) preset = 'h1';
    else if (s === 1 && e === 3) preset = 'q1';
    else if (s === 4 && e === 6) preset = 'q2';
    else if (s === 1 && e === 9) preset = 'q3';
    else if (s === 1 && e === 10) preset = 'oct';
    else if (s === 1 && e === 12) preset = 'fy';
    setPeriod(s, e, preset);
  }

  function onCustomPeriodChange() {
    const fromSel = document.getElementById('period-from');
    const toSel = document.getElementById('period-to');
    if (!fromSel || !toSel) return;
    let s = parseInt(fromSel.value);
    let e = parseInt(toSel.value);
    if (s > e) {
      e = s;
      toSel.value = e;
    }
    let preset = 'custom';
    if (s === 1 && e === 6) preset = 'h1';
    else if (s === 1 && e === 3) preset = 'q1';
    else if (s === 4 && e === 6) preset = 'q2';
    else if (s === 1 && e === 9) preset = 'q3';
    else if (s === 1 && e === 10) preset = 'oct';
    else if (s === 1 && e === 12) preset = 'fy';
    setPeriod(s, e, preset);
  }

  /* ── Interactive Timeline Slider & Month Chips ──────────── */
  function onTimelineSliderChange(type, val) {
    let s = parseInt(document.getElementById('timeline-range-start').value);
    let e = parseInt(document.getElementById('timeline-range-end').value);

    if (type === 'start') {
      s = parseInt(val);
      if (s > e) {
        e = s;
        document.getElementById('timeline-range-end').value = e;
      }
    } else {
      e = parseInt(val);
      if (e < s) {
        s = e;
        document.getElementById('timeline-range-start').value = s;
      }
    }

    let preset = 'custom';
    if (s === 1 && e === 6) preset = 'h1';
    else if (s === 1 && e === 3) preset = 'q1';
    else if (s === 4 && e === 6) preset = 'q2';
    else if (s === 1 && e === 9) preset = 'q3';
    else if (s === 1 && e === 10) preset = 'oct';
    else if (s === 1 && e === 12) preset = 'fy';

    setPeriod(s, e, preset);
  }

  function onTimelineMonthClick(monthNum) {
    let s = state.startMonth;
    let e = state.endMonth;

    if (monthNum < s) {
      s = monthNum;
    } else if (monthNum > e) {
      e = monthNum;
    } else {
      // Clicked inside range: if closer to start, adjust start; else adjust end
      if (Math.abs(monthNum - s) <= Math.abs(monthNum - e)) {
        s = monthNum;
      } else {
        e = monthNum;
      }
    }

    let preset = 'custom';
    if (s === 1 && e === 6) preset = 'h1';
    else if (s === 1 && e === 3) preset = 'q1';
    else if (s === 4 && e === 6) preset = 'q2';
    else if (s === 1 && e === 9) preset = 'q3';
    else if (s === 1 && e === 10) preset = 'oct';
    else if (s === 1 && e === 12) preset = 'fy';

    setPeriod(s, e, preset);
  }

  function renderTimelineChips() {
    const container = document.getElementById('timeline-month-chips');
    if (!container) return;

    container.innerHTML = MONTH_NAMES.map((name, idx) => {
      const m = idx + 1;
      const inRange = m >= state.startMonth && m <= state.endMonth;
      const isBound = m === state.startMonth || m === state.endMonth;
      const cls = isBound ? 'month-chip range-bound' : (inRange ? 'month-chip in-range' : 'month-chip');
      return `<div class="${cls}" onclick="App.onTimelineMonthClick(${m})" title="Click to filter up to ${name}">${name}</div>`;
    }).join('');

    const badge = document.getElementById('timeline-active-badge');
    if (badge) {
      badge.textContent = state.startMonth === state.endMonth
        ? MONTH_NAMES[state.startMonth - 1]
        : `${MONTH_NAMES[state.startMonth - 1]} – ${MONTH_NAMES[state.endMonth - 1]}`;
    }

    const sliderS = document.getElementById('timeline-range-start');
    const sliderE = document.getElementById('timeline-range-end');
    if (sliderS) sliderS.value = state.startMonth;
    if (sliderE) sliderE.value = state.endMonth;
  }

  function syncPeriodUI(presetKey) {
    if (!state.analyticsData) return;
    const { summary } = state.analyticsData;

    // Header chip
    const chip = document.getElementById('dash-period-chip');
    if (chip) chip.textContent = summary.periodLabel;

    // Header dropdown
    const hdrSel = document.getElementById('header-period-select');
    if (hdrSel) {
      const targetVal = `${state.startMonth}-${state.endMonth}`;
      if (hdrSel.querySelector(`option[value="${targetVal}"]`)) {
        hdrSel.value = targetVal;
      }
    }

    // Sidebar dropdowns
    const fromSel = document.getElementById('period-from');
    const toSel = document.getElementById('period-to');
    if (fromSel) fromSel.value = state.startMonth;
    if (toSel) toSel.value = state.endMonth;

    // Sidebar preset buttons
    document.querySelectorAll('.period-preset-btn').forEach(btn => {
      const isAct = btn.dataset.preset === presetKey ||
        (parseInt(btn.dataset.start) === state.startMonth && parseInt(btn.dataset.end) === state.endMonth);
      btn.classList.toggle('active', isAct);
    });

    // Sync visual timeline chips & sliders
    renderTimelineChips();
  }

  /* ── Sidebar filter builders ────────────────────────────── */
  const MFR_PALETTE = [
    '#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4',
    '#ec4899','#6366f1','#84cc16','#f97316','#14b8a6','#a855f7',
    '#eab308','#0ea5e9','#22c55e','#fb923c','#e11d48','#7c3aed',
  ];

  function buildMfrFilter(data) {
    const list = document.getElementById('mfr-filter-list');
    if (!list) return;

    state.activeMfrs = new Set(); // all selected by default

    list.innerHTML = data.manufacturers.map((m, i) => {
      const color = MFR_PALETTE[i % MFR_PALETTE.length];
      return `
        <label class="f-item">
          <input type="checkbox" checked data-mfr="${m.manufacturer}" onchange="App.onMfrChange()">
          <span class="f-dot" style="background:${color}"></span>
          <span class="f-name active-mfr" title="${m.manufacturer}">${m.manufacturer}</span>
          <span class="f-name" style="color:#64748b;font-size:10px">(${m.count})</span>
        </label>`;
    }).join('');
  }

  function buildMolFilter(data) {
    const mols = [...new Set(data.products.map(p => p.molecule).filter(Boolean))].sort();
    if (!mols.length) return;

    const sec = document.getElementById('mol-section');
    if (sec) sec.style.display = 'block';

    const list = document.getElementById('mol-filter-list');
    if (!list) return;

    state.activeMols = new Set();

    list.innerHTML = mols.map(m => `
      <label class="f-item">
        <input type="checkbox" checked data-mol="${m}" onchange="App.onMolChange()">
        <span class="f-name">${m}</span>
      </label>`).join('');
  }

  /* ── Filter event handlers ──────────────────────────────── */
  function onMfrChange() {
    const checked = [...document.querySelectorAll('[data-mfr]:checked')].map(el => el.dataset.mfr);
    const all = [...document.querySelectorAll('[data-mfr]')];
    const allChecked = checked.length === all.length;

    state.activeMfrs = allChecked ? new Set() : new Set(checked);
    document.getElementById('mfr-all-check').checked = allChecked;

    if (state.analyticsData) Dashboard.refresh(state.analyticsData);
  }

  function toggleAllMfr(checked) {
    document.querySelectorAll('[data-mfr]').forEach(el => { el.checked = checked; });
    state.activeMfrs = new Set();
    if (state.analyticsData) Dashboard.refresh(state.analyticsData);
  }

  function onMolChange() {
    const checked = [...document.querySelectorAll('[data-mol]:checked')].map(el => el.dataset.mol);
    const all = [...document.querySelectorAll('[data-mol]')];
    state.activeMols = checked.length === all.length ? new Set() : new Set(checked);
    if (state.analyticsData) Dashboard.refresh(state.analyticsData);
  }

  function setMetric(m) {
    state.metric = m;
    document.getElementById('mb-value').classList.toggle('active', m === 'value');
    document.getElementById('mb-volume').classList.toggle('active', m === 'volume');
    if (state.analyticsData) Dashboard.refresh(state.analyticsData);
  }

  function setTopN(n) {
    state.topN = parseInt(n);
    document.getElementById('topn-display').textContent = n;
    if (state.analyticsData) Dashboard.refresh(state.analyticsData);
  }

  function searchProduct(q) {
    state.search = q;
    if (state.analyticsData) Dashboard.refresh(state.analyticsData);
  }

  /* ── Export to Dynamic Standalone HTML ──────────────────── */
  function exportDynamicHTML() {
    const exp = window.Exporter || (typeof Exporter !== 'undefined' ? Exporter : null);
    if (exp && typeof exp.exportDynamicHTML === 'function') {
      exp.exportDynamicHTML(state);
    } else {
      toast('Exporter module is loading or unavailable.', 'err');
    }
  }

  /* ── Export to Executive PDF Report ─────────────────────── */
  function exportPDF() {
    const exp = window.Exporter || (typeof Exporter !== 'undefined' ? Exporter : null);
    if (exp && typeof exp.exportPDF === 'function') {
      exp.exportPDF(state);
    } else {
      window.print();
    }
  }

  /* ── Export to Excel ────────────────────────────────────── */
  function exportData() {
    if (!state.analyticsData) { toast('No data to export yet.', 'err'); return; }
    showLoading('Building Excel export…');
    setTimeout(() => {
      try {
        const wb = Analytics.buildExportWorkbook(state.analyticsData, {});
        const ts = new Date().toISOString().slice(0,10);
        XLSX.writeFile(wb, `PharmaDash_Export_${ts}.xlsx`);
        toast('Excel exported successfully!', 'ok');
      } catch(err) {
        toast('Export error: ' + err.message, 'err');
      }
      hideLoading();
    }, 200);
  }

  /* ── Download CSV ───────────────────────────────────────── */
  function downloadCSV() {
    if (!state.analyticsData) return;
    const data = Dashboard.getFilteredProducts(state.analyticsData);
    const pName = state.analyticsData.summary.periodName || 'Period';
    const headers = [
      'Rank','Brand','Manufacturer','Molecule',
      `${pName} 2026 Value (EGP)`, `${pName} 2025 Value (EGP)`, `Value PPG% (${pName})`,
      `${pName} 2026 Units`, `${pName} 2025 Units`, `Vol PPG% (${pName})`,
      'Defined MS% Value', 'Defined MS% Volume'
    ];
    const rows = data.map(p => [
      p.rank, p.product, p.manufacturer, p.molecule,
      Math.round(p.ytd26v), Math.round(p.ytd25v),
      p.ppgv !== null ? p.ppgv.toFixed(1) : '',
      Math.round(p.ytd26u), Math.round(p.ytd25u),
      p.ppgu !== null ? p.ppgu.toFixed(1) : '',
      p.msv.toFixed(2), p.msu.toFixed(2),
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `PharmaDash_Data_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    toast('CSV downloaded!', 'ok');
  }

  /* ── Drag and drop support ──────────────────────────────── */
  function setupDragDrop() {
    ['zone-defined', 'zone-source'].forEach(id => {
      const zone = document.getElementById(id);
      if (!zone) return;
      const type = id === 'zone-defined' ? 'defined' : 'source';

      zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
      zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file, type);
      });
    });

    // File input change
    document.getElementById('file-defined')?.addEventListener('change', e => handleFile(e.target.files[0], 'defined'));
    document.getElementById('file-source')?.addEventListener('change', e => handleFile(e.target.files[0], 'source'));
  }

  /* ── Column mapping change listeners ───────────────────── */
  function setupMappingListeners() {
    ['dm-product','dm-mfr','dm-mol','dm-form','ds-product','ds-mfr','dm-type-pat','ds-type-pat'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        renderMonthsPreview();
      });
    });
  }


  /* ── Init ───────────────────────────────────────────────── */
  function init() {
    setupDragDrop();
    setupMappingListeners();
    initRecordedMarketsUI();
    // Ensure Chart.js datalabels plugin is registered
    if (typeof ChartDataLabels !== 'undefined') {
      Chart.register(ChartDataLabels);
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    state,
    goToUpload,
    goToMapping,
    runAnalysis,
    loadSampleData,
    setMetric,
    setTopN,
    searchProduct,
    exportData,
    exportDynamicHTML,
    exportPDF,
    downloadCSV,
    onMfrChange,
    onMolChange,
    toggleAllMfr,
    setPeriod,
    onHeaderPeriodChange,
    onCustomPeriodChange,
    onTimelineSliderChange,
    onTimelineMonthClick,
    onSelectSavedMarket,
    recordCurrentMarket,
    deleteSelectedMarket,
    toast,
  };
})();
