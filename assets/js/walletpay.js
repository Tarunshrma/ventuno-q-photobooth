/**
 * Guest wallet payments over WalletConnect: the booth page acts as the dapp, shows a
 * pairing QR code, and asks the guest's mobile wallet (e.g. Rabby) to sign the USDC
 * authorization that pays the Print Agent. The signature goes back to the board, which
 * forwards it to the Print Agent with x402. The booth never receives the money.
 */
const GuestWallet = (() => {
  const SIGN_CLIENT_URL = 'https://esm.sh/@walletconnect/sign-client@2.17.2';
  let client = null;
  let clientProjectId = null;

  async function getClient(projectId) {
    if (client && clientProjectId === projectId) return client;
    const mod = await import(SIGN_CLIENT_URL);
    const SignClient = mod.SignClient || mod.default;
    client = await SignClient.init({
      projectId,
      metadata: {
        name: 'Festive Photobooth',
        description: 'Pay for your photo print with USDC on XDC Network',
        url: location.origin,
        icons: [],
      },
    });
    clientProjectId = projectId;
    return client;
  }

  async function post(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    return data;
  }

  /**
   * Run one guest payment. Callbacks: onQr(svgMarkup) when the pairing QR is ready,
   * onConnected(address) once the wallet has joined.
   */
  async function pay({ jobId, projectId, chainId, onQr, onConnected }) {
    let session = null;
    let c = null;
    try {
      c = await getClient(projectId);
      const chain = `eip155:${chainId}`;
      const { uri, approval } = await c.connect({
        optionalNamespaces: {
          eip155: { methods: ['eth_signTypedData_v4'], chains: [chain], events: ['accountsChanged', 'chainChanged'] },
        },
      });
      const qr = await fetch('/agent/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: uri }),
      });
      onQr(await qr.text());

      session = await approval();
      const accounts = session.namespaces.eip155?.accounts || [];
      const account = accounts.find((a) => a.startsWith(`${chain}:`)) || accounts[0];
      if (!account) throw new Error('The wallet did not share an account');
      const address = account.split(':')[2];
      onConnected(address);

      const typed = await post('/agent/guest/typed-data', { jobId, address });
      const signature = await c.request({
        topic: session.topic,
        chainId: chain,
        request: { method: 'eth_signTypedData_v4', params: [address, JSON.stringify(typed)] },
      });
      await post('/agent/guest/signature', { jobId, signature });
    } catch (err) {
      console.error('Guest wallet payment failed', err);
      const message = String(err?.message || err).slice(0, 160);
      await post('/agent/guest/signature', { jobId, error: message }).catch(() => {});
      throw err;
    } finally {
      // One guest per payment: drop the pairing so the next guest gets a fresh QR
      if (session && c) c.disconnect({ topic: session.topic, reason: { code: 6000, message: 'Payment finished' } }).catch(() => {});
    }
  }

  return { pay };
})();
