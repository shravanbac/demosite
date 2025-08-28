(() => {
  // eslint-disable-next-line no-console
  alert("📢 publish-for-review.js LOADED");
  console.log('✅ publish-for-review.js loaded');

  document.addEventListener("publish-for-review", () => {
    // eslint-disable-next-line no-console
    alert('🚀 Button clicked!');
    console.log('✅ Event fired: publish-for-review');
  });
})();
