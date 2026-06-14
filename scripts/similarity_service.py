"""
Clickmate Similarity Microservice
----------------------------------
A persistent FastAPI service that loads the sentence-transformer model once on
startup and serves similarity score requests over HTTP on localhost:8001.

This replaces the per-comparison python3 subprocess spawn in app.js, eliminating
the ~1-5s cold-start overhead on every comparison.

Setup:
    pip install fastapi uvicorn sentence-transformers torch

Run (managed automatically if using the npm start script, or separately):
    python3 scripts/similarity_service.py
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer, util
import uvicorn
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Clickmate Similarity Service", version="1.0.0")

# Load the model once at startup — this is the key performance win over subprocess spawning
logger.info("Loading sentence transformer model...")
model = SentenceTransformer("paraphrase-mpnet-base-v2")
logger.info("Model loaded and ready.")


class SimilarityRequest(BaseModel):
    text1: str
    text2: str


class SimilarityResponse(BaseModel):
    similarity_score: float


@app.get("/health")
def health_check():
    """Liveness probe — Node.js checks this on startup before accepting searches."""
    return {"status": "ok"}


@app.post("/similarity", response_model=SimilarityResponse)
def get_similarity(req: SimilarityRequest):
    """
    Compute the cosine similarity between two texts using the pre-loaded model.
    Returns a float in the range [-1, 1] where 1 is identical meaning.
    """
    if not req.text1.strip() or not req.text2.strip():
        raise HTTPException(status_code=400, detail="Both text1 and text2 must be non-empty.")

    try:
        emb1 = model.encode(req.text1, convert_to_tensor=True)
        emb2 = model.encode(req.text2, convert_to_tensor=True)
        score = util.pytorch_cos_sim(emb1, emb2).item()
        return SimilarityResponse(similarity_score=score)
    except Exception as e:
        logger.error(f"Error computing similarity: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001, log_level="info")
