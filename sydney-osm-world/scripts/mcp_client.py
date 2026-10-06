"""Thin wrapper around the local `osm-mcp-server` (stdio MCP) process.

Every pipeline script talks to the geographic data through this module, so the
MCP transport stays in exactly one place.

The server is the upstream project cloned at ./open-streetmap-mcp
(https://github.com/jagan-shanmugam/open-streetmap-mcp).
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parent.parent
MCP_DIR = ROOT / "open-streetmap-mcp"


def server_env() -> dict:
    """Environment for the MCP server process.

    The CPython builds shipped by `uv` (python-build-standalone) bundle an
    OpenSSL CA store whose Let's Encrypt chain is expired, so TLS to
    overpass-api.de / router.project-osrm.org fails with
    "certificate has expired". Pointing SSL_CERT_FILE at the certifi bundle
    that `mcp` itself depends on fixes it. See docs/OSM-MCP.md.
    """
    env = dict(os.environ)
    try:
        import certifi

        env["SSL_CERT_FILE"] = certifi.where()
    except Exception:  # pragma: no cover - certifi always ships with mcp
        pass
    return env


def server_params() -> StdioServerParameters:
    """Launch the local checkout of the OSM MCP server over stdio."""
    venv_python = ROOT / ".venv" / (
        "Scripts/python.exe" if os.name == "nt" else "bin/python"
    )
    if venv_python.exists():
        command = str(venv_python)
        args = ["-c", "from osm_mcp_server import main; main()"]
    else:
        # Fall back to whatever is on PATH (e.g. a global `osm-mcp-server`).
        command = "osm-mcp-server"
        args = []
    return StdioServerParameters(
        command=command,
        args=args,
        env=server_env(),
        cwd=str(MCP_DIR) if MCP_DIR.exists() else None,
    )


@asynccontextmanager
async def mcp_session():
    """Yield an initialised MCP ClientSession connected to the OSM server."""
    async with stdio_client(server_params()) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session


def _decode(result: Any) -> Any:
    """MCP returns text content blocks; the server puts JSON inside them."""
    if getattr(result, "isError", False):
        raise RuntimeError(f"MCP tool error: {getattr(result, 'content', result)}")
    chunks = []
    for item in getattr(result, "content", []) or []:
        text = getattr(item, "text", None)
        if text is None:
            continue
        try:
            chunks.append(json.loads(text))
        except json.JSONDecodeError:
            chunks.append(text)
    if not chunks:
        return None
    if len(chunks) == 1:
        return chunks[0]
    return chunks


async def list_tools() -> list[dict]:
    async with mcp_session() as session:
        response = await session.list_tools()
        return [
            {
                "name": tool.name,
                "description": (tool.description or "").strip().splitlines()[0]
                if tool.description
                else "",
                "input_schema": tool.inputSchema,
            }
            for tool in response.tools
        ]


async def call(tool: str, arguments: dict, retries: int = 5) -> Any:
    """Call one MCP tool, retrying transient upstream failures.

    The OSM MCP server's Overpass calls hit a public mirror that frequently
    returns 429/504; those surface as a Python ExceptionGroup from the stdio
    transport, so they are retried with backoff here rather than silently
    dropped. A tool error that is a real tool error (e.g. a bad argument)
    is reported immediately.
    """
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            async with mcp_session() as session:
                result = await session.call_tool(tool, arguments)
                return _decode(result)
        except Exception as exc:  # noqa: BLE001 - reported, not hidden
            last_error = exc
            message = str(exc)
            if message.startswith("MCP tool error:") and "TaskGroup" not in message:
                raise  # a genuine tool-level failure: retrying will not help
            if attempt == retries:
                break
            await asyncio.sleep(min(45.0, 5.0 * attempt * attempt))
    raise last_error  # type: ignore[misc]


def call_sync(tool: str, arguments: dict) -> Any:
    return asyncio.run(call(tool, arguments))


MCP_CACHE = ROOT / "data" / "cache" / "mcp"


def call_cached(tool: str, arguments: dict) -> tuple[Any, str]:
    """Call an MCP tool through an on-disk cache.

    Returns (payload, origin) where origin is 'cache' or 'live'. Public OSM
    services rate-limit, so re-running the pipeline must not re-issue every
    request - and a cached run makes the pipeline reproducible.
    """
    import hashlib

    MCP_CACHE.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256(json.dumps([tool, arguments], sort_keys=True).encode("utf-8")).hexdigest()[:24]
    path = MCP_CACHE / f"{tool}-{key}.json"
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as handle:
                return json.load(handle)["response"], "cache"
        except Exception:
            pass
    payload = call_sync(tool, arguments)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump({"tool": tool, "arguments": arguments, "response": payload}, handle, ensure_ascii=False)
    return payload, "live"


def list_tools_sync() -> list[dict]:
    return asyncio.run(list_tools())


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "tools":
        print(json.dumps(list_tools_sync(), indent=2))
    elif len(sys.argv) > 2:
        print(json.dumps(call_sync(sys.argv[1], json.loads(sys.argv[2])), indent=2)[:4000])
    else:
        print("usage: mcp_client.py tools | mcp_client.py <tool> '<json-args>'")
