"""Unified LLM access layer for Azure OpenAI (chat completions).

Configuration (environment variables):
- AZURE_OPENAI_ENDPOINT: full chat completions URL (optional). Defaults to the provided deployment URL.
- AZURE_OPENAI_API_KEY: API key for the Azure OpenAI resource (required at runtime).

Example:
    from llm import chat
    print(chat("Write a short haiku about code"))
"""

from __future__ import annotations

import json
import os
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional

# Default to environment-configured endpoint only (do not hardcode URLs)
_DEFAULT_ENDPOINT = os.environ.get("AZURE_OPENAI_ENDPOINT")

_API_KEY_ENV_VARS = ("AZURE_OPENAI_API_KEY", "OPENAI_API_KEY")


class LLMError(RuntimeError):
    pass


class AzureLLM:
    """Thin wrapper around Azure OpenAI chat completions endpoint.

    Usage:
        llm = AzureLLM()
        resp = llm.chat_completion(messages=[{"role": "user", "content": "Hello"}])
        text = llm.chat("Hello")
    """

    def __init__(self, endpoint: Optional[str] = None, api_key: Optional[str] = None, timeout: int = 60):
        self.endpoint = endpoint or _DEFAULT_ENDPOINT
        if not self.endpoint:
            raise LLMError(
                "Azure OpenAI endpoint not configured. Set AZURE_OPENAI_ENDPOINT in the environment or pass 'endpoint' to AzureLLM()."
            )
        self._api_key = api_key
        self.timeout = timeout

    def _get_api_key(self) -> Optional[str]:
        if self._api_key:
            return self._api_key
        for k in _API_KEY_ENV_VARS:
            v = os.environ.get(k)
            if v:
                return v
        return None

    def _build_request(self, payload: Dict[str, Any]) -> urllib.request.Request:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(self.endpoint, data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        api_key = self._get_api_key()
        if not api_key:
            # Delay error until call time to avoid raising on import
            raise LLMError(
                "Azure OpenAI API key not found. Set AZURE_OPENAI_API_KEY (or OPENAI_API_KEY) in the environment."
            )
        # Azure OpenAI expects the API key in the 'api-key' header
        req.add_header("api-key", api_key)
        return req

    def chat_completion(
        self,
        *,
        messages: List[Dict[str, str]],
        temperature: float = 0.0,
        max_tokens: Optional[int] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"messages": messages, "temperature": temperature}
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        # Allow caller to pass additional fields supported by the endpoint
        payload.update(kwargs)

        req = self._build_request(payload)

        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                body = resp.read().decode("utf-8")
                return json.loads(body)
        except urllib.error.HTTPError as e:
            # Try to extract JSON error body if present
            try:
                body = e.read().decode("utf-8")
                err = json.loads(body)
            except Exception:
                err = {"status": e.code, "reason": str(e)}
            raise LLMError(f"Azure OpenAI request failed: {err}") from e
        except Exception as e:  # pragma: no cover - network/runtime errors
            raise LLMError(f"Azure OpenAI request error: {e}") from e

    def chat(self, prompt: str, system_prompt: Optional[str] = None, **kwargs: Any) -> str:
        messages: List[Dict[str, str]] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        resp = self.chat_completion(messages=messages, **kwargs)

        # Return best-effort string from the response
        if not isinstance(resp, dict):
            return str(resp)
        choices = resp.get("choices") or []
        if not choices:
            # Fallback to returning the raw response
            return json.dumps(resp)
        first = choices[0]
        msg = first.get("message") or {}
        if isinstance(msg, dict):
            return msg.get("content", "")
        # Older/simpler shape may have 'text'
        return first.get("text", "")


# Module-level convenience helpers
_default_llm: Optional[AzureLLM] = None


def get_default_llm() -> AzureLLM:
    global _default_llm
    if _default_llm is None:
        _default_llm = AzureLLM()
    return _default_llm


def chat(prompt: str, system_prompt: Optional[str] = None, **kwargs: Any) -> str:
    return get_default_llm().chat(prompt=prompt, system_prompt=system_prompt, **kwargs)


def chat_completion(*, messages: List[Dict[str, str]], **kwargs: Any) -> Dict[str, Any]:
    return get_default_llm().chat_completion(messages=messages, **kwargs)


__all__ = ["AzureLLM", "get_default_llm", "chat", "chat_completion", "LLMError"]
