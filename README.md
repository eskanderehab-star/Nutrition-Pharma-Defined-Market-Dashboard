# PharmaDash — Pharmaceutical Market Intelligence Platform (Egypt)

A high-performance, client-side web application developed for pharmaceutical data analytics. It updates a **Defined Market Sheet** with the latest monthly unit and value sales from a **Data Source Sheet** (e.g. IQVIA/IMS or internal ERP), calculates all core commercial KPIs, and visualizes them on an executive dashboard.

---

## 🌟 Key Capabilities

### 1. Data Merging & Defined Market Isolation
- **Strict Defined Market Scope**: The analytics engine and dashboard process **ONLY** the products provided in the Defined Market Sheet (1st input). Any other products present in the broader Data Source Sheet (2nd input) are automatically excluded.
- **Normalized Matching**: Matches brand and product names across sheets regardless of case, punctuation, or whitespace variations.
- **Selective Override**: Preserves Defined Market master attributes (Molecule, Form, Manufacturer) while updating monthly Unit Sales and Value Sales (EGP) with the freshest data from the Data Source.
- **Missing Attribute Fallback**: If the Defined Market is missing Manufacturer data, it seamlessly imports it from the Data Source sheet.

### 2. Comprehensive KPI Analytics Engine & Dynamic Same-Period Comparison
- **Dynamic Same-Period Comparison**: Compares the exact same monthly period each year to eliminate seasonality bias (e.g. **H1: Jan–Jun 2026 vs. Jan–Jun 2025**, **Q1: Jan–Mar 2026 vs. Jan–Mar 2025**, **Q3: Jan–Sep**, **YTD Oct**, or custom month ranges).
- **PPG% (Previous Period Growth %)**:
  $$\text{PPG\%} = \left(\frac{\text{Sales}_{\text{Period } 2026}}{\text{Sales}_{\text{Period } 2025}} - 1\right) \times 100$$
  Calculated for the identical months in both years, independently for both **Value (EGP)** and **Volume (Units)**.
- **Defined MS% (Market Share %)**:
  $$\text{Defined MS\% (Value)} = \left(\frac{\text{Product Period 2026 Value}}{\text{Total Defined Market Period 2026 Value}}\right) \times 100$$
  $$\text{Defined MS\% (Volume)} = \left(\frac{\text{Product Period 2026 Units}}{\text{Total Defined Market Period 2026 Units}}\right) \times 100$$
- **Dynamic Ranking**: Automatic re-ranking within the Defined Market for the selected comparison period by Value or Volume.

### 3. Manufacturer / Company Analytics & Filtering
- **Sidebar Manufacturer Checklist**: Filter by any single company or combination (e.g., AstraZeneca, Takeda, Pharco, EVA Pharma, Novartis, etc.).
- **Manufacturer Performance Chart**: Side-by-side comparison of 2026 vs. 2025 YTD sales and manufacturer-level PPG% badges.
- **Strategy Bubble Matrix**: Visualizes competitive market share vs. growth rate by company.

### 4. Interactive Visualizations (Chart.js)
1. **YTD Sales Comparison with In-Chart PPG% Badges**: Grouped bar chart comparing 2026 vs 2025 sales with color-coded PPG% pill badges displayed directly beside/above each product's sales bar (green for positive growth, red for contraction). Includes toggle between Value (EGP) and Volume (Units) and horizontal/vertical orientation.
2. **Defined Market Share Donut (2026)**: Shows brand shares within the defined market and aggregates "Others" with custom legend.
3. **PPG% Growth Chart**: Dedicated growth comparison across all defined brands.
4. **Manufacturer Benchmark**: Multi-company bar chart with PPG% badges beside each company's sales bar.
5. **Defined MS% vs. PPG% Strategy Matrix**: Bubble scatter plot (bubble diameter proportional to YTD sales).
6. **Monthly Trend Line (Jan–Oct)**: Compares 2026 vs. 2025 trajectories for the Total Defined Market or any individual product.
7. **Interactive Data Table**: Sortable columns, micro-visual progress bars for Defined Market Share, and one-click CSV export.

### 5. Multi-Tab Excel Export (SheetJS)
Exports a multi-sheet `.xlsx` workbook containing:
- **Updated Defined Market**: The full market sheet updated with latest sales figures.
- **KPI Summary**: Rank, Brand, Manufacturer, Molecule, YTD 2026/2025 Value & Units, PPG%, and MS%.
- **By Manufacturer**: Company totals, portfolio product count, PPG%, and value market share.

---

## 🚀 How to Run the Application

No installation, Node.js, Python, or local web server is required. Everything runs directly in modern web browsers:

1. Navigate to:
   ```
   C:\Users\Ehab Atef\.gemini\antigravity\scratch\pharma-dashboard
   ```
2. Double-click **`index.html`** to launch it in Microsoft Edge, Google Chrome, or Mozilla Firefox.
3. To test immediately with real-world Egyptian pharmaceutical data, click **"Load Sample Data — Egyptian PPI Market"** on the upload screen.

---

## 📁 Project Structure

```
pharma-dashboard/
├── index.html          # 3-screen layout (Upload, Column Mapping, Executive Dashboard)
├── css/
│   └── styles.css      # Dark pharmaceutical analytics UI theme
├── js/
│   ├── analytics.js    # Data merge, YTD calculations, PPG%, MS%, Excel export builder
│   ├── dashboard.js    # Chart.js graphs, KPI cards, sorting, and data tables
│   └── app.js          # Controller, file upload, drag-and-drop, filter state
└── README.md           # Documentation and user guide
```
