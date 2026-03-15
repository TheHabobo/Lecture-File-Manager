# LLM — unified access layer

Summary
-------
All LLM usage is centralized in `llm.py`. This module wraps the Azure OpenAI chat completions endpoint and provides two convenience APIs:

- `AzureLLM.chat(prompt: str, system_prompt: Optional[str] = None, temperature: float = 0.0, max_tokens: Optional[int] = None) -> str`
- `AzureLLM.chat_completion(messages: List[dict], **kwargs) -> dict`

Configuration
-------------
- `AZURE_OPENAI_API_KEY` (required) — API key for the Azure OpenAI resource.
- `AZURE_OPENAI_ENDPOINT` (optional) — full chat completions URL; defaults to the configured deployment URL.

Important notes
---------------
- Requests send the API key in the `api-key` header (Azure OpenAI requirement).
- `llm.chat()` returns a best-effort text string for the primary assistant message. `chat_completion()` returns the full JSON response.
- The module raises `LLMError` for network or HTTP failures; code should catch and handle this.

German prompts (examples)
-------------------------
These prompts are used by the app for summaries and flashcards; they instruct the model to answer in German and follow strict formatting.

Summary prompt (system):
"Du bist ein ausführlicher, fachlich korrekter Dokumentenzusammenfasser. Antworte ausschließlich auf Deutsch. Extrahiere alle relevanten Themen aus dem Dokument und liefere ausschließlich eine strukturierte 'Themen'-Ausgabe in Markdown. Für jedes Thema gib den Thementitel (eine Zeile) und darunter 3-6 kurze, tiefgehende Bullet-Punkte an, die Aspekte, typische Anwendungen, Grenzen und weiterführende Details beschreiben. Keine Einleitungen, keine Erklärungen zur Methode, keine Fußnoten oder Hinweise; nur die Themenliste."

Flashcards prompt (system):
"Du bist ein Experte für das Erstellen tiefgehender Lernkarten. Antworte ausschließlich auf Deutsch. Gib die Karten im Format 'Vorderseite :: Rückseite' aus, eine Karte pro Zeile. Erstelle für jedes im Kontext genannte Thema mehrere gründliche Karten (mindestens 2-4 pro Thema), die Schlüsselkonzepte, typische Anwendungen, Beispiele und mögliche Fallstricke abdecken. Formuliere präzise und vermeide redundante Karten. Gruppiere thematisch, wenn möglich."

Example usage (Python)
----------------------
```python
from llm import chat

system = "Du bist ... (see llm.md above)"
text = "Inhalt oder extrahierter Text der PDF..."
res = chat(text, system_prompt=system, temperature=0.0, max_tokens=1200)
print(res)
```

Testing tips
------------
- Unit-test llm-dependent endpoints by mocking `llm.chat` and `llm.chat_completion` to return deterministic strings/JSON.
- Do not perform live LLM calls in unit tests; use integration tests or explicit feature tests when required.

Operational notes
-----------------
- Monitor costs and set quotas when running in production.
- Consider conversation/message splitting and prompt compression for very long documents.
