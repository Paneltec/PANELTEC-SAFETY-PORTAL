import io
from unittest.mock import AsyncMock

import pytest
from reportlab.pdfgen.canvas import Canvas

import mobile_onboarding_cards as cards


@pytest.mark.parametrize("size", [(cards.CARD_W, cards.CARD_H), (cards.SLOT_W, cards.SLOT_H)])
def test_card_renders_two_labelled_qrs(monkeypatch, size):
    monkeypatch.setenv("PUBLIC_APP_BASE_URL", "https://example.test/")
    payloads = []
    labels = []
    real_qr = cards.qr_image
    monkeypatch.setattr(cards, "qr_image", lambda payload, **kw: (payloads.append(payload), real_qr(payload, **kw))[1])
    canvas = Canvas(io.BytesIO(), pagesize=size)
    real_label = canvas.drawCentredString
    monkeypatch.setattr(canvas, "drawCentredString", lambda x, y, text: (labels.append(text), real_label(x, y, text))[1])

    cards._render_card(canvas, 0, 0, *size, "Test Worker", cards._app_install_url(),
                       cards._install_url("token123", {"company": "Viatec"}), "v1")
    canvas.save()

    assert payloads == ["https://example.test/m/install", "https://example.test/m/onboard/token123?preload=viatec"]
    assert "1. INSTALL APP" in labels
    assert "2. CONNECT ACCOUNT" in labels


@pytest.mark.asyncio
@pytest.mark.parametrize("count", [1, 2])
async def test_endpoint_passes_distinct_urls_for_each_card(monkeypatch, count):
    monkeypatch.setenv("PUBLIC_APP_BASE_URL", "https://example.test")
    workers = [{"id": str(i), "org_id": "org", "first_name": "Worker", "last_name": str(i),
                "company": "Civil", "simpro_employee_id": str(i)} for i in range(count)]
    monkeypatch.setattr(cards, "_fetch_workers_async", AsyncMock(return_value=workers))
    monkeypatch.setattr(cards, "_get_or_issue_token", AsyncMock(side_effect=[f"token{i}" for i in range(count)]))
    rendered = []
    monkeypatch.setattr(cards, "_render_card", lambda *args: rendered.append(args))
    monkeypatch.setattr(cards.db.user_audit, "insert_one", AsyncMock())
    response = await cards.onboarding_cards_pdf(worker_id="0" if count == 1 else None,
        worker_ids=None if count == 1 else "0,1", user_id=None, all=False,
        expires_days=7, user={"role": "admin", "id": "admin", "org_id": "org"})
    assert response.media_type == "application/pdf"
    assert response.headers["x-paneltec-generated"] == str(count)
    assert [(args[6], args[7]) for args in rendered] == [
        ("https://example.test/m/install", f"https://example.test/m/onboard/token{i}?preload=civil")
        for i in range(count)
    ]