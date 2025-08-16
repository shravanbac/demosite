import {
  buildBlock,
  loadHeader,
  loadFooter,
  decorateButtons,
  decorateIcons,
  decorateSections,
  decorateBlocks,
  decorateTemplateAndTheme,
  waitForFirstImage,
  loadSection,
  loadSections,
  loadCSS,
} from './aem.js';

/**
 * Builds hero block and prepends to main in a new section.
 * @param {Element} main The container element
 */
function buildHeroBlock(main) {
  const h1 = main.querySelector('h1');
  const picture = main.querySelector('picture');
  // eslint-disable-next-line no-bitwise
  if (h1 && picture && (h1.compareDocumentPosition(picture) & Node.DOCUMENT_POSITION_PRECEDING)) {
    const section = document.createElement('div');
    section.append(buildBlock('hero', { elems: [picture, h1] }));
    main.prepend(section);
  }
}

/**
 * load fonts.css and set a session storage flag
 */
async function loadFonts() {
  await loadCSS(`${window.hlx.codeBasePath}/styles/fonts.css`);
  try {
    if (!window.location.hostname.includes('localhost')) sessionStorage.setItem('fonts-loaded', 'true');
  } catch (e) {
    // do nothing
  }
}

/**
 * Builds all synthetic blocks in a container element.
 * @param {Element} main The container element
 */
function buildAutoBlocks(main) {
  try {
    buildHeroBlock(main);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Auto Blocking failed', error);
  }
}

/**
 * Decorates the main element.
 * @param {Element} main The main element
 */
// eslint-disable-next-line import/prefer-default-export
export function decorateMain(main) {
  // hopefully forward compatible button decoration
  decorateButtons(main);
  decorateIcons(main);
  buildAutoBlocks(main);
  decorateSections(main);
  decorateBlocks(main);
}

/**
 * Loads everything needed to get to LCP.
 * @param {Element} doc The container element
 */
async function loadEager(doc) {
  document.documentElement.lang = 'en';
  decorateTemplateAndTheme();
  const main = doc.querySelector('main');
  if (main) {
    decorateMain(main);
    document.body.classList.add('appear');
    await loadSection(main.querySelector('.section'), waitForFirstImage);
  }

  try {
    /* if desktop (proxy for fast connection) or fonts already loaded, load fonts.css */
    if (window.innerWidth >= 900 || sessionStorage.getItem('fonts-loaded')) {
      loadFonts();
    }
  } catch (e) {
    // do nothing
  }
}

/**
 * Loads everything that doesn't need to be delayed.
 * @param {Element} doc The container element
 */
async function loadLazy(doc) {
  const main = doc.querySelector('main');
  await loadSections(main);

  const { hash } = window.location;
  const element = hash ? doc.getElementById(hash.substring(1)) : false;
  if (hash && element) element.scrollIntoView();

  loadHeader(doc.querySelector('header'));
  loadFooter(doc.querySelector('footer'));

  loadCSS(`${window.hlx.codeBasePath}/styles/lazy-styles.css`);
  loadFonts();
}

/**
 * Loads everything that happens a lot later,
 * without impacting the user experience.
 */
function loadDelayed() {
  // eslint-disable-next-line import/no-cycle
  window.setTimeout(() => import('./delayed.js'), 3000);
  // load anything that can be postponed to the latest here
}

async function loadPage() {
  await loadEager(document);
  await loadLazy(document);
  loadDelayed();
}

/* -------------------------------------------------------------------------- */
/*                   Sidekick: Send For Review + Webhook POST                 */
/* -------------------------------------------------------------------------- */

const WEBHOOK_URL = 'https://hook.fusion.adobe.com/vko85v1ph298ozoqj63vg2k6swj9wgj3';

// Disable should persist for this page while waiting.
// If Fusion returns a statusUrl, we poll it; otherwise we auto-reset after TTL.
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;   // 24h safety valve (tweak as needed)
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_JITTER_MS = 1500;

