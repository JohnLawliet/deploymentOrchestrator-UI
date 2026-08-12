import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SystemToast } from '@/types/frontend';

type ToastPortalMock = { systemToasts: SystemToast[]; dismissSystemToast: ReturnType<typeof vi.fn> };

const portal = vi.hoisted((): ToastPortalMock => ({ systemToasts: [], dismissSystemToast: vi.fn() }));
vi.mock('@/context/PortalContext', () => ({ usePortal: () => portal }));

import SystemToastQueue from './SystemToastQueue';

describe('SystemToastQueue', () => {
  afterEach(() => {
    cleanup();
    portal.systemToasts = [];
    portal.dismissSystemToast.mockReset();
    vi.useRealTimers();
  });

  it('renders accessible warning and success notifications and supports manual dismissal', () => {
    portal.systemToasts = [
      { id: 'warning', variant: 'warning', message: 'Runtime reconciliation found issues.' },
      { id: 'success', variant: 'success', message: 'Runtime reconciliation recovered.' },
    ];
    render(<SystemToastQueue />);

    expect(screen.getByText('Runtime reconciliation found issues.').closest('[role="status"]')).toHaveClass('border-amber-500/40');
    expect(screen.getByText('Runtime reconciliation recovered.').closest('[role="status"]')).toHaveClass('border-green-500/40');
    expect(screen.getByText('Runtime reconciliation found issues.').closest('[aria-live="polite"]')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss system notification' })[0]);
    expect(portal.dismissSystemToast).toHaveBeenCalledWith('warning');
  });

  it('automatically dismisses live notifications after five seconds', () => {
    vi.useFakeTimers();
    portal.systemToasts = [{ id: 'warning', variant: 'warning', message: 'Runtime reconciliation found issues.' }];
    render(<SystemToastQueue />);

    vi.advanceTimersByTime(4999);
    expect(portal.dismissSystemToast).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(portal.dismissSystemToast).toHaveBeenCalledWith('warning');
  });
});
