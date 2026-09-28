import { useState } from 'react';
import { productImageUrl } from '../../services/productService';
import type { Product } from '../../types';

/** Uploaded catalog image with the existing initial as a missing-image fallback. */
export default function ProductImage({ product, className }: { product: Product; className: string }) {
  const src = product.image_id && product.ROWID
    ? productImageUrl(product.ROWID)
    : product.image_url || '';
  const [failedSrc, setFailedSrc] = useState('');
  return (
    <span className={className} aria-hidden="true" style={{ position: 'relative', overflow: 'hidden', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      {src && failedSrc !== src ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailedSrc(src)}
          style={{ width: '100%', height: '100%', objectFit: 'inherit', position: 'absolute', inset: 0 }} />
      ) : product.name.charAt(0).toUpperCase()}
    </span>
  );
}
