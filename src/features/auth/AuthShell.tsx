import type { ReactNode } from 'react';

/** Moldura das telas de login/cadastro, com o logo original. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <div className="relative flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,#A42AB8_0%,#7A1290_45%,#6A0E7B_100%)] px-6 pb-8 pt-[calc(2rem+env(safe-area-inset-top))] lg:w-[46%] lg:py-0">
        <img src="/brand/logo.png" alt="Logo Açaí Everest ABC" className="h-44 w-44 object-contain sm:h-56 sm:w-56 lg:h-[26rem] lg:w-[26rem]" style={{ maskImage: 'radial-gradient(circle, #000 52%, transparent 70%)', WebkitMaskImage: 'radial-gradient(circle, #000 52%, transparent 70%)' }} />
        <p className="absolute bottom-6 hidden text-sm font-medium text-white/80 lg:block">Sistema de gestão da loja</p>
      </div>
      <div className="flex flex-1 items-start justify-center bg-surface px-5 py-8 lg:items-center">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-bold tracking-tight text-acai-950">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
