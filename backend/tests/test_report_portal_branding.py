"""Offline regression checks for self-hosted report branding."""
import io
import os
import unittest
from unittest.mock import patch

from portal_urls import configured_portal_url, report_portal_url


class ReportPortalBrandingTests(unittest.TestCase):
    def test_self_hosted_url_is_used(self):
        with patch.dict(os.environ, {"FRONTEND_PUBLIC_URL": "http://umbrel.local:3952/"}, clear=True):
            self.assertEqual(configured_portal_url(), "http://umbrel.local:3952")
            self.assertEqual(report_portal_url(), "http://umbrel.local:3952")

    def test_explicit_public_url_takes_priority(self):
        with patch.dict(os.environ, {"PUBLIC_APP_URL": "https://portal.example.com/", "FRONTEND_PUBLIC_URL": "http://umbrel.local:3952"}, clear=True):
            self.assertEqual(configured_portal_url(), "https://portal.example.com")

    def test_saved_report_url_is_preserved(self):
        with patch.dict(os.environ, {"FRONTEND_PUBLIC_URL": "http://umbrel.local:3952"}, clear=True):
            self.assertEqual(report_portal_url({"portal_url": " https://reports.example.com/login/ "}), "https://reports.example.com/login")

    def test_blank_configuration_falls_through(self):
        with patch.dict(os.environ, {"PUBLIC_APP_URL": " ", "FRONTEND_PUBLIC_URL": "", "PUBLIC_URL": "https://safety.example.com/"}, clear=True):
            self.assertEqual(configured_portal_url(), "https://safety.example.com")

    def test_unconfigured_deployment_has_no_invented_url(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(configured_portal_url(), "")
            self.assertEqual(report_portal_url({"portal_url": " "}), "")

    def test_pdf_footer_uses_configured_or_saved_url(self):
        from pdf_chrome import BrandedDocTemplate
        from reportlab.platypus import Paragraph
        from reportlab.lib.styles import getSampleStyleSheet
        from pypdf import PdfReader
        for env, org, expected in (
            ({"FRONTEND_PUBLIC_URL": "http://umbrel.local:3952"}, {}, "http://umbrel.local:3952"),
            ({"PUBLIC_APP_URL": "https://portal.example.com"}, {"portal_url": "https://reports.example.com"}, "https://reports.example.com"),
            ({}, {}, None),
        ):
            with self.subTest(expected=expected), patch.dict(os.environ, env, clear=True):
                output = io.BytesIO()
                BrandedDocTemplate(output, org={"name": "Paneltec Pty Ltd", **org}).build([
                    Paragraph("Report branding check", getSampleStyleSheet()["Normal"])
                ])
                text = PdfReader(output).pages[0].extract_text()
                self.assertIn("PANELTEC", text)
                self.assertNotIn("emergent", text.lower())
                if expected:
                    self.assertIn("Portal: " + expected, text)
                else:
                    self.assertNotIn("Portal:", text)


if __name__ == "__main__":
    unittest.main()
