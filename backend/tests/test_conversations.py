"""API tests for /api/conversations, including the persisted streaming endpoint."""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.conversations import title_from_message
from app.providers import ChatMessage
from tests.conftest import FakeProvider
from tests.sse import parse_sse


def create(client: TestClient, **body: Any) -> dict[str, Any]:
    response = client.post("/api/conversations", json=body)
    assert response.status_code == 201
    return response.json()


def send(
    client: TestClient, conversation_id: str, content: str, model: str = "fake-model", provider: str = "fake"
) -> list:  # type: ignore[type-arg]
    response = client.post(
        f"/api/conversations/{conversation_id}/messages/stream",
        json={"content": content, "model": model, "provider": provider},
    )
    assert response.status_code == 200
    return parse_sse(response.text)


# ---- CRUD -------------------------------------------------------------------


def test_create_and_get_conversation(client: TestClient) -> None:
    created = create(client, system_prompt="Be brief.")
    assert created["title"] == "New chat"
    assert created["system_prompt"] == "Be brief."
    assert created["created_at"].endswith("Z") or "+00:00" in created["created_at"]

    detail = client.get(f"/api/conversations/{created['id']}").json()
    assert detail["id"] == created["id"]
    assert detail["messages"] == []


def test_list_is_newest_first(client: TestClient, provider: FakeProvider) -> None:
    first = create(client, title="First")
    second = create(client, title="Second")
    send(client, first["id"], "bump")  # activity moves "First" to the top

    titles = [c["title"] for c in client.get("/api/conversations").json()]
    assert titles == ["First", "Second"]
    assert second["id"] in {c["id"] for c in client.get("/api/conversations").json()}


def test_rename_and_update_system_prompt(client: TestClient) -> None:
    conversation = create(client)
    response = client.patch(
        f"/api/conversations/{conversation['id']}",
        json={"title": "Trip planning", "system_prompt": "You are a travel agent."},
    )
    assert response.status_code == 200
    assert response.json()["title"] == "Trip planning"
    assert response.json()["system_prompt"] == "You are a travel agent."

    # Fields left out of a PATCH stay unchanged.
    response = client.patch(f"/api/conversations/{conversation['id']}", json={"title": "Trip"})
    assert response.json()["system_prompt"] == "You are a travel agent."


def test_rename_rejects_empty_title(client: TestClient) -> None:
    conversation = create(client)
    response = client.patch(f"/api/conversations/{conversation['id']}", json={"title": ""})
    assert response.status_code == 422


def test_delete_removes_conversation_and_messages(client: TestClient, provider: FakeProvider) -> None:
    conversation = create(client)
    send(client, conversation["id"], "hello")

    assert client.delete(f"/api/conversations/{conversation['id']}").status_code == 204
    assert client.get(f"/api/conversations/{conversation['id']}").status_code == 404
    assert client.get("/api/conversations").json() == []


@pytest.mark.parametrize("method", ["get", "patch", "delete"])
def test_unknown_conversation_returns_404(client: TestClient, method: str) -> None:
    kwargs = {"json": {"title": "x"}} if method == "patch" else {}
    response = getattr(client, method)("/api/conversations/does-not-exist", **kwargs)
    assert response.status_code == 404


def test_search_matches_titles_and_message_text(client: TestClient, provider: FakeProvider) -> None:
    create(client, title="Python tips")
    by_message = create(client, title="Random")
    send(client, by_message["id"], "How do I bake sourdough?")

    def search(term: str) -> list[str]:
        return [c["title"] for c in client.get("/api/conversations", params={"q": term}).json()]

    assert search("python") == ["Python tips"]  # case-insensitive title match
    assert search("SOURDOUGH") == ["Random"]  # matched via a message
    assert search("100%") == []  # SQL wildcards are escaped, not interpreted


# ---- Streaming + persistence ------------------------------------------------


