"""Shared pytest fixtures. pytest loads this file automatically."""

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def app() -> FastAPI:
    """A fresh app with test settings for each test."""
    return create_app(Settings(environment="test"))


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client
