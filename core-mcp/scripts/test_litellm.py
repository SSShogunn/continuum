import os
from pathlib import Path

import litellm
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

model = os.environ["CONTINUUM_FACT_EXTRACTION_MODEL"]
api_key = os.environ["CONTINUUM_FACT_EXTRACTION_API_KEY"]

response = litellm.completion(
    model=model,
    api_key=api_key,
    messages=[{"role": "user", "content": "Say hello in exactly 5 words."}],
)

print(f"model: {model}")
print(f"response: {response.choices[0].message.content}")
print(f"usage: {response.usage}")
