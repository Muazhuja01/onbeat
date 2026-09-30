dev split, 1 judge vote (run D3; see RESULTS.md)

| Model | Scenarios | Shown | Worth keeping (target 80%) | Invented (target under 5%) | Edits right (target 90%) | Recall | Batch p50 |
|---|---|---|---|---|---|---|---|
| groq:qwen/qwen3.8-27b | 40 | 34 | 97% (33/34) | 0% (0/34) | 100% (11/11) | 97% (31/32) | 4489 ms |
| groq:openai/gpt-oss-20b | 40 (8 failed) | 33 | 91% (30/33) | 3% (1/33) | 82% (9/11) | 69% (22/32) | 600 ms |
