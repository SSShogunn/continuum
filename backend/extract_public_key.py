"""Reads CONTINUUM_BACKEND_JWT_PRIVATE_KEY from .env and prints the public key."""
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    PublicFormat,
    load_pem_private_key,
)
from dotenv import load_dotenv
import os

load_dotenv()

raw = os.environ["CONTINUUM_BACKEND_JWT_PRIVATE_KEY"]

# Normalise: strip surrounding quotes dotenv may leave, convert \n literals to real newlines
raw = raw.strip().strip('"').strip("'")
if "\\n" in raw:
    raw = raw.replace("\\n", "\n")

pem = raw.encode()
print("--- key preview (first 60 chars) ---")
print(repr(pem[:60]))
print("-------------------------------------")

key = load_pem_private_key(pem, password=None)
print(key.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo).decode())
