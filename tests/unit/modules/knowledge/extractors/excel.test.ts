import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/lib/errors';

// Use vi.hoisted so mock fns are available when vi.mock factory runs (it is hoisted)
const { mockSheetToJson, mockRead } = vi.hoisted(() => ({
  mockSheetToJson: vi.fn(),
  mockRead: vi.fn(),
}));

vi.mock('xlsx', () => ({
  default: {
    read: mockRead,
    utils: { sheet_to_json: mockSheetToJson },
  },
  read: mockRead,
  utils: { sheet_to_json: mockSheetToJson },
}));

import { extractExcel } from '@/modules/knowledge/extractors/excel';

function makeWorkbook(sheets: Record<string, unknown[][]>) {
  const sheetNames = Object.keys(sheets);
  const Sheets: Record<string, unknown> = {};
  for (const name of sheetNames) {
    Sheets[name] = { __data: sheets[name] };
  }
  // When sheet_to_json is called, return the data for that sheet
  mockSheetToJson.mockImplementation((sheet: any) => {
    // Find the sheet name by matching the sheet object
    for (const [name, data] of Object.entries(sheets)) {
      if (sheet === Sheets[name]) return data;
    }
    return [];
  });
  return { SheetNames: sheetNames, Sheets };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── extractExcel ─────────────────────────────────────────────────────────────

describe('extractExcel', () => {
  it('单 sheet 转为 Markdown 表格', async () => {
    const rows = [
      ['Name', 'Age', 'Team'],
      ['Alice', 30, 'Alpha'],
      ['Bob', 25, 'Beta'],
    ];
    const wb = makeWorkbook({ Sheet1: rows });
    mockRead.mockReturnValue(wb);

    const result = await extractExcel(Buffer.from('fake-xlsx'), 'application/vnd.ms-excel');

    expect(result.text).toContain('## Sheet1');
    expect(result.text).toContain('| Name | Age | Team |');
    expect(result.text).toContain('| ------ | ------ | ------ |');
    expect(result.text).toContain('| Alice | 30 | Alpha |');
    expect(result.text).toContain('| Bob | 25 | Beta |');
    expect(result.truncated).toBe(false);
  });

  it('多 sheet 以标题分隔', async () => {
    const wb = makeWorkbook({
      Drivers: [['Driver', 'Rating'], ['Max', 99]],
      Teams: [['Team', 'Points'], ['Red Bull', 500]],
    });
    mockRead.mockReturnValue(wb);

    const result = await extractExcel(Buffer.from('multi'), 'application/vnd.ms-excel');

    expect(result.text).toContain('## Drivers');
    expect(result.text).toContain('## Teams');
    expect(result.text).toContain('| Driver | Rating |');
    expect(result.text).toContain('| Team | Points |');
  });

  it('超过 50 sheets → AppError CONTENT_TOO_LARGE', async () => {
    const sheets: Record<string, unknown[][]> = {};
    for (let i = 0; i < 51; i++) {
      sheets[`Sheet${i}`] = [['A']];
    }
    const wb = makeWorkbook(sheets);
    mockRead.mockReturnValue(wb);

    await expect(
      extractExcel(Buffer.from('too-many'), 'application/vnd.ms-excel'),
    ).rejects.toMatchObject({ code: 'CONTENT_TOO_LARGE' });
  });

  it('超 10000 行 → AppError CONTENT_TOO_LARGE', async () => {
    const rows = Array.from({ length: 10001 }, (_, i) => [`row${i}`]);
    const wb = makeWorkbook({ BigSheet: rows });
    mockRead.mockReturnValue(wb);

    await expect(
      extractExcel(Buffer.from('too-many-rows'), 'application/vnd.ms-excel'),
    ).rejects.toMatchObject({ code: 'CONTENT_TOO_LARGE' });
  });

  it('超 100 列 → AppError CONTENT_TOO_LARGE', async () => {
    const row = Array.from({ length: 101 }, (_, i) => `col${i}`);
    const wb = makeWorkbook({ WideSheet: [row] });
    mockRead.mockReturnValue(wb);

    await expect(
      extractExcel(Buffer.from('wide'), 'application/vnd.ms-excel'),
    ).rejects.toMatchObject({ code: 'CONTENT_TOO_LARGE' });
  });

  it('空行被裁剪', async () => {
    const rows = [
      ['A', 'B'],
      ['', ''],
      ['x', 'y'],
      ['', ''],
    ];
    const wb = makeWorkbook({ Sheet1: rows });
    mockRead.mockReturnValue(wb);

    const result = await extractExcel(Buffer.from('empty-rows'), 'application/vnd.ms-excel');

    // Count the number of data lines (excluding header and separator)
    const lines = result.text.split('\n').filter((l) => l.startsWith('|'));
    // header + separator + 1 data row (empty rows removed)
    expect(lines).toHaveLength(3);
  });

  it('空 workbook（无 sheet）返回空结果', async () => {
    mockRead.mockReturnValue({ SheetNames: [], Sheets: {} });

    const result = await extractExcel(Buffer.from('empty-wb'), 'application/vnd.ms-excel');

    expect(result.text).toBe('');
    expect(result.charCount).toBe(0);
    expect(result.warnings).toContain('Workbook contains no sheets');
  });

  it('xlsx.read 抛出错误 → AppError EXTRACTION_FAILED', async () => {
    mockRead.mockImplementation(() => {
      throw new Error('Invalid file');
    });

    await expect(
      extractExcel(Buffer.from('bad'), 'application/vnd.ms-excel'),
    ).rejects.toMatchObject({ code: 'EXTRACTION_FAILED' });
  });

  it('公式单元格取缓存值（cell.v）', async () => {
    // sheet_to_json returns computed values; we just verify the value is used
    const rows = [
      ['Formula', 'Result'],
      ['=SUM(A1:A2)', 42],
    ];
    const wb = makeWorkbook({ Formulas: rows });
    mockRead.mockReturnValue(wb);

    const result = await extractExcel(
      Buffer.from('formula'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    expect(result.text).toContain('42');
    expect(result.text).not.toContain('=SUM');
  });
});
