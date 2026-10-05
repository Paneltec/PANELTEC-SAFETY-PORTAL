import { useEffect, useState } from 'react';
import api from './api';

export default function useAppUpdateBadge(role) {
  const [badge, setBadge] = useState({ total: 0 });
  useEffect(() => {
    if (role !== 'admin') { setBadge({ total: 0 }); return undefined; }
    let stopped = false;
    let checking = false;
    let lastCheck = 0;
    const check = async () => {
      if (checking || Date.now() - lastCheck < 60000) return;
      checking = true;
      lastCheck = Date.now();
      try {
        const { data } = await api.get('/admin/app-updates/check', { timeout: 30000 });
        if (!stopped) setBadge(data.available && !data.busy ? {
          total: 1, label: 'Update',
          title: `App update ${data.release.sha.slice(0, 7)} is available. Open System to install it.`,
        } : { total: 0 });
      } catch {
        if (!stopped) setBadge({ total: 0 });
      } finally { checking = false; }
    };
    check();
    const timer = setInterval(check, 300000);
    window.addEventListener('focus', check);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('focus', check); };
  }, [role]);
  return role === 'admin' ? badge : { total: 0 };
}
