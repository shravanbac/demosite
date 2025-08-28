(() => {
  alert("📢 publish-for-review.js LOADED");
  console.log("✅ publish-for-review.js loaded");

  document.addEventListener("publish-for-review", () => {
    alert("🚀 Button clicked!");
    console.log("✅ Event fired: publish-for-review");
  });
})();
