import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BookOpen } from 'lucide-react';
import { EVENTS, Joyride, STATUS, type EventData, type Placement, type Step } from 'react-joyride';
import { Button } from '@/components/ui/button';

export type TutorialStep = {
  target: string;
  title: string;
  instruction: string;
  why?: string;
  media?: ReactNode;
  placement?: Placement;
  before?: Step['before'];
  targetWaitTimeout?: number;
};

type PageTutorialProps = {
  steps: TutorialStep[];
  disabled?: boolean;
  onStart?: () => void;
  onReset?: () => void;
  onStepPrepare?: (index: number) => void | Promise<void>;
  onStepChange?: (index: number) => void;
};

export default function PageTutorial({
  steps,
  disabled = false,
  onStart,
  onReset,
  onStepPrepare,
  onStepChange,
}: PageTutorialProps) {
  const [run, setRun] = useState(false);
  const activeRef = useRef(false);
  const joyrideSteps = useMemo<Step[]>(
    () =>
      steps.map(({ title, instruction, why, media, ...step }, index) => ({
        ...step,
        before: async (data) => {
          await step.before?.(data);
          await onStepPrepare?.(index);
        },
        skipBeacon: true,
        content: (
          <div className="space-y-3">
            <div>
              <p className="font-semibold text-foreground">{title}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{instruction}</p>
            </div>
            {why && (
              <p className="rounded-md bg-muted px-3 py-2 text-sm leading-5 text-muted-foreground">
                <span className="font-medium text-foreground">Why this is required: </span>
                {why}
              </p>
            )}
            {media}
          </div>
        ),
      })),
    [onStepPrepare, steps],
  );

  const reset = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setRun(false);
    onReset?.();
  }, [onReset]);

  useEffect(
    () => () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      onReset?.();
    },
    [onReset],
  );

  const handleEvent = useCallback(
    (data: EventData) => {
      if (data.type === EVENTS.STEP_BEFORE) onStepChange?.(data.index);
      if (data.type === EVENTS.TARGET_NOT_FOUND) reset();
      if (data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED || data.type === EVENTS.TOUR_END) reset();
    },
    [onStepChange, reset],
  );

  const start = () => {
    if (disabled) return;
    activeRef.current = true;
    onStart?.();
    onStepChange?.(0);
    setRun(true);
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="gap-2" onClick={start} disabled={disabled}>
        <BookOpen className="h-4 w-4" />
        Tutorial
      </Button>
      <Joyride
        continuous
        onEvent={handleEvent}
        run={run}
        scrollToFirstStep
        steps={joyrideSteps}
        locale={{ back: 'Back', close: 'Close', last: 'Finish', next: 'Next', skip: 'Skip' }}
        options={{
          buttons: ['back', 'close', 'primary', 'skip'],
          closeButtonAction: 'skip',
          overlayClickAction: false,
          overlayColor: 'rgba(15, 23, 42, 0.58)',
          primaryColor: 'hsl(var(--primary))',
          showProgress: true,
          textColor: 'hsl(var(--foreground))',
          zIndex: 200,
        }}
        styles={{
          tooltip: { backgroundColor: 'hsl(var(--card))', borderRadius: 8 },
          tooltipContent: { padding: '18px 18px 6px', textAlign: 'left' },
          buttonBack: { color: 'hsl(var(--muted-foreground))' },
          buttonClose: { color: 'hsl(var(--muted-foreground))' },
        }}
      />
    </>
  );
}
