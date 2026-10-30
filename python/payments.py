"""Booth Agent: buys prints from the Print Agent using x402 (USDC on XDC Network).

Flow (x402 "exact" scheme, EIP-3009 transferWithAuthorization):
  1. POST the photo to the Print Agent's /print endpoint.
  2. It answers 402 Payment Required with its price, token, network and receiver.
  3. The Booth Agent checks the price, gets the USDC authorization signed and retries
     with the X-PAYMENT header.
  4. The Print Agent has the facilitator verify + settle it, prints, and returns a receipt.

Two payment modes (switchable at any time, e.g. as a fallback during a demo):
  - "guest": the guest pays. The booth shows a WalletConnect QR code; the guest scans it
    with their mobile wallet (e.g. Rabby) and signs the authorization. The money goes from
    the guest straight to the Print Agent: the booth only relays the signature.
  - "booth": the booth pays with its own wallet (key stored on the board), within a
    per-print maximum and a daily budget.

Until a Print Agent URL is configured (and, in booth mode, a booth wallet), jobs run in
demo mode: the same steps are shown, but nothing is paid or printed.

Settings and the wallet key are stored in /app/.cache/booth-agent/ (not part of the
app's source files). The key never leaves the board and is never sent to the browser.
"""

import base64
import json
import os
import secrets
import threading
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

from eth_account import Account
from eth_account.messages import encode_typed_data

from arduino.app_utils import Logger

logger = Logger("BoothAgent")

CONFIG_DIR = Path(__file__).resolve().parent.parent / ".cache" / "booth-agent"
CONFIG_FILE = CONFIG_DIR / "config.json"
SPEND_FILE = CONFIG_DIR / "spend.json"

USDC_DECIMALS = 6
PAYMENT_MODES = ("claude", "guest", "booth")
DEFAULTS = {
    # "claude": the guest's own Claude (xdcai.tech connector) pays, prompted by the booth's voice
    # "guest":  the guest's mobile wallet pays via a WalletConnect QR
    # "booth":  the booth's own wallet pays (the fallback)
    "paymentMode": "guest",
    "printAgentUrl": "",  # e.g. http://<laptop-ip>:8402
    "walletConnectProjectId": "",  # free project ID from cloud.reown.com (public, not a secret)
    "maxPriceUsdc": 0.5,  # never pay (or ask a guest to pay) more than this for one print
    "dailyLimitUsdc": 5.0,  # total the booth wallet may spend per day (booth mode)
    "chainId": None,  # override if the network name in the 402 answer isn't recognized
    "printAgentKey": "",  # optional shared key sent as X-Booth-Key when the booth creates orders
}
CLAUDE_READY_TIMEOUT_S = 60  # wait this long for "ready" / 👍 before speaking to Claude anyway
CLAUDE_PAY_TIMEOUT_S = 300  # how long the guest's Claude has to pay an order
PAID_STATES = ("paid", "settled", "printing", "printed", "done", "completed")
FAILED_STATES = ("failed", "cancelled", "canceled", "expired")
NETWORK_CHAIN_IDS = {"xdc": 50, "xdc-mainnet": 50, "xinfin": 50, "xdc-apothem": 51, "apothem": 51}
EXPLORER_TX = "https://xdcscan.com/tx/"
GUEST_TIMEOUT_S = 180  # how long a guest has to scan and sign

EIP712_DOMAIN = [
    {"name": "name", "type": "string"},
    {"name": "version", "type": "string"},
    {"name": "chainId", "type": "uint256"},
    {"name": "verifyingContract", "type": "address"},
]
TRANSFER_WITH_AUTHORIZATION = [
    {"name": "from", "type": "address"},
    {"name": "to", "type": "address"},
    {"name": "value", "type": "uint256"},
    {"name": "validAfter", "type": "uint256"},
    {"name": "validBefore", "type": "uint256"},
    {"name": "nonce", "type": "bytes32"},
]


def _usdc(atomic: int) -> str:
    return f"{atomic / 10**USDC_DECIMALS:.2f}"


