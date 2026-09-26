import {
  BarChart3,
  Boxes,
  Play,
  MonitorSmartphone,
  ReceiptText,
  Users,
  Blocks,
} from 'lucide-react';
import { PLAY_STORE_URL } from '../../config/app';
import './mobile.css';

interface MobileAccessScreenProps {
  onContinue: () => void;
}

const FEATURES = [
  { icon: ReceiptText, label: 'POS Billing' },
  { icon: Boxes, label: 'Inventory Management' },
  { icon: Users, label: 'Customer Management' },
  { icon: BarChart3, label: 'Reports & Analytics' },
  { icon: Blocks, label: 'Zoho Integration' },
];

export default function MobileAccessScreen({ onContinue }: MobileAccessScreenProps) {
  return (
    <div className="mob-page">
      <div className="mob-blobs" aria-hidden="true">
        <span className="b1" />
        <span className="b2" />
        <span className="b3" />
      </div>

      <main className="mob-card" role="main" aria-labelledby="mob-title">
        <span className="mob-logo" aria-hidden="true">C</span>
        <p className="mob-eyebrow">CloudHub POS</p>
        <h1 id="mob-title" className="mob-title">Mobile Device Detected</h1>
        <p className="mob-sub">
          This application is optimized for desktop environments.
          Install the mobile application or continue using desktop mode.
        </p>

        <div className="mob-actions">
          <a className="mob-btn mob-btn-primary" href={PLAY_STORE_URL} target="_blank" rel="noreferrer">
            <Play size={17} aria-hidden="true" />
            Get App on Play Store
          </a>
          <button type="button" className="mob-btn mob-btn-secondary" onClick={onContinue}>
            <MonitorSmartphone size={17} aria-hidden="true" />
            Continue to Desktop Version
          </button>
        </div>

        <ul className="mob-features" aria-label="Included features">
          {FEATURES.map((f) => (
            <li key={f.label}>
              <f.icon size={15} aria-hidden="true" />
              {f.label}
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
