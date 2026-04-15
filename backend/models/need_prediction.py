import json
import math
import os
import re
from urllib.error import URLError
from urllib.request import Request, urlopen


def _tokenize(text: str) -> set[str]:
    lowered = text.lower()
    tokens = re.findall(r"[a-z0-9]+", lowered)
    return {token for token in tokens if len(token) > 2}


def _local_embedding(text: str, dimensions: int = 96) -> list[float]:
    vector = [0.0 for _ in range(dimensions)]
    tokens = re.findall(r"[a-z0-9]+", text.lower())
    if not tokens:
        return vector

    for token in tokens:
        index = hash(f"idx::{token}") % dimensions
        sign = 1.0 if (hash(f"sgn::{token}") % 2 == 0) else -1.0
        vector[index] += sign

    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return vector
    return [value / norm for value in vector]


def _jaccard_similarity(text_a: str, text_b: str) -> float:
    tokens_a = _tokenize(text_a)
    tokens_b = _tokenize(text_b)
    if not tokens_a or not tokens_b:
        return 0.0

    intersection = len(tokens_a.intersection(tokens_b))
    union = len(tokens_a.union(tokens_b))
    if union == 0:
        return 0.0
    return intersection / union


def _cosine_similarity(vector_a: list[float], vector_b: list[float]) -> float:
    if not vector_a or not vector_b or len(vector_a) != len(vector_b):
        return 0.0

    dot_product = sum(a * b for a, b in zip(vector_a, vector_b))
    norm_a = math.sqrt(sum(a * a for a in vector_a))
    norm_b = math.sqrt(sum(b * b for b in vector_b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot_product / (norm_a * norm_b)


class SemanticMatcher:
    """
    Lightweight semantic matcher.

    - Primary path: optional local Ollama embeddings if configured.
    - Fallback path: deterministic token Jaccard similarity.
    """

    def __init__(self) -> None:
        self.ollama_url = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
        self.ollama_model = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
        self.use_ollama = os.getenv("USE_OLLAMA_EMBEDDINGS", "0") == "1"
        self.local_dimensions = int(os.getenv("LOCAL_EMBED_DIM", "96"))

    def _embed_text(self, text: str) -> list[float] | None:
        endpoint = f"{self.ollama_url.rstrip('/')}/api/embeddings"
        payload = json.dumps({"model": self.ollama_model, "prompt": text}).encode(
            "utf-8"
        )
        request = Request(
            endpoint,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urlopen(request, timeout=2) as response:
                body = response.read().decode("utf-8")
        except (URLError, TimeoutError, ValueError):
            return None

        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            return None

        embedding = parsed.get("embedding")
        if not isinstance(embedding, list):
            return None

        vector: list[float] = []
        for item in embedding:
            try:
                vector.append(float(item))
            except (TypeError, ValueError):
                return None
        return vector

    def similarity(self, text_a: str, text_b: str) -> float:
        if not text_a or not text_b:
            return 0.0

        if self.use_ollama:
            embedding_a = self._embed_text(text_a)
            embedding_b = self._embed_text(text_b)
            if embedding_a is not None and embedding_b is not None:
                score = _cosine_similarity(embedding_a, embedding_b)
                return max(0.0, min(1.0, score))

        score = _jaccard_similarity(text_a, text_b)
        return max(0.0, min(1.0, score))

    def embed(self, text: str) -> list[float]:
        if self.use_ollama:
            vector = self._embed_text(text)
            if vector is not None:
                return vector
        return _local_embedding(text, dimensions=self.local_dimensions)

    def cosine_similarity(self, vector_a: list[float], vector_b: list[float]) -> float:
        score = _cosine_similarity(vector_a, vector_b)
        return max(0.0, min(1.0, score))
