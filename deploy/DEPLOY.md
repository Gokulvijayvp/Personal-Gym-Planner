# Run Gym Planner on an AWS EC2 server (no Docker)

**Part A** (steps 0 to 11): the app on EC2 with a database file. **Part B**: switch to an AWS RDS database. Do them in this order.

How it works, in one picture:

```
Browser ──► nginx (port 80/443) ──► the website files (built on your PC)
                    │
                    └── /api ──► Gym Planner API (Python, runs as a service on this machine only) ──► database (SQLite file, or AWS RDS)
```

Everything is plain Linux: **nginx** (small) + **Python** + a **systemd** service. No Docker, no Node on the server, no compilers.
Disk use is about **300 MB** in total, so a small 8 GB volume is plenty.

---

## 0. What you need
- An EC2 instance (Amazon Linux 2023 or Ubuntu 22.04/24.04). A free-tier `t2.micro` / `t3.micro` (1 GB RAM) works.
- Your key file (`.pem`) and the instance's public IP address.
- Your PC with the project, Node (to build the website) and Python.

## 1. Open the right ports (EC2 → Security group → Inbound rules)
| Port | Source | Why |
|---|---|---|
| 22 (SSH) | **My IP** only | so only you can log in |
| 80 (HTTP) | Anywhere | the website |
| 443 (HTTPS) | Anywhere | only if you do step 8 |

**Do not open port 8000.** The API is meant to be reached only through nginx.
Tip: attach an **Elastic IP** to the instance. Otherwise the public IP changes every time the server is stopped and started, and you would have to update step 5 each time.

## 2. On your Windows PC: build the bundle
In PowerShell, from the project folder:
```powershell
powershell -ExecutionPolicy Bypass -File deploy\make-bundle.ps1 -WithDatabase
```
- It builds the website and packs the backend into **`deploy\upload`** (about 2 MB).
- `-WithDatabase` also takes your current data and exercise pictures to the server. Leave it out for a fresh, empty server.

## 3. Upload it
```powershell
scp -i C:\path\to\your-key.pem -r deploy\upload ec2-user@YOUR-EC2-IP:~/gp
```
(Ubuntu servers use `ubuntu@` instead of `ec2-user@`.)

## 4. Log in and run the setup
```bash
ssh -i C:\path\to\your-key.pem ec2-user@YOUR-EC2-IP
cd ~/gp
sudo bash setup-server.sh
```
The first run installs everything, creates the settings file `/etc/gym-planner.env` with a random `SECRET_KEY`, and then **stops** and asks you to edit that file.

## 5. Fill in the settings, then run the setup again
```bash
sudo nano /etc/gym-planner.env
```
Change these lines:
| Line | Put |
|---|---|
| `CORS_ORIGINS` | `http://YOUR-EC2-IP` (exactly what you type in the browser, no slash at the end) |
| `RESEND_API_KEY` | the same key as in your local `backend/.env` |
| `RESEND_FROM_EMAIL` | the same sender as locally |

Save (Ctrl+O, Enter, Ctrl+X), then:
```bash
sudo bash setup-server.sh
```
When it says **Done**, open `http://YOUR-EC2-IP/` in your browser.

## 6. First sign-in
- **The first account that signs up becomes the admin** (and takes over the data you brought with `-WithDatabase`, if that database had no users yet). Sign up with your own email first.
- Sign-up codes: Resend's testing mode only emails the address of your Resend account. For any other address the code is written to the server log. Watch it with:
  ```bash
  sudo journalctl -u gym-planner -f
  ```
  Look for the line `DEV ONLY: … signup code is 123456`.

## 7. Everyday commands
```bash
sudo systemctl status gym-planner        # is it running?
sudo journalctl -u gym-planner -n 50 --no-pager   # recent messages
sudo systemctl restart gym-planner       # restart the API
sudo nginx -t && sudo systemctl reload nginx      # after editing the nginx file
curl http://127.0.0.1:8000/health        # the API's own health check
```
The API and nginx start by themselves whenever the server restarts.

