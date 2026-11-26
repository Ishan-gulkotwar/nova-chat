"""Tests for API-key encryption."""

import pytest

from app.config import INSECURE_DEV_SECRET, Settings
from app.security import DecryptionError, Encryptor, mask_secret


def test_encrypt_round_trip_and_ciphertext_hides_the_key() -> None:
    encryptor = Encryptor("a" * 40)
    token = encryptor.encrypt("gsk_super_secret_value")

    assert "gsk_super_secret_value" not in token
    assert encryptor.decrypt(token) == "gsk_super_secret_value"


def test_encryption_is_randomized() -> None:
    encryptor = Encryptor("a" * 40)
    assert encryptor.encrypt("same") != encryptor.encrypt("same")  # random IV each time


def test_wrong_secret_cannot_decrypt() -> None:
    token = Encryptor("a" * 40).encrypt("secret")
    with pytest.raises(DecryptionError):
        Encryptor("b" * 40).decrypt(token)


def test_tampered_ciphertext_is_rejected() -> None:
    encryptor = Encryptor("a" * 40)
    token = encryptor.encrypt("secret")
    tampered = token[:-5] + ("A" if token[-5] != "A" else "B") + token[-4:]
    with pytest.raises(DecryptionError):
        encryptor.decrypt(tampered)


@pytest.mark.parametrize(
    ("value", "expected"), [("gsk_abcdefghijklmnop1234", "…1234"), ("short", "…")]
)
def test_mask_secret_reveals_at_most_four_characters(value: str, expected: str) -> None:
    assert mask_secret(value) == expected


def test_production_refuses_the_default_secret() -> None:
    with pytest.raises(ValueError, match="SECRET_KEY"):
        Settings(environment="production", secret_key=INSECURE_DEV_SECRET)  # type: ignore[arg-type]
    Settings(environment="production", secret_key="x" * 40)  # type: ignore[arg-type]
