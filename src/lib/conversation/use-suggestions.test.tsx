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
});
