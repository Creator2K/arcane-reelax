(() => {
  let config = null;
  let applying = false;
  const apply = () => {
    if (!config || applying) return;
    applying = true;
    try {
      const branding = config.branding || {};
      const qqGroup = String(branding.qqGroupNumber || '').trim();
      const qqUrl = String(branding.qqGroupUrl || '').trim();
      if (branding.appName && document.title.includes('奥术摸鱼大师')) {
        const nextTitle = document.title.replace('奥术摸鱼大师', String(branding.appName));
        if (document.title !== nextTitle) document.title = nextTitle;
      }
      document.querySelectorAll('.global-notification-community-label').forEach((node) => {
        const next = 'QQ群: ' + qqGroup;
        if (qqGroup && node.textContent !== next) node.textContent = next;
      });
      document.querySelectorAll('.global-notification-community').forEach((node) => {
        if (qqUrl) node.setAttribute('href', qqUrl);
        if (qqGroup) {
          node.setAttribute('title', '加入QQ群 ' + qqGroup);
          node.setAttribute('aria-label', '加入QQ群 ' + qqGroup);
        }
      });
      document.querySelectorAll('.global-notification-copy').forEach((node) => {
        if (qqGroup) node.setAttribute('title', '复制QQ群号 ' + qqGroup);
      });
      document.querySelectorAll('.site-footer span').forEach((node) => {
        const text = node.textContent || '';
        if (branding.policeRecord && text.includes('公网安备') && text !== branding.policeRecord) node.textContent = branding.policeRecord;
        if (branding.icpRecord && text.includes('ICP备') && text !== branding.icpRecord) node.textContent = branding.icpRecord;
      });
    } finally {
      applying = false;
    }
  };
  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('.global-notification-copy') : null;
    if (!target || !config?.branding?.qqGroupNumber) return;
    event.preventDefault();
    event.stopPropagation();
    const value = String(config.branding.qqGroupNumber);
    navigator.clipboard?.writeText(value).catch(() => {});
    const feedback = document.querySelector('.global-notification-copy-feedback');
    if (feedback) {
      feedback.textContent = '已复制 QQ群 ' + value;
      window.setTimeout(() => { feedback.textContent = ''; }, 1800);
    }
  }, true);
  fetch('/api/site-config', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
    .then((response) => response.ok ? response.json() : null)
    .then((value) => {
      if (!value) return;
      config = value;
      window.__ARCANE_SITE_CONFIG__ = Object.freeze(value);
      apply();
    })
    .catch(() => {});
})();
