// v58.12.7 — jsdom tests for the shared <GroupedTilesView>.
// Covers the 3-test contract in the ship spec:
//   1. Empty state renders {prefix}-empty with the message.
//   2. Error state renders amber card + retry button that calls onRetry.
//   3. 4 items across 2 groups → 2 header banners + 4 tiles + count chips [2,2].
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import GroupedTilesView from '../GroupedTilesView';

describe('GroupedTilesView (v58.12.7)', () => {
  test('empty state renders {prefix}-empty', () => {
    render(<GroupedTilesView items={[]} groupBy={() => 'x'}
      renderTile={() => null} testidPrefix="foo" emptyMessage="No stuff here." />);
    const el = screen.getByTestId('foo-empty');
    expect(el).toBeInTheDocument();
    expect(el.textContent).toMatch(/No stuff here/);
  });

  test('error state renders amber card + retry button calls onRetry', () => {
    const onRetry = jest.fn();
    render(<GroupedTilesView items={[]} groupBy={() => 'x'} renderTile={() => null}
      testidPrefix="foo" error={new Error('Network down')} onRetry={onRetry} />);
    expect(screen.getByTestId('foo-error-card')).toBeInTheDocument();
    expect(screen.getByText(/Network down/)).toBeInTheDocument();
    const btn = screen.getByTestId('foo-retry-btn');
    act(() => { fireEvent.click(btn); });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('groups items by discriminator, renders header + count chip + tiles per group', () => {
    const items = [
      { id: 'a', kind: 'Alpha', created_at: '2026-01-03' },
      { id: 'b', kind: 'Beta',  created_at: '2026-01-02' },
      { id: 'c', kind: 'Alpha', created_at: '2026-01-01' },
      { id: 'd', kind: 'Beta',  created_at: '2026-01-04' },
    ];
    render(<GroupedTilesView items={items} groupBy={(r) => r.kind}
      renderTile={(r) => <span>{r.id}</span>} testidPrefix="foo" />);
    // Two group banners (alphabetical order → Alpha first)
    expect(screen.getByTestId('foo-tile-group-Alpha')).toBeInTheDocument();
    expect(screen.getByTestId('foo-tile-group-Beta')).toBeInTheDocument();
    // Count chips = 2 per group
    expect(screen.getByTestId('foo-tile-count-Alpha').textContent).toBe('2');
    expect(screen.getByTestId('foo-tile-count-Beta').textContent).toBe('2');
    // All 4 tiles rendered
    expect(screen.getByTestId('foo-tile-a')).toBeInTheDocument();
    expect(screen.getByTestId('foo-tile-b')).toBeInTheDocument();
    expect(screen.getByTestId('foo-tile-c')).toBeInTheDocument();
    expect(screen.getByTestId('foo-tile-d')).toBeInTheDocument();
    // Rows within a group sort by date DESC — Alpha: 'a' (2026-01-03) before 'c' (2026-01-01).
    const alphaTiles = screen.getByTestId('foo-tile-group-Alpha').querySelectorAll('[data-testid^="foo-tile-"]');
    // The container itself has testid 'foo-tile-group-Alpha' — the descendants matching `foo-tile-*`
    // include the count chip + individual tiles. Filter to the actual tile rows (rec-id keyed).
    const rowIds = Array.from(alphaTiles)
      .map((n) => n.getAttribute('data-testid'))
      .filter((t) => t === 'foo-tile-a' || t === 'foo-tile-c');
    expect(rowIds).toEqual(['foo-tile-a', 'foo-tile-c']);
  });

  test('groupOrder overrides alpha sort, palette override applied per key', () => {
    const items = [
      { id: 'x', kind: 'medical' },
      { id: 'y', kind: 'near_miss' },
    ];
    const overrides = {
      near_miss: { header: 'bg-amber-50 border-amber-200', dot: 'bg-amber-500', chip: 'bg-amber-100 text-amber-800' },
    };
    render(<GroupedTilesView items={items} groupBy={(r) => r.kind}
      groupOrder={['near_miss', 'medical']}
      groupPaletteOverrides={overrides}
      groupLabels={{ near_miss: 'Near miss', medical: 'Medical' }}
      renderTile={(r) => <span>{r.id}</span>} testidPrefix="inc" />);
    // Order: check header text order in the DOM.
    const groups = document.querySelectorAll('[data-testid^="inc-tile-group-"]');
    expect(groups[0].getAttribute('data-testid')).toBe('inc-tile-group-near_miss');
    expect(groups[1].getAttribute('data-testid')).toBe('inc-tile-group-medical');
    // Label rendered
    expect(screen.getByText('Near miss')).toBeInTheDocument();
    expect(screen.getByText('Medical')).toBeInTheDocument();
    // Palette override for near_miss carries the amber classes
    expect(groups[0].className).toMatch(/border-amber-200/);
  });
});
