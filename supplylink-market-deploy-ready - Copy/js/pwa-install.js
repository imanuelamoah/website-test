
(function() {
  'use strict';
  let deferredInstallPrompt = null;

  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (localStorage.getItem('sl_install_dismissed') === '1') return;
    const banner = document.getElementById('slInstallBanner');
    if (banner) banner.style.display = 'flex';
  });

  document.addEventListener('DOMContentLoaded', function() {
    const installBtn = document.getElementById('slInstallBtn');
    const dismissBtn = document.getElementById('slInstallDismiss');
    const banner = document.getElementById('slInstallBanner');

    if (installBtn) {
      installBtn.addEventListener('click', async function() {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        if (banner) banner.style.display = 'none';
      });
    }
    if (dismissBtn) {
      dismissBtn.addEventListener('click', function() {
        localStorage.setItem('sl_install_dismissed', '1');
        if (banner) banner.style.display = 'none';
      });
    }
  });

  // Once actually installed, don't show the banner again on future visits
  window.addEventListener('appinstalled', function() {
    localStorage.setItem('sl_install_dismissed', '1');
    const banner = document.getElementById('slInstallBanner');
    if (banner) banner.style.display = 'none';
  });
})();
