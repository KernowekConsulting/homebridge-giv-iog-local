'use strict';

(function () {
  const status = document.getElementById('givhome-config-status');
  let passthrough = [];

  homebridge.addEventListener('ready', async () => {
    try {
      const blocks = await homebridge.getPluginConfig();
      const pluginSchema = await homebridge.getPluginConfigSchema();
      const known = new Set(Object.keys((pluginSchema.schema && pluginSchema.schema.properties) || {}));
      passthrough = (blocks || []).map((block) => Object.fromEntries(Object.entries(block)
        .filter(([key]) => !known.has(key) && !['platform', 'accessory', '_bridge'].includes(key))));
      const prepared = Array.isArray(blocks) && blocks.length > 0
        ? blocks.map((block) => GivHomeConfigMigration.migrateExistingConfig(block).config)
        : [{}];
      if (Array.isArray(blocks) && blocks.length > 0) await homebridge.updatePluginConfig(prepared);
      status.textContent = '';
      status.hidden = true;

      // Use the same schema renderer as Homebridge, but keep its working copy
      // separate from the parent's config object. The stock embedded form
      // deletes properties it does not recognise before Save; older GivHome
      // versions and owner-managed extensions may legitimately have such
      // properties. Reconcile every edit back into the parent while retaining
      // those values, then leave Homebridge's normal outer Save button and
      // restart prompt in control.
      let current = prepared[0];
      const form = homebridge.createForm(pluginSchema, prepared[0]);
      const panel = document.createElement('section');
      panel.hidden = !(current.marstekIntegrationEnabled === true || (current.marstekIntegrationEnabled !== false && current.marstekDevices?.length));
      panel.className = 'card mt-3 p-3';
      panel.innerHTML = '<h5>Venus Gateway connection</h5><p class="small">Reads the Gateway and checks its serial. No device settings are changed.</p><button type="button" class="btn btn-primary">Test Gateway connection</button><p class="mt-2" role="status" aria-live="polite"></p><button type="button" class="btn btn-secondary" disabled>Download connection report</button>';
      const commissioningUi=typeof window!=='undefined'&&window.GivHomeCommissioning?window.GivHomeCommissioning.mount(current):null;
      if(commissioningUi)panel.hidden=true;else document.body.appendChild(panel);
      const plainStatus=document.createElement('p');plainStatus.setAttribute('role','status');panel.appendChild(plainStatus);
      const refreshStatus=async()=>{if(panel.hidden)return;try{const state=await homebridge.request('/marstek/status');plainStatus.textContent=state.title+'. '+state.detail;}catch{plainStatus.textContent='Waiting for the battery.';}};
      let statusTimer;const scheduleStatus=()=>{if(panel.hidden){clearInterval(statusTimer);statusTimer=null;}else{refreshStatus();if(!statusTimer)statusTimer=setInterval(refreshStatus,5000);}};scheduleStatus();if(typeof window!=='undefined')window.addEventListener('unload',()=>clearInterval(statusTimer));
      const buttons = panel.querySelectorAll('button'), reportStatus = panel.querySelector('[role="status"]');
      let report = null, settingsRevision = 0;
      buttons[0].onclick = async () => {
        const revision = settingsRevision;
        buttons[0].disabled = true; buttons[1].disabled = true; report = null;
        reportStatus.textContent = 'Checking Gateway…';
        try {
          const result = await homebridge.request('/marstek/gateway-test', { marstekGatewayHost: current.marstekGatewayHost, marstekGatewaySerial: current.marstekGatewaySerial });
          if(revision !== settingsRevision)return;
          report = result;
          reportStatus.textContent = 'Gateway serial verified at ' + new Date(report.observedAtMs).toLocaleTimeString() + '.';
          buttons[1].disabled = false;
        } catch(error) { if(revision === settingsRevision)reportStatus.textContent = 'Gateway not verified: ' + (error.message || String(error)); }
        finally { buttons[0].disabled = false; }
      };
      buttons[1].onclick = () => {
        if(!report)return;
        const { serial, ...redacted } = report;
        const url = URL.createObjectURL(new Blob([JSON.stringify(redacted, null, 2)], {type:'application/json'}));
        const link = document.createElement('a');link.href=url;link.download='givhome-gateway-check.json';link.click();URL.revokeObjectURL(url);
      };
      form.onChange(async (formData) => {
        formData=GivHomeConfigMigration.migrateExistingConfig(formData).config;current = formData; if(commissioningUi)commissioningUi.update(current);panel.hidden = commissioningUi?true:current.marstekIntegrationEnabled !== true; settingsRevision++; scheduleStatus(); report = null; buttons[1].disabled = true; reportStatus.textContent = "Settings changed; test again to verify this Gateway.";
        const merged = [{ ...(passthrough[0] || {}), ...formData }];
        for (let index = 1; index < prepared.length; index += 1) {
          merged.push({ ...(passthrough[index] || {}), ...prepared[index] });
        }
        homebridge.disableSaveButton();
        try { await homebridge.updatePluginConfig(merged); }
        finally { homebridge.enableSaveButton(); }
      });
    } catch (error) {
      status.textContent = 'GivHome could not safely prepare the configuration form. Close this window without saving and try again.';
      homebridge.disableSaveButton();
      homebridge.toast.error(error && error.message ? error.message : String(error), 'Configuration not changed');
    }
  });
}());
