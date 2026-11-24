"""Email connectivity test: sends ONE clearly labelled test message to ONE address you name.

    python scripts/send_test_email.py --to you@example.com
    python scripts/send_test_email.py --preview email_preview.html     # writes the HTML to open in a browser; sends nothing

With the sandbox sender (onboarding@resend.dev) Resend only delivers to the email address of your own Resend account.
The API key is read from backend/.env and is never printed.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import resend_mailer  # noqa: E402
from app.services.email_templates import render_otp_email  # noqa: E402

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--to", help="the single recipient (your verified Resend account email)")
    ap.add_argument("--preview", metavar="FILE", help="write the HTML email to FILE instead of sending")
    args = ap.parse_args()

    if args.preview:
        Path(args.preview).write_text(render_otp_email("123456", 5, test=True)[1], encoding="utf-8")
        print(f"Preview written to {args.preview} (nothing was sent).")
        raise SystemExit(0)
    if not args.to:
        raise SystemExit("Give the recipient with --to you@example.com (or use --preview FILE).")
    try:
        message_id = resend_mailer.send_test_email(args.to)
    except (resend_mailer.EmailConfigError, resend_mailer.EmailDeliveryError) as exc:
        raise SystemExit(f"FAILED: {exc}")
    print(f"Sent to {resend_mailer.mask(args.to)}. Resend message id: {message_id}")
