// tools/library/send-for-review-library.js

function buildPayload() {
  const { host, pathname, href } = window.location;
  return {
    title: document.title,
    path: pathname,
    url: href,
    submittedBy: window.Granite?.author?.User?.currentUser || 'anonymous',
    isoNow: new Date().toISOString(),
    host,
  };
}

function addSendForReviewToLibrary() {
  const libContainer = document.querySelector('.library');
  if (!libContainer) return;
  if (libContainer.querySelector('.send-for-review-btn')) return; // already added

  // Create the button
  const btn = document.createElement('button');
  btn.className = 'send-for-review-btn coral-Button coral-Button--primary';
  btn.textContent = 'Send For Review';
  btn.style.margin = '8px';

  btn.addEventListener('click', async () => {
    const payload = buildPayload();

    try {
      await fetch(
        'https://hook.app.workfrontfusion.com/3o5lrlkstfbbrspi35hh0y3cmjkk4gdd',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      // eslint-disable-next-line no-alert
      alert('Review request submitted.');
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(`Send For Review failed: ${err.message}`);
    }
  });

  // Insert into library header
  const header = libContainer.querySelector('.library-header') || libContainer;
  header.appendChild(btn);
}

document.addEventListener('DOMContentLoaded', () => {
  const observer = new MutationObserver(() => {
    const lib = document.querySelector('.library');
    if (lib) {
      addSendForReviewToLibrary();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
});
