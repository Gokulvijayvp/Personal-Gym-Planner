"""The sign-in code email: Gym Planner branding (Charcoal + Orange). Table layout with inline styles, which is what mail apps need."""
from html import escape

BG, CARD, ELEVATED, ORANGE = "#202329", "#292E36", "#323944", "#FF8A24"
TEXT, MUTED, BORDER = "#F5F6F8", "#A7ADB7", "#3A414C"


def render_otp_email(code: str, expires_minutes: int, *, test: bool = False) -> tuple[str, str, str]:
    """Returns (subject, html, plain_text). The code is shown spaced out (123 456) so it is easy to read and copy."""
    spaced = f"{code[:3]} {code[3:]}" if len(code) == 6 else code
    subject = "Gym Planner: email delivery test" if test else f"Your Gym Planner code: {spaced}"
    banner = (f'<tr><td style="padding:0 32px 16px"><div style="background:{ELEVATED};border:1px solid {ORANGE};border-radius:10px;'
              f'padding:12px 14px;color:{TEXT};font-size:13px;line-height:1.5"><b style="color:{ORANGE}">Test message.</b> '
              f'This only checks that email delivery works. Nobody asked to sign in, and this code does nothing.</div></td></tr>') if test else ""
    intro = "Use this code to continue to Gym Planner." if not test else "This is how your sign-in code email will look."
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><title>{escape(subject)}</title></head>
<body style="margin:0;padding:0;background:{BG};font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{BG};padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:{CARD};border:1px solid {BORDER};border-radius:16px">
<tr><td style="padding:28px 32px 8px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="background:{ORANGE};border-radius:10px;width:36px;height:36px;text-align:center;font-size:18px;line-height:36px;color:{BG}">&#127947;</td>
    <td style="padding-left:12px;color:{TEXT};font-size:18px;font-weight:bold">Gym Planner</td>
  </tr></table></td></tr>
<tr><td style="padding:16px 32px 4px;color:{TEXT};font-size:22px;font-weight:bold">Your verification code</td></tr>
<tr><td style="padding:0 32px 20px;color:{MUTED};font-size:14px;line-height:1.5">{escape(intro)}</td></tr>
{banner}
<tr><td style="padding:0 32px 20px"><div style="background:{BG};border:1px solid {BORDER};border-radius:12px;padding:18px;text-align:center">
  <span style="font-family:'Courier New',monospace;font-size:36px;letter-spacing:8px;font-weight:bold;color:{ORANGE}">{escape(spaced)}</span></div></td></tr>
<tr><td style="padding:0 32px 8px;color:{TEXT};font-size:14px;line-height:1.5">This code expires in <b>{expires_minutes} minutes</b> and works once.</td></tr>
<tr><td style="padding:0 32px 28px;color:{MUTED};font-size:12px;line-height:1.5">Didn't ask for this? You can ignore this email. Nobody can sign in without the code. Never share it with anyone.</td></tr>
</table>
<p style="max-width:480px;color:{MUTED};font-size:11px;margin:16px 0 0;text-align:center">Gym Planner &middot; your personal fitness planner</p>
</td></tr></table></body></html>"""
    text = (f"Gym Planner\n\n{'TEST MESSAGE: nobody asked to sign in. ' if test else ''}Your verification code: {spaced}\n\n"
            f"It expires in {expires_minutes} minutes and works once.\nDidn't ask for this? Ignore this email and never share the code.\n")
    return subject, html, text
