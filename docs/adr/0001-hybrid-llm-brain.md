# ADR-0001: Hybrid brain — cloud LLM + local embeddings/voice

## Context
Target machine: 16 GB RAM, RTX 4050 laptop GPU (6 GB VRAM). A single strong local LLM, local voice models, and the n8n/Postgres/Qdrant stack running simultaneously would not fit comfortably, and a small enough local LLM to fit (~7B) would compromise intent-classification and synthesis accuracy for a "no hallucination" requirement.

## Decision
Split the workload: OpenAI (`gpt-4o-mini` for classification/routing/sub-agents, `gpt-4o` for extraction/synthesis) handles reasoning; local Ollama (`nomic-embed-text`) handles embeddings; local `faster-whisper`/Piper handle voice. Only the reasoning step needs an API key and network call — retrieval, storage, and voice all run on-machine.

## Consequences
- Requires an `OPENAI_API_KEY` and ongoing API cost — acceptable for the accuracy this buys.
- Embeddings and voice stay free and private (no clinic conversation data leaves the machine for STT/TTS/retrieval).
- If OpenAI is unreachable, classification/synthesis fail; retrieval and voice do not.
