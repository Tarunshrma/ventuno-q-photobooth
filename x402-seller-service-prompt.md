Build a small "Print Agent" service for a live demo of agent-to-agent payments on XDC Network using x402.

Context:
- A photobooth app runs on an Arduino VENTUNO Q board (Ubuntu) on the same LAN. Its "Booth Agent" will pay this
  service per print using x402 (USDC on XDC, EIP-3009, settled via the public XDC AI facilitator from xdcai.tech).
- This laptop has a normal printer installed in the OS. The service must print the photo it receives.
- Read the docs first: https://docs.xdcai.tech — especially /facilitator/accept-x402-payments-xdc,
  /facilitator/sdks, /reference/x402-flow and /reference/constants. Use the exact facilitator URL, network name,
  USDC asset address and chain ID from the docs; do not guess them.

Requirements:
1. Node.js + TypeScript + Express, using @xdcai/x402-seller@1.0.0-rc.1 (pin exact version).
2. Endpoints:
   - GET  /health          -> {"ok": true, "printer": "<name>", "price": "<USDC amount>"} (free)
   - POST /print           -> x402-protected. Body: JSON {"image": "data:image/jpeg;base64,...", "jobId": "...",
                              "copies": 1}. Price configurable (default 0.10 USDC). After payment is settled,
                              print the image and respond {"status":"printed","jobId":...,"txHash":...,
                              "explorerUrl":...,"payer":...,"amount":...}. The 402 response must include the
                              standard x402 "accepts" requirements (scheme, network, asset, payTo, maxAmountRequired,
                              resource, extra with EIP-712 domain name/version) so a generic client can pay it.
   - GET  /jobs            -> last 50 jobs with status, payer, amount, txHash, timestamps (free; for a dashboard).
3. Printing: save the image to a temp file and print it with the OS printer (Windows: use pdf-to-printer or
   a PowerShell print command; macOS/Linux: `lp`). Fit to a 4x6 / A6 page if possible. Make PRINTER_NAME configurable;
   add DRY_RUN=1 to skip real printing (just save the file) for testing.
   Optionally stamp a small footer on the print: "Paid by agent · XDC Network · tx <short hash>" plus a QR code
   linking to the explorer URL.
4. Config via .env (never commit secrets): FACILITATOR_URL, FACILITATOR_API_KEY (if the docs require one),
   SELLER_RECEIVER_ADDRESS (my XDC wallet that receives USDC), PRICE_USDC, NETWORK (testnet/mainnet per docs),
   PRINTER_NAME, PORT (default 8402), DRY_RUN. Provide .env.example.
5. Listen on 0.0.0.0 so the board on the LAN can reach it; print the LAN URL at startup. Log each step of every job
   (request received -> 402 sent -> payment verified -> settled (tx hash) -> printed) clearly, since this is a demo.
6. Also include a tiny test client script (using @xdcai/x402-buyer@1.0.0-rc.2 or the xdcai CLI) that pays /print
   once with DRY_RUN so I can test end-to-end from the laptop before connecting the board.
7. README: setup, how to fund/configure wallets, how to run, how to test, and the exact 402 response JSON
   (paste a real example) so the board-side Python client can be written against it.

When done, tell me: the service URL, the price, the network used, and paste one real 402 response body.
