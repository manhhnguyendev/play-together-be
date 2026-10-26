import { offsetOf, paginated } from './pagination';

describe('pagination helpers', () => {
  it('computes offsets', () => {
    expect(offsetOf(1, 20)).toBe(0);
    expect(offsetOf(3, 10)).toBe(20);
  });

  it('builds page metadata including the final partial page', () => {
    const result = paginated([{ id: 1 }], 41, 3, 20);
    expect(result).toEqual({
      items: [{ id: 1 }],
      meta: { page: 3, pageSize: 20, total: 41, totalPages: 3 },
    });
  });

  it('reports zero total pages for an empty result', () => {
    expect(paginated([], 0, 1, 20).meta.totalPages).toBe(0);
  });
});
