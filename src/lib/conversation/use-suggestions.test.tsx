import { act, renderHook } from "@testing-library/react";
import { useReducer } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/lib/memory/store";
import { SuggestUnavailableError, type SuggestClient, type SuggestInput, type SuggestUpdate } from "@/lib/suggest/client";
import { conversationReducer, initialConversation } from "./reducer";
import { useSuggestions } from "./use-suggestions";

function fakeClient(result: SuggestUpdate | Error) {
  const calls: SuggestInput[] = [];
  const client = {
    calls,
    cancel: vi.fn(),
    request: vi.fn(async (input: SuggestInput, onUpdate: (u: SuggestUpdate) => void) => {
      calls.push(input);
      if (result instanceof Error) throw result;
      onUpdate(result);
      return result;
    }),
  };
  return client as unknown as SuggestClient & { calls: SuggestInput[] };
}

const done: SuggestUpdate = { replies: [{ text: "Large, please.", noteIds: [], source: "model" }], reactions: [], done: true };

async function setup(client: SuggestClient) {
  const memory = await MemoryStore.create();
  await memory.replaceAll([], [{ id: "p", text: "My usual, please.", context: { timeOfDay: "morning" }, timesUsed: 3, lastUsed: 1 }]);
  return renderHook(() => {
    const [state, dispatch] = useReducer(conversationReducer, initialConversation);
    useSuggestions({ client, memory, state, dispatch, isHolding: () => false, debounceMs: 300 });
    return { state, dispatch };
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useSuggestions", () => {
  it("asks for replies and reactions right after the partner speaks", async () => {
    const client = fakeClient(done);
    const { result } = await setup(client);
    await act(async () => result.current.dispatch({ type: "partnerSaid", id: "1", text: "What size?", at: 1 }));
    expect(client.calls[0]).toMatchObject({ mode: "replies+reactions", partnerSaid: "What size?" });
    expect(result.current.state.replies[0].text).toBe("Large, please.");
  });

  it("shows phrase matches immediately and asks the model after the debounce", async () => {
    const client = fakeClient(done);
    const { result } = await setup(client);
    await act(async () => result.current.dispatch({ type: "typed", text: "my us" }));
    expect(result.current.state.replies.map((r) => r.source)).toEqual(["phrase"]);
    expect(client.calls).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(client.calls[0]).toMatchObject({ mode: "replies", typed: "my us" });
  });

  it("does not ask the model for a single character", async () => {
    const client = fakeClient(done);
    const { result } = await setup(client);
    await act(async () => result.current.dispatch({ type: "typed", text: "m" }));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(client.calls).toHaveLength(0);
  });

  it("pauses when the service is unavailable", async () => {
    const client = fakeClient(new SuggestUnavailableError("HTTP 503"));
    const { result } = await setup(client);
    await act(async () => result.current.dispatch({ type: "partnerSaid", id: "1", text: "Hi", at: 1 }));
    expect(result.current.state.status).toBe("paused");
  });

  it("recovers by pausing instead of leaving an unhandled rejection on an unexpected error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = fakeClient(new Error("boom"));
    const { result } = await setup(client);
    await act(async () => result.current.dispatch({ type: "partnerSaid", id: "1", text: "Hi", at: 1 }));
    expect(result.current.state.status).toBe("paused");
    spy.mockRestore();
  });

  it("cancels an in-flight typed request when the typed text is cleared", async () => {
    const calls: SuggestInput[] = [];
    let respond: (() => void) | null = null;
    let cancelled = false;
    const client = {
      calls,
      cancel: vi.fn(() => {
        cancelled = true;
      }),
      request: vi.fn(
        (input: SuggestInput, onUpdate: (u: SuggestUpdate) => void) =>
          new Promise<SuggestUpdate | null>((resolve) => {
            calls.push(input);
            cancelled = false;
            respond = () => {
              if (cancelled) {
                resolve(null);
                return;
              }
              const result: SuggestUpdate = { replies: [{ text: "late", noteIds: [], source: "model" }], reactions: [], done: true };
              onUpdate(result);
              resolve(result);
            };
          }),
      ),
    } as unknown as SuggestClient & { calls: SuggestInput[] };

    const { result } = await setup(client);
    await act(async () => result.current.dispatch({ type: "typed", text: "my us" }));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(client.calls).toHaveLength(1);

    await act(async () => result.current.dispatch({ type: "typed", text: "" }));
    expect(client.cancel).toHaveBeenCalled();

    await act(async () => {
      respond?.();
    });
    expect(result.current.state.replies.some((r) => r.text === "late")).toBe(false);
  });

  it("returns to idle instead of staying stuck thinking when the typed text is cleared mid-request", async () => {
    const calls: SuggestInput[] = [];
    let resolveRequest: (() => void) | null = null;
    const client = {
      calls,
      cancel: vi.fn(),
      request: vi.fn(
        (input: SuggestInput) =>
          new Promise<SuggestUpdate | null>((resolve) => {
            calls.push(input);
            resolveRequest = () => resolve(null);
          }),
      ),
    } as unknown as SuggestClient & { calls: SuggestInput[] };

    const { result } = await setup(client);
    // "zz" has no matching phrase, so status goes to "thinking" while the
    // model request is outstanding, instead of resolving instantly from a
    // local phrase match.
    await act(async () => result.current.dispatch({ type: "typed", text: "zz" }));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.state.status).toBe("thinking");

    await act(async () => result.current.dispatch({ type: "typed", text: "" }));
    expect(client.cancel).toHaveBeenCalled();
    expect(result.current.state.status).toBe("idle");

    await act(async () => {
      resolveRequest?.();
    });
  });

  it("does not cancel a just-started partner-turn request when the client becomes available", async () => {
    const memory = await MemoryStore.create();
    const partnerReply: SuggestUpdate = { replies: [{ text: "Sure, here.", noteIds: [], source: "model" }], reactions: [], done: true };
    const client = fakeClient(partnerReply);

    const { result, rerender } = renderHook(
      ({ client: c }: { client: SuggestClient | null }) => {
        const [state, dispatch] = useReducer(conversationReducer, initialConversation);
        useSuggestions({ client: c, memory, state, dispatch, isHolding: () => false, debounceMs: 300 });
        return { state, dispatch };
      },
      { initialProps: { client: null as SuggestClient | null } },
    );

    // The partner speaks while there is no client yet (e.g. still loading).
    await act(async () => result.current.dispatch({ type: "partnerSaid", id: "1", text: "What size?", at: 1 }));
    expect(client.calls).toHaveLength(0);

    // The client becomes available with typed text still empty. This also
    // changes `run`'s identity, which used to make the typing effect cancel
    // the partner-turn request the partner effect starts in the same commit.
    await act(async () => rerender({ client }));

    expect(client.calls.length).toBeGreaterThanOrEqual(1);
    expect(client.cancel).not.toHaveBeenCalled();
    expect(result.current.state.replies[0]?.text).toBe("Sure, here.");
  });
});
