"""Encryption for secrets we must store and later use, such as provider API keys.

API keys can't be hashed like passwords: we need the original value back to
call the provider. So we encrypt them with Fernet (AES-128-CBC + HMAC-SHA256,
from the `cryptography` library), which also detects tampering.

The Fernet key is derived from SECRET_KEY with HKDF, so there's one secret to
manage, and each use (encryption here, token signing in Phase 5) gets its own
independent key via a different `info` label.
"""

import base64

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


class DecryptionError(Exception):
    """The value can't be decrypted: wrong SECRET_KEY, or corrupted data."""


def derive_key(secret: str, purpose: bytes) -> bytes:
    """Derive a 32-byte key for one purpose from the master secret."""
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=purpose).derive(secret.encode())


class Encryptor:
    def __init__(self, secret: str) -> None:
        key = derive_key(secret, b"nova-chat/api-key-encryption/v1")
        self._fernet = Fernet(base64.urlsafe_b64encode(key))

    def encrypt(self, plaintext: str) -> str:
        return self._fernet.encrypt(plaintext.encode()).decode()

    def decrypt(self, token: str) -> str:
        try:
            return self._fernet.decrypt(token.encode()).decode()
        except InvalidToken as exc:
            raise DecryptionError("Stored secret can't be decrypted (was SECRET_KEY changed?)") from exc


def mask_secret(value: str) -> str:
    """A safe hint for the UI, e.g. '…9f2c'. Shows only the last 4 characters."""
    return "…" + value[-4:] if len(value) >= 12 else "…"
