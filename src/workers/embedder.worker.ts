import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

env.allowLocalModels = false;

// pipeline()'s overloads are too complex for TypeScript here; narrow them.
type Factory = (
  task: "feature-extraction",
  model: string,
  options: { dtype: "q8"; device: "wasm" },
) => Promise<FeatureExtractionPipeline>;
const createExtractor = pipeline as unknown as Factory;

let extractor: Promise<FeatureExtractionPipeline> | null = null;

self.onmessage = async (event: MessageEvent<{ id: number; texts: string[] }>) => {
  const { id, texts } = event.data;
  try {
    extractor ??= createExtractor("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8", device: "wasm" });
    const fe = await extractor;
    const out = await fe(texts, { pooling: "mean", normalize: true });
    self.postMessage({ id, vectors: out.tolist() as number[][] });
  } catch (err) {
    extractor = null;
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
