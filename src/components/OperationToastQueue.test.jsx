import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const portal = vi.hoisted(() => ({ operationToasts: [], dismissOperationToast: vi.fn() }));
vi.mock('@/context/PortalContext', () => ({ usePortal: () => portal }));

import OperationToastQueue from './OperationToastQueue';

describe('OperationToastQueue', () => {
  afterEach(() => {
    cleanup();
    portal.operationToasts = [];
    portal.dismissOperationToast.mockReset();
  });

  it('renders accessible success and restrained failure notifications using summaries only', () => {
    portal.operationToasts = [
      {
        id: 'one:COMPLETED',
        heading: 'WAR operation completed',
        username: 'John Smith',
        targetLabel: 'Orders profile',
        deploymentId: 'one',
        outcome: 'COMPLETED',
      },
      {
        id: 'two:FAILED',
        heading: 'JAR operation failed',
        username: 'Mary Smith',
        targetLabel: 'Orders API',
        deploymentId: 'two',
        outcome: 'FAILED',
      },
    ];
    render(<OperationToastQueue />);

    expect(screen.getByText('John Smith · Orders profile')).toBeVisible();
    expect(screen.getByText('Deployment ID: one')).toBeVisible();
    expect(screen.getByText('Mary Smith · Orders API').closest('[role="status"]')).toHaveClass('border-amber-500/40');
    expect(screen.getByText('John Smith · Orders profile').closest('[role="status"]')).toHaveClass('border-green-500/40');
    expect(screen.getByText('John Smith · Orders profile').closest('[aria-live="polite"]')).toBeInTheDocument();
    expect(screen.queryByText(/2026|finished cleanly|stopped safely/)).not.toBeInTheDocument();
  });

  it('dismisses a queued notification by its deduplication key', () => {
    portal.operationToasts = [
      {
        id: 'operation-1:FAILED',
        heading: 'WAR operation failed',
        username: 'Mary',
        targetLabel: 'Orders profile',
        deploymentId: 'operation-1',
        outcome: 'FAILED',
      },
    ];
    render(<OperationToastQueue />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss operation notification' }));
    expect(portal.dismissOperationToast).toHaveBeenCalledWith('operation-1:FAILED');
  });
});
