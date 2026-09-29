"""Self-hosted stand-in for Emergent's `emergentintegrations` package.

Only used in the Docker images (deploy/). Emergent keeps its own package.
Implements the small part of the API the app uses:
    LlmChat(api_key, session_id, system_message).with_model("anthropic", model)
    await chat.send_message(UserMessage(text, file_contents=[ImageContent(image_base64)]))
and sends it straight to Anthropic's Messages API with your own key.
"""