## 8. Optional: https (recommended once real people use it)
Cookies are safer over https. You do not need to buy a domain: the free name **`<ip-with-dashes>.sslip.io`** points to your IP, and Let's Encrypt will issue a certificate for it. For IP `3.110.45.67` the name is `3-110-45-67.sslip.io`.

1. Open port 443 in the security group (step 1).
2. Put the name into nginx: `sudo nano /etc/nginx/conf.d/gym-planner.conf` and change `server_name _;` to `server_name 3-110-45-67.sslip.io;`
3. Install certbot.
   - Ubuntu: `sudo apt install -y certbot python3-certbot-nginx`
   - Amazon Linux 2023:
     ```bash
     sudo dnf install -y augeas-libs
     sudo python3.11 -m venv /opt/certbot
     sudo /opt/certbot/bin/pip install --no-cache-dir certbot certbot-nginx
     sudo ln -s /opt/certbot/bin/certbot /usr/bin/certbot
     ```
4. Get the certificate: `sudo certbot --nginx -d 3-110-45-67.sslip.io` (it also renews itself).
5. In `/etc/gym-planner.env` set `CORS_ORIGINS=https://3-110-45-67.sslip.io` and `COOKIE_SECURE=true`, then `sudo systemctl restart gym-planner`.

**Test mode versus production mode** (the `APP_ENV` line in `/etc/gym-planner.env`):
- `APP_ENV=development` (the default here): the API documentation page is public and sign-up codes that cannot be emailed are written to the log. Right for testing with a few people.
- `APP_ENV=production`: documentation is hidden and codes are **only** ever emailed. This needs a real sending domain in Resend (the free test sender can only email you). Switch to it when you have a domain and verified it in Resend.

## 9. Updating the app later
On your PC run step 2 again (no `-WithDatabase`), upload (step 3), then on the server:
```bash
cd ~/gp && sudo bash setup-server.sh
```
Your database and pictures live in `/var/lib/gym-planner` and are **never touched** by an update. New database changes are applied automatically when the API starts.

## 10. Backups
- A verified copy of the database is made every night at 03:30 into `/var/lib/gym-planner/backups` (the newest 14 are kept).
- Pictures and videos are in `/var/lib/gym-planner/media`. They are not in the nightly copy. Download both now and then:
  ```powershell
  scp -i key.pem -r ec2-user@YOUR-EC2-IP:/var/lib/gym-planner C:\gym-planner-backup
  ```
  (If permission is denied, first run on the server: `sudo cp -r /var/lib/gym-planner ~/gp-backup && sudo chown -R $USER ~/gp-backup`, and download that folder instead.)
- Also consider an EBS snapshot of the volume from the AWS console.

## 11. Keeping the disk small
```bash
df -h /                                  # how full is the disk?
sudo journalctl --vacuum-size=50M        # trim old logs
sudo du -sh /var/lib/gym-planner/*       # videos are the biggest thing: delete ones you do not need in the app
```

## Part B. Use an AWS RDS database instead of the file (recommended once real people use the app)

Part A above stores the data in one file on the server. With RDS the data lives in a managed **PostgreSQL** database that AWS backs up for you, so it survives losing the server and takes no space on the small EC2 disk. Do Part A first (so you know the app works), then switch.

> The backend was tested on PostgreSQL 17 with the full test suite. RDS PostgreSQL 15, 16 or 17 all work.

### B1. Create the database (AWS console → RDS → Create database)
1. **Standard create** → engine **PostgreSQL** (version 16 or 17).
2. **Templates:** *Free tier* if you see it (otherwise *Dev/Test*).
3. **Settings:** DB instance identifier `gymplanner-db`. Master username `gymplanner`. Choose a **password** (letters and numbers only keeps things simple) and write it down.
4. **Instance class:** `db.t4g.micro` or `db.t3.micro`. **Storage:** gp3, 20 GB. Turn **storage autoscaling off** (so it cannot grow and cost money).
5. **Connectivity:** choose **Connect to an EC2 compute resource** and pick your Gym Planner server. AWS then creates the network rules for you. Make sure **Public access = No**.
6. **Additional configuration:** *Initial database name* `gymplanner`. Keep **automated backups** on (7 days) and **encryption** on.
7. **Create database.** It takes about 10 minutes to become **Available**. Open it and copy the **Endpoint** (a name like `gymplanner-db.abc123.ap-south-1.rds.amazonaws.com`).

