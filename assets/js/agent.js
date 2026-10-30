/**
 * Agent payments UI: the Booth Agent (on the board) buys prints from the
 * Print Agent (on another machine) with x402 / USDC on XDC Network.
 *
 * The board reports each step as "active" then "done" (or "error"). Real steps can
 * finish within milliseconds, so the stepper plays them back at a readable pace:
 * every step is shown working for a moment before it ticks off.
 */
const Agent = (() => {
  const q = (sel) => document.querySelector(sel);
  const card = q('#agentCard');
  const stepsEl = q('#agentSteps');
  const modeBadge = q('#agentMode');
  const token = q('#agentToken');
  const resultEl = q('#agentResult');
  const summary = q('#agentSummary');
  const budget = q('#agentBudget');
  const budgetText = q('#agentBudgetText');
  const dialog = q('#agentSetup');
  const form = q('#agentForm');
  const formError = q('#agentFormError');

  // Step order, titles, and which way the token travels, per payment mode
  const COMMON_START = [
    { id: 'request', title: 'Booth Agent asks for a print', from: 'booth', to: 'printer', icon: '📄' },
    { id: 'quote', title: 'Print Agent quotes a price (HTTP 402)', from: 'printer', to: 'booth', icon: '🧾' },
  ];
  const COMMON_END = [
    { id: 'settle', title: 'Payment settles on XDC Network', from: 'booth', to: 'chain', icon: '💵' },
    { id: 'print', title: 'Print Agent prints the photo', at: 'printer', icon: '🖨️' },
  ];
  const STEPS_BY_MODE = {
    booth: [
      ...COMMON_START,
      { id: 'check', title: 'Booth Agent checks its budget', at: 'booth', icon: '🔍' },
      { id: 'sign', title: 'Booth Agent signs the USDC payment', at: 'booth', icon: '✍️' },
      ...COMMON_END,
    ],
    claude: [
      { id: 'request', title: 'Booth Agent opens a print order', from: 'booth', to: 'printer', icon: '📄' },
      { id: 'quote', title: 'Print Agent sets the price', from: 'printer', to: 'booth', icon: '🧾' },
      { id: 'speak', title: 'Booth talks to your Claude', from: 'booth', to: 'guest', icon: '🗣️' },
      { id: 'agent', title: 'Your Claude pays via XDC AI (x402)', from: 'guest', to: 'printer', icon: '🤖' },
      { id: 'settle', title: 'Payment settles on XDC Network', from: 'printer', to: 'chain', icon: '💵' },
      { id: 'print', title: 'Print Agent prints the photo', at: 'printer', icon: '🖨️' },
    ],
    guest: [
      ...COMMON_START,
      { id: 'check', title: 'Booth Agent checks the price', at: 'booth', icon: '🔍' },
      { id: 'connect', title: 'Guest scans the QR with their wallet', from: 'guest', to: 'booth', icon: '📱' },
      { id: 'sign', title: 'Guest signs the USDC payment (gasless)', from: 'guest', to: 'booth', icon: '✍️' },
      ...COMMON_END,
    ],
  };
  let STEPS = STEPS_BY_MODE.booth;
  const qrBox = q('#agentQr');
  const qrCode = q('#agentQrCode');
  const qrTimer = q('#agentQrTimer');
  const modeInputs = document.querySelectorAll('input[name="paymentMode"]');
  const claudeBox = q('#agentClaude');
  const guestNode = q('.agent-node[data-node="guest"]');
  const GUEST_NODES = {
    guest: '<span>📱</span>Your wallet<small>Rabby · WalletConnect</small>',
    claude: '<span>🤖</span>Your Claude<small>xdcai.tech</small>',
  };
  let walletStarted = null; // job id for which the guest wallet flow is running
  let stepHook = null; // (event, mode) => void, e.g. to narrate the payment
  let jobMode = 'booth';
  let qrDeadline = 0;
  const GUEST_TIMEOUT_MS = 180000;
  const MIN_ACTIVE_MS = 1100; // each step is shown "working" at least this long
  const MIN_GAP_MS = 350; // pause between steps

  let status = null;
  let jobId = null;
  let seenActivity = 0;
  let queue = []; // board events waiting to be played back
  let playing = false;
  let state = {}; // step id -> { phase, text, link }
  let hideTimer = null;

  const short = (addr) => (addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '');
  const escape = (text) =>
    String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ---------- Polling the board ----------

  async function poll() {
    try {
      const res = await fetch('/agent/status', { cache: 'no-store' });
      if (!res.ok) return;
      status = await res.json();
      renderPanel();
      if (jobId) maybeStartGuestWallet();
      if (jobId) renderClaude();
      if (jobId) {
        for (const ev of status.activity) {
          if (ev.id > seenActivity && ev.job === jobId) queue.push(ev);
          seenActivity = Math.max(seenActivity, ev.id);
        }
        play();
      } else {
        seenActivity = status.activity.at(-1)?.id ?? seenActivity;
      }
    } catch {
      /* board busy or offline; try again next tick */
    }
  }

  function renderPanel() {
    let host = status.printAgentUrl;
    try {
      host = new URL(status.printAgentUrl).host;
    } catch {
      /* keep as typed */
    }
    const mode = status.paymentMode;
    modeInputs.forEach((input) => (input.checked = input.value === mode));
    const summaries = {
      claude: status.demo
        ? 'Demo mode: set the Print Agent URL (⚙️ Setup) for real voice payments.'
        : `The booth opens an order at ${host} and asks the guest's Claude (xdcai.tech) to pay it by voice.`,
      guest: status.demo
        ? 'Demo mode: set the Print Agent URL and WalletConnect project ID (⚙️ Setup) for real guest payments.'
        : `Guests pay the Print Agent at ${host} from their own wallet (USDC on XDC). The booth only relays the signature.`,
      booth: status.demo
        ? 'Demo mode: set up the Print Agent and booth wallet to pay for real.'
        : `Booth wallet ${short(status.address)} pays the Print Agent at ${host} in USDC on XDC.`,
    };
    summary.textContent = summaries[mode] || summaries.booth;
    budget.parentElement.hidden = mode !== 'booth';
    budgetText.hidden = mode !== 'booth';
    const ratio = status.dailyLimitUsdc ? Math.min(1, status.spentTodayUsdc / status.dailyLimitUsdc) : 0;
    budget.style.width = `${Math.round(ratio * 100)}%`;
    budgetText.textContent = `${status.spentTodayUsdc.toFixed(2)} / ${status.dailyLimitUsdc.toFixed(2)} USDC spent today · max ${status.maxPriceUsdc.toFixed(2)} per print`;
  }

  // ---------- Guest wallet (WalletConnect QR) ----------

  function maybeStartGuestWallet() {
    const job = status.jobs.find((j) => j.id === jobId);
    if (!job || job.state !== 'awaiting_wallet' || job.demo || walletStarted === jobId) return;
    walletStarted = jobId;
    const forJob = jobId;
    q('#agentQrPrice').textContent = `${job.amount} USDC`;
    GuestWallet.pay({
      jobId: forJob,
      projectId: status.walletConnectProjectId,
      chainId: job.chainId,
      onQr(svg) {
        if (jobId !== forJob) return;
        qrCode.innerHTML = svg;
        qrDeadline = performance.now() + GUEST_TIMEOUT_MS;
        qrBox.hidden = false;
        tickQrTimer();
      },
      onConnected() {
        qrBox.hidden = true;
      },
    }).catch(() => {
      qrBox.hidden = true;
    });
  }

  // ---------- Guest's Claude (voice) ----------

  const CLAUDE_HINTS = {
    ready: 'Open <b>Claude</b> on your phone, start <b>voice mode</b> and hold the phone near the booth. Then say <b>“ready”</b> or show 👍.',
    speaking: '🔊 The booth is speaking to your Claude…',
    waiting: '🤖 Your Claude is paying through XDC AI. If it missed it, say <b>“booth, repeat”</b>.',
  };

  function currentJob() {
    return status?.jobs.find((j) => j.id === jobId) || null;
  }

  function renderClaude() {
    const job = currentJob();
    const show = job && job.mode === 'claude' && job.state === 'awaiting_claude' && job.stage !== 'paid';
    claudeBox.hidden = !show;
    if (!show) return;
    q('#agentOrderCode').textContent = job.code;
    q('#agentClaudeHint').innerHTML = CLAUDE_HINTS[job.stage] || '';
    q('#agentClaudePrompt').textContent = `“${job.prompt}”`;
    q('#agentReady').hidden = job.stage !== 'ready';
    q('#agentRepeat').hidden = job.stage !== 'waiting';
  }

  async function signal(name) {
    if (!jobId) return false;
    try {
      const res = await fetch('/agent/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signal: name, jobId }),
      });
      return res.ok && (await res.json()).ok;
    } catch {
      return false;
    }
  }

  q('#agentReady').onclick = () => signal('ready');
  q('#agentRepeat').onclick = () => signal('repeat');

  function tickQrTimer() {
    if (qrBox.hidden) return;
    const left = Math.max(0, Math.round((qrDeadline - performance.now()) / 1000));
    qrTimer.textContent = `Waiting for your wallet… ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left`;
    if (left > 0) setTimeout(tickQrTimer, 500);
  }

  modeInputs.forEach((input) =>
    input.addEventListener('change', async () => {
      if (!input.checked) return;
      try {
        const res = await fetch('/agent/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentMode: input.value }),
        });
        if (res.ok) {
          status = { ...status, ...(await res.json()) };
          renderPanel();
        }
      } catch (err) {
        console.error('Could not switch payment mode', err);
      }
    })
  );

  // ---------- Paced playback ----------

  async function play() {
    if (playing) return;
    playing = true;
    while (queue.length) {
      const ev = queue.shift();
      if (ev.demo) modeBadge.hidden = false;

      if (ev.step === 'done') {
        await finish(ev);
        continue;
      }
      const current = state[ev.step];
      if (ev.phase === 'active' || (ev.phase === 'done' && current?.phase !== 'active')) {
        // Show the step working first, even if the board already finished it
        state[ev.step] = { phase: 'active', text: ev.phase === 'active' ? ev.text : 'Working…' };
        moveToken(ev.step);
        render();
        await wait(MIN_ACTIVE_MS);
        if (ev.phase === 'active') continue;
      }
      state[ev.step] = { phase: ev.phase, text: ev.text, link: ev.explorerUrl };
      render();
      stepHook?.(ev, jobMode);
      if (ev.phase === 'error') {
        await finish(null, ev.text);
        continue;
      }
      await wait(MIN_GAP_MS);
    }
    playing = false;
  }

  function render() {
    stepsEl.innerHTML = STEPS.map((s, i) => {
      const st = state[s.id];
      const phase = st?.phase || 'pending';
      const marker = { pending: i + 1, active: '', done: '✓', error: '✕' }[phase];
      const link = st?.link ? ` <a href="${escape(st.link)}" target="_blank" rel="noopener">view tx ↗</a>` : '';
      return `<li class="${phase}"><span class="marker">${marker}</span><div><b>${s.icon} ${escape(s.title)}</b>${
        st ? `<small>${escape(st.text)}${link}</small>` : ''
      }</div></li>`;
    }).join('');
  }

  function moveToken(stepId) {
    const s = STEPS.find((x) => x.id === stepId);
    if (!s) return;
    const lane = token.parentElement.getBoundingClientRect();
    const center = (node) => {
      const r = q(`.agent-node[data-node="${node}"] span`).getBoundingClientRect();
      return r.left + r.width / 2 - lane.left;
    };
    document.querySelectorAll('.agent-node').forEach((n) => n.classList.toggle('busy', n.dataset.node === (s.at || s.to)));
    token.textContent = s.icon;
    token.classList.remove('travel', 'pulse');
    void token.offsetWidth;
    if (s.at) {
      token.style.setProperty('--from', `${center(s.at)}px`);
      token.style.setProperty('--to', `${center(s.at)}px`);
      token.classList.add('pulse');
    } else {
      token.style.setProperty('--from', `${center(s.from)}px`);
      token.style.setProperty('--to', `${center(s.to)}px`);
      token.classList.add('travel');
    }
  }

  async function finish(ev, error) {
    qrBox.hidden = true;
    claudeBox.hidden = true;
    document.querySelectorAll('.agent-node').forEach((n) => n.classList.remove('busy'));
    token.classList.remove('travel', 'pulse');
    token.textContent = '';
    if (error) {
      resultEl.className = 'failed';
      resultEl.innerHTML = `❌ Payment stopped: ${escape(error)}`;
    } else {
      resultEl.className = 'ok';
      const link = ev.explorerUrl ? ` · <a href="${escape(ev.explorerUrl)}" target="_blank" rel="noopener">view on XDC explorer ↗</a>` : '';
      resultEl.innerHTML = `🎉 ${escape(ev.text)}${link}`;
    }
    resultEl.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(close, error ? 14000 : 12000);
  }

  function close() {
    card.hidden = true;
    jobId = null;
    queue = [];
  }

  async function print(image, theme) {
    if (jobId) return false; // one print at a time
    try {
      const res = await fetch('/agent/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, theme }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      jobId = (await res.json()).jobId;
      clearTimeout(hideTimer);
      const mode = STEPS_BY_MODE[status?.paymentMode] ? status.paymentMode : 'booth';
      STEPS = STEPS_BY_MODE[mode];
      jobMode = mode;
      guestNode.hidden = mode === 'booth';
      if (GUEST_NODES[mode]) guestNode.innerHTML = GUEST_NODES[mode];
      claudeBox.hidden = true;
      qrBox.hidden = true;
      qrCode.innerHTML = '';
      state = {};
      queue = [];
      modeBadge.hidden = true;
      resultEl.hidden = true;
      render();
      card.hidden = false;
      poll();
      return true;
    } catch (err) {
      console.error('Print request failed', err);
      return false;
    }
  }

  // ---------- Setup dialog ----------

  q('#agentSetupButton').onclick = () => {
    form.printAgentUrl.value = status?.printAgentUrl || '';
    form.walletConnectProjectId.value = status?.walletConnectProjectId || '';
    form.privateKey.value = '';
    form.maxPriceUsdc.value = status?.maxPriceUsdc ?? 0.5;
    form.dailyLimitUsdc.value = status?.dailyLimitUsdc ?? 5;
    q('#agentFormAddress').textContent = status?.address
      ? `Current booth wallet: ${status.address}`
      : 'No booth wallet set yet.';
    formError.hidden = true;
    dialog.showModal();
  };

  form.addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'save') return;
    e.preventDefault();
    const settings = {
      printAgentUrl: form.printAgentUrl.value.trim(),
      walletConnectProjectId: form.walletConnectProjectId.value.trim(),
      maxPriceUsdc: form.maxPriceUsdc.value,
      dailyLimitUsdc: form.dailyLimitUsdc.value,
    };
    if (form.privateKey.value.trim()) settings.privateKey = form.privateKey.value.trim();
    if (form.printAgentKey.value.trim()) settings.printAgentKey = form.printAgentKey.value.trim();
    try {
      const res = await fetch('/agent/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      form.privateKey.value = '';
      status = { ...status, ...data };
      renderPanel();
      dialog.close();
    } catch (err) {
      formError.textContent = String(err.message || err);
      formError.hidden = false;
    }
  });

  poll();
  setInterval(poll, 700);

  return {
    print,
    signal,
    onStep(fn) {
      stepHook = fn;
    },
    get busy() {
      return jobId !== null;
    },
    /** True while the voice flow waits for the guest's "ready" (so 👍 means ready). */
    get awaitingReady() {
      const job = currentJob();
      return !!job && job.mode === 'claude' && job.state === 'awaiting_claude' && job.stage === 'ready';
    },
    get paymentMode() {
      return status?.paymentMode;
    },
  };
})();