/** Extract {ref, site, org, env, path, title, url, host, iso_now} */
function getSidekickContext() {
  const { host, pathname, href } = window.location;
  let ref; let site; let org; let env;
  const m = host.match(/^([^-]+)--([^-]+)--([^.]+)\.aem\.(page|live)$/);
  if (m) [, ref, site, org, env] = m;

  // Fallbacks for localhost or non-standard hosts
  const skHost = document.querySelector('aem-sidekick');
  const sk = (window.hlx && window.hlx.sidekick)
    || skHost?.sidekick
    || skHost?.config
    || {};
  ref  = ref  || sk.ref  || sk.branch || sk.gitref  || '';
  site = site || sk.repo || sk.site   || '';
  org  = org  || sk.owner|| sk.org    || '';
  env  = env  || (host.includes('.aem.live') ? 'live' : 'page');

  const path = (pathname || '/').replace(/^\//, '');
  const title = document.title || path || '/';
  const iso_now = new Date().toISOString();
  return { ref, site, org, env, path, title, url: href, host, iso_now };
}

/** Build payload (matches your current implementation) */
function buildPayload(ctx) {
  const liveHost = (ctx.ref && ctx.site && ctx.org)
    ? `${ctx.ref}--${ctx.site}--${ctx.org}.aem.live`
    : window.location.host.replace('.aem.page', '.aem.live');

  return {
    url: `https://${liveHost}/${ctx.path}`,
    title: ctx.title,
    path: `/${ctx.path}`,
    org: ctx.org,
    site: ctx.site,
    ref: ctx.ref,
    source: 'DA.live',
    publishedAt: ctx.iso_now,
  };
}

/** POST to Fusion webhook; try to parse JSON body for {statusUrl,...} */
async function postToWebhook(payload) {
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    mode: 'cors',
    body: JSON.stringify(payload),
  });
  const text = await res.text(); // body might be empty or JSON
  let meta = null;
  try { meta = text ? JSON.parse(text) : null; } catch (e) { /* ignore non-JSON */ }
  if (!res.ok) {
    const detail = (meta && (meta.message || meta.error)) || text || '';
    throw new Error(`HTTP ${res.status}${detail ? ` – ${detail}` : ''}`);
  }
  return meta || {};
}

/** localStorage helpers to persist "pending" per page (ref/site/org/path) */
function storageKey(ctx) {
  return `sfr:pending:${ctx.ref}|${ctx.site}|${ctx.org}|/${ctx.path}`;
}
function savePending(ctx, pending) {
  try { localStorage.setItem(storageKey(ctx), JSON.stringify({ ...pending, t: Date.now() })); } catch (e) {}
}
function loadPending(ctx) {
  try {
    const raw = localStorage.getItem(storageKey(ctx));
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v?.t || Date.now() - v.t > PENDING_TTL_MS) {
      localStorage.removeItem(storageKey(ctx));
      return null;
    }
    return v;
  } catch (e) { return null; }
}
function clearPending(ctx) {
  try { localStorage.removeItem(storageKey(ctx)); } catch (e) {}
}

/** Ensure disabled/aria-busy + try to disable inner clickable node */
function enforceDisabled(btn, disabled) {
  if (disabled) {
    btn.setAttribute('aria-busy', 'true');
    btn.setAttribute('disabled', '');
    btn.style.pointerEvents = 'none'; // belt & suspenders on host
    // try to reach internal control
    const applyInner = () => {
      const inner = btn.shadowRoot?.querySelector('button, [part="button"], .control, .sk-button');
      if (inner) {
        inner.disabled = true;
        inner.style.pointerEvents = 'none';
        return true;
      }
      return false;
    };
    if (!applyInner()) {
      // watch once until shadow content is ready
      const mo = new MutationObserver(() => { if (applyInner()) mo.disconnect(); });
      btn.shadowRoot && mo.observe(btn.shadowRoot, { childList: true, subtree: true });
    }
  } else {
    btn.removeAttribute('aria-busy');
    btn.removeAttribute('disabled');
    btn.style.pointerEvents = '';
    const inner = btn.shadowRoot?.querySelector('button, [part="button"], .control, .sk-button');
    if (inner) {
      inner.disabled = false;
      inner.style.pointerEvents = '';
    }
  }
}

