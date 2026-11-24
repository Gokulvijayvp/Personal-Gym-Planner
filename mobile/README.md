# Gym Planner for Android

A small Android app that opens your Gym Planner server full screen. It has no copy of the website inside: the first
screen asks for your server address (for example `http://13.233.10.20`), checks that the server answers, remembers it,
and opens it. Because the page comes from the server itself, login, cookies, uploads and every feature work exactly as in the browser,
and updating the server updates the app. Changing the server's IP needs no rebuild: press Back to the connect screen and enter the new address.

**The app file:** `mobile\GymPlanner.apk`

## Install on your phone
1. Copy `GymPlanner.apk` to the phone (USB cable, Google Drive, WhatsApp to yourself, email...).
2. Open it on the phone. If Android asks, allow **Install unknown apps** for the app you opened it from (Files / Chrome / Drive...).
3. Open **Gym Planner**, type your server address, tap **Connect**.

Or with a USB cable and USB debugging on: `adb install -r mobile\GymPlanner.apk`

## Rebuild after changing anything in `mobile\`
```powershell
powershell -ExecutionPolicy Bypass -File mobile\build-apk.ps1
```
Uses Android Studio's Java 21 for the build only. Output: `mobile\GymPlanner.apk` (a debug-signed file, fine for your own phone).

## Notes
- **Plain http is allowed** because a bare IP address cannot have https. When you get a domain and https, nothing in the app changes: just enter `https://your-domain`.
- **Server settings:** the server's `CORS_ORIGINS` must contain exactly the address you type in the app (see `deploy\DEPLOY.md`).
- **Sharing the app with others / Play Store:** that needs a release-signed build and https. Ask when you get there.
- Camera/gallery pickers for exercise pictures and videos work through the normal Android file chooser.
