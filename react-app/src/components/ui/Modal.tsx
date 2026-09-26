import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
}

export default function Modal({ open, title, subtitle, onClose, children, footer, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="ch-modal-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={size === 'lg' ? 'ch-modal ch-modal-lg' : 'ch-modal'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ch-modal-head">
          <div>
            <h2 className="ch-modal-title">{title}</h2>
            {subtitle !== undefined && <p className="ch-modal-sub">{subtitle}</p>}
          </div>
          <button type="button" className="ch-modal-x" onClick={onClose} aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>
        <div className="ch-modal-body">{children}</div>
        {footer !== undefined && <div className="ch-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
