import { memo } from 'react';

interface Props {
  embedUrl: string;
  title: string;
}

/**
 * Lazy-mounted YouTube iframe. Mounted only when this component is rendered;
 * the parent gates that on a user click.
 */
function YouTubeEmbedBase({ embedUrl, title }: Props) {
  return (
    <iframe
      src={`${embedUrl}?autoplay=1&rel=0&modestbranding=1`}
      title={`YouTube player — ${title}`}
      className="aspect-video h-full w-full rounded-lg"
      loading="lazy"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}

export const YouTubeEmbed = memo(YouTubeEmbedBase);
