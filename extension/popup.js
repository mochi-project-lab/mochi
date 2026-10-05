/* global PetSprite, PetCommon */
(async function () {
  'use strict';
  const api = globalThis.browser || globalThis.chrome;
  const $ = (id) => document.getElementById(id);
  const S = PetCommon.withDefaults(await api.storage.local.get(null));

  const ctx = $('pet').getContext('2d');
  const draw = (m) => { ctx.clearRect(0, 0, 16, 16); PetSprite.draw(ctx, m, S.color, 1); };
  draw('happy');
  setInterval(() => { draw('blink'); setTimeout(() => draw('happy'), 140); }, 3800);
  $('name').textContent = S.petName;
  $('enabled').checked = S.enabled;

  function note(text, action) {
    const n = $('note');
    n.textContent = text || '';
    if (action) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.style.marginTop = '8px';
      b.textContent = action.label;
      b.addEventListener('click', action.run);
      n.appendChild(document.createElement('br'));
      n.appendChild(b);
    }
    n.classList.toggle('show', !!text);
  }

  // Backend status.
  api.runtime.sendMessage({ type: 'health' }).then((r) => {
    const ok = r && r.ok;
    $('dot').className = 'dot ' + (ok ? 'on' : 'off');
    $('status').textContent = ok ? (r.llm ? 'online' : 'online · rules mode') : 'backend offline';
  }, () => { $('status').textContent = 'backend offline'; });

  // Firefox asks for site access separately. Offer to grant it.
  const ORIGINS = ['http://*/*', 'https://*/*'];
  let hasAccess = true;
  const isFirefox = api.runtime.getURL('').startsWith('moz-extension:');
  try { if (isFirefox && api.permissions && api.permissions.contains) hasAccess = await api.permissions.contains({ origins: ORIGINS }); } catch (e) { /* chrome: content scripts are granted */ }

  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  let info = null;
  if (tab && tab.id != null) {
    try { info = await api.tabs.sendMessage(tab.id, { type: 'ping' }); } catch (e) { info = null; }
  }

  const here = $('here');
  if (!info) {
    $('host').textContent = 'not available on this page';
    here.disabled = true;
    $('scan').disabled = true;
    $('site').disabled = true;
    if (!hasAccess) {
      note('Mochi needs access to websites to show the pet.', {
        label: 'Allow on all sites',
        run: async () => { try { await api.permissions.request({ origins: ORIGINS }); window.close(); } catch (e) { /* ignore */ } },
      });
    } else {
      note('Open any website (or reload this tab) to see your pet.');
    }
  } else {
    $('host').textContent = info.host;
    here.checked = !info.hidden;
    if (!info.coin) $('scan').title = 'No coin detected on this page';
  }

  $('enabled').addEventListener('change', (e) => api.storage.local.set({ enabled: e.target.checked }));
  here.addEventListener('change', async (e) => {
    const cur = PetCommon.withDefaults(await api.storage.local.get(null));
    const set = new Set(cur.hiddenSites);
    if (e.target.checked) set.delete(info.host); else set.add(info.host);
    await api.storage.local.set({ hiddenSites: Array.from(set) });
  });

  const needsPet = () => {
    if (!S.enabled || !here.checked) { note('Turn the pet on for this site first.'); return true; }
    return false;
  };
  $('scan').addEventListener('click', async () => {
    if (needsPet()) return;
    const r = await api.tabs.sendMessage(tab.id, { type: 'scanPage' }).catch(() => null);
    if (r && r.ok) window.close();
  });
  $('site').addEventListener('click', async () => {
    if (needsPet()) return;
    const r = await api.tabs.sendMessage(tab.id, { type: 'checkSite' }).catch(() => null);
    if (r && r.ok) window.close();
  });
  $('options').addEventListener('click', (e) => { e.preventDefault(); api.runtime.openOptionsPage(); window.close(); });
})();
