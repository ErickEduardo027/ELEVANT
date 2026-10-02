import { usePrivateMediaUrl } from '../hooks/usePrivateMediaUrl';

export default function PrivateMediaImage({ url, alt, className = '' }) {
  const src = usePrivateMediaUrl(url);
  return src ? <img src={src} alt={alt} className={className} /> : null;
}
