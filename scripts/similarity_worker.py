import json
import sys

from sentence_transformers import SentenceTransformer, util


model = SentenceTransformer("paraphrase-mpnet-base-v2")
print(json.dumps({"ready": True}), flush=True)

for line in sys.stdin:
    request_id = None
    try:
        request = json.loads(line)
        if not isinstance(request, dict):
            raise ValueError("Request must be a JSON object")
        request_id = request.get("id")
        embeddings = model.encode([request["text1"], request["text2"]], convert_to_tensor=True)
        score = float(util.pytorch_cos_sim(embeddings[0], embeddings[1]).item())
        print(json.dumps({"id": request["id"], "similarity_score": score}), flush=True)
    except Exception as error:
        print(json.dumps({"id": request_id, "error": str(error)}), flush=True)
