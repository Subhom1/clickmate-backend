import json
import sys

from sentence_transformers import SentenceTransformer, util


# Load the model once and reuse it for every comparison.
model = SentenceTransformer("paraphrase-mpnet-base-v2")
print(json.dumps({"ready": True}), flush=True)

# Each input line gets one JSON reply with the same request ID.
for line in sys.stdin:
    request_id = None
    embedding_count = 0
    try:
        request = json.loads(line)
        if not isinstance(request, dict):
            raise ValueError("Request must be a JSON object")
        request_id = request.get("id")
        embeddings = model.encode([request["text1"], request["text2"]], convert_to_tensor=True)
        embedding_count = 2
        score = float(util.pytorch_cos_sim(embeddings[0], embeddings[1]).item())
        print(json.dumps({"id": request["id"], "similarity_score": score, "embeddings": embedding_count}), flush=True)
    except Exception as error:
        print(json.dumps({"id": request_id, "error": str(error), "embeddings": embedding_count}), flush=True)
