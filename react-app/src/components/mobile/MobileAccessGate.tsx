import type { ReactNode } from 'react';

interface MobileAccessGateProps {
  children: ReactNode;
}

/**
 * Responsive web access is enabled for phone and tablet terminals. The
 * component remains as a stable app-shell seam, but no longer replaces the
 * application with the former desktop-only access screen.
 */
export default function MobileAccessGate({ children }: MobileAccessGateProps) {
  return <>{children}</>;
}
