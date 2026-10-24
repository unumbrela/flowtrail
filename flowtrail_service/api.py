"""Authenticated local HTTP boundary for the FlowTrail coordinator."""

from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from collections.abc import AsyncIterator

import httpx
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from flowtrail_service.coordinator import Coordinator, Problem, Store
from flowtrail_service.report import build_report


class Transport:
    """Forward only caller credentials to the fixed Skyvern server."""

    def __init__(self, client: httpx.AsyncClient, headers: dict[str, str]) -> None:
        self.client = client
        self.headers = headers

    async def call(self, method: str, path: str, body: dict | None = None) -> Any:
        """Translate errors without exposing upstream payloads or secrets."""
        try:
            response = await self.client.request(method, path, headers=self.headers, json=body)
        except httpx.RequestError:
            raise Problem(503, "upstream_unreachable") from None
        if response.status_code >= 400:
            raise Problem(response.status_code, "upstream_rejected")
        if not response.content:
            return None
        try:
            return response.json()
        except ValueError:
            raise Problem(502, "invalid_upstream_response") from None


def create_app(store: Store | None = None, client: httpx.AsyncClient | None = None) -> FastAPI:
    """Build a single-worker service; injected clients support isolated HTTP tests."""
    store = store or Store(Path(os.environ.get("FLOWTRAIL_DB", "/data/operations.sqlite3")))
    coordinator = Coordinator(store, os.environ.get("FLOWTRAIL_ALLOW_FIXTURE") == "true")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        store.recover()
        app.state.client = client or httpx.AsyncClient(
            base_url=os.environ.get("SKYVERN_URL", "http://skyvern:8000"),
            timeout=60,
        )
        yield
        if client is None:
            await app.state.client.aclose()

    app = FastAPI(title="FlowTrail task lifecycle", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=os.environ.get(
            "FLOWTRAIL_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080"
        ).split(","),
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-API-Key", "Authorization", "x-user-agent"],
    )

    @app.exception_handler(Problem)
    async def problem_handler(request: Request, error: Problem) -> JSONResponse:
        return JSONResponse({"code": error.code}, status_code=error.status)

    async def caller(request: Request) -> tuple[str, Transport]:
        headers = {
            name: request.headers[name]
            for name in ("x-api-key", "authorization")
            if request.headers.get(name)
        }
        if not headers:
            raise Problem(401, "authentication_required")
        transport = Transport(app.state.client, headers)
        org = await transport.call("GET", "/api/v1/organizations/me")
        if not isinstance(org, dict) or not isinstance(org.get("organization_id"), str):
            raise Problem(502, "invalid_identity")
        return org["organization_id"], transport

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok"}

    @app.post("/v1/operations/{key}")
    async def create(
        key: str, request: Request, identity: tuple[str, Transport] = Depends(caller)
    ) -> dict:
        raw = await request.body()
        if len(raw) > 600000:
            raise Problem(413, "request_too_large")
        try:
            payload = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            raise Problem(422, "invalid_json") from None
        if not isinstance(payload, dict):
            raise Problem(422, "invalid_request")
        org, transport = identity
        return await coordinator.create(org, key, payload, transport)

    @app.get("/v1/operations/{key}")
    async def get(key: str, identity: tuple[str, Transport] = Depends(caller)) -> dict:
        org, transport = identity
        return await coordinator.refresh(org, key, transport)

    @app.get("/v1/operations/{key}/report")
    async def report(key: str, identity: tuple[str, Transport] = Depends(caller)) -> dict:
        org, transport = identity
        operation = await coordinator.refresh(org, key, transport)
        run = (
            await transport.call("GET", f"/v1/runs/{operation['run_id']}")
            if operation["run_id"]
            else None
        )
        return build_report(operation, run)

    @app.post("/v1/operations/{key}/{action}")
    async def act(key: str, action: str, identity: tuple[str, Transport] = Depends(caller)) -> dict:
        org, transport = identity
        return await coordinator.action(org, key, action, transport)

    return app
