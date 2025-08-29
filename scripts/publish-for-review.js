(() => {
  document.addEventListener('publish-for-review', async () => {
    const payload = {
      url: window.location.href,
      title: document.title,
      submittedBy: 'shravan',
      isoNow: new Date().toISOString()
    };

    try {
      const res = await fetch(
        'https://hook.app.workfrontfusion.com/3o5lrlkstfbbrspi35hh0y3cmjkk4gdd',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      );

      if (res.ok) {
        // eslint-disable-next-line no-alert
        alert('✅ Page sent to Workfront Fusion successfully');
      } else {
        // eslint-disable-next-line no-alert
        alert('❌ Workfront Fusion webhook failed: ' + res.status);
      }
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert('❌ Error sending webhook: ' + err.message);
    }
  });
})();
