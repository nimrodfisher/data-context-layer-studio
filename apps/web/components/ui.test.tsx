// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EvidenceSelector, TextInput } from './ui';

afterEach(cleanup);

describe('accessible guided controls', () => {
  it('announces inline errors through aria-invalid and aria-describedby', () => {
    render(<TextInput label="Source name" value="" error="Source name is required." readOnly />);

    const input = screen.getByLabelText('Source name');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('Source name is required.').getAttribute('role')).toBe('alert');
  });

  it('selects evidence explicitly without an implicit first record', () => {
    let selected: string[] = [];
    render(
      <EvidenceSelector
        label="Supporting evidence"
        evidence={[
          {
            id: 'evidence-one',
            sourceId: 'source-one',
            kind: 'document',
            locator: 'inline:one',
            retrievedAt: '2026-07-22T10:00:00.000Z',
            confidence: 0.9,
          },
        ]}
        selectedIds={selected}
        onChange={(ids) => {
          selected = ids;
        }}
      />,
    );

    expect((screen.getByRole('checkbox', { name: /inline:one/ }) as HTMLInputElement).checked).toBe(
      false,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /inline:one/ }));
    expect(selected).toEqual(['evidence-one']);
  });
});