If you do not use step 5's shortcut, add this yourself: in the RDS security group, an inbound rule **PostgreSQL, port 5432, source = the EC2 server's security group**. Never open 5432 to the whole internet.

### B2. Point the server at it
```bash
sudo nano /etc/gym-planner.env
```
Replace the `DATABASE_URL=` line with (your own endpoint and password):
```
DATABASE_URL=postgresql+psycopg://gymplanner:YOUR_PASSWORD@gymplanner-db.abc123.ap-south-1.rds.amazonaws.com:5432/gymplanner?sslmode=require
```
Special characters in the password must be written as `%40` for `@`, `%3A` for `:`, `%2F` for `/`, `%3F` for `?`, `%23` for `#`, `%25` for `%`.

Then run the setup again:
```bash
cd ~/gp && sudo bash setup-server.sh
```
It first **tests the connection** (and tells you what to check if it cannot connect), creates the tables, and starts the app.

### B3. Move your existing data (optional)
If you made the bundle with `-WithDatabase`, the setup script copies your accounts, plans, workouts and exercises into RDS **only when RDS has no accounts yet**, then checks every table's row count. To do it by hand later (this **replaces** what is in RDS):
```bash
cd /opt/gym-planner/backend
sudo -u gymplanner /opt/gym-planner/venv/bin/python scripts/sqlite_to_postgres.py \
  --sqlite /path/to/gym_planner.db --postgres "postgresql+psycopg://gymplanner:PASSWORD@ENDPOINT:5432/gymplanner?sslmode=require" --replace
```
The SQLite file is only read, never changed. Pictures and videos stay as files in `/var/lib/gym-planner/media` on the server.

### B4. Backups and costs
- **Backups are automatic** (RDS keeps 7 days; you can also take a manual **snapshot** any time from the RDS page). The in-app "Download backup" button is replaced by a note about this.
- **Cost:** new AWS accounts get a free tier for RDS for 12 months (750 hours of a micro instance and 20 GB). After that it is a small monthly charge. If you stop using it, take a snapshot and delete the instance so it stops billing. (A stopped RDS instance restarts by itself after 7 days.)
- **Connections:** the app keeps at most 10 connections open, which a micro instance handles easily.
- **Changing the schema later:** updates apply new database changes automatically when the app starts, exactly as in Part A. Take a snapshot before a big update.

## Troubleshooting
| What you see | What it means |
|---|---|
| nginx "Welcome" page | the default site is still active: remove the default `server { … }` block from `/etc/nginx/nginx.conf`, then `sudo systemctl reload nginx` |
| **502 Bad Gateway** | the API is not running: `sudo journalctl -u gym-planner -n 50 --no-pager` |
| API will not start with "Unsafe production configuration" | `APP_ENV=production` needs `COOKIE_SECURE=true` (https), a long `SECRET_KEY`, `EMAIL_BACKEND=resend` and the Resend values |
| Sign-up/login shows "This request came from an untrusted site" | `CORS_ORIGINS` does not exactly match the address in your browser (http vs https, IP changed, a trailing slash) |
| You are signed out all the time over http | normal if `COOKIE_SECURE=true` while using http: use https, or set it to `false` for testing |
| Setup says **COULD NOT CONNECT to the database** | wrong endpoint/user/password in `DATABASE_URL`, special characters in the password not written as `%40`-style codes, or the RDS security group does not allow this server on port 5432 (Part B1) |
| "We couldn't send the email right now" | `RESEND_API_KEY` missing, or Resend refused the address: see step 6 |
| Uploading a video fails | check the file is under 200 MB and the disk has room (`df -h /`) |
