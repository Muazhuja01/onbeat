import { fireEvent, render } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStableTargets } from "./use-stable-targets";

let isHolding: () => boolean = () => false;

function Harness({ onRelease }: { onRelease: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const holding = useStableTargets(ref, onRelease, 1500);
  // react-hooks/globals: assign the harness's outer test hook in an effect,
  // not during render (see report for this task's eslint deviation note).
  useEffect(() => {
    isHolding = holding;
  }, [holding]);
  return (
    <div ref={ref} data-testid="list">
      <button>Reply</button>
    </div>
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useStableTargets", () => {
  it("holds while the pointer moves inside and releases after 1.5 s of stillness", () => {
    const onRelease = vi.fn();
    const { getByTestId } = render(<Harness onRelease={onRelease} />);
    fireEvent.pointerEnter(getByTestId("list"));
    expect(isHolding()).toBe(true);
    vi.advanceTimersByTime(1000);
    fireEvent.pointerMove(getByTestId("list"));
    vi.advanceTimersByTime(1000);
    expect(isHolding()).toBe(true);
    expect(onRelease).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(isHolding()).toBe(false);
    expect(onRelease).toHaveBeenCalled();
  });

  it("releases when the pointer leaves", () => {
    const onRelease = vi.fn();
    const { getByTestId } = render(<Harness onRelease={onRelease} />);
    fireEvent.pointerEnter(getByTestId("list"));
    fireEvent.pointerLeave(getByTestId("list"));
    expect(isHolding()).toBe(false);
    expect(onRelease).toHaveBeenCalled();
  });

  it("holds while a reply has keyboard focus", () => {
    const onRelease = vi.fn();
    const { getByRole } = render(<Harness onRelease={onRelease} />);
    fireEvent.focusIn(getByRole("button"));
    expect(isHolding()).toBe(true);
    fireEvent.focusOut(getByRole("button"), { relatedTarget: document.body });
    expect(isHolding()).toBe(false);
  });
});
