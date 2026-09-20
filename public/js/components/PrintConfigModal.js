// ============================================================================
// PrintConfigModal — Centralized Print Configuration & Preview Modal
// Allows column toggling, reordering (move up/down), orientation selection,
// RTL/LTR control, live preview, and final isolated printing.
// ============================================================================

import { createModal } from './Modal.js';
import { Icons } from '../icons.js';
import { i18n, t } from '../i18n.js';
import { PrintService } from '../services/PrintService.js';

export function openPrintConfigModal(opts = {}) {
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

  // State copies for local manipulation
  let activeCols = columns.map((c, idx) => ({
    key: c.key,
    label: c.label || c.key,
    visible: c.visible !== false,
    format: c.format,
    align: c.align,
    originalIndex: idx,
  }));

  let currentOrientation = orientation;
  let currentDirection = direction;

  const renderColumnsEditor = () => {
    return activeCols.map((col, index) => `
      <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:var(--bg-card); border:1px solid var(--border-color); border-radius:6px; gap:8px;" data-col-index="${index}">
        <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
          <input type="checkbox" class="col-toggle-checkbox" data-index="${index}" ${col.visible ? 'checked' : ''} style="cursor:pointer; width:16px; height:16px;">
          <span style="font-size:13px; font-weight:700; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(col.label)}</span>
        </div>
        <div style="display:flex; align-items:center; gap:4px;">
          <button type="button" class="btn btn-sm btn-outline col-move-up" data-index="${index}" ${index === 0 ? 'disabled style="opacity:0.3;"' : ''} title="${isEn ? 'Move Up' : 'تحريك لأعلى'}">▲</button>
          <button type="button" class="btn btn-sm btn-outline col-move-down" data-index="${index}" ${index === activeCols.length - 1 ? 'disabled style="opacity:0.3;"' : ''} title="${isEn ? 'Move Down' : 'تحريك لأسفل'}">▼</button>
        </div>
      </div>
    `).join('');
  };

  const getPreviewHtml = () => {
    const visibleCols = activeCols.filter((c) => c.visible);
    const printDate = new Date().toLocaleString(isEn ? 'en-US' : 'ar-SA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    return `
      <div style="background:#ffffff; color:#0f172a; padding:24px; border-radius:8px; border:1px solid #cbd5e1; font-family:system-ui, sans-serif; direction:${currentDirection}; box-sizing:border-box; width:100%;">
        <div style="border-bottom:2px solid #334155; padding-bottom:12px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <h2 style="font-size:16pt; font-weight:800; color:#0f172a; margin:0 0 4px 0;">${escapeHtml(title)}</h2>
            <div style="font-size:9pt; color:#475569;">${period ? `<strong>${isEn ? 'Period' : 'الفترة'}:</strong> ${escapeHtml(period)}` : ''}</div>
            <div style="font-size:9pt; color:#475569;">${branchName ? `<strong>${isEn ? 'Branch' : 'الفرع'}:</strong> ${escapeHtml(branchName)}` : ''}</div>
          </div>
          <div style="text-align:${currentDirection === 'rtl' ? 'left' : 'right'};">
            <div style="font-size:10pt; font-weight:800; color:#1e293b;">${escapeHtml(companyName)}</div>
            <div style="font-size:8pt; color:#64748b; margin-top:2px;">${printDate}</div>
          </div>
        </div>

        <div style="overflow-x:auto; max-height:350px;">
          <table style="width:100%; border-collapse:collapse; font-size:9pt;">
            <thead>
              <tr style="background:#f1f5f9;">
                ${visibleCols.map((c) => `<th style="border:1px solid #cbd5e1; padding:6px 8px; text-align:${c.align || (currentDirection === 'rtl' ? 'right' : 'left')}; font-weight:700;">${escapeHtml(c.label)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${rows.length === 0 ? `<tr><td colspan="${visibleCols.length}" style="text-align:center; padding:20px; color:#64748b;">${isEn ? 'No data available' : 'لا توجد بيانات'}</td></tr>` : 
                rows.map((row) => `
                  <tr>
                    ${visibleCols.map((c) => {
                      const val = row[c.key];
                      const formatted = c.format && typeof c.format === 'function' ? c.format(val, row) : (val !== undefined && val !== null ? escapeHtml(val) : '-');
                      return `<td style="border:1px solid #cbd5e1; padding:6px 8px; text-align:${c.align || (currentDirection === 'rtl' ? 'right' : 'left')};">${formatted}</td>`;
                    }).join('')}
                  </tr>
                `).join('')
              }
              ${totals && typeof totals === 'object' ? `
                <tr style="background:#e2e8f0; font-weight:800;">
                  ${visibleCols.map((c, idx) => {
                    const val = totals[c.key];
                    const formatted = val !== undefined ? (c.format && typeof c.format === 'function' ? c.format(val, totals) : escapeHtml(val)) : (idx === 0 ? (isEn ? 'Total' : 'الإجمالي') : '');
                    return `<td style="border:1px solid #0f172a; padding:6px 8px; text-align:${c.align || (currentDirection === 'rtl' ? 'right' : 'left')};">${formatted}</td>`;
                  }).join('')}
                </tr>
              ` : ''}
            </tbody>
          </table>
        </div>
      </div>
    `;
  };

  const bodyHtml = `
    <div style="display:grid; grid-template-columns: 280px 1fr; gap:20px; align-items:start;" class="print-config-layout">
      <!-- Left Config Sidebar -->
      <div style="background:var(--bg-card-hover); padding:16px; border-radius:8px; border:1px solid var(--border-color); display:flex; flex-direction:column; gap:16px;">
        <div>
          <div style="font-weight:800; font-size:14px; color:var(--text-main); margin-bottom:8px;">
            ⚙️ ${isEn ? 'Print Settings' : 'إعدادات الطباعة'}
          </div>
          
          <div style="display:flex; flex-direction:column; gap:10px; margin-top:12px;">
            <div>
              <label style="font-size:12px; font-weight:700; color:var(--text-muted); display:block; margin-bottom:4px;">${isEn ? 'Orientation' : 'اتجاه الصفحة'}</label>
              <select id="print-orientation-select" class="form-input" style="width:100%; padding:6px 8px; font-size:13px;">
                <option value="portrait" ${currentOrientation === 'portrait' ? 'selected' : ''}>${isEn ? 'Portrait (عمودي)' : 'عمودي (Portrait)'}</option>
                <option value="landscape" ${currentOrientation === 'landscape' ? 'selected' : ''}>${isEn ? 'Landscape (أفقي)' : 'أفقي (Landscape)'}</option>
              </select>
            </div>

            <div>
              <label style="font-size:12px; font-weight:700; color:var(--text-muted); display:block; margin-bottom:4px;">${isEn ? 'Direction' : 'اتجاه النص'}</label>
              <select id="print-direction-select" class="form-input" style="width:100%; padding:6px 8px; font-size:13px;">
                <option value="rtl" ${currentDirection === 'rtl' ? 'selected' : ''}>RTL (عربي)</option>
                <option value="ltr" ${currentDirection === 'ltr' ? 'selected' : ''}>LTR (English)</option>
              </select>
            </div>
          </div>
        </div>

        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-weight:800; font-size:13px; color:var(--text-main);">📋 ${isEn ? 'Columns' : 'الأعمدة'}</span>
            <div style="display:flex; gap:4px;">
              <button type="button" class="btn btn-sm btn-outline" id="btn-col-all" style="font-size:11px; padding:2px 6px;">${isEn ? 'All' : 'الكل'}</button>
              <button type="button" class="btn btn-sm btn-outline" id="btn-col-none" style="font-size:11px; padding:2px 6px;">${isEn ? 'None' : 'إخفاء الكل'}</button>
              <button type="button" class="btn btn-sm btn-outline" id="btn-col-reset" style="font-size:11px; padding:2px 6px;" title="${isEn ? 'Reset' : 'إعادة ضبط'}">🔄</button>
            </div>
          </div>
          <div id="print-columns-list" style="display:flex; flex-direction:column; gap:6px; max-height:220px; overflow-y:auto; padding-right:2px;">
            ${renderColumnsEditor()}
          </div>
        </div>
      </div>

      <!-- Right Live Preview -->
      <div style="display:flex; flex-direction:column; gap:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:800; font-size:13px; color:var(--text-main);">👁️ ${isEn ? 'A4 Live Preview' : 'معاينة حية مقاس A4'}</span>
          <span style="font-size:11.5px; color:var(--text-muted);">${isEn ? 'Updates automatically' : 'تحديث فوري للإعدادات'}</span>
        </div>
        <div id="print-preview-pane" style="background:#f1f5f9; padding:16px; border-radius:8px; border:1px dashed var(--border-color); min-height:380px; display:flex; align-items:center; justify-content:center;">
          ${getPreviewHtml()}
        </div>
      </div>
    </div>
  `;

  const footerHtml = `
    <button type="button" class="btn btn-secondary close-modal-btn">${t('cancel')}</button>
    <button type="button" class="btn btn-primary" id="btn-execute-print">
      ${Icons.printer(16)} ${isEn ? 'Print Report Now' : '🖨️ طباعة التقرير الآن'}
    </button>
  `;

  const modalRef = createModal({
    title: `${isEn ? 'Print Preview & Configuration' : 'إعداد ومعاينة الطباعة'} — ${title}`,
    size: 'xl',
    bodyHtml,
    footerHtml,
    onOpen: (overlay, close) => {
      const previewPane = overlay.querySelector('#print-preview-pane');
      const columnsList = overlay.querySelector('#print-columns-list');
      const orientationSelect = overlay.querySelector('#print-orientation-select');
      const directionSelect = overlay.querySelector('#print-direction-select');

      const refreshPreviewAndEditor = () => {
        previewPane.innerHTML = getPreviewHtml();
        columnsList.innerHTML = renderColumnsEditor();
        attachEventListeners();
      };

      const attachEventListeners = () => {
        columnsList.querySelectorAll('.col-toggle-checkbox').forEach((chk) => {
          chk.addEventListener('change', (e) => {
            const idx = Number(e.target.getAttribute('data-index'));
            activeCols[idx].visible = e.target.checked;
            previewPane.innerHTML = getPreviewHtml();
          });
        });

        columnsList.querySelectorAll('.col-move-up').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            const idx = Number(e.target.getAttribute('data-index'));
            if (idx > 0) {
              const temp = activeCols[idx];
              activeCols[idx] = activeCols[idx - 1];
              activeCols[idx - 1] = temp;
              refreshPreviewAndEditor();
            }
          });
        });

        columnsList.querySelectorAll('.col-move-down').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            const idx = Number(e.target.getAttribute('data-index'));
            if (idx < activeCols.length - 1) {
              const temp = activeCols[idx];
              activeCols[idx] = activeCols[idx + 1];
              activeCols[idx + 1] = temp;
              refreshPreviewAndEditor();
            }
          });
        });
      };

      attachEventListeners();

      orientationSelect.addEventListener('change', (e) => {
        currentOrientation = e.target.value;
        refreshPreviewAndEditor();
      });

      directionSelect.addEventListener('change', (e) => {
        currentDirection = e.target.value;
        refreshPreviewAndEditor();
      });

      overlay.querySelector('#btn-col-all').addEventListener('click', () => {
        activeCols.forEach((c) => { c.visible = true; });
        refreshPreviewAndEditor();
      });

      overlay.querySelector('#btn-col-none').addEventListener('click', () => {
        activeCols.forEach((c) => { c.visible = false; });
        refreshPreviewAndEditor();
      });

      overlay.querySelector('#btn-col-reset').addEventListener('click', () => {
        activeCols = columns.map((c, idx) => ({
          key: c.key,
          label: c.label || c.key,
          visible: c.visible !== false,
          format: c.format,
          align: c.align,
          originalIndex: idx,
        }));
        refreshPreviewAndEditor();
      });

      overlay.querySelector('.close-modal-btn').addEventListener('click', close);

      overlay.querySelector('#btn-execute-print').addEventListener('click', () => {
        const finalCols = activeCols.filter((c) => c.visible);
        if (finalCols.length === 0) {
          alert(isEn ? 'Please select at least one column to print.' : 'يرجى اختيار عمود واحد على الأقل للطباعة.');
          return;
        }
        PrintService.print({
          title,
          companyName,
          branchName,
          period,
          columns: finalCols,
          rows,
          orientation: currentOrientation,
          direction: currentDirection,
          totals,
        });
        close();
      });
    },
  });

  return modalRef;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
