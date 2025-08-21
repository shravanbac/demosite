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
/*     Sidekick: "Send For Review" — plain POST (no TTL, no polling, no LS)   */
/* -------------------------------------------------------------------------- */
/*
  Drop‑in usage
  =============
  - Include this IIFE after the Sidekick loads (end of your main JS is fine).
  - It injects a "Send For Review" button before Publish and performs a
    single POST to your Fusion webhook when clicked.
  - No persistence, no status polling, no timers — just the POST.

  Configure the webhook (first match wins):
    1) window.__SFR_WEBHOOK_URL = "https://hook.fusion.adobe.com/xxxx";
    2) <meta name="sfr:webhook" content="https://hook.fusion.adobe.com/xxxx">
    3) DEFAULT_WEBHOOK below.
*/

(() => {
  const DEFAULT_WEBHOOK = "https://hook.app.workfrontfusion.com/3o5lrlkstfbbrspi35hh0y3cmjkk4gdd";
  const LABEL = "Send For Review";
  const LABEL_COLOR = "gainsboro";

  /** Resolve webhook URL from global, meta, or default */
  function resolveWebhook() {
    if (typeof window.__SFR_WEBHOOK_URL === 'string' && window.__SFR_WEBHOOK_URL) return window.__SFR_WEBHOOK_URL;
    const meta = document.querySelector('meta[name="sfr:webhook"]');
    if (meta?.content) return meta.content.trim();
    return DEFAULT_WEBHOOK;
  }

  /** Extract {ref, site, org, env, path, title, url, host, iso_now} */
  function getSidekickContext() {
    const { host, pathname, href } = window.location;
    let ref = ""; let site = ""; let org = ""; let env = host.includes('.aem.live') ? 'live' : 'page';
    const m = host.match(/^([^-]+)--([^-]+)--([^.]+)\.aem\.(page|live)$/);
    if (m) [, ref, site, org, env] = m;

    const skEl = document.querySelector('aem-sidekick, helix-sidekick');
    const sk = (window.hlx && window.hlx.sidekick) || skEl?.sidekick || skEl?.config || {};
    ref  = ref  || sk.ref  || sk.branch || sk.gitref || '';
    site = site || sk.repo || sk.site   || '';
    org  = org  || sk.owner|| sk.org    || '';

    const path = (pathname || '/').replace(/^\//, '');
    const title = document.title || path || '/';
    const iso_now = new Date().toISOString();
    return { ref, site, org, env, path, title, url: href, host, iso_now };
  }

  /** Build payload expected by your Fusion scenario */
function buildPayload(ctx) {
  // Resolve live & preview hosts
  const hasRepo = Boolean(ctx.ref && ctx.site && ctx.org);
  const liveHost = hasRepo
    ? `${ctx.ref}--${ctx.site}--${ctx.org}.aem.live`
    : (ctx.host && ctx.host.endsWith('.aem.page')
        ? ctx.host.replace('.aem.page', '.aem.live')
        : ctx.host || 'localhost');
  const previewHost = hasRepo
    ? `${ctx.ref}--${ctx.site}--${ctx.org}.aem.page`
    : (ctx.host || 'localhost');

  // Normalize path and derive name
  const cleanPath = (ctx.path || '').replace(/^\/+/, '');
  const last = cleanPath.split('/').filter(Boolean).pop() || 'index';
  const name = last.replace(/\.[^.]+$/, '') || 'index';

  // Head helpers
  const qMeta = (sel) => {
    const el = document.head.querySelector(sel);
    return el && (el.content || el.getAttribute('content')) || null;
  };
  const metas = (prefix) => {
    const out = {};
    document.head.querySelectorAll(`meta[property^="${prefix}"], meta[name^="${prefix}"]`)
      .forEach((m) => {
        const key = (m.getAttribute('property') || m.getAttribute('name')).replace(`${prefix}:`, '');
        out[key] = m.getAttribute('content');
      });
    return Object.keys(out).length ? out : undefined;
  };
  const canonical = (() => {
    const l = document.head.querySelector('link[rel="canonical"]');
    return l ? l.href : undefined;
  })();

  // Optional headings (limit for brevity)
  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .slice(0, 6)
    .map(h => ({ level: h.tagName, text: h.textContent.trim() }))
    || undefined;

  // Base payload (your 4 required fields)
  const payload = {
    title: ctx.title,
    url: `https://${liveHost}/${cleanPath}`,
    name,
    publishedDate: ctx.iso_now,
  };

  // Enrich (optional but useful)
  Object.assign(payload, {
    // context
    path: `/${cleanPath}`,
    previewUrl: `https://${previewHost}/${cleanPath}`,
    liveUrl: `https://${liveHost}/${cleanPath}`,
    host: ctx.host,
    env: ctx.env,
    org: ctx.org || undefined,
    site: ctx.site || undefined,
    ref: ctx.ref || undefined,
    source: 'DA.live',

    // page meta
    lang: document.documentElement.lang || undefined,
    dir: document.documentElement.dir || undefined,
    canonical: canonical,
    meta: {
      description: qMeta('meta[name="description"]'),
      keywords: qMeta('meta[name="keywords"]'),
      author: qMeta('meta[name="author"]'),
      og: metas('og') || undefined,
      twitter: metas('twitter') || undefined,
    },

    // small content preview
    headings,

    // client/audit (optional)
    analytics: {
      referrer: document.referrer || undefined,
      userAgent: navigator.userAgent || undefined,
      locale: navigator.language || undefined,
      timezoneOffset: new Date().getTimezoneOffset(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    },

    // dedupe helper if you ever need it
    idempotencyKey: `${cleanPath}#${ctx.iso_now}`,
  });

  // Clean out empty nested objects
  const clean = (obj) => {
    Object.keys(obj).forEach((k) => {
      const v = obj[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) clean(v);
      if (v == null || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) {
        delete obj[k];
      }
    });
    return obj;
  };

  return clean(payload);
}



  /** Minimal POST helper (no retries). Accepts empty/JSON response. */
  async function postToWebhook(webhook, payload) {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      mode: 'cors',
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let meta = null; try { meta = text ? JSON.parse(text) : null; } catch { /* ignore */ }
    if (!res.ok) {
      const detail = (meta && (meta.message || meta.error)) || text || '';
      throw new Error(`HTTP ${res.status}${detail ? ` – ${detail}` : ''}`);
    }
    return meta || {};
  }

  /** UI helpers */
  function setInitialLabel(btn) {
    const span = document.createElement('span');
    btn.replaceChildren(span);
    btn.setAttribute('aria-label', LABEL);
    btn.setAttribute('title', LABEL);
  }

  function locate(root) {
    const barEl = root.querySelector('plugin-action-bar');
    const barSR = barEl && barEl.shadowRoot;
    const publish = barSR && barSR.querySelector('sk-action-button.publish');
    const group = barSR && (barSR.querySelector('.action-group.plugins-container') || publish?.parentNode || barSR);
    return { barSR, publish, group };
  }

  function ensureButton(root) {
    const { barSR, publish, group } = locate(root);
    if (!barSR || !group) return null;
    const existing = barSR.querySelector('sk-action-button.send-review');
    if (existing) return existing;

    // Prefer real constructor for exact styling
    const Ctor = customElements.get('sk-action-button');
    if (Ctor) {
      try {
        const btn = new Ctor();
        btn.classList.add('send-review');
        btn.dataset.action = 'send-for-review';
        if (publish) {
          [...publish.attributes].forEach(({ name, value }) => {
            if (!['class', 'title', 'aria-label'].includes(name)) btn.setAttribute(name, value);
          });
        } else {
          btn.setAttribute('quiet', ''); btn.setAttribute('dir', 'ltr'); btn.setAttribute('role', 'button'); btn.setAttribute('tabindex', '0');
        }
        setInitialLabel(btn);
        (publish?.parentNode || group).insertBefore(btn, publish || null);
        return btn;
      } catch {}
    }

    // Fallback: clone Publish
    if (publish) {
      const clone = publish.cloneNode(true);
      clone.classList.remove('publish', 'reload', 'edit');
      clone.classList.add('send-review');
      clone.dataset.action = 'send-for-review';
      clone.removeAttribute('disabled');
      clone.removeAttribute('aria-busy');
      setInitialLabel(clone);
      publish.parentNode.insertBefore(clone, publish);
      return clone;
    }

    // Fallback: create element
    const el = document.createElement('sk-action-button');
    el.classList.add('send-review');
    el.dataset.action = 'send-for-review';
    el.setAttribute('quiet', ''); el.setAttribute('dir', 'ltr'); el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0');
    setInitialLabel(el);
    group.insertBefore(el, publish || null);
    return el;
  }

  function getHost() { return document.querySelector('aem-sidekick, helix-sidekick'); }

  function attach() {
    const host = getHost();
    const root = host && host.shadowRoot;
    if (!root) return;

    // One-time delegated click handler inside the shadow root
    if (!root.__sfrDelegation) {
      root.__sfrDelegation = true;
      root.addEventListener('click', async (e) => {
        const path = (e.composedPath && e.composedPath()) || [];
        const hit = path.find((el) => el?.tagName === 'SK-ACTION-BUTTON' && el.classList?.contains('send-review'));
        if (!hit) return;
        if (hit.hasAttribute('aria-busy')) return; // avoid double-clicks during in-flight

        const webhook = resolveWebhook();
        const ctx = getSidekickContext();
        const payload = buildPayload(ctx);

        // Minimal in-flight feedback (no persistence)
        hit.setAttribute('aria-busy', 'true');
        hit.setAttribute('disabled', '');
        try {
          await postToWebhook(webhook, payload);
          alert('Review request submitted.');
        } catch (err) {
          console.error('[SFR] webhook failed:', err);
          alert(`Send For Review failed: ${err.message}`);
        } finally {
          hit.removeAttribute('aria-busy');
          hit.removeAttribute('disabled');
        }
      }, { capture: true });
    }

    // Insert button now or when the bar renders
    let btn = ensureButton(root);
    if (!btn) {
      if (!customElements.get('sk-action-button')) {
        customElements.whenDefined('sk-action-button').then(() => { btn = btn || ensureButton(root); });
      }
      const mo = new MutationObserver(() => { btn = btn || ensureButton(root); if (btn) mo.disconnect(); });
      mo.observe(root, { childList: true, subtree: true });
    }
  }

  // Attach now and on readiness events
  if (getHost()) attach();
  ['sidekick-ready', 'helix-sidekick-ready'].forEach((ev) => document.addEventListener(ev, attach));
  if (customElements.whenDefined) {
    customElements.whenDefined('aem-sidekick').then(attach).catch(() => {});
    if (customElements.get('helix-sidekick')) customElements.whenDefined('helix-sidekick').then(attach).catch(() => {});
  }
})();






loadPage();