def _short(addr: str | None) -> str:
    return f"{addr[:6]}…{addr[-4:]}" if addr else "?"


class JobFailed(Exception):
    """A job step failed; `step` tells the stepper where."""

    def __init__(self, step: str, message: str):
        super().__init__(message)
        self.step = step


class BoothAgent:
    def __init__(self, voice=None):
        self._voice = voice  # BoothVoice, used to talk to the guest and their Claude
        self._lock = threading.Lock()
        self._activity: list[dict] = []
        self._activity_id = 0
        self._jobs: dict[str, dict] = {}  # public job info (sent to the browser)
        self._ctx: dict[str, dict] = {}  # private per-job data (never sent to the browser)
        self._config = dict(DEFAULTS)
        self._key: str | None = None
        self._load()

    # ---------- configuration ----------

    def _load(self):
        try:
            data = json.loads(CONFIG_FILE.read_text())
            self._key = data.pop("privateKey", None)
            # Setups saved before guest payments existed keep using the booth wallet until switched
            data.setdefault("paymentMode", "booth")
            self._config.update({k: v for k, v in data.items() if k in DEFAULTS})
        except FileNotFoundError:
            pass
        except Exception as exc:
            logger.warning(f"Could not read booth agent config: {exc}")

    def _save(self):
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        data = dict(self._config)
        if self._key:
            data["privateKey"] = self._key
        CONFIG_FILE.write_text(json.dumps(data, indent=2))
        os.chmod(CONFIG_FILE, 0o600)

    def configure(self, data: dict) -> dict:
        with self._lock:
            if "printAgentUrl" in data:
                self._config["printAgentUrl"] = str(data["printAgentUrl"] or "").strip().rstrip("/")
            if "walletConnectProjectId" in data:
                self._config["walletConnectProjectId"] = str(data["walletConnectProjectId"] or "").strip()
            if "printAgentKey" in data:
                self._config["printAgentKey"] = str(data["printAgentKey"] or "").strip()
            if data.get("paymentMode") in PAYMENT_MODES:
                self._config["paymentMode"] = data["paymentMode"]
            for key in ("maxPriceUsdc", "dailyLimitUsdc"):
                if data.get(key) not in (None, ""):
                    self._config[key] = max(0.0, float(data[key]))
            if data.get("chainId") not in (None, ""):
                self._config["chainId"] = int(data["chainId"])
            key = str(data.get("privateKey") or "").strip()
            if key:
                if not key.startswith("0x"):
                    key = "0x" + key
                Account.from_key(key)  # raises if invalid
                self._key = key
            if data.get("clearKey"):
                self._key = None
            self._save()
        logger.info(f"Booth agent settings updated (payment mode: {self._config['paymentMode']})")
        return self.status()

    @property
    def address(self) -> str | None:
        return Account.from_key(self._key).address if self._key else None

    @property
    def demo_mode(self) -> bool:
        if not self._config["printAgentUrl"]:
            return True
        if self._config["paymentMode"] == "claude":
            return False
        if self._config["paymentMode"] == "guest":
            return not self._config["walletConnectProjectId"]
        return not self._key

    # ---------- spending limit (booth wallet) ----------

    def _spent_today(self) -> int:
        try:
            data = json.loads(SPEND_FILE.read_text())
            return int(data.get(date.today().isoformat(), 0))
        except Exception:
            return 0

    def _add_spend(self, atomic: int):
        today = date.today().isoformat()
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        SPEND_FILE.write_text(json.dumps({today: self._spent_today() + atomic}))

    # ---------- status for the browser ----------

    def _log(self, job_id: str, step: str, text: str, **extra):
        with self._lock:
            self._activity_id += 1
            self._activity.append({"id": self._activity_id, "job": job_id, "step": step, "text": text, "t": time.time(), **extra})
            del self._activity[:-80]
        logger.info(f"[{job_id}] {step}: {text}")

    def status(self) -> dict:
        with self._lock:
            return {
                "demo": self.demo_mode,
                "paymentMode": self._config["paymentMode"],
                "walletConnectProjectId": self._config["walletConnectProjectId"],
                "address": self.address,
                "printAgentUrl": self._config["printAgentUrl"],
                "maxPriceUsdc": self._config["maxPriceUsdc"],
                "dailyLimitUsdc": self._config["dailyLimitUsdc"],
                "spentTodayUsdc": float(_usdc(self._spent_today())),
                "activity": list(self._activity),
                "jobs": list(self._jobs.values())[-10:],
            }

    def _update_job(self, job_id: str, **info):
        with self._lock:
            self._jobs[job_id].update(**info)

    # ---------- printing ----------

    def request_print(self, image_data_url: str, theme: str) -> str:
        job_id = secrets.token_hex(3)
        mode = self._config["paymentMode"]
        demo = self.demo_mode
        with self._lock:
            self._jobs[job_id] = {"id": job_id, "state": "started", "mode": mode, "demo": demo, "theme": theme, "t": time.time()}
            self._ctx[job_id] = {
                "event": threading.Event(),  # guest wallet: signature arrived
                "ready": threading.Event(),  # claude: guest says "ready" / shows 👍
                "repeat": threading.Event(),  # claude: say the prompt again
                "cancel": threading.Event(),
            }
            # keep only recent jobs
            for old in list(self._jobs)[:-20]:
                self._jobs.pop(old, None)
                self._ctx.pop(old, None)
        if demo:
            target = self._demo_job
        elif mode == "claude":
            target = self._claude_job
        elif mode == "guest":
            target = self._guest_job
        else:
            target = self._booth_job
        threading.Thread(target=target, args=(job_id, image_data_url), daemon=True).start()
        return job_id

    # Steps reported to the stepper, in order; each goes "active" then "done" (or "error"):
    #   request -> quote -> check -> [connect: guest mode only] -> sign -> settle -> print -> done

    def _demo_job(self, job_id: str, _image: str):
        mode = self._jobs[job_id]["mode"]
        guest = mode == "guest"
        if mode == "claude":
            script = [
                ("request", "Creating a print order with the Print Agent", "Order 4827 created (simulated)", {"code": "4827"}),
                ("quote", "Reading the price", "0.01 USDC on XDC Network · pay with your Claude", {"amount": "0.01"}),
                ("speak", "Booth is talking to your Claude", "Asked your Claude to pay for order 4827", {}),
                ("agent", "Waiting for your Claude to pay via XDC AI", "Your Claude paid 0.01 USDC (simulated)", {}),
                ("settle", "Settling on XDC Network", "Settled on XDC Network (simulated)", {}),
                ("print", "Print Agent is printing your photo", "Printed (simulated)", {}),
            ]
            self._say("This is a demo. Set the Print Agent URL to pay for real.")
            for step, active, done, extra in script:
                self._log(job_id, step, active, phase="active", demo=True)
                time.sleep(1.4)
                self._log(job_id, step, done, phase="done", demo=True, **extra)
            self._log(job_id, "done", "Demo complete: set the Print Agent URL (⚙️ Setup) to pay for real.", phase="done", demo=True)
            self._update_job(job_id, state="done", amount="0.01")
            return
        script = [
            ("request", "Asking the Print Agent for a 4×6 print", "Print Agent replied: payment required", {}),
            ("quote", "Reading the price", "0.10 USDC on XDC Network", {"amount": "0.10"}),
            ("check", "Checking the price", "Price is OK ✓", {}),
        ]
        if guest:
            script.append(("connect", "Waiting for the guest's wallet", "Guest wallet connected (simulated)", {}))
        script += [
            ("sign", "Signing a gasless USDC authorization", "Signed (EIP-3009, no gas needed)", {}),
            ("settle", "Print Agent is verifying and settling the payment", "Settled on XDC Network (simulated)", {}),
            ("print", "Print Agent is printing your photo", "Printed (simulated)", {}),
        ]
        for step, active, done, extra in script:
            self._log(job_id, step, active, phase="active", demo=True)
            time.sleep(1.4 if step in ("settle", "print", "connect") else 0.8)
            self._log(job_id, step, done, phase="done", demo=True, **extra)
        hint = "the Print Agent URL and WalletConnect project ID" if guest else "the Print Agent and booth wallet"
        self._log(job_id, "done", f"Demo complete: set up {hint} to pay for real.", phase="done", demo=True)
        self._update_job(job_id, state="done", amount="0.10")

    def _booth_job(self, job_id: str, image: str):
        """Fallback mode: the booth's own wallet pays."""
        try:
            url, body, offer, req, amount = self._quote(job_id, image, check_budget=True)
            self._log(job_id, "sign", "Signing a gasless USDC authorization with the booth wallet", phase="active")
            typed, auth = self._typed_data(req, amount, self.address)
            signature = self._sign_locally(typed)
            self._log(job_id, "sign", f"Signed by the booth wallet {_short(self.address)} (EIP-3009, no gas needed)", phase="done", payer=self.address)
            receipt = self._pay_and_print(job_id, url, body, offer, req, auth, signature)
            self._add_spend(amount)
            self._complete(job_id, amount, receipt, "agent-to-agent")
        except JobFailed as exc:
            self._fail(job_id, exc.step, str(exc))
        except Exception as exc:
            logger.exception(f"Print job {job_id} failed")
            self._fail(job_id, "request", str(exc))

    def _guest_job(self, job_id: str, image: str):
        """Main mode: the guest pays from their mobile wallet; the booth relays the signature."""
        ctx = self._ctx[job_id]
        try:
            url, body, offer, req, amount = self._quote(job_id, image, check_budget=False)
            chain_id = self._chain_id(req)
            ctx.update(url=url, body=body, offer=offer, req=req, amount=amount, chainId=chain_id, step="connect")
            self._log(job_id, "connect", "Scan the QR code with your wallet app (e.g. Rabby)", phase="active")
            self._update_job(job_id, state="awaiting_wallet", chainId=chain_id, amount=_usdc(amount))

            # The browser connects the guest's wallet, fetches the typed data (guest_typed_data)
            # and sends back the signature (guest_signature), which sets the event.
            if not ctx["event"].wait(GUEST_TIMEOUT_S):
                raise JobFailed(ctx.get("step", "connect"), "No payment within 3 minutes, so the print was cancelled")
            if ctx.get("error"):
                raise JobFailed(ctx.get("step", "sign"), ctx["error"])

            payer = ctx["auth"]["from"]
            self._log(job_id, "sign", f"Signed by the guest's wallet {_short(payer)} (EIP-3009, no gas needed)", phase="done", payer=payer)
            self._update_job(job_id, state="paying", payer=payer)
            receipt = self._pay_and_print(job_id, url, body, offer, req, ctx["auth"], ctx["signature"])
            self._complete(job_id, amount, {**receipt, "payer": receipt.get("payer") or payer}, "from the guest's wallet")
        except JobFailed as exc:
            self._fail(job_id, exc.step, str(exc))
        except Exception as exc:
            logger.exception(f"Print job {job_id} failed")
            self._fail(job_id, ctx.get("step", "request"), str(exc))

    def _claude_job(self, job_id: str, image: str):
        """Voice mode: the booth creates an order, then talks the guest's Claude into paying it.

        The guest's Claude reaches the Print Agent through its xdcai.tech MCP tools and pays the
        order with x402; the booth follows the order status and narrates.
        """
        ctx = self._ctx[job_id]
        base = self._config["printAgentUrl"]
        step = "request"
        try:
            self._log(job_id, "request", "Creating a print order with the Print Agent", phase="active")
            headers = {"X-Booth-Key": self._config["printAgentKey"]} if self._config["printAgentKey"] else {}
            body = json.dumps({"image": image, "jobId": job_id, "copies": 1}).encode()
            try:
                status, _, payload = self._post(f"{base}/orders", body, headers)
            except Exception as exc:
                raise JobFailed("request", f"Print Agent not reachable: {exc}")
            if status not in (200, 201):
                raise JobFailed("request", f"Print Agent could not create the order (HTTP {status})")
            order = json.loads(payload)
            code = str(order.get("code") or order.get("orderCode") or order.get("id"))
            price = str(order.get("priceUsdc") or order.get("price") or "")
            self._log(job_id, "request", f"Order {code} created", phase="done", code=code)

            step = "quote"
            price_text = f"{price} USDC" if price else "a few cents in USDC"
            self._log(job_id, "quote", f"{price_text} on XDC Network · pay with your Claude", phase="done", amount=price, code=code)
            spoken_code = ", ".join(code)
            prompt = f"Hello Claude. Please pay for XDC photobooth print order {code}, using the XDC AI photo print service."
            spoken_prompt = f"Hello Claude. Please pay for X D C photobooth print order {spoken_code}, using the X D C A I photo print service."
            self._update_job(job_id, state="awaiting_claude", stage="ready", code=code, amount=price, prompt=prompt)

            # 1. Ask the guest to get their Claude listening
            step = "speak"
            self._log(job_id, "speak", "Booth is talking to you", phase="active")
            self._expect({"ready", "repeat", "cancel"})
            self._say(
                f"Your print costs {price_text}. Open Claude on your phone, start voice mode, "
                "and hold the phone near me. Say ready, or show a thumbs up, when Claude is listening.",
                block=True,
            )
            ready = self._wait_any(ctx, ("ready", "cancel"), CLAUDE_READY_TIMEOUT_S)
            if ready == "cancel":
                raise JobFailed("speak", "Cancelled by the guest")

            # 2. Speak the request to the guest's Claude
            self._update_job(job_id, stage="speaking")
            self._log(job_id, "speak", "Booth is speaking to your Claude", phase="active")
            self._say(spoken_prompt, block=True)
            self._log(job_id, "speak", f"Asked your Claude to pay for order {code}", phase="done")

            # 3. Follow the order until the guest's Claude has paid and it's printed
            step = "agent"
            self._update_job(job_id, stage="waiting")
            self._log(job_id, "agent", "Waiting for your Claude to pay via XDC AI", phase="active")
            self._watch_order(job_id, ctx, base, code, spoken_prompt)
        except JobFailed as exc:
            self._say("Sorry, the payment did not go through. You can try again.")
            self._fail(job_id, exc.step, str(exc))
        except Exception as exc:
            logger.exception(f"Print job {job_id} failed")
            self._fail(job_id, step, str(exc))
        finally:
            self._expect(set())

    def _watch_order(self, job_id: str, ctx: dict, base: str, code: str, spoken_prompt: str):
        deadline = time.monotonic() + CLAUDE_PAY_TIMEOUT_S
        seen = set()
        while time.monotonic() < deadline:
            if ctx["cancel"].is_set():
                raise JobFailed("agent", "Cancelled by the guest")
            if ctx["repeat"].is_set():
                ctx["repeat"].clear()
                self._say(spoken_prompt, block=True)
            try:
                with urllib.request.urlopen(f"{base}/orders/{code}", timeout=4) as res:
                    order = json.loads(res.read())
            except Exception:
                time.sleep(1.5)
                continue
            state = str(order.get("status") or order.get("state") or "").lower()
            tx = order.get("txHash") or order.get("transaction")
            payer = order.get("payer")
            amount = str(order.get("priceUsdc") or order.get("amount") or "")
            if any(s in state for s in PAID_STATES) and "paid" not in seen:
                seen.add("paid")
                self._log(job_id, "agent", f"Your Claude paid {amount or 'the'} USDC" + (f" from {_short(payer)}" if payer else ""), phase="done", payer=payer)
                self._log(
                    job_id,
                    "settle",
                    f"Settled on XDC Network · tx {tx[:10]}…{tx[-6:]}" if tx else "Settled on XDC Network",
                    phase="done",
                    txHash=tx,
                    explorerUrl=(EXPLORER_TX + tx) if tx else None,
                )
                self._update_job(job_id, stage="paid", payer=payer, txHash=tx)
                self._say("Payment received from your agent. Printing now!")
            if "printing" in state and "printing" not in seen:
                seen.add("printing")
                self._log(job_id, "print", "Print Agent is printing your photo", phase="active")
            if any(s in state for s in ("printed", "done", "completed")):
                self._log(job_id, "print", "Printed! Collect your photo at the printer", phase="done")
                receipt = {"txHash": tx, "explorerUrl": (EXPLORER_TX + tx) if tx else None, "payer": payer}
                self._log(job_id, "done", f"Your Claude paid {amount or ''} USDC agent-to-agent on XDC Network".replace("  ", " "), phase="done", amount=amount, **receipt)
                self._update_job(job_id, state="done", amount=amount, **receipt)
                self._say("Your print is ready. Enjoy the celebration!")
                return
            if any(s in state for s in FAILED_STATES):
                raise JobFailed("agent", f"Order {state}")
            time.sleep(1.5)
        raise JobFailed("agent", "No payment from Claude within 5 minutes")

    def signal(self, signal: str, job_id: str | None = None) -> bool:
        """Voice or 👍 for the active voice job: "ready", "repeat" or "cancel"."""
        if signal not in ("ready", "repeat", "cancel"):
            return False
        with self._lock:
            if job_id is None:
                active = [j for j in self._jobs.values() if j.get("state") == "awaiting_claude"]
                job_id = active[-1]["id"] if active else None
            ctx = self._ctx.get(job_id) if job_id else None
        if not ctx:
            return False
        ctx[signal].set()
        if signal == "ready":
            self._log(job_id, "speak", "Guest is ready", phase="active")
        return True

    def _wait_any(self, ctx: dict, names: tuple, timeout: float) -> str | None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for name in names:
                if ctx[name].is_set():
                    return name
            time.sleep(0.2)
        return None

    def _say(self, text: str, block: bool = False):
        if self._voice:
            self._voice.say(text, block=block)

    def _expect(self, replies: set):
        if self._voice:
            self._voice.expecting = set(replies)

    # ---------- guest wallet hand-off (called from the web API) ----------

    def guest_typed_data(self, job_id: str, address: str) -> dict:
        """The guest's wallet is connected: return the EIP-712 data it should sign."""
        ctx = self._ctx.get(job_id)
        if not ctx or "req" not in ctx or ctx["event"].is_set():
            raise ValueError("This print is not waiting for a payment")
        if not (isinstance(address, str) and address.startswith("0x") and len(address) == 42):
            raise ValueError("Invalid wallet address")
        typed, auth = self._typed_data(ctx["req"], ctx["amount"], address)
        ctx.update(typed=typed, auth=auth, step="sign")
        self._log(job_id, "connect", f"Guest wallet connected: {_short(address)}", phase="done", payer=address)
        self._log(job_id, "sign", f"Approve the {_usdc(ctx['amount'])} USDC payment in your wallet", phase="active")
        return typed

    def guest_signature(self, job_id: str, signature: str | None, error: str | None = None):
        """The guest signed (or declined) in their wallet."""
        ctx = self._ctx.get(job_id)
        if not ctx or ctx["event"].is_set():
            raise ValueError("This print is not waiting for a payment")
        if error:
            ctx["error"] = f"Payment not approved: {error}"
        else:
            if "typed" not in ctx:
                raise ValueError("Connect the wallet first")
            signer = Account.recover_message(encode_typed_data(full_message=self._typed_for_signing(ctx["typed"])), signature=signature)
            if signer.lower() != ctx["auth"]["from"].lower():
                raise ValueError("Signature does not match the connected wallet")
            ctx["signature"] = signature
        ctx["event"].set()

    # ---------- shared pipeline ----------

    def _quote(self, job_id: str, image: str, check_budget: bool):
        """Ask the Print Agent for the price (HTTP 402) and check it."""
        url = f"{self._config['printAgentUrl']}/print"
        body = json.dumps({"image": image, "jobId": job_id, "copies": 1}).encode()

        self._log(job_id, "request", "Asking the Print Agent for a 4×6 print", phase="active")
        try:
            status, _, payload = self._post(url, body)
        except Exception as exc:
            raise JobFailed("request", f"Print Agent not reachable: {exc}")
        if status != 402:
            raise JobFailed("request", f"Print Agent answered HTTP {status} instead of 402 Payment Required")
        self._log(job_id, "request", "Print Agent replied: 402 Payment Required", phase="done")

        offer = json.loads(payload)
        req = next((a for a in offer.get("accepts", []) if a.get("scheme") == "exact"), None)
        if not req:
            raise JobFailed("quote", "Print Agent offered no supported payment option")
        amount = int(req.get("maxAmountRequired") or req.get("amount"))
        self._log(job_id, "quote", f"{_usdc(amount)} USDC on {req.get('network')}", phase="done", amount=_usdc(amount), payTo=req.get("payTo"))

        self._log(job_id, "check", "Checking the price", phase="active")
        max_atomic = int(self._config["maxPriceUsdc"] * 10**USDC_DECIMALS)
        if amount > max_atomic:
            raise JobFailed("check", f"Price {_usdc(amount)} USDC is above the per-print limit of {_usdc(max_atomic)}")
        if check_budget:
            limit_atomic = int(self._config["dailyLimitUsdc"] * 10**USDC_DECIMALS)
            spent = self._spent_today()
            if spent + amount > limit_atomic:
                raise JobFailed("check", f"Daily budget reached ({_usdc(spent)} of {_usdc(limit_atomic)} USDC spent)")
            text = f"Within budget ✓ {_usdc(spent)} / {_usdc(limit_atomic)} USDC used today, max {_usdc(max_atomic)} per print"
        else:
            text = f"Price is OK ✓ (max {_usdc(max_atomic)} USDC per print)"
        self._log(job_id, "check", text, phase="done")
        return url, body, offer, req, amount

    def _chain_id(self, req: dict) -> int:
        network = str(req.get("network", ""))
        chain_id = self._config["chainId"] or (
            int(network.split(":", 1)[1]) if network.startswith("eip155:") else NETWORK_CHAIN_IDS.get(network.lower())
        )
        if not chain_id:
            raise JobFailed("quote", f"Unknown network '{network}': set chainId in the agent settings")
        return chain_id

    def _typed_data(self, req: dict, amount: int, payer: str) -> tuple[dict, dict]:
        """EIP-712 TransferWithAuthorization from `payer` to the Print Agent, as a wallet expects it."""
        extra = req.get("extra") or {}
        now = int(time.time())
        auth = {
            "from": payer,
            "to": req["payTo"],
            "value": str(amount),
            "validAfter": str(now - 60),
            "validBefore": str(now + max(int(req.get("maxTimeoutSeconds") or 300), 120)),
            "nonce": "0x" + secrets.token_hex(32),
        }
        typed = {
            "types": {"EIP712Domain": EIP712_DOMAIN, "TransferWithAuthorization": TRANSFER_WITH_AUTHORIZATION},
            "primaryType": "TransferWithAuthorization",
            "domain": {
                "name": extra.get("name", "USD Coin"),
                "version": str(extra.get("version", "2")),
                "chainId": self._chain_id(req),
                "verifyingContract": req["asset"],
            },
            "message": auth,
        }
        return typed, auth

    @staticmethod
    def _typed_for_signing(typed: dict) -> dict:
        """eth-account wants numbers as ints and bytes32 as bytes."""
        msg = dict(typed["message"])
        for k in ("value", "validAfter", "validBefore"):
            msg[k] = int(msg[k])
        msg["nonce"] = bytes.fromhex(msg["nonce"][2:])
        return {**typed, "message": msg}

    def _sign_locally(self, typed: dict) -> str:
        signed = Account.sign_message(encode_typed_data(full_message=self._typed_for_signing(typed)), self._key)
        return "0x" + signed.signature.hex().removeprefix("0x")

    def _pay_and_print(self, job_id, url, body, offer, req, auth, signature) -> dict:
        """Forward the signed authorization to the Print Agent (X-PAYMENT); it settles and prints."""
        version = int(offer.get("x402Version", 1))
        if version >= 2:
            payment = {"x402Version": version, "accepted": req, "payload": {"signature": signature, "authorization": auth}}
            header = "PAYMENT-SIGNATURE"
        else:
            payment = {"x402Version": 1, "scheme": "exact", "network": req.get("network"), "payload": {"signature": signature, "authorization": auth}}
            header = "X-PAYMENT"

        self._log(job_id, "settle", "Payment sent. Print Agent is verifying and settling it via the XDC AI facilitator", phase="active")
        stop = threading.Event()
        threading.Thread(target=self._watch_print_agent, args=(job_id, stop), daemon=True).start()
        try:
            status, headers, payload = self._post(url, body, {header: base64.b64encode(json.dumps(payment).encode()).decode()}, timeout=180)
        except Exception as exc:
            raise JobFailed("settle", f"Print Agent not reachable: {exc}")
        finally:
            stop.set()
        if status != 200:
            raise JobFailed("settle", f"Payment not accepted (HTTP {status}): {payload[:160].decode(errors='replace')}")
        receipt = self._receipt(headers, payload)
        tx = receipt.get("txHash")
        self._log(
            job_id,
            "settle",
            f"Settled on XDC Network · tx {tx[:10]}…{tx[-6:]}" if tx else "Settled on XDC Network",
            phase="done",
            txHash=tx,
            explorerUrl=receipt.get("explorerUrl"),
        )
        self._log(job_id, "print", "Printed! Collect your photo at the printer", phase="done")
        return receipt

    def _complete(self, job_id: str, amount: int, receipt: dict, how: str):
        self._log(job_id, "done", f"Paid {_usdc(amount)} USDC {how} on XDC Network", phase="done", amount=_usdc(amount), **receipt)
        self._update_job(job_id, state="done", amount=_usdc(amount), **receipt)

    def _fail(self, job_id: str, step: str, message: str):
        logger.warning(f"Print job {job_id} failed at {step}: {message}")
        self._log(job_id, step, message, phase="error")
        self._update_job(job_id, state="failed", error=message)

    def _watch_print_agent(self, job_id: str, stop: threading.Event):
        """While the paid request is open, follow the job on the Print Agent's /jobs list (if it has one)."""
        base = self._config["printAgentUrl"]
        reported = set()
        while not stop.wait(1.0):
            try:
                with urllib.request.urlopen(f"{base}/jobs", timeout=3) as res:
                    jobs = json.loads(res.read())
            except Exception:
                continue
            jobs = jobs.get("jobs", []) if isinstance(jobs, dict) else jobs
            job = next((j for j in jobs if str(j.get("jobId") or j.get("id")) == job_id), None)
            if not job:
                continue
            state = str(job.get("status") or job.get("state") or "").lower()
            tx = job.get("txHash") or job.get("transaction")
            if any(k in state for k in ("settled", "paid", "printing", "printed")) and "settle" not in reported:
                reported.add("settle")
                self._log(job_id, "settle", "Settled on XDC Network" + (f" · tx {tx[:10]}…{tx[-6:]}" if tx else ""), phase="done", txHash=tx)
            if "printing" in state and "print" not in reported:
                reported.add("print")
                self._log(job_id, "print", "Print Agent is printing your photo", phase="active")

    @staticmethod
    def _receipt(headers: dict, payload: bytes) -> dict:
        info = {}
        for name in ("x-payment-response", "payment-response"):
            if name in headers:
                try:
                    info.update(json.loads(base64.b64decode(headers[name])))
                except Exception:
                    pass
        try:
            info.update(json.loads(payload))
        except Exception:
            pass
        tx = info.get("txHash") or info.get("transaction")
        explorer = info.get("explorerUrl") or (EXPLORER_TX + tx if tx else None)
        return {"txHash": tx, "explorerUrl": explorer, "payer": info.get("payer")}

    @staticmethod
    def _post(url: str, body: bytes, headers: dict | None = None, timeout: int = 30):
        req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return res.status, {k.lower(): v for k, v in res.headers.items()}, res.read()
        except urllib.error.HTTPError as err:
            return err.code, {k.lower(): v for k, v in err.headers.items()}, err.read()
