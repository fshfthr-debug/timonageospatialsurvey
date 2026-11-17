// CSV helpers for the export buttons (quantity survey and bill of materials).
// Kept separate from the screens so the escaping can be tested on its own.

// A cell needs quoting when it contains a delimiter, a quote, or a line break.
export const escapeCsvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// Builds a CRLF-delimited CSV (CRLF is what Excel expects).
export const buildCsv = (headers, rows) =>
  [headers, ...rows].map(row => row.map(escapeCsvCell).join(',')).join('\r\n');

// Filename-safe fragment: "Bole Tower Phase 1" -> "bole-tower-phase-1".
export const safeFilePart = (value) =>
  String(value || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';

// YYYY-MM-DD, so exported files sort chronologically.
export const todayStamp = () => new Date().toISOString().slice(0, 10);

// Triggers a browser download. The leading BOM makes Excel read the file as
// UTF-8, which matters for values like "m³".
export const downloadCsv = (filename, csv) => {
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
