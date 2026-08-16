import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PageTutorial from './PageTutorial';

vi.mock('react-joyride', () => ({
  Joyride: ({
    run,
    steps,
    onEvent,
  }: {
    run: boolean;
    steps: Array<{ content: ReactNode; before?: (data: unknown) => Promise<void> }>;
    onEvent: (value: unknown) => void;
  }) => (
    <div data-testid="joyride">
      {run && steps.map((step, index) => <div key={index}>{step.content}</div>)}
      {run && (
        <>
          <button type="button" onClick={() => onEvent({ status: 'finished', type: 'tour:end' })}>
            Finish mock tour
          </button>
          <button type="button" onClick={() => onEvent({ status: 'skipped', type: 'tour:end' })}>
            Skip mock tour
          </button>
          <button type="button" onClick={() => onEvent({ status: 'skipped', type: 'tour:end' })}>
            Close mock tour
          </button>
          <button type="button" onClick={() => onEvent({ type: 'step:before', index: 2 })}>
            Trigger step two
          </button>
          <button type="button" onClick={() => void steps[0].before?.({})}>
            Prepare first tutorial step
          </button>
          <button type="button" onClick={() => onEvent({ type: 'error:target_not_found' })}>
            Missing tutorial target
          </button>
        </>
      )}
    </div>
  ),
  EVENTS: { TOUR_END: 'tour:end', STEP_BEFORE: 'step:before', TARGET_NOT_FOUND: 'error:target_not_found' },
  STATUS: { FINISHED: 'finished', SKIPPED: 'skipped' },
}));

describe('PageTutorial', () => {
  afterEach(cleanup);

  it('starts only on request, displays rich step guidance, and can be replayed after completion', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    const onReset = vi.fn();
    render(
      <PageTutorial
        onStart={onStart}
        onReset={onReset}
        steps={[
          {
            target: '[data-tour="example"]',
            title: 'Select the source',
            instruction: 'Choose the file to process.',
            why: 'The operation needs an explicit source.',
            media: <img src="/example.png" alt="Example deployment" />,
          },
        ]}
      />,
    );

    expect(screen.queryByText('Select the source')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tutorial' }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Select the source')).toBeVisible();
    expect(screen.getByText('The operation needs an explicit source.')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Example deployment' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Finish mock tour' }));
    expect(screen.queryByText('Select the source')).not.toBeInTheDocument();
    expect(onReset).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Tutorial' }));
    expect(screen.getByText('Select the source')).toBeVisible();
  });

  it.each(['Skip mock tour', 'Close mock tour'])('resets the owning page when the user uses %s', async (control) => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    render(
      <PageTutorial
        onReset={onReset}
        steps={[{ target: '[data-tour="example"]', title: 'Example', instruction: 'Example instruction.' }]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Tutorial' }));
    await user.click(screen.getByRole('button', { name: control }));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Example instruction.')).not.toBeInTheDocument();
  });

  it('resets the owning page if an active tutorial is interrupted by unmounting', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    const { unmount } = render(
      <PageTutorial
        onReset={onReset}
        steps={[{ target: '[data-tour="example"]', title: 'Example', instruction: 'Example instruction.' }]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Tutorial' }));
    unmount();

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('reports the initial and subsequently active steps to its owner', async () => {
    const user = userEvent.setup();
    const onStepChange = vi.fn();
    render(
      <PageTutorial
        onStepChange={onStepChange}
        steps={[{ target: '[data-tour="example"]', title: 'Example', instruction: 'Example instruction.' }]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Tutorial' }));
    await user.click(screen.getByRole('button', { name: 'Trigger step two' }));

    expect(onStepChange).toHaveBeenNthCalledWith(1, 0);
    expect(onStepChange).toHaveBeenNthCalledWith(2, 2);
  });

  it('does not start when disabled', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(
      <PageTutorial
        disabled
        onStart={onStart}
        steps={[{ target: '[data-tour="example"]', title: 'Example', instruction: 'Example instruction.' }]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Tutorial' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Tutorial' }));

    expect(onStart).not.toHaveBeenCalled();
    expect(screen.queryByText('Example instruction.')).not.toBeInTheDocument();
  });

  it('prepares each target before Joyride searches for it', async () => {
    const user = userEvent.setup();
    const onStepPrepare = vi.fn().mockResolvedValue(undefined);
    render(
      <PageTutorial
        onStepPrepare={onStepPrepare}
        steps={[{ target: '[data-tour="example"]', title: 'Example', instruction: 'Example instruction.' }]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Tutorial' }));
    await user.click(screen.getByRole('button', { name: 'Prepare first tutorial step' }));

    expect(onStepPrepare).toHaveBeenCalledWith(0);
  });

  it('resets the owner if a tutorial target cannot be found', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    render(
      <PageTutorial
        onReset={onReset}
        steps={[{ target: '[data-tour="example"]', title: 'Example', instruction: 'Example instruction.' }]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Tutorial' }));
    await user.click(screen.getByRole('button', { name: 'Missing tutorial target' }));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Example instruction.')).not.toBeInTheDocument();
  });
});
