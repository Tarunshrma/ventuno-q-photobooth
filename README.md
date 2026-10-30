# Festive Photobooth (Arduino VENTUNO Q)

An edge-AI photobooth for the Arduino VENTUNO Q: it cuts guests out of the camera feed,
places them in animated festive scenes (Diwali, Halloween), dresses them with face props,
takes photos hands-free, talks to them, and buys prints from a Print Agent with
agent-to-agent USDC payments on XDC Network (x402).

## What runs where

| Part | Where | How |
|---|---|---|
| Person cut-out | Board CPU | MediaPipe selfie segmentation (LiteRT), `python/vision.py` |
| Face props (478-point face mesh) | Board CPU | MediaPipe BlazeFace + face landmarks (LiteRT) |
| Gestures (✌️ 🙏 👍 ☝️ 🤟 👎) and hand pointing | Board NPU | `arduino:gesture_recognition` brick |
| Voice (talking) | Board NPU | Piper TTS (`arduino:tts`); clips played by the web page (HDMI / Bluetooth / laptop) |
| Voice (listening) | Board NPU | Whisper Small (`arduino:asr`), wake word "booth" |
| Scenes, effects, ambient sound | Browser | Canvas + Web Audio, `assets/js` |
| Agent payments | Board | `python/payments.py` (x402, EIP-3009 USDC on XDC) |

Models are downloaded once into `models/`; no camera images or audio leave the board.

## Using the booth

- **Photo:** show ✌️ (V sign) or 🙏 (namaste), or say "booth, take a photo".
- **Props:** point a fingertip into a round tile on the left/right edge and hold until the ring fills.
  👎 removes all props.
- **Effects:** ☝️ launches a firecracker (Diwali) or friendly bats (Halloween); 👍 for the finale.
- **Theme:** 🤟 or say "booth, Halloween" / "booth, Diwali".
- **Print:** after the photo, say "Happy Diwali!" / "Happy Halloween!" or show 👍.
- Only the person nearest the centre of the frame controls the booth.
- 🔊/🔇 on the picture mutes voice, sounds and spoken-instruction overlays.

## Payment modes (switchable in the "Agent payments" panel)

1. **🗣️ Guest's Claude (voice):** the booth creates an order on the Print Agent and speaks a
   request to the guest's Claude (with the xdcai.tech connector), which pays it.
2. **📱 Guest wallet (QR):** WalletConnect QR; the guest signs a gasless USDC authorization in
   their mobile wallet (e.g. Rabby); the booth relays it to the Print Agent with x402.
   Needs a WalletConnect project ID (cloud.reown.com).
3. **📸 Booth wallet:** the booth's own wallet pays, within a per-print maximum and daily budget.

Settings (Print Agent URL, keys, limits) are entered in ⚙️ Setup and stored on the board in
`.cache/booth-agent/` — never in this repository.

## Print Agent API expected by the booth

- `POST /print` — x402-protected (402 with `accepts`, then `X-PAYMENT`), body `{image, jobId, copies}`.
- `GET /jobs` — optional live job status (`jobId`, `status`, `txHash`).
- `POST /orders` (header `X-Booth-Key`) and `GET /orders/{code}` — voice/Claude mode.

## Adding a theme

Create `assets/js/themes/<name>.js` calling `PhotoboothThemes.register({...})` (see `registry.js`
for the full contract: settings, face art, voice lines, ambient sound, effects) and add a
`<script>` tag in `assets/index.html`.
