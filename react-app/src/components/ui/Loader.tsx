import Skeleton from './Skeleton';

interface LoaderProps {
  message?: string;
  skeleton?: 'page' | 'card' | 'table';
}

export default function Loader({ message = 'Loading…', skeleton = 'page' }: LoaderProps) {
  if (skeleton === 'page') {
    return (
      <div role="status" aria-live="polite" aria-label={message}>
        <Skeleton stats={4} chart lines={3} />
        <span className="ch-hint" style={{ display: 'block', textAlign: 'center', marginTop: 14 }}>{message}</span>
      </div>
    );
  }
  return (
    <div className="ch-loader-wrap" role="status" aria-live="polite">
      <span className="ch-spinner" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
