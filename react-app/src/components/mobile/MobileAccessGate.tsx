import { useState, type ReactNode } from 'react';
import { deviceIsMobile, hasDesktopOverride, setDesktopOverride } from './detect';
import MobileAccessScreen from './MobileAccessScreen';

interface MobileAccessGateProps {
  children: ReactNode;
}

/**
 * Global device gate — evaluated once at startup (zero desktop impact).
 * Mobile visitors see the access screen unless they chose desktop mode,
 * which persists in localStorage under `cloudhub_mobile_override`.
 */
export default function MobileAccessGate({ children }: MobileAccessGateProps) {
  const [mobile] = useState<boolean>(() => deviceIsMobile());
  const [override, setOverride] = useState<boolean>(() => hasDesktopOverride());

  if (!mobile || override) return <>{children}</>;

  const continueToDesktop = () => {
    setDesktopOverride();
    setOverride(true);
  };

  return <MobileAccessScreen onContinue={continueToDesktop} />;
}
