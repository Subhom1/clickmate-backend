import sys
import json
from sentence_transformers import SentenceTransformer, util

# Load a pre-trained model from sentence-transformers
# model = SentenceTransformer('paraphrase-MiniLM-L6-v2')
model = SentenceTransformer('paraphrase-mpnet-base-v2')
# model = SentenceTransformer('paraphrase-xlm-r-multilingual-v1')
def calculate_similarity(text1, text2):
    embeddings1 = model.encode(text1, convert_to_tensor=True)
    embeddings2 = model.encode(text2, convert_to_tensor=True)
    similarity_score = util.pytorch_cos_sim(embeddings1, embeddings2).item()
    return similarity_score

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python calculate_similarity.py <text1> <text2>")
        sys.exit(1)

    try:
        text1 = sys.argv[1]
        text2 = sys.argv[2]
        similarity_score = calculate_similarity(text1, text2)
        result = {'similarity_score': similarity_score}
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)
