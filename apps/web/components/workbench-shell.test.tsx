// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WorkbenchShell } from './workbench-shell';

afterEach(cleanup);

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
      onchange: null,
    }),
  });
});

describe('WorkbenchShell', () => {
  it('renders the complete domain path as keyboard buttons', () => {
    render(
      <WorkbenchShell activeStep="domain" evidenceOpen onEvidenceToggle={() => undefined}>
        <p>Canvas</p>
      </WorkbenchShell>,
    );

    for (const label of [
      'Chat',
      'Domain',
      'Sources',
      'Business',
      'Data map',
      'Metrics',
      'Caveats',
      'Governance',
      'Clarify',
      'Review',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy();
    }
  }, 15_000);

  it('collapses evidence without removing the authoring canvas', () => {
    let toggled = false;
    render(
      <WorkbenchShell
        activeStep="domain"
        evidenceOpen
        onEvidenceToggle={() => {
          toggled = true;
        }}
      >
        <p>Focused authoring canvas</p>
      </WorkbenchShell>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Collapse evidence' }));

    expect(toggled).toBe(true);
    expect(screen.getByText('Focused authoring canvas')).toBeTruthy();
  });

  it('reflects controlled evidence state after a toggle', () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <WorkbenchShell
          activeStep="domain"
          evidenceOpen={open}
          onEvidenceToggle={() => setOpen((value) => !value)}
        >
          <p>Canvas</p>
        </WorkbenchShell>
      );
    }
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse evidence' }));

    expect(
      screen.getByRole('button', { name: 'Open evidence' }).getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('opens evidence as a modal dialog on compact viewports', async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: query.includes('max-width'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
        onchange: null,
      }),
    });
    render(
      <WorkbenchShell activeStep="domain" evidenceOpen onEvidenceToggle={() => undefined}>
        <p>Canvas</p>
      </WorkbenchShell>,
    );

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Evidence' })).toBeTruthy();
    });
  });
});
