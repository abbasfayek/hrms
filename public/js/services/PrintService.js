// ============================================================================
// PrintService — Centralized Professional A4 Printing & Document Generator
// Generic, isolated window printer supporting RTL, A4 portrait/landscape,
// headers, footers, pagination, and repeatable table headers.
// ============================================================================

import { formatCurrency, formatAmountWithCode } from '../types.js';
import { i18n } from '../i18n.js';

export const PrintService = {
  /**
   * Opens an isolated professional print window for generic tabular reports and documents.
   * @param {Object} opts Printing options
   * @param {string} opts.title Report title
   * @param {string} [opts.companyName] Company name header
   * @param {string} [opts.branchName] Branch name header
   * @param {string} [opts.period] Period / month / date range
   * @param {Array<Object>} opts.columns Column definitions [{ key, label, align?, format? }]
   * @param {Array<Object>} opts.rows Data rows
   * @param {string} [opts.orientation='portrait'] 'portrait' or 'landscape'
   * @param {string} [opts.direction='rtl'] 'rtl' or 'ltr'
   * @param {Object} [opts.totals] Optional summary totals row or key-value pairs
   */
  print(opts = {}) {
    const {
      title = 'Report',
      companyName = 'HRMS Enterprise',
      branchName = '',
      period = '',
      columns = [],
      rows = [],
      orientation = 'portrait',
      direction = 'rtl',
      totals = null,
    } = opts;

    const isEn = direction === 'ltr' || i18n.getLang() === 'en';
    const printDate = new Date().toLocaleString(isEn ? 'en-US' : 'ar-SA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    const doc = document.implementation.createHTMLDocument(title);
    doc.documentElement.setAttribute('dir', direction);
    doc.documentElement.setAttribute('lang', isEn ? 'en' : 'ar');

    // Inject professional printing CSS directly into the isolated document head
    const styleEl = doc.createElement('style');
    styleEl.textContent = `
      @page {
        size: A4 ${orientation};
        margin: 15mm;
      }
      @media print {
        body {
          background: #ffffff !important;
          color: #0f172a !important;
          font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          font-size: 10.5pt;
          line-height: 1.5;
          margin: 0;
          padding: 0;
          direction: ${direction};
        }
        .print-container {
          width: 100%;
          max-width: 100%;
          margin: 0 auto;
          box-sizing: border-box;
        }
        .print-header {
          border-bottom: 2px solid #334155;
          padding-bottom: 12px;
          margin-bottom: 20px;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }
        .print-header h1 {
          font-size: 18pt;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 4px 0;
        }
        .print-header .meta-info {
          font-size: 9.5pt;
          color: #475569;
          margin-top: 2px;
        }
        .print-header .company-badge {
          text-align: ${direction === 'rtl' ? 'left' : 'right'};
          font-size: 10pt;
          font-weight: 700;
          color: #1e293b;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
          font-size: 9.5pt;
        }
        thead {
          display: table-header-group;
        }
        tr {
          page-break-inside: avoid;
          break-inside: avoid;
        }
        th {
          background: #f1f5f9 !important;
          color: #0f172a !important;
          font-weight: 700;
          text-align: ${direction === 'rtl' ? 'right' : 'left'};
          padding: 8px 10px;
          border: 1px solid #cbd5e1;
        }
        td {
          padding: 7px 10px;
          border: 1px solid #cbd5e1;
          color: #1e293b;
          text-align: ${direction === 'rtl' ? 'right' : 'left'};
        }
        tr:nth-child(even) td {
          background: #f8fafc;
        }
        .print-footer {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 8.5pt;
          color: #64748b;
          border-top: 1px solid #cbd5e1;
          padding-top: 8px;
          margin-top: 20px;
        }
        .totals-row td {
          font-weight: 800;
          background: #e2e8f0 !important;
          border-top: 2px solid #0f172a;
        }
      }
    `;
    doc.head.appendChild(styleEl);

    // Build Body
    const bodyEl = doc.body;
    bodyEl.style.margin = '20px';
    bodyEl.style.background = '#ffffff';

    const container = doc.createElement('div');
    container.className = 'print-container';

    // Header section
    const header = doc.createElement('div');
    header.className = 'print-header';
    header.innerHTML = `
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta-info">${period ? `<strong>${isEn ? 'Period' : 'الفترة'}:</strong> ${escapeHtml(period)}` : ''}</div>
        <div class="meta-info">${branchName ? `<strong>${isEn ? 'Branch' : 'الفرع'}:</strong> ${escapeHtml(branchName)}` : ''}</div>
      </div>
      <div class="company-badge">
        <div style="font-size:11pt; font-weight:800;">${escapeHtml(companyName)}</div>
        <div style="font-size:8.5pt; color:#64748b; margin-top:4px;">${printDate}</div>
      </div>
    `;
    container.appendChild(header);

    // Table section
    const table = doc.createElement('table');
    const thead = doc.createElement('thead');
    const trHead = doc.createElement('tr');

    columns.forEach((col) => {
      const th = doc.createElement('th');
      th.textContent = col.label || col.key;
      if (col.align) th.style.textAlign = col.align;
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);
    table.appendChild(thead);

    const tbody = doc.createElement('tbody');
    rows.forEach((row) => {
      const tr = doc.createElement('tr');
      columns.forEach((col) => {
        const td = doc.createElement('td');
        const val = row[col.key];
        if (col.format && typeof col.format === 'function') {
          td.innerHTML = col.format(val, row);
        } else {
          td.textContent = val !== undefined && val !== null ? val : '-';
        }
        if (col.align) td.style.textAlign = col.align;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    // Optional totals row
    if (totals && typeof totals === 'object') {
      const trTotals = doc.createElement('tr');
      trTotals.className = 'totals-row';
      columns.forEach((col, idx) => {
        const td = doc.createElement('td');
        if (idx === 0) {
          td.textContent = isEn ? 'Total' : 'الإجمالي';
        } else if (totals[col.key] !== undefined) {
          const val = totals[col.key];
          td.textContent = col.format && typeof col.format === 'function' ? col.format(val, totals) : val;
        } else {
          td.textContent = '';
        }
        if (col.align) td.style.textAlign = col.align;
        trTotals.appendChild(td);
      });
      tbody.appendChild(trTotals);
    }

    table.appendChild(tbody);
    container.appendChild(table);

    // Footer section
    const footer = doc.createElement('div');
    footer.className = 'print-footer';
    footer.innerHTML = `
      <div>${escapeHtml(companyName)} — ${escapeHtml(title)}</div>
      <div>${isEn ? 'Generated via HRMS Enterprise' : 'صدر من نظام إدارة الموارد البشرية'}</div>
    `;
    container.appendChild(footer);

    bodyEl.appendChild(container);

    // Open isolated print window
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert(isEn ? 'Please allow pop-ups for printing' : 'يرجى السماح بفتح النوافذ المنسقة (Pop-ups) للطباعة');
      return;
    }

    printWindow.document.open();
    printWindow.document.write(doc.documentElement.outerHTML);
    printWindow.document.close();

    // Trigger print after resources load
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 350);
  },
};

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