def test_stream_saves_user_message_and_reply(client: TestClient, provider: FakeProvider) -> None:
    conversation = create(client)

    events = send(client, conversation["id"], "Hi there")

    assert [e for e, _ in events] == ["token", "token", "token", "done"]
    detail = client.get(f"/api/conversations/{conversation['id']}").json()
    assert [(m["role"], m["content"], m["status"]) for m in detail["messages"]] == [
        ("user", "Hi there", "done"),
        ("assistant", "Hello, world", "done"),
    ]
    assert detail["messages"][1]["model"] == "fake-model"
    assert detail["messages"][1]["provider"] == "fake"
    assert events[-1][1]["message_id"] == detail["messages"][1]["id"]
    # The first message becomes the title, and the model is remembered.
    assert detail["title"] == "Hi there"
    assert detail["model"] == "fake-model"
    assert detail["provider"] == "fake"


def test_stream_sends_system_prompt_and_full_history(client: TestClient, provider: FakeProvider) -> None:
    conversation = create(client, system_prompt="Answer in French.")
    send(client, conversation["id"], "First question")
    send(client, conversation["id"], "Second question")

    _, prompt = provider.calls[-1]
    assert prompt == [
        ChatMessage(role="system", content="Answer in French."),
        ChatMessage(role="user", content="First question"),
        ChatMessage(role="assistant", content="Hello, world"),
        ChatMessage(role="user", content="Second question"),
    ]


def test_provider_error_is_streamed_and_saved(client: TestClient, provider: FakeProvider) -> None:
    provider.chunks, provider.fail = ["partial"], True
    conversation = create(client)

    events = send(client, conversation["id"], "Hi")

    reply = client.get(f"/api/conversations/{conversation['id']}").json()["messages"][1]
    assert events == [
        ("token", {"content": "partial"}),
        ("error", {"message": "model crashed", "message_id": reply["id"]}),
    ]
    assert (reply["status"], reply["content"], reply["error"]) == ("error", "partial", "model crashed")

    # Failed replies are left out of the context for the next turn.
    provider.chunks, provider.fail = ["ok"], False
    send(client, conversation["id"], "Again")
    _, prompt = provider.calls[-1]
    assert [m.role for m in prompt] == ["user", "user"]


def test_stream_unknown_conversation_returns_404(client: TestClient, provider: FakeProvider) -> None:
    response = client.post(
        "/api/conversations/nope/messages/stream",
        json={"content": "Hi", "model": "fake-model", "provider": "fake"},
    )
    assert response.status_code == 404


def test_stream_unknown_provider_returns_400(client: TestClient, provider: FakeProvider) -> None:
    conversation = create(client)
    response = client.post(
        f"/api/conversations/{conversation['id']}/messages/stream",
        json={"content": "Hi", "model": "gpt-x", "provider": "deleted-provider"},
    )
    assert response.status_code == 400
    assert "isn't available" in response.json()["detail"]
    # Nothing was saved for a request that was rejected up front.
    assert client.get(f"/api/conversations/{conversation['id']}").json()["messages"] == []


def test_switching_models_mid_conversation(client: TestClient, provider: FakeProvider) -> None:
    conversation = create(client)
    send(client, conversation["id"], "First", model="model-a")
    send(client, conversation["id"], "Second", model="model-b")

    detail = client.get(f"/api/conversations/{conversation['id']}").json()
    assert [m["model"] for m in detail["messages"] if m["role"] == "assistant"] == ["model-a", "model-b"]
    assert detail["model"] == "model-b"  # the chat remembers the latest choice
    # The second model received the whole conversation, including model-a's reply.
    model, prompt = provider.calls[-1]
    assert model == "model-b"
    assert [m.content for m in prompt] == ["First", "Hello, world", "Second"]


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        ("Short question", "Short question"),
        ("  Spaces   are\tcollapsed  ", "Spaces are collapsed"),
        ("First line\nsecond line", "First line"),
        ("x" * 100, "x" * 59 + "…"),
    ],
)
def test_title_from_message(content: str, expected: str) -> None:
    assert title_from_message(content) == expected
