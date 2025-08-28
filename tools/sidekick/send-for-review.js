(() => {
  console.log('✅ sidekick send-for-review.js loaded');

  document.addEventListener('publish-for-review', () => {
    alert('🚀 Publish For Review button clicked!');
    console.log('✅ Event fired: publish-for-review');
  });
})();