/** Poll Fusion status URL (if provided). Label never changes; only enable on reject/timeout. */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function pollApproval({ statusUrl, btn, ctx }) {
  if (!statusUrl) return; // nothing to poll; pending TTL keeps it disabled

  const startedAt = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const r = await fetch(statusUrl, { method: 'GET', mode: 'cors' });
      const txt = await r.text();
      let data = null;
      try { data = txt ? JSON.parse(txt) : null; } catch (e) { /* ignore */ }
      const status = (data && (data.status || data.State || data.result)) || '';

      if (/approved/i.test(status)) {
        clearPending(ctx);
        // keep disabled on approval
        return;
      }
      if (/rejected|declined|failed/i.test(status)) {
        enforceDisabled(btn, false);
        clearPending(ctx);
        return;
      }
    } catch (e) {
      // transient error, keep waiting
    }

    // safety timeout
    if (Date.now() - startedAt > PENDING_TTL_MS) {
      enforceDisabled(btn, false);
      clearPending(ctx);
      return;
    }

    const jitter = Math.floor(Math.random() * POLL_MAX_JITTER_MS);
    await delay(POLL_INTERVAL_MS + jitter);
  }
}

/** Add "Send For Review" before Publish and wire the click */
(function sidekickSendForReview() {
  const LABEL = 'Send For Review';
  const LABEL_COLOR = 'gainsboro';
  const log = (...a) => console.log('[SFR]', ...a);

  function attach() {
    const host = document.querySelector('aem-sidekick');
    const root = host && host.shadowRoot;
    if (!root) return;

    // Delegated click handler -> POST + disable (per page) until approval
    if (!root.__sfrDelegation) {
      root.__sfrDelegation = true;
      root.addEventListener('click', async (e) => {
        const hit = (e.composedPath?.() || []).find(
          (el) => el?.tagName === 'SK-ACTION-BUTTON' && el.classList?.contains('send-review'),
        );
        if (!hit) return;

        // if already disabled (pending), ignore
        if (hit.hasAttribute('disabled')) return;

        const ctx = getSidekickContext();
        try {
          enforceDisabled(hit, true); // disable, keep label text
          const payload = buildPayload(ctx);
          const meta = await postToWebhook(payload);

          // Persist "pending" for this page and start polling if possible
          const statusUrl = meta?.statusUrl || meta?.status_url || meta?.statusURL || null;
          savePending(ctx, { status: 'pending', statusUrl });
          if (statusUrl) {
            pollApproval({ statusUrl, btn: hit, ctx }).catch(() => {});
          }
          alert('Review request submitted ✅');
        } catch (err) {
          console.error('[SFR] webhook failed:', err);
          alert(`Send For Review failed: ${err.message}`);
          enforceDisabled(hit, false); // re-enable on failure
        }
      }, { capture: true });
      log('delegation attached');
    }

    const locate = () => {
      const barEl = root.querySelector('plugin-action-bar');
      const barSR = barEl && barEl.shadowRoot;
      const publish = barSR && barSR.querySelector('sk-action-button.publish');
      const group = barSR && (barSR.querySelector('.action-group.plugins-container') || publish?.parentNode);
      return { barSR, publish, group };
    };

    // visible label via a slotted node so color applies
    const setInitialLabel = (btn) => {
      const span = document.createElement('span');
      span.textContent = LABEL;
      span.style.color = LABEL_COLOR;
      btn.replaceChildren(span);
      btn.setAttribute('aria-label', LABEL);
      btn.setAttribute('title', LABEL);
    };

    const ensureButton = () => {
      const { barSR, publish, group } = locate();
      if (!barSR || !group) return false;
      if (barSR.querySelector('sk-action-button.send-review')) return true;

      // Attempt 1: real constructor (best styling)
      const Ctor = customElements.get('sk-action-button');
      if (Ctor) {
        try {
          const btn = new Ctor();
          btn.classList.add('send-review');
          // copy useful attrs from Publish for spacing/behavior
          if (publish) {
            [...publish.attributes].forEach(({ name, value }) => {
              if (!['class', 'title', 'aria-label'].includes(name)) btn.setAttribute(name, value);
            });
          } else {
            btn.setAttribute('quiet', '');
            btn.setAttribute('dir', 'ltr');
            btn.setAttribute('role', 'button');
            btn.setAttribute('tabindex', '0');
          }
          setInitialLabel(btn);
          (publish?.parentNode || group).insertBefore(btn, publish || null); // BEFORE Publish
          log('button inserted (ctor)');
          return true;
        } catch (e) { log('ctor failed:', e.message); }
      }

      // Attempt 2: clone Publish (inherits exact look)
      if (publish) {
        const clone = publish.cloneNode(true);
        clone.classList.remove('publish', 'reload', 'edit');
        clone.classList.add('send-review');
        clone.removeAttribute('disabled'); clone.removeAttribute('aria-busy');
        setInitialLabel(clone);
        publish.parentNode.insertBefore(clone, publish); // BEFORE Publish
        log('button inserted (clone)');
        return true;
      }

      // Attempt 3: createElement fallback
      const el = document.createElement('sk-action-button');
      el.classList.add('send-review');
      el.setAttribute('quiet', ''); el.setAttribute('dir', 'ltr');
      el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0');
      setInitialLabel(el);
      group.insertBefore(el, publish || null);
      log('button inserted (createElement)');
      return true;
    };

    // Try now; if not ready, watch for renders and CE upgrade
    let inserted = ensureButton();
    if (!inserted) {
      if (!customElements.get('sk-action-button')) {
        customElements.whenDefined('sk-action-button').then(() => inserted || (inserted = ensureButton()));
      }
      const mo = new MutationObserver(() => {
        inserted || (inserted = ensureButton());
        if (inserted) mo.disconnect();
      });
      mo.observe(root, { childList: true, subtree: true });
      log('waiting for action bar…');
    }

    // Rehydrate "pending" for this page and enforce disabled on load
    const ctx = getSidekickContext();
    const pending = loadPending(ctx);
    if (pending && root.querySelector('plugin-action-bar')?.shadowRoot) {
      const barSR = root.querySelector('plugin-action-bar').shadowRoot;
      const btn = barSR.querySelector('sk-action-button.send-review');
      if (btn) {
        enforceDisabled(btn, true);
        if (pending.statusUrl) {
          pollApproval({ statusUrl: pending.statusUrl, btn, ctx }).catch(() => {});
        } else {
          // No status URL; auto-reset after TTL if still pending
          setTimeout(() => {
            const still = loadPending(ctx);
            if (still) {
              enforceDisabled(btn, false);
              clearPending(ctx);
            }
          }, Math.max(0, pending.t + PENDING_TTL_MS - Date.now()));
        }
      }
    }

    // Keep it across Lit re-renders (reinsert + reapply disabled if pending)
    const { barSR } = locate();
    if (barSR && !barSR.__sfrPersist) {
      barSR.__sfrPersist = true;
      new MutationObserver(() => {
        const btn = barSR.querySelector('sk-action-button.send-review');
        if (!btn) {
          ensureButton();
        } else {
          const p = loadPending(getSidekickContext());
          if (p) enforceDisabled(btn, true);
        }
      }).observe(barSR, { childList: true, subtree: true });
      log('persistence on');
    }
  }

  if (document.querySelector('aem-sidekick')) attach();
  document.addEventListener('sidekick-ready', attach);
  document.addEventListener('helix-sidekick-ready', attach);
  customElements.whenDefined?.('aem-sidekick').then(attach);
})();

/* -------------------------------------------------------------------------- */

loadPage();
