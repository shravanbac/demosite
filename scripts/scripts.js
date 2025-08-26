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
  usage
  =============
  - It injects a "Send For Review" button before Publish and performs a
    single POST to your Fusion webhook when clicked.
  - No persistence, no status polling, no timers — just the POST.
*/

(() => {
  const DEFAULT_WEBHOOK = 'https://hook.app.workfrontfusion.com/3o5lrlkstfbbrspi35hh0y3cmjkk4gdd';
  const LABEL = 'Send For Review';

  /** Resolve webhook URL from global, meta, or default */
  const resolveWebhook = () =>
    (typeof window.__SFR_WEBHOOK_URL === 'string' && window.__SFR_WEBHOOK_URL)
      || document.querySelector('meta[name="sfr:webhook"]')?.content?.trim()
      || DEFAULT_WEBHOOK;

  /** Collect info about current page and sidekick */
  function getSidekickContext() {
      const { host, pathname, href } = window.location;
      let ref = '', site = '', org = '', env = host.includes('.aem.live') ? 'live' : 'page';

      const m = host.match(/^([^-]+)--([^-]+)--([^.]+)\.aem\.(page|live)$/);
      if (m) [, ref, site, org, env] = m;

      const sk = (window.hlx?.sidekick)
        || document.querySelector('aem-sidekick, helix-sidekick')?.sidekick
        || {};
  
  // fallback from sidekick config if still missing
  ref  ||= sk.ref  || sk.branch || sk.gitref || '';
  site ||= sk.repo || sk.site   || '';
  org  ||= sk.owner|| sk.org    || '';


    return {
      ref, site, org, env,
      path: (pathname || '/').replace(/^\//, ''),
      title: document.title || pathname || '/',
      url: href,
      host,
      iso_now: new Date().toISOString()
    };
  }

  /** Construct the JSON object that will be sent to Fusion */
  function buildPayload(ctx) {
    const { ref, site, org, host, path, iso_now } = ctx;
    const hasRepo = ref && site && org;
    const cleanPath = path.replace(/^\/+/, '');
    const name = (cleanPath.split('/').filter(Boolean).pop() || 'index').replace(/\.[^.]+$/, '') || 'index';

    // Try different sources to identify who clicked "Send For Review"
    const userMeta     = document.querySelector('meta[name="sfr:user"]')?.content || undefined;
    const userFromSk   = window.hlx?.sidekick?.user || undefined;
    const userOverride = window.__SFR_USER || undefined;

    // Pick first available value
    const submittedBy = userOverride || userMeta || userFromSk || "anonymous";

    const liveHost = hasRepo
      ? `${ref}--${site}--${org}.aem.live`
      : host?.endsWith('.aem.page') ? host.replace('.aem.page', '.aem.live') : host || 'localhost';

    const previewHost = hasRepo
      ? `${ref}--${site}--${org}.aem.page`
      : host || 'localhost';

    const qMeta = (sel) => document.head.querySelector(sel)?.content || null;
    const metas = (prefix) => {
      const out = {};
      document.head.querySelectorAll(`meta[property^="${prefix}"], meta[name^="${prefix}"]`)
        .forEach((m) => {
          const key = (m.getAttribute('property') || m.getAttribute('name')).replace(`${prefix}:`, '');
          out[key] = m.content;
        });
      return Object.keys(out).length ? out : undefined;
    };

    const payload = {
      // required
      title: ctx.title,
      url: `https://${liveHost}/${cleanPath}`,
      name,
      publishedDate: iso_now,
      submittedBy,

      // context
      path: `/${cleanPath}`,
      previewUrl: `https://${previewHost}/${cleanPath}`,
      liveUrl: `https://${liveHost}/${cleanPath}`,
      host, env: ctx.env, org, site, ref,
      source: 'DA.live',

      // page meta
      lang: document.documentElement.lang || undefined,
      dir: document.documentElement.dir || undefined,
      canonical: document.querySelector('link[rel="canonical"]')?.href,
      meta: {
        description: qMeta('meta[name="description"]'),
        keywords: qMeta('meta[name="keywords"]'),
        author: qMeta('meta[name="author"]'),
        og: metas('og'),
      },

      // content preview
      headings: Array.from(document.querySelectorAll('h1, h2, h3'))
        .slice(0, 6)
        .map(h => ({ level: h.tagName, text: h.textContent.trim() })) || undefined,

      // audit info
      analytics: {
        referrer: document.referrer || undefined,
        userAgent: navigator.userAgent || undefined,
        locale: navigator.language || undefined,
        timezoneOffset: new Date().getTimezoneOffset(),
        viewport: { width: window.innerWidth, height: window.innerHeight },
      },

      idempotencyKey: `${cleanPath}#${iso_now}`,
    };

    // prune empty objects
    const prune = (obj) => {
      Object.keys(obj).forEach((k) => {
        const v = obj[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) prune(v);
        if (v == null || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) {
          delete obj[k];
        }
      });
      return obj;
    };

    return prune(payload);
  }

  /** Send the payload to the webhook */
  async function postToWebhook(webhook, payload) {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      mode: 'cors',
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let meta; try { meta = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}${meta?.message ? ` – ${meta.message}` : text ? ` – ${text}` : ''}`);
    }
    return meta || {};
  }

  /** Initialize the button label and accessibility attributes */
  const setInitialLabel = (btn) => {
    btn.replaceChildren(document.createElement('span'));
    btn.setAttribute('aria-label', LABEL);
    btn.setAttribute('title', LABEL);
  };

  /** Insert the Send For Review button into the Sidekick UI */
  function ensureButton(root) {
    const bar = root.querySelector('plugin-action-bar')?.shadowRoot;
    if (!bar) return null;
    const publish = bar.querySelector('sk-action-button.publish');
    const group = bar.querySelector('.action-group.plugins-container') || publish?.parentNode || bar;

    if (!group) return null;
    let btn = bar.querySelector('sk-action-button.send-review');
    if (btn) return btn;

    const Ctor = customElements.get('sk-action-button');
    btn = Ctor ? new Ctor() : document.createElement('sk-action-button');
    btn.classList.add('send-review');
    btn.dataset.action = 'send-for-review';
    if (publish) {
      [...publish.attributes].forEach(({ name, value }) => {
        if (!['class', 'title', 'aria-label'].includes(name)) btn.setAttribute(name, value);
      });
      publish.parentNode.insertBefore(btn, publish);
    } else {
      btn.setAttribute('quiet', '');
      btn.setAttribute('role', 'button');
      group.insertBefore(btn, null);
    }
    setInitialLabel(btn);
    return btn;
  }

  /** Attach event listeners and insert the button when Sidekick is ready */
  function attach() {
    const host = document.querySelector('aem-sidekick, helix-sidekick');
    const root = host?.shadowRoot;
    if (!root) return;

    if (!root.__sfrDelegation) {
      root.__sfrDelegation = true;
      root.addEventListener('click', async (e) => {
        const hit = e.composedPath().find(
          (el) => el?.tagName === 'SK-ACTION-BUTTON' && el.classList.contains('send-review')
        );
        if (!hit || hit.hasAttribute('aria-busy')) return;

        hit.setAttribute('aria-busy', 'true');
        hit.setAttribute('disabled', '');
        try {
          await postToWebhook(resolveWebhook(), buildPayload(getSidekickContext()));
          alert('Review request submitted.');
        } catch (err) {
          alert(`Send For Review failed: ${err.message}`);
        } finally {
          hit.removeAttribute('aria-busy');
          hit.removeAttribute('disabled');
        }
      }, { capture: true });
    }

    let btn = ensureButton(root);
    if (!btn) {
      customElements.whenDefined('sk-action-button').then(() => { btn ||= ensureButton(root); });
      const mo = new MutationObserver(() => { btn ||= ensureButton(root); if (btn) mo.disconnect(); });
      mo.observe(root, { childList: true, subtree: true });
    }
  }

  // Attach now and on readiness events
  if (document.querySelector('aem-sidekick, helix-sidekick')) attach();
  ['sidekick-ready', 'helix-sidekick-ready'].forEach((ev) => document.addEventListener(ev, attach));
  customElements.whenDefined('aem-sidekick').then(attach).catch(() => {});
  if (customElements.get('helix-sidekick')) customElements.whenDefined('helix-sidekick').then(attach).catch(() => {});
})();

loadPage();
