import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plug, ArrowRight, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { INTEGRATIONS } from '../mocks/dashboard';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../components/ui/dialog';

function IntegrationCard({ integ, onConfigure }) {
  const isLive = integ.key === 'navixy';
  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-col"
      data-testid={`integration-card-${integ.key}`}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-display font-bold text-lg shrink-0"
          style={{ backgroundColor: integ.logoBg }}
          aria-hidden="true"
        >
          {integ.logoChar}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-lg font-semibold">{integ.name}</h3>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${isLive ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-amber-soft text-amber-700'}`}
              data-testid={`integration-status-${integ.key}`}
            >
              {isLive ? 'Live API' : integ.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600 leading-relaxed">{integ.purpose}</p>
        </div>
      </div>
      <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
        <span className="text-xs text-slate-400">{isLive ? 'Live · per-org session hash' : 'MOCKED · UI only'}</span>
        {isLive ? (
          <Link
            to="/app/settings/integrations/navixy"
            data-testid={`integration-configure-${integ.key}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline"
          >
            Configure <ArrowRight size={14} />
          </Link>
        ) : (
          <button
            onClick={onConfigure}
            data-testid={`integration-configure-${integ.key}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline"
          >
            Configure <ArrowRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

export default function Integrations() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(null);

  const openModal = (integ) => {
    setActive(integ);
    setOpen(true);
  };

  return (
    <div className="max-w-6xl mx-auto" data-testid="integrations-page">
      <nav className="text-xs text-slate-500 mb-3" aria-label="breadcrumb">
        Settings <span className="mx-1.5">/</span> <span className="text-slate-700">Integrations</span>
      </nav>
      <div className="flex items-start justify-between flex-wrap gap-4 mb-8">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">Integrations</h1>
          <p className="mt-2 text-slate-600 max-w-2xl">
            Connect Paneltec Civil to the tools your team already uses. Configuration is provided by your admin.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-violet-soft text-brand-violet text-xs font-medium border border-violet-200">
          <Plug size={13} /> 4 connectors available
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {INTEGRATIONS.map((integ) => (
          <IntegrationCard key={integ.key} integ={integ} onConfigure={() => openModal(integ)} />
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="integration-modal">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <ShieldAlert size={18} className="text-amber-500" />
              Connect {active?.name}
            </DialogTitle>
            <DialogDescription className="pt-2">
              Configuration will be provided by admin — API credentials pending.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <span className="font-semibold text-slate-700">MOCKED:</span> {active?.purpose}
          </div>
          <DialogFooter>
            <button
              onClick={() => setOpen(false)}
              data-testid="integration-modal-cancel"
              className="px-4 py-2 rounded-lg border border-slate-300 text-sm hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                setOpen(false);
                toast.info('Request sent to admin', { description: 'MOCKED: no email is actually delivered.' });
              }}
              data-testid="integration-modal-request"
              className="px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-medium hover:bg-blue-600"
            >
              Request access
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
